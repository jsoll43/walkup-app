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

function formatTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

async function readJsonOrText(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export default function Coach() {
  const [loginKey, setLoginKey] = useState("");
  const [coachKey, setCoachKey] = useState(getSavedCoachKey());
  const [isAuthed, setIsAuthed] = useState(false);

  // Master roster (from D1)
  const [rosterList, setRosterList] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(false);

  // Coach state (persisted in D1 via /api/coach/state)
  const [lineupIds, setLineupIds] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [updatedAt, setUpdatedAt] = useState("");
  const [version, setVersion] = useState(0);

  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");

  // Audio
  const audioRef = useRef(null);
  const [playingPlayerId, setPlayingPlayerId] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);

  const rosterById = useMemo(() => new Map(rosterList.map((p) => [p.id, p])), [rosterList]);

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
    if (!silent) setRosterLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/roster", {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
      });
      const data = await readJsonOrText(res);

      if (!res.ok || data?.ok === false) {
        if (res.status === 401) setIsAuthed(false);
        throw new Error(data?.error || data?.message || data?.raw || `Roster load failed (HTTP ${res.status}).`);
      }

      const list = Array.isArray(data?.roster) ? data.roster : [];
      setRosterList(list);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      if (!silent) setRosterLoading(false);
    }
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
      setVersion(Number(json.version || 0));
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
        const json = await res.json();
        if (json?.server) {
          setLineupIds(json.server.lineupIds || []);
          setCurrentIndex(Number(json.server.currentIndex || 0));
          setUpdatedAt(json.server.updatedAt || "");
          setVersion(Number(json.server.version || 0));
        }
        throw new Error(json?.message || "Conflict: another coach updated the lineup.");
      }

      if (!res.ok) throw new Error(await res.text());

      const json = await res.json();
      if (json.updatedAt) setUpdatedAt(json.updatedAt);
      if (Number.isFinite(json.version)) setVersion(Number(json.version));
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
      setVersion(Number(json.version || 0));

      // Also load master roster
      await fetchRoster(key);
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

      if (res.status === 404) throw new Error(`No final clip uploaded for ${playerId} yet.`);
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
    await saveState(coachKey, lineupIds, clamped);
    if (shouldPlay) await playForPlayerId(lineupIds[clamped]);
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
    if (!rosterById.has(playerId)) return; // only allow from master list
    if (lineupIds.includes(playerId)) return;
    setLineupIds((prev) => [...prev, playerId]);
  }

  function removeFromLineup(indexToRemove) {
    setLineupIds((prev) => {
      if (indexToRemove < 0 || indexToRemove >= prev.length) return prev;
      const copy = [...prev];
      copy.splice(indexToRemove, 1);

      setCurrentIndex((ci) => {
        if (copy.length === 0) return 0;
        if (indexToRemove < ci) return Math.max(0, ci - 1);
        if (indexToRemove === ci) return Math.min(ci, copy.length - 1);
        return Math.min(ci, copy.length - 1);
      });

      return copy;
    });
  }

  useEffect(() => {
    const saved = getSavedCoachKey();
    if (saved) tryLogin(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isAuthed || !coachKey) return;

    const id = setInterval(() => {
      fetchState(coachKey, true);
      // refresh roster occasionally in case admin updates it
      fetchRoster(coachKey, true);
    }, 15000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, coachKey]);

  const availablePlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inLineup = new Set(lineupIds);

    const list = rosterList
      .filter((p) => !inLineup.has(p.id))
      .filter((p) => {
        if (!q) return true;
        const name = `${p.first || ""} ${p.last || ""}`.toLowerCase();
        const num = String(p.number || "").toLowerCase();
        const id = String(p.id || "").toLowerCase();
        return name.includes(q) || num.includes(q) || id.includes(q);
      });

    return list;
  }, [rosterList, lineupIds, search]);

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
          style={{ marginTop: 12, width: "100%", padding: "12px 14px", borderRadius: 12, fontWeight: 900 }}
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

  const lastSavedDisplay = updatedAt ? formatTimestamp(updatedAt) : "";

  return (
    <div style={{ padding: 18, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Coach</h1>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            {lastSavedDisplay ? (
              <>
                Last saved: <strong>{lastSavedDisplay}</strong>
              </>
            ) : (
              ""
            )}
          </div>

          <button
            onClick={() => {
              fetchState(coachKey);
              fetchRoster(coachKey);
            }}
            disabled={loading || saving || rosterLoading}
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

      {/* GAME MODE */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 16, padding: 14 }}>
        <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 900 }}>LAST UP</div>
        <div style={{ fontSize: 18, opacity: lastP ? 1 : 0.4, marginBottom: 10 }}>{lastP ? formatPlayer(lastP) : "—"}</div>

        <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 900 }}>NOW BATTING</div>
        <div
          style={{
            marginTop: 8,
            marginBottom: 12,
            padding: 14,
            borderRadius: 16,
            border: "3px solid #111",
            background: "#d6d6d6",
          }}
        >
          <div style={{ fontSize: 44, fontWeight: 1100, lineHeight: 1.05, color: "#111" }}>
            {nowP ? formatPlayer(nowP) : "No lineup set"}
          </div>
        </div>

        <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 900 }}>NEXT UP</div>
        <div style={{ fontSize: 18, opacity: nextP ? 1 : 0.4 }}>{nextP ? formatPlayer(nextP) : "—"}</div>

        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => (nowId ? playForPlayerId(nowId) : null)}
            disabled={!nowId}
            style={{ padding: "12px 16px", borderRadius: 12, fontWeight: 1000 }}
          >
            ▶️ Play Now
          </button>

          <button onClick={stopAudio} style={{ padding: "12px 16px", borderRadius: 12, fontWeight: 1000 }}>
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

      {/* BUILD LINEUP */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 16, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Build lineup (add players from master roster)</h2>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search roster…"
              style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid #ddd", minWidth: 220 }}
            />

            <button
              onClick={() => {
                setLineupIds([]);
                setCurrentIndex(0);
              }}
              style={{ padding: "10px 14px", borderRadius: 10, fontWeight: 900 }}
            >
              Clear lineup
            </button>
          </div>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {rosterLoading ? (
            <div style={{ opacity: 0.75 }}>Loading roster…</div>
          ) : rosterList.length === 0 ? (
            <div style={{ opacity: 0.8 }}>
              The master roster is empty. Ask the admin to add players in <strong>/admin</strong>.
            </div>
          ) : availablePlayers.length === 0 ? (
            <div style={{ opacity: 0.75 }}>No available players (or all players are already in the lineup).</div>
          ) : (
            availablePlayers.map((p) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid #eee",
                }}
              >
                <div style={{ width: 70, fontWeight: 900, textAlign: "right" }}>{p.number ? `#${p.number}` : ""}</div>
                <div style={{ flex: 1, fontWeight: 900 }}>{`${p.first || ""} ${p.last || ""}`.trim() || p.id}</div>
                <button onClick={() => addToLineup(p.id)} style={{ padding: "10px 12px", borderRadius: 12, fontWeight: 900 }}>
                  Add →
                </button>
              </div>
            ))
          )}
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          Coaches can only add players from the master roster. Admin manages the master list in /admin.
        </div>
      </div>

      {/* LINEUP EDITOR */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 16, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Lineup</h2>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {lastSavedDisplay ? (
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                Last saved: <strong>{lastSavedDisplay}</strong>
              </div>
            ) : null}

            <button
              onClick={() => saveState(coachKey, lineupIds, currentIndex)}
              disabled={saving}
              style={{ padding: "10px 14px", borderRadius: 10, fontWeight: 900 }}
            >
              {saving ? "Saving…" : "Save lineup"}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {lineupDisplay.length === 0 ? (
            <div style={{ opacity: 0.75 }}>Lineup is empty. Add players above.</div>
          ) : (
            lineupDisplay.map((p, idx) => {
              const isCurrent = idx === currentIndex;

              const rowStyle = isCurrent
                ? {
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: 10,
                    paddingLeft: 18,
                    borderRadius: 12,
                    border: "2px solid #111",
                    background: "#2f2f2f",
                    color: "#fff",
                    position: "relative",
                  }
                : {
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid #eee",
                    background: "transparent",
                    color: "inherit",
                  };

              const leftBarStyle = isCurrent
                ? {
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 8,
                    borderTopLeftRadius: 12,
                    borderBottomLeftRadius: 12,
                    background: "#111",
                  }
                : null;

              const badgeStyle = isCurrent
                ? {
                    fontSize: 11,
                    fontWeight: 1000,
                    padding: "4px 8px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.22)",
                    background: "rgba(255,255,255,0.10)",
                    letterSpacing: 0.4,
                  }
                : null;

              const primaryButtonStyle = isCurrent
                ? {
                    flex: 1,
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 12,
                    fontWeight: 1000,
                    color: "inherit",
                    background: "rgba(255,255,255,0.10)",
                    border: "1px solid rgba(255,255,255,0.20)",
                  }
                : {
                    flex: 1,
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 12,
                    fontWeight: 1000,
                  };

              const smallButtonStyle = isCurrent
                ? {
                    padding: "10px 12px",
                    borderRadius: 12,
                    color: "inherit",
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.18)",
                  }
                : { padding: "10px 12px", borderRadius: 12 };

              return (
                <div key={`${p.id}-${idx}`} style={rowStyle}>
                  {leftBarStyle ? <div style={leftBarStyle} /> : null}

                  <div style={{ width: 36, textAlign: "right", fontWeight: 900 }}>{idx + 1}.</div>
                  {isCurrent ? <div style={badgeStyle}>CURRENT</div> : null}

                  <button
                    onClick={() => setCurrentAndMaybePlay(idx, true)}
                    style={primaryButtonStyle}
                    title={p._missing ? `Not found in master roster. ID: ${p.id}` : p.id}
                  >
                    {formatPlayer(p)} {p._missing ? " (ID only)" : ""}
                  </button>

                  <button onClick={() => setLineupIds(moveItem(idx, idx - 1))} disabled={idx === 0} style={smallButtonStyle}>
                    ↑
                  </button>
                  <button
                    onClick={() => setLineupIds(moveItem(idx, idx + 1))}
                    disabled={idx === lineupIds.length - 1}
                    style={smallButtonStyle}
                  >
                    ↓
                  </button>

                  <button onClick={() => setCurrentAndMaybePlay(idx, false)} style={smallButtonStyle}>
                    Set current
                  </button>

                  <button onClick={() => removeFromLineup(idx)} style={smallButtonStyle}>
                    Remove
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          Tip: Reorder with ↑/↓ then click “Save lineup”. Coaches can only add players from the master roster.
        </div>
      </div>
    </div>
  );
}
