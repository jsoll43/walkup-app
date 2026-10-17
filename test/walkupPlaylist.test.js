import assert from "node:assert/strict";
import test from "node:test";
import { WalkupPlaylist } from "../src/audio/WalkupPlaylist.js";

class FakeAudio extends EventTarget {
  src = "";
  currentTime = 0;
  paused = true;
  plays = [];
  rejection = null;
  getAttribute() { return this.src || null; }
  removeAttribute() { this.src = ""; }
  load() {}
  pause() { this.paused = true; }
  play() {
    this.paused = false;
    this.plays.push(this.src);
    return this.rejection ? Promise.reject(this.rejection) : Promise.resolve();
  }
}

function setup(urls = ["blob:team-a-player", "blob:team-b-player"]) {
  const audio = new FakeAudio();
  let state;
  const player = new WalkupPlaylist(audio, (value) => { state = value; });
  player.setTracks(urls);
  return { audio, player, state: () => state };
}

test("mixed-team songs advance automatically and wrap continuously", async () => {
  const { audio, player, state } = setup();
  await player.play();
  audio.dispatchEvent(new Event("ended"));
  assert.equal(state().index, 1);
  audio.dispatchEvent(new Event("ended"));
  assert.equal(state().index, 0);
  assert.equal(state().status, "playing");
  assert.deepEqual(audio.plays, ["blob:team-a-player", "blob:team-b-player", "blob:team-a-player"]);
});

test("play once stops after the last song and can restart", async () => {
  const { audio, player, state } = setup();
  player.loop = false;
  await player.play();
  audio.dispatchEvent(new Event("ended"));
  audio.dispatchEvent(new Event("ended"));
  assert.equal(state().status, "completed");
  assert.equal(audio.paused, true);
  assert.equal(audio.plays.length, 2);
  await player.play(0);
  assert.equal(state().index, 0);
  assert.equal(state().status, "playing");
});

test("one-song playlist loops and honors a live change to play once", async () => {
  const { audio, player, state } = setup(["blob:only-song"]);
  await player.play();
  audio.dispatchEvent(new Event("ended"));
  assert.equal(audio.plays.length, 2);
  player.loop = false;
  audio.dispatchEvent(new Event("ended"));
  assert.equal(state().status, "completed");
});

test("pause/resume keeps position; stop resets to the first song", async () => {
  const { audio, player, state } = setup();
  await player.play(1);
  audio.currentTime = 7;
  player.pause();
  audio.dispatchEvent(new Event("ended"));
  assert.equal(state().status, "paused");
  assert.equal(state().index, 1);
  await player.play(1, true);
  assert.equal(audio.currentTime, 7);
  player.stop();
  assert.equal(state().index, 0);
  assert.equal(state().status, "ready");
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.paused, true);
});

test("play rejection gives a recoverable error and Next can skip the song", async () => {
  const { audio, player, state } = setup();
  audio.rejection = new Error("Playback blocked");
  await player.play();
  assert.equal(state().status, "error");
  assert.match(state().error, /Tap Play/);
  audio.rejection = null;
  player.next();
  assert.equal(state().index, 1);
  assert.equal(state().status, "playing");
});

test("stale play rejection cannot overwrite a newer pause", async () => {
  const { audio, player, state } = setup();
  let rejectPlay;
  audio.play = () => new Promise((_, reject) => { rejectPlay = reject; });
  const pending = player.play();
  player.pause();
  rejectPlay(new Error("Interrupted"));
  await pending;
  assert.equal(state().status, "paused");
});

test("replacing the playlist and disposing stop playback and detach handlers", async () => {
  const { audio, player, state } = setup();
  await player.play();
  player.setTracks([]);
  assert.equal(audio.paused, true);
  assert.equal(audio.src, "");
  audio.dispatchEvent(new Event("ended"));
  assert.equal(state().status, "idle");
  player.setTracks(["blob:new-song"]);
  await player.play();
  player.dispose();
  const lastState = state();
  audio.dispatchEvent(new Event("ended"));
  audio.dispatchEvent(new Event("error"));
  assert.equal(state(), lastState);
  assert.equal(audio.paused, true);
  assert.equal(audio.src, "");
});
