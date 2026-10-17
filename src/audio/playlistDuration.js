export function trackAudioKey(track) {
  return JSON.stringify([track.teamSlug, track.id]);
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

export function summarizeDuration(tracks, durations) {
  let seconds = 0;
  let pending = 0;
  let unavailable = 0;
  for (const track of tracks) {
    const duration = durations[trackAudioKey(track)];
    if (duration === undefined) pending += 1;
    else if (duration === null) unavailable += 1;
    else seconds += duration;
  }
  return { seconds, pending, unavailable };
}

export function readAudioDuration(url, signal) {
  return new Promise((resolve) => {
    const audio = new Audio();
    let timeout;
    const finish = (duration) => {
      clearTimeout(timeout);
      audio.removeEventListener("loadedmetadata", loaded);
      audio.removeEventListener("durationchange", loaded);
      audio.removeEventListener("error", failed);
      signal.removeEventListener("abort", failed);
      audio.removeAttribute("src");
      audio.load();
      resolve(duration);
    };
    const loaded = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) finish(audio.duration);
    };
    const failed = () => finish(null);
    if (signal.aborted) { resolve(null); return; }
    audio.addEventListener("loadedmetadata", loaded);
    audio.addEventListener("durationchange", loaded);
    audio.addEventListener("error", failed);
    signal.addEventListener("abort", failed, { once: true });
    timeout = setTimeout(failed, 15000);
    audio.preload = "metadata";
    audio.src = url;
  });
}

// Share downloads between duration checks and the parade player.
export class PlaylistAudioCache {
  constructor(adminKey) {
    this.adminKey = adminKey;
    this.abort = new AbortController();
    this.entries = new Map();
    this.urls = new Set();
  }

  load(track) {
    const key = trackAudioKey(track);
    if (!this.entries.has(key)) {
      const pending = this.download(track).catch((error) => {
        this.entries.delete(key);
        throw error;
      });
      this.entries.set(key, pending);
    }
    return this.entries.get(key);
  }

  async download(track) {
    const signal = this.abort.signal;
    const query = new URLSearchParams({ playerId: track.id, teamSlug: track.teamSlug });
    const response = await fetch(`/api/admin/voice-file?${query}`, {
      headers: { "x-admin-key": this.adminKey }, signal,
    });
    if (!response.ok) throw new Error(`Could not load ${track.name} from ${track.teamName}. Check that her finished song is uploaded, then try again.`);
    const blob = await response.blob();
    signal.throwIfAborted();
    const url = URL.createObjectURL(blob);
    this.urls.add(url);
    const duration = await readAudioDuration(url, signal);
    signal.throwIfAborted();
    return { url, duration };
  }

  dispose() {
    this.abort.abort();
    this.urls.forEach(URL.revokeObjectURL);
    this.urls.clear();
    this.entries.clear();
  }
}
