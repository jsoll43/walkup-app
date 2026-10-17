// Reuse one audio element across songs so mobile playback stays in the same session.
export class WalkupPlaylist {
  constructor(audio, onChange) {
    this.audio = audio;
    this.onChange = onChange;
    this.urls = [];
    this.index = 0;
    this.loop = true;
    this.status = "idle";
    this.version = 0;
    this.ended = () => {
      if (this.status === "playing") this.next();
    };
    this.failed = () => {
      this.version += 1;
      this.update("error", "This song could not play. Try Play again or skip to the next song.");
    };
    audio.addEventListener("ended", this.ended);
    audio.addEventListener("error", this.failed);
  }

  update(status, error = "") {
    this.status = status;
    this.onChange({ status, index: this.index, error });
  }

  setTracks(urls) {
    this.stop();
    this.urls = urls;
    this.audio.removeAttribute("src");
    this.audio.load();
    this.update(urls.length ? "ready" : "idle");
  }

  async play(index = this.index, resume = false) {
    if (!this.urls[index]) return;
    const version = ++this.version;
    this.index = index;
    if (!resume || this.audio.getAttribute("src") !== this.urls[index]) {
      this.audio.src = this.urls[index];
    }
    this.update("playing");
    try {
      await this.audio.play();
    } catch {
      if (version === this.version) {
        this.update("error", "Playback stopped. Tap Play to continue; if this song still fails, tap Next.");
      }
    }
  }

  pause() {
    this.version += 1;
    this.audio.pause();
    this.update("paused");
  }

  stop() {
    this.version += 1;
    this.audio.pause();
    if (this.audio.getAttribute("src")) this.audio.currentTime = 0;
    this.index = 0;
    this.update(this.urls.length ? "ready" : "idle");
  }

  next() {
    if (!this.urls.length) return;
    const next = this.index + 1;
    if (next < this.urls.length) void this.play(next);
    else if (this.loop) void this.play(0);
    else {
      this.version += 1;
      this.audio.pause();
      this.update("completed");
    }
  }

  dispose() {
    this.version += 1;
    this.audio.removeEventListener("ended", this.ended);
    this.audio.removeEventListener("error", this.failed);
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
  }
}
