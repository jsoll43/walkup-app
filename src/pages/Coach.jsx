// src/pages/Coach.jsx
import { useEffect, useMemo, useRef, useState } from "react";

function getSavedCoachKey() {
  return sessionStorage.getItem("COACH_KEY") || "";
}
function saveCoachKey(k) {
  sessionStorage.setItem("COACH_KEY", k);
}
function clearCoachKey() {
  sessionStorage.removeItem("COACH_KEY");
}

function formatPlayer(p) {
  if (!p) return "";
  const name = `${p.first || ""} ${p.last || ""}`.trim();
  if (p.number) return `#${p.number} ${name}`.trim();
  return name || p.id;
}

function formatET(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

async function safeJsonOrText(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function clampIndex(idx, length) {
  if (length <= 0) return 0;
  const n = Number.isFinite(idx) ? idx : 0;
  return Math.max(0, Math.min(n, length - 1));
}

export default function Coach() {
  const [loginKey, setLoginKey] = useState("");
  const [coachKey, setCoachKey] = useState(getSavedCoachKey());
  const [isAuthed, setIsAuthed] = useState(false);

  const [roster, setRoster] = useState([]);
  const rosterById = useMemo(() => new Map(roster.map((p) => [p.id, p])), [roster]);

  const [lineupIds, setLineupIds] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [updatedAt, setUpdatedAt] = useState("");
  const [version, setVersion] = useState(0);

  const [lastSavedAt, setLastSavedAt] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");

  const audioRef = useRef(null);
  const [playingPlayerId, setPlayingPlayerId] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);

  const lineupDisplay = useMemo(() => {
    return lineupIds.map((id) => rosterById.get(id) || { id, number: "", first: id, last: "", _missing: true });
  }, [lineupIds, rosterById]);

  const lastId = lineupIds[currentIndex - 1] || "";
  const nowId = lineupIds[currentIndex] || "";
  const nextId = lineupIds[currentIndex + 1] || "";

  const lastP = lastId ? rosterById.get(lastId) || { id: lastId, first: lastId, last: "", number: "" } : null;
  const nowP = nowId ? rosterById.get(nowId) || { id: nowId, first: nowId, last: "", number: "" } : null;
  const nextP = nextId ? rosterById.get(nextId) || { id: nextId, first: nextId, last: "", number: "" } : null;

  function stopAudio() {
    try {
      const a = audioRef.current;
      if (a) {
        a.pause();
        a.currentTime = 0;
      }
    } catch {}
    setIsPlaying(false);
    setPlayingPlayerId("");
  }

  async function fetchRoster(key, silent = false) {
    if (!silent) setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/roster", {
        headers: {
          Authorization: `Bearer ${key}`,
          "x-coach-key": key,
        },
      });
      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.raw || `Roster failed (HTTP ${res.status})`);
      setRoster(Array.isArray(data.roster) ? data.roster : []);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function fetchState(key, silent = false) {
    if (!silent) setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/coach/state", {
        headers: { Authorization: `Bearer ${key}` },
      });
      const json = await safeJsonOrText(res);
      if (!res.ok || json?.ok === false) throw new Error(json?.error || json?.raw || `State failed (HTTP ${res.status})`);

      const ids = Array.isArray(json.lineupIds) ? json.lineupIds : [];
      const idx = Number.isFinite(json.currentIndex) ? json.currentIndex : 0;

      setLineupIds(ids);
      setCurrentIndex(clampIndex(idx, ids.length));
      setUpdatedAt(json.updatedAt || "");
      setVersion(Number(json.version || 0));
      if (json.updatedAt) setLastSavedAt(json.updatedAt);
    } catch (e) {
      const msg = e?.message || String(e);
      setErr(msg);
      if (msg.toLowerCase().includes("unauthorized")) setIsAuthed(false);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function saveState(key, nextLineupIds, nextCurrentIndex) {
    setSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/coach/state", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          lineupIds: nextLineupIds,
          currentIndex: nextCurrentIndex,
          clientVersion: version,
        }),
      });

      if (res.status === 409) {
        const json = await safeJsonOrText(res);
        if (json?.server) {
          setLineupIds(json.server.lineupIds || []);
          setCurrentIndex(clampIndex(Number(json.server.currentIndex || 0), (json.server.lineupIds || []).length));
          setUpdatedAt(json.server.updatedAt || "");
          setVersion(Number(json.server.version || 0));
        }
        throw new Error(json?.message || "Conflict: another coach updated the lineup.");
      }

      const json = await safeJsonOrText(res);
      if (!res.ok || json?.ok === false) throw new Error(json?.error || json?.raw || `Save failed (HTTP ${res.status})`);

      if (json.updatedAt) {
        setUpdatedAt(json.updatedAt);
        setLastSavedAt(json.updatedAt);
      }
      if (Number.isFinite(json.version)) setVersion(Number(json.version));
      if (Array.isArray(json.lineupIds)) setLineupIds(json.lineupIds);
      if (Number.isFinite(json.currentIndex)) setCurrentIndex(clampIndex(json.currentIndex, (json.lineupIds || nextLineupIds).length));
    } catch (e) {
      const msg = e?.message || String(e);
      setErr(msg);
      if (msg.toLowerCase().includes("unauthorized")) setIsAuthed(false);
    } finally {
      setSaving(false);
    }
  }

  async function tryLogin(key) {
    setErr("");
    setLoading(true);
    try {
      const res = await fetch("/api/coach/state", {
        headers: { Authorization: `Bearer ${key}` },
      });
      const json = await safeJsonOrText(res);
      if (!res.ok || json?.ok === false) throw new Error(json?.error || json?.raw || "Unauthorized");

      setIsAuthed(true);
      setCoachKey(key);
      saveCoachKey(key);
      setLoginKey("");

      const ids = Array.isArray(json.lineupIds) ? json.lineupIds : [];
      const idx = Number.isFinite(json.currentIndex) ? json.currentIndex : 0;

      setLineupIds(ids);
      setCurrentIndex(clampIndex(idx, ids.length));
      setUpdatedAt(json.updatedAt || "");
      setVersion(Number(json.version || 0));
      if (json.updatedAt) setLastSavedAt(json.updatedAt);

      await fetchRoster(key, true);
    } catch (e) {
      setIsAuthed(false);
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function playForPlayerId(playerId) {
    if (!playerId) return;
    setErr("");
    stopAudio();

    try {
      const res = await fetch(`/api/coach/final-file?playerId=${encodeURIComponent(playerId)}`, {
        headers: { Authorization: `Bearer ${coachKey}` },
      });

      if (res.status === 404) throw new Error("No final clip uploaded for this player yet.");
      if (!res.ok) throw new Error(await res.text());

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = new Audio(url);
      audioRef.current = a;

      a.onended = () => {
        setIsPlaying(false);
        setPlayingPlayerId("");
        URL.revokeObjectURL(url);
      };
      a.onpause = () => setIsPlaying(false);
      a.onplay = () => setIsPlaying(true);

      setPlayingPlayerId(playerId);
      await a.play();
    } catch (e) {
      setErr(e?.message || String(e));
    }
  }

  // NEW: supports "next" to wrap to top when at end
  async function setCurrentAndMaybePlay(indexOrKeyword, shouldPlay) {
    if (lineupIds.length === 0) return;

    let nextIdx;
    if (indexOrKeyword === "next") {
      nextIdx = currentIndex + 1;
      if (nextIdx >= lineupIds.length) nextIdx = 0; // wrap
    } else {
      nextIdx = clampIndex(indexOrKeyword, lineupIds.length);
    }

    setCurrentIndex(nextIdx);
    await saveState(coachKey, lineupIds, nextIdx);

    if (shouldPlay) {
      const pid = lineupIds[nextIdx];
      if (pid) await playForPlayerId(pid);
    }
  }

  function moveItem(from, to) {
    if (to < 0 || to >= lineupIds.length) return lineupIds;
    if (from === to) return lineupIds;
    const copy = [...lineupIds];
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    return copy;
  }

  function addToLineup(playerId) {
    if (!playerId) return;
    if (lineupIds.includes(playerId)) return;
    setLineupIds([...lineupIds, playerId]);
  }

  function removeFromLineup(idx) {
    const copy = [...lineupIds];
    copy.splice(idx, 1);
    const nextIdx = clampIndex(currentIndex, copy.length);
    setLineupIds(copy);
    setCurrentIndex(nextIdx);
  }

  function clearLineup() {
    setLineupIds([]);
    setCurrentIndex(0);
  }

  const availableRoster = useMemo(() => {
    const s = search.trim().toLowerCase();
    const inLineup = new Set(lineupIds);
    return roster
      .filter((p) => !inLineup.has(p.id))
      .filter((p) => {
        if (!s) return true;
        const hay = `${p.number || ""} ${p.first || ""} ${p.last || ""}`.toLowerCase();
        return hay.includes(s);
      });
  }, [roster, lineupIds, search]);

  useEffect(() => {
    const saved = getSavedCoachKey();
    if (saved) tryLogin(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isAuthed || !coachKey) return;
    const id = setInterval(() => {
      fetchState(coachKey, true);
      fetchRoster(coachKey, true);
    }, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, coachKey]);

  if (!isAuthed) {
    return (
      <div className="page">
        <div className="card">
          <h1 style={{ marginTop: 0 }}>Coach Login</h1>

          <div style={{ marginTop: 14 }}>
            <label className="label">Coach Key</label>
            <input
              type="password"
              value={loginKey}
              onChange={(e) => setLoginKey(e.target.value)}
              placeholder="Enter coach key…"
              className="input"
            />
          </div>

          <button className="btn" onClick={() => tryLogin(loginKey)} disabled={!loginKey || loading} style={{ marginTop: 12, width: "100%" }}>
            {loading ? "Logging in…" : "Log in"}
          </button>

          {err ? (
            <div style={{ marginTop: 12, color: "crimson" }}>
              <strong>Error:</strong> {err}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      {err ? (
        <div className="card" style={{ borderColor: "rgba(220,38,38,0.35)", marginBottom: 12 }}>
          <div style={{ color: "crimson" }}>
            <strong>Error:</strong> {err}
          </div>
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="cardTitle">Game mode</div>

        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 900 }}>LAST UP</div>
          <div style={{ fontSize: 18, opacity: lastP ? 1 : 0.4, marginBottom: 10 }}>{lastP ? formatPlayer(lastP) : "—"}</div>

          <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 900 }}>NOW BATTING</div>
          <div style={{ marginTop: 8, marginBottom: 12, padding: 14, borderRadius: 16, border: "3px solid #111", background: "#e9e9e9" }}>
            <div style={{ fontSize: 36, fontWeight: 1100, lineHeight: 1.1, color: "#111" }}>
              {nowP ? formatPlayer(nowP) : "No lineup set"}
            </div>
          </div>

          <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 900 }}>NEXT UP</div>
          <div style={{ fontSize: 18, opacity: nextP ? 1 : 0.4 }}>{nextP ? formatPlayer(nextP) : "—"}</div>
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn" onClick={() => (nowId ? playForPlayerId(nowId) : null)} disabled={!nowId}>
            ▶️ Play Now
          </button>
          <button className="btn-secondary" onClick={stopAudio}>
            ⏸ Pause/Stop
          </button>

          {/* CHANGED: always enabled if lineup exists, wraps to top */}
          <button className="btn" onClick={() => setCurrentAndMaybePlay("next", true)} disabled={lineupIds.length === 0}>
            ⏭ Next + Play
          </button>

          <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.8 }}>
            {updatedAt ? `Last update (ET): ${formatET(updatedAt)}` : ""}
            {isPlaying && playingPlayerId ? ` • Playing` : ""}
          </div>

          <button className="btn-secondary" onClick={() => { fetchState(coachKey); fetchRoster(coachKey); }} disabled={loading || saving}>
            Refresh
          </button>

          <button
            className="btn-secondary"
            onClick={() => {
              stopAudio();
              clearCoachKey();
              setIsAuthed(false);
              setCoachKey("");
              setLoginKey("");
              setErr("");
            }}
          >
            Log out
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Build lineup (add players who showed up)</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search roster…"
            className="input"
            style={{ width: 240, maxWidth: "100%" }}
          />
          <button className="btn-secondary" onClick={clearLineup}>
            Clear lineup
          </button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {availableRoster.length === 0 ? (
            <div style={{ opacity: 0.75 }}>No available players (or all are already in the lineup).</div>
          ) : (
            availableRoster.map((p) => (
              <div key={p.id} className="coach-add-row">
                <div className="coach-add-name">{formatPlayer(p)}</div>
                <button className="btn" onClick={() => addToLineup(p.id)}>
                  Add
                </button>
              </div>
            ))
          )}
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          Tip: Create today’s lineup by adding only players who are present, then reorder below and click “Save lineup”.
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Lineup</h2>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {lastSavedAt ? (
              <div style={{ fontSize: 12, opacity: 0.85 }}>
                Last saved (ET): <strong>{formatET(lastSavedAt)}</strong>
              </div>
            ) : null}
            <button className="btn" onClick={() => saveState(coachKey, lineupIds, currentIndex)} disabled={saving}>
              {saving ? "Saving…" : "Save lineup"}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {lineupDisplay.length === 0 ? (
            <div style={{ opacity: 0.75 }}>No lineup set yet.</div>
          ) : (
            lineupDisplay.map((p, idx) => {
              const isCurrent = idx === currentIndex;
              return (
                <div key={`${p.id}-${idx}`} className={`coach-row ${isCurrent ? "current" : ""}`}>
                  <div className="coach-pos">{idx + 1}.</div>

                  <div className="coach-main">
                    <div className="coach-name">
                      {isCurrent ? <span className="coach-pill">CURRENT</span> : null}
                      <span style={{ fontWeight: 1000 }}>{formatPlayer(p)}</span>
                      {p._missing ? <span style={{ marginLeft: 8, opacity: 0.7 }}>(missing)</span> : null}
                    </div>
                  </div>

                  <div className="coach-actions">
                    <button className="btn-secondary" onClick={() => setLineupIds(moveItem(idx, idx - 1))} disabled={idx === 0}>
                      ↑
                    </button>
                    <button className="btn-secondary" onClick={() => setLineupIds(moveItem(idx, idx + 1))} disabled={idx === lineupIds.length - 1}>
                      ↓
                    </button>
                    <button className="btn" onClick={() => setCurrentAndMaybePlay(idx, false)}>
                      Set current
                    </button>
                    <button className="btn-danger" onClick={() => removeFromLineup(idx)}>
                      Remove
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          Tip: Reorder with ↑/↓ then click “Save lineup”. If another coach saved changes, you’ll get a conflict message instead of overwriting.
        </div>
      </div>
    </div>
  );
}
