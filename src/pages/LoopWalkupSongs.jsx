import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { WalkupPlaylist } from "../audio/WalkupPlaylist.js";
import { removeDuplicatePlayers } from "../audio/playlistPlayers.js";

const STORAGE_KEY = "BGSL_PARADE_PLAYLIST_V1";

function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const tracks = Array.isArray(saved?.tracks) ? saved.tracks.filter((p) =>
      p && typeof p.id === "string" && typeof p.teamSlug === "string" &&
      typeof p.name === "string" && typeof p.teamName === "string"
    ) : [];
    return { tracks, loop: saved?.loop !== false };
  } catch {
    return { tracks: [], loop: true };
  }
}

function playerName(p) {
  return `${p.number ? `#${p.number} ` : ""}${`${p.first || ""} ${p.last || ""}`.trim() || p.id}`;
}

async function getJson(url, key, signal, teamSlug) {
  const res = await fetch(url, {
    headers: { "x-admin-key": key, ...(teamSlug ? { "x-team-slug": teamSlug } : {}) },
    signal,
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function LoopWalkupSongs() {
  const [adminKey] = useState(() => sessionStorage.getItem("ADMIN_KEY") || "");
  const [saved] = useState(readSaved);
  const [tracks, setTracks] = useState(saved.tracks);
  const [loop, setLoop] = useState(saved.loop);
  const [teams, setTeams] = useState([]);
  const [teamSlug, setTeamSlug] = useState("");
  const [roster, setRoster] = useState([]);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState(null);
  const [playback, setPlayback] = useState({ status: "idle", index: 0, error: "" });
  const audioRef = useRef(null);
  const controller = useRef(null);
  const urls = useRef([]);
  const prepareAbort = useRef(null);
  const busy = progress !== null || playback.status === "playing";
  const prepared = !["idle"].includes(playback.status);
  const current = tracks[playback.index];
  const uniqueTracks = removeDuplicatePlayers(tracks);
  const duplicateCount = tracks.length - uniqueTracks.length;

  useEffect(() => {
    const player = new WalkupPlaylist(audioRef.current, setPlayback);
    controller.current = player;
    return () => {
      prepareAbort.current?.abort();
      player.dispose();
      urls.current.forEach(URL.revokeObjectURL);
      urls.current = [];
    };
  }, []);

  useEffect(() => {
    controller.current.loop = loop;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tracks, loop }));
      setStorageError("");
    } catch {
      setStorageError("Your browser could not save this playlist. Keep this page open to retain your list.");
    }
  }, [tracks, loop]);

  useEffect(() => {
    if (!adminKey) return;
    const abort = new AbortController();
    getJson("/api/admin/teams", adminKey, abort.signal)
      .then((data) => setTeams(data.teams || []))
      .catch((e) => { if (!abort.signal.aborted) setError(e.message); })
      .finally(() => { if (!abort.signal.aborted) setLoadingTeams(false); });
    return () => abort.abort();
  }, [adminKey]);

  useEffect(() => {
    if (!teamSlug || !adminKey) return;
    const abort = new AbortController();
    setLoadingRoster(true);
    setRoster([]);
    setError("");
    Promise.all([
      getJson("/api/roster", adminKey, abort.signal, teamSlug),
      getJson("/api/admin/final-status", adminKey, abort.signal, teamSlug),
    ]).then(([data, songs]) => {
      setRoster((data.roster || []).map((p) => ({ ...p, hasSong: Boolean(songs.status?.[p.id]) })));
    }).catch((e) => { if (!abort.signal.aborted) setError(e.message); })
      .finally(() => { if (!abort.signal.aborted) setLoadingRoster(false); });
    return () => abort.abort();
  }, [teamSlug, adminKey]);

  // Ask the device to keep the display awake while songs are playing, when supported.
  useEffect(() => {
    if (playback.status !== "playing" || !navigator.wakeLock) return;
    let lock;
    let disposed = false;
    const requestLock = async () => {
      if (document.visibilityState !== "visible" || (lock && !lock.released)) return;
      try {
        const acquired = await navigator.wakeLock.request("screen");
        if (disposed) await acquired.release();
        else lock = acquired;
      } catch { /* Playback can continue without a screen wake lock. */ }
    };
    void requestLock();
    document.addEventListener("visibilitychange", requestLock);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", requestLock);
      if (lock) void lock.release().catch(() => {});
    };
  }, [playback.status]);

  function changeTracks(next) {
    controller.current.setTracks([]);
    urls.current.forEach(URL.revokeObjectURL);
    urls.current = [];
    setError("");
    setNotice("");
    setTracks(next);
  }

  function addPlayers(players) {
    const team = teams.find((t) => t.slug === teamSlug);
    const additions = players.filter((p) => p.hasSong && !tracks.some((t) => t.teamSlug === teamSlug && t.id === p.id));
    if (!additions.length) return;
    changeTracks([...tracks, ...additions.map((p) => ({
      id: p.id, name: playerName(p), fullName: `${p.first || ""} ${p.last || ""}`.trim(), teamSlug,
      teamName: `${team.name}${team.season_label ? ` (${team.season_label})` : ""}`,
    }))]);
  }

  function move(index, offset) {
    const next = [...tracks];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    changeTracks(next);
  }

  async function prepare() {
    const abort = new AbortController();
    prepareAbort.current = abort;
    const loaded = [];
    setProgress(0);
    setError("");
    try {
      for (const track of tracks) {
        const query = new URLSearchParams({ playerId: track.id, teamSlug: track.teamSlug });
        const res = await fetch(`/api/admin/voice-file?${query}`, {
          headers: { "x-admin-key": adminKey }, signal: abort.signal,
        });
        if (!res.ok) throw new Error(`Could not load ${track.name} from ${track.teamName}. Check that her finished song is uploaded, then try again.`);
        const blob = await res.blob();
        if (abort.signal.aborted) return;
        loaded.push(URL.createObjectURL(blob));
        setProgress(loaded.length);
      }
      urls.current = loaded;
      controller.current.setTracks(loaded);
    } catch (e) {
      if (!abort.signal.aborted) setError(e.message);
    } finally {
      if (abort.signal.aborted || loaded.length !== tracks.length) loaded.forEach(URL.revokeObjectURL);
      if (!abort.signal.aborted) setProgress(null);
    }
  }

  if (!adminKey) return <Navigate to="/admin" replace />;

  return (
    <div className="parade-page">
      <audio ref={audioRef} preload="auto" playsInline />
      <Link className="btn-secondary" to="/admin">Back to Admin</Link>
      <h1>Loop Walkup Songs</h1>
      <p>Build a parade playlist with players from any team. Their finished walkup songs play one after another.</p>
      {error || playback.error ? <div className="card parade-error" role="alert">{error || playback.error}</div> : null}
      {storageError ? <p role="status">{storageError}</p> : null}

      <section className="card parade-player" aria-labelledby="parade-playback-title">
        <h2 id="parade-playback-title">Parade player</h2>
        <label className="parade-mode" htmlFor="parade-mode">Playback mode
          <select id="parade-mode" className="input" value={loop ? "loop" : "once"} onChange={(e) => setLoop(e.target.value === "loop")}>
            <option value="loop">Loop continuously</option>
            <option value="once">Play once</option>
          </select>
        </label>
        <div className="parade-now" role="status" aria-live="polite">
          {progress !== null ? `Preparing songs: ${progress} of ${tracks.length}` :
            playback.status === "completed" ? "Playlist complete" :
            ["playing", "paused", "error"].includes(playback.status) && current ? <>
              <div className="cardTitle">{playback.status === "playing" ? "Now playing" : "Paused"} · {playback.index + 1} of {tracks.length}</div>
              <strong>{current.name}</strong><div>{current.teamName}</div>
              <div className="parade-up-next">Up next: {tracks[playback.index + 1]?.name || (loop ? tracks[0]?.name : "End of playlist")}</div>
            </> : prepared ? `${tracks.length} songs loaded. Ready to play!` : "Add players, then prepare your songs."}
        </div>
        <div className="parade-actions">
          {!prepared ? <button className="btn" disabled={!tracks.length || progress !== null} onClick={prepare}>Prepare songs</button> : <>
            {playback.status === "playing" ? <button className="btn" onClick={() => controller.current.pause()}>Pause</button> :
              <button className="btn" onClick={() => void controller.current.play(playback.status === "completed" ? 0 : playback.index, playback.status === "paused")}>{playback.status === "paused" ? "Resume" : "Play"}</button>}
            <button className="btn-secondary" onClick={() => controller.current.stop()}>Stop / Reset</button>
            <button className="btn-secondary" onClick={() => controller.current.next()}>Next song</button>
          </>}
        </div>
        <p className="parade-hint">Prepare songs while you have reception, then tap Play. Loaded songs stay available while this page is open. Keep the page open and your phone unlocked during the parade.</p>
      </section>

      <div className="parade-columns">
        <section className="card" aria-labelledby="parade-add-title">
          <h2 id="parade-add-title">Add players</h2>
          <label htmlFor="parade-team">Team</label>
          <select id="parade-team" className="input" value={teamSlug} disabled={loadingTeams} onChange={(e) => { setTeamSlug(e.target.value); setRoster([]); }}>
            <option value="">{loadingTeams ? "Loading teams..." : "Select a team"}</option>
            {teams.map((t) => <option key={t.slug} value={t.slug}>{t.name}{t.season_label ? ` — ${t.season_label}` : ""}{t.season_status === "archived" ? " (past season)" : ""}</option>)}
          </select>
          {teamSlug ? <>
            <p className="parade-hint">Switch teams to add more players to the same playlist. Players need a finished walkup song.</p>
            <button className="btn-secondary" disabled={busy || loadingRoster || !roster.some((p) => p.hasSong && !tracks.some((t) => t.teamSlug === teamSlug && t.id === p.id))} onClick={() => addPlayers(roster)}>Add all available players</button>
            {loadingRoster ? <p role="status">Loading players...</p> : !roster.length ? <p>No players on this team.</p> :
              <ul className="parade-list">{roster.map((p) => {
                const added = tracks.some((t) => t.teamSlug === teamSlug && t.id === p.id);
                return <li key={p.id} className="parade-row"><span>{playerName(p)}{!p.hasSong ? <small>No finished song</small> : null}</span>
                  <button className="btn-secondary" disabled={busy || added || !p.hasSong} onClick={() => addPlayers([p])} aria-label={`${added ? "Added" : "Add"} ${playerName(p)}`}>{added ? "Added" : "Add"}</button></li>;
              })}</ul>}
          </> : <p>Select a team to see its players.</p>}
        </section>

        <section className="card" aria-labelledby="parade-list-title">
          <div className="parade-row"><h2 id="parade-list-title">Your playlist ({tracks.length})</h2>
            <div className="parade-actions">
              <button className="btn-secondary" disabled={busy || !duplicateCount} onClick={() => {
                changeTracks(uniqueTracks);
                setNotice(`Removed ${duplicateCount} duplicate ${duplicateCount === 1 ? "entry" : "entries"}.`);
              }}>Remove duplicates{duplicateCount ? ` (${duplicateCount})` : ""}</button>
              <button className="btn-secondary" disabled={busy || !tracks.length} onClick={() => changeTracks([])}>Clear</button>
            </div></div>
          <p className="parade-hint">Saved on this device. Pause playback to edit; prepare songs again after changes.</p>
          <p className="parade-hint">Remove duplicates matches full names across teams and keeps the first entry. Move a player’s preferred team entry above her other entries before removing duplicates.</p>
          {notice ? <p role="status">{notice}</p> : null}
          {!tracks.length ? <p>Your playlist is empty. Add players from a team to get started.</p> :
            <ol className="parade-list">{tracks.map((track, index) => <li key={`${track.teamSlug}/${track.id}`} className={`parade-row ${prepared && index === playback.index ? "parade-current" : ""}`}>
              <span><strong>{index + 1}. {track.name}</strong><small>{track.teamName}</small></span>
              <div className="parade-actions">
                <button className="btn-secondary" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={`Move ${track.name} up`}>↑</button>
                <button className="btn-secondary" disabled={busy || index === tracks.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${track.name} down`}>↓</button>
                <button className="btn-secondary" disabled={busy} onClick={() => changeTracks(tracks.filter((_, i) => i !== index))} aria-label={`Remove ${track.name}`}>Remove</button>
              </div>
            </li>)}</ol>}
        </section>
      </div>
    </div>
  );
}
