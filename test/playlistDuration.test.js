import assert from "node:assert/strict";
import test from "node:test";
import { formatDuration, summarizeDuration, trackAudioKey, readAudioDuration, PlaylistAudioCache } from "../src/audio/playlistDuration.js";

test("formats seconds with minute and hour rollover", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(59.6), "1:00");
  assert.equal(formatDuration(754), "12:34");
  assert.equal(formatDuration(3670), "1:01:10");
});

test("totals follow the current playlist and distinguish unknown from loading lengths", () => {
  const a = { teamSlug: "gold", id: "1" };
  const b = { teamSlug: "blue", id: "1" };
  const c = { teamSlug: "blue", id: "2" };
  const durations = { [trackAudioKey(a)]: 10.25, [trackAudioKey(b)]: 20.75 };
  assert.deepEqual(summarizeDuration([a, b, c], durations), { seconds: 31, pending: 1, unavailable: 0 });
  assert.deepEqual(summarizeDuration([a], durations), { seconds: 10.25, pending: 0, unavailable: 0 });
  assert.deepEqual(summarizeDuration([a, c], { ...durations, [trackAudioKey(c)]: null }), { seconds: 10.25, pending: 0, unavailable: 1 });
  assert.deepEqual(summarizeDuration([], durations), { seconds: 0, pending: 0, unavailable: 0 });
});

function mockAudio(t, shouldLoad = true) {
  const original = globalThis.Audio;
  const instances = [];
  globalThis.Audio = class extends EventTarget {
    constructor() { super(); this.duration = 12.5; instances.push(this); }
    set src(value) {
      this.source = value;
      if (shouldLoad) queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
    }
    removeAttribute() { this.source = ""; }
    load() {}
  };
  t.after(() => {
    if (original === undefined) delete globalThis.Audio;
    else globalThis.Audio = original;
  });
  return instances;
}

test("reads metadata without playback and releases the audio source", async (t) => {
  const instances = mockAudio(t);
  assert.equal(await readAudioDuration("blob:song", new AbortController().signal), 12.5);
  assert.equal(instances[0].source, "");
});

test("aborting a pending metadata check releases its source", async (t) => {
  const instances = mockAudio(t, false);
  const abort = new AbortController();
  const pending = readAudioDuration("blob:song", abort.signal);
  abort.abort();
  assert.equal(await pending, null);
  assert.equal(instances[0].source, "");
});

test("metadata checks and playback reuse a single authenticated download", async (t) => {
  mockAudio(t);
  const requests = [];
  const revoked = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    return new Response(new Blob(["audio"], { type: "audio/mpeg" }));
  });
  t.mock.method(URL, "createObjectURL", () => "blob:cached-song");
  t.mock.method(URL, "revokeObjectURL", (url) => revoked.push(url));
  const cache = new PlaylistAudioCache("test-admin");
  const track = { id: "p1", teamSlug: "gold", name: "Alex", teamName: "Gold" };
  const pending = cache.load(track);
  assert.equal(cache.load(track), pending);
  const song = await pending;
  assert.deepEqual(song, { url: "blob:cached-song", duration: 12.5 });
  assert.equal(await cache.load(track), song);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.headers["x-admin-key"], "test-admin");
  assert.match(requests[0].url, /teamSlug=gold/);
  cache.dispose();
  assert.deepEqual(revoked, ["blob:cached-song"]);
  assert.equal(requests[0].options.signal.aborted, true);
});

test("a failed download can be retried when preparing songs", async (t) => {
  mockAudio(t);
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => {
    attempts += 1;
    return attempts === 1 ? new Response("Missing", { status: 404 }) : new Response(new Blob(["audio"]));
  });
  t.mock.method(URL, "createObjectURL", () => "blob:retry");
  t.mock.method(URL, "revokeObjectURL", () => {});
  const cache = new PlaylistAudioCache("test-admin");
  const track = { id: "p1", teamSlug: "gold", name: "Alex", teamName: "Gold" };
  await assert.rejects(cache.load(track), /Could not load Alex/);
  assert.equal((await cache.load(track)).duration, 12.5);
  assert.equal(attempts, 2);
  cache.dispose();
});
