import { useEffect, useMemo, useRef, useState } from "react";
import { roster } from "../data/roster";

function getSavedCoachKey() {
  return sessionStorage.getItem("COACH_KEY") || "";
}
function saveCoachKey(k) {
  sessionStorage.setItem("COACH_KEY", k);
}
function clearCoachKey() {
  sessionStorage.removeItem("COACH_KEY");
}

export default function Coach() {
  // Auth gate
  const [loginKey, setLoginKey] = useState("");
  const [coachKey, setCoachKey] = useState(getSavedCoachKey());
  const [isAuthed, setIsAuthed] = useState(false);

  // State from server
  const [lineupIds, setLineupIds] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [updatedAt, setUpdatedAt] = useState("");

  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Audio control
  const audioRef = useRef(null);
  const [playingPlayerId, setPlayingPlayerId] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);

  const rosterById = useMemo(() => new Map(roster.map((p) => [p.id, p])), []);

  // IMPORTANT: never filter the lineup when rendering/reordering
  // If a player isn't found in rosterById, we still show them by ID so indices stay correct.
  const lineupDisplay = useMemo(() => {
    return lineupIds.map((id) => {
      const p = rosterById.get(id);
      if (p) return { ...p, _missing: false };
      return { id, number: "", first: id, last: "", _missing: true };
    });
  }, [lineupIds, rosterById]);

  const lastId = lineupIds[currentIndex - 1] || "";
  const nowId = lineupIds[currentIndex] || "";
  const nextId = lineupIds[currentIndex + 1] || "";

  const lastP = lastId ? (rosterById.get(lastId) || { id: lastId, first: lastId, last: "", number: "" }) : null;
  const nowP = nowId ? (rosterById.get(nowId) || { id: nowId, first: nowId, last: "", number: "" }) : null;
  const nextP = nextId ? (rosterById.get(nextId) || { id: nextId, first: nextId, last: "", number: "" }) : null;

  function formatPlayer(p) {
    if (!p) return "";
    const name = `${p.first || ""} ${p.last || ""}`.trim();
    if (p.number) return `#${p.number} ${name}`.trim();
    return name || p.id;
  }

  async function fetchState(key, silent = false) {
    if (!silent) setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/coach/state", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();

      const ids = Array.isArray(json.lineupIds) ? json.lineupIds : [];
      const idx = Number.isFinite(json.currentIndex) ? json.currentIndex : 0;

      setLineupIds(ids);
      setCurrentIndex(Math.max(0, Math.min(idx, Math.max(0, ids.length - 1))));
      setUpdatedAt(json.updatedAt || "");
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
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      if (json.updatedAt) setUpdatedAt(json.updatedAt);
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
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();

      const ids = Array.isArray(json.lineupIds) ? json.lineupIds : [];
      const idx = Number.isFinite(json.currentIndex) ? json.currentIndex : 0;

      setIsAuthed(true);
      setCoachKey(key);
      saveCoachKey(key);
      setLoginKey("");

      setLineupIds(ids);
      setCurrentIndex(Math.max(0, Math.min(idx, Math.max(0, ids.length - 1))));
      setUpdatedAt(json.updatedAt || "");
    } catch (e) {
      setIsAuthed(false);
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

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

  async function playForPlayerId(playerId) {
    if (!playerId) return;

    setErr("");
    stopAudio();

    try {
      const res = await fetch(`/api/coach/final-file?playerId=${encodeURIComponent(playerId)}`, {
        headers: { Authorization: `Bearer ${coachKey}` },
      });

      if (res.status === 404) {
        throw new Error(`No final clip uploaded for ${playerId} yet.`);
      }
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

  async function setCurrentAndMaybePlay(index, shouldPlay) {
    if (lineupIds.length === 0) return;

    const clamped = Math.max(0, Math.min(index, lineupIds.length - 1));
    setCurrentIndex(clamped);

    // Persist so other coaches/devices see it
    await saveState(coachKey, lineupIds, clamped);

    if (shouldPlay) {
      await playForPlayerId(lineupIds[clamped]);
    }
  }

  // Move item within lineupIds (authoritative list)
  function moveItem(from, to) {
    if (from === to) return lineupIds;
    const copy = [...lineupIds];
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    return copy;
  }

  // Auto-login if key exists
  useEffect(() => {
    const saved = getSavedCoachKey();
    if (saved) tryLogin(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll state every 10s so different coach devices stay in sync
  useEffect(() => {
    if (!isAuthed || !coachKey) return;
    const id = setInterval(() => fetchState(coachKey, true), 10000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, coachKey]);

  // LOGIN VIEW
  if (!isAuthed) {
    return (
      <div style={{ padding: 24, maxWidth: 520, margin: "0 auto" }}>
        <h1 style={{ marginTop: 0 }}>Coach Login</h1>

        <div style={{ marginTop: 14 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 900, opacity: 0.75, marginBottom: 6 }}>
            Coach Key
          </label>
          <input
            type="password"
            value={loginKey}
            onChange={(e) => setLoginKey(e.target.value)}
            placeholder="Enter coach key…"
            style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd" }}
          />
        </div>

        <button
          onClick={() => tryLogin(loginKey)}
          disabled={!loginKey || loading}
          style={{
            marginTop: 12,
            width: "100%",
            padding: "12px 14px",
            borderRadius: 12,
            fontWeight: 900,
          }}
        >
          {loading ? "Logging in…" : "Log in"}
        </button>

        {err && (
          <div style={{ marginTop: 12, color: "crimson" }}>
            <strong>Error:</strong> {err}
          </div>
        )}
      </div>
    );
  }

  // DASHBOARD / GAME MODE
  return (
    <div style={{ padding: 18, maxWidth: 980, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Coach</h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            {updatedAt ? `Last update: ${updatedAt}` : ""}
          </div>
          <button
            onClick={() => fetchState(coachKey)}
            disabled={loading || saving}
            style={{ padding: "10px 14px", borderRadius: 10 }}
          >
            Refresh
          </button>
          <button
            onClick={() => {
              stopAudio();
              clearCoachKey();
              setIsAuthed(false);
              setCoachKey("");
              setLoginKey("");
              setErr("");
            }}
            style={{ padding: "10px 14px", borderRadius: 10, fontWeight: 900 }}
          >
            Log out
          </button>
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 10, color: "crimson" }}>
          <strong>Error:</strong> {err}
        </div>
      )}

      {/* GAME MODE CARD */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 16, padding: 14 }}>
        <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 900 }}>LAST UP</div>
        <div style={{ fontSize: 18, opacity: lastP ? 1 : 0.4, marginBottom: 10 }}>
          {lastP ? formatPlayer(lastP) : "—"}
        </div>

        <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 900 }}>NOW BATTING</div>
        <div style={{ fontSize: 40, fontWeight: 1000, margin: "6px 0 10px 0", lineHeight: 1.05 }}>
          {nowP ? formatPlayer(nowP) : "No lineup set"}
        </div>

        <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 900 }}>NEXT UP</div>
        <div style={{ fontSize: 18, opacity: nextP ? 1 : 0.4 }}>
          {nextP ? formatPlayer(nextP) : "—"}
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => (nowId ? playForPlayerId(nowId) : null)}
            disabled={!nowId}
            style={{ padding: "12px 16px", borderRadius: 12, fontWeight: 1000 }}
          >
            ▶️ Play Now
          </button>
          <button
            onClick={stopAudio}
            style={{ padding: "12px 16px", borderRadius: 12, fontWeight: 1000 }}
          >
            ⏸ Pause/Stop
          </button>
          <button
            onClick={() => setCurrentAndMaybePlay(currentIndex + 1, true)}
            disabled={currentIndex >= lineupIds.length - 1}
            style={{ padding: "12px 16px", borderRadius: 12, fontWeight: 1000 }}
          >
            ⏭ Next + Play
          </button>

          <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.7, alignSelf: "center" }}>
            {isPlaying && playingPlayerId ? `Playing: ${playingPlayerId}` : ""}
          </div>
        </div>
      </div>

      {/* LINEUP EDITOR */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 16, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Lineup</h2>
          <button
            onClick={() => saveState(coachKey, lineupIds, currentIndex)}
            disabled={saving}
            style={{ padding: "10px 14px", borderRadius: 10, fontWeight: 900 }}
          >
            {saving ? "Saving…" : "Save lineup"}
          </button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {lineupDisplay.length === 0 ? (
            <div style={{ opacity: 0.75 }}>
              No lineup set yet. (If another coach set it, tap Refresh.)
            </div>
          ) : (
            lineupDisplay.map((p, idx) => {
              const isCurrent = idx === currentIndex;
              return (
                <div
                  key={`${p.id}-${idx}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid #eee",
                    background: isCurrent ? "#f5f5ff" : "transparent",
                  }}
                >
                  <div style={{ width: 36, textAlign: "right", fontWeight: 900 }}>{idx + 1}.</div>

                  <button
                    onClick={() => setCurrentAndMaybePlay(idx, true)}
                    style={{
                      flex: 1,
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 12,
                      fontWeight: 1000,
                    }}
                    title={p._missing ? `Not found in roster.js. ID: ${p.id}` : p.id}
                  >
                    {formatPlayer(p)} {p._missing ? " (ID only)" : ""}
                  </button>

                  <button
                    onClick={() => {
                      const updated = moveItem(idx, idx - 1);
                      setLineupIds(updated);
                    }}
                    disabled={idx === 0}
                    style={{ padding: "10px 12px", borderRadius: 12 }}
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => {
                      const updated = moveItem(idx, idx + 1);
                      setLineupIds(updated);
                    }}
                    disabled={idx === lineupIds.length - 1}
                    style={{ padding: "10px 12px", borderRadius: 12 }}
                  >
                    ↓
                  </button>

                  <button
                    onClick={() => setCurrentAndMaybePlay(idx, false)}
                    style={{ padding: "10px 12px", borderRadius: 12 }}
                  >
                    Set current
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          Tip: Reorder with ↑/↓ then click “Save lineup” so other coaches/devices see it.
        </div>
      </div>
    </div>
  );
}
