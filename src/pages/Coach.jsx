import { useEffect, useMemo, useRef, useState } from "react";
import { roster } from "../data/roster";

function getCoachKey() {
  return sessionStorage.getItem("COACH_KEY") || "";
}

function setCoachKey(k) {
  sessionStorage.setItem("COACH_KEY", k);
}

function clearCoachKey() {
  sessionStorage.removeItem("COACH_KEY");
}

// Placeholder until we wire final clips
function getFinalClipUrl(playerId) {
  return null;
}

async function fetchState(coachKey) {
  const res = await fetch("/api/coach/state", {
    headers: { Authorization: `Bearer ${coachKey}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function saveState(coachKey, lineupIds, currentIndex) {
  const res = await fetch("/api/coach/state", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${coachKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ lineupIds, currentIndex }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function Coach() {
  const defaultIds = useMemo(() => roster.map((p) => p.id), []);
  const [tab, setTab] = useState("lineup");

  const [coachKey, setCoachKeyState] = useState(getCoachKey());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [lineupIds, setLineupIds] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef(null);

  const lineupPlayers = useMemo(() => {
    const byId = new Map(roster.map((p) => [p.id, p]));
    return lineupIds.map((id) => byId.get(id)).filter(Boolean);
  }, [lineupIds]);

  const lastPlayer = lineupPlayers[currentIndex - 1] || null;
  const nowPlayer = lineupPlayers[currentIndex] || null;
  const nextPlayer = lineupPlayers[currentIndex + 1] || null;

  async function loadFromServer(key) {
    setLoading(true);
    setErr("");
    try {
      const s = await fetchState(key);

      // If server lineup is empty, default to roster order and persist it.
      const serverIds = Array.isArray(s.lineupIds) ? s.lineupIds : [];
      const nextIds = serverIds.length ? serverIds : defaultIds;

      setLineupIds(nextIds);
      setCurrentIndex(Number.isInteger(s.currentIndex) ? s.currentIndex : 0);
      setUpdatedAt(s.updatedAt || null);

      if (!serverIds.length) {
        await saveState(key, nextIds, 0);
      }
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  // Load on first key present
  useEffect(() => {
    if (coachKey) loadFromServer(coachKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll every 10s for changes made by another coach
  useEffect(() => {
    if (!coachKey) return;

    const t = setInterval(async () => {
      try {
        const s = await fetchState(coachKey);
        if (s.updatedAt && s.updatedAt !== updatedAt) {
          const serverIds = Array.isArray(s.lineupIds) ? s.lineupIds : [];
          setLineupIds(serverIds);
          setCurrentIndex(Number.isInteger(s.currentIndex) ? s.currentIndex : 0);
          setUpdatedAt(s.updatedAt);
        }
      } catch {
        // ignore polling errors
      }
    }, 10000);

    return () => clearInterval(t);
  }, [coachKey, updatedAt]);

  function stopAudio() {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    try { a.currentTime = 0; } catch {}
    setIsPlaying(false);
  }

  function playNow() {
    if (!nowPlayer) return;
    const url = getFinalClipUrl(nowPlayer.id);
    if (!url) return;

    const a = audioRef.current;
    if (!a) return;
    stopAudio();
    a.src = url;
    a.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
  }

  function goPrev() {
    stopAudio();
    setCurrentIndex((i) => Math.max(0, i - 1));
  }

  function goNext() {
    stopAudio();
    setCurrentIndex((i) => Math.min(lineupPlayers.length - 1, i + 1));
  }

  async function persist(nextIds, nextIndex) {
    if (!coachKey) return;
    setErr("");
    try {
      await saveState(coachKey, nextIds, nextIndex);
      const s = await fetchState(coachKey);
      setUpdatedAt(s.updatedAt || null);
    } catch (e) {
      setErr(e?.message || String(e));
    }
  }

  async function setNow(i) {
    stopAudio();
    const nextIndex = Math.max(0, Math.min(i, lineupPlayers.length - 1));
    setCurrentIndex(nextIndex);
    await persist(lineupIds, nextIndex);
  }

  async function moveUp(i) {
    if (i <= 0) return;
    stopAudio();
    const next = [...lineupIds];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    let nextIndex = currentIndex;
    if (currentIndex === i) nextIndex = i - 1;
    else if (currentIndex === i - 1) nextIndex = i;

    setLineupIds(next);
    setCurrentIndex(nextIndex);
    await persist(next, nextIndex);
  }

  async function moveDown(i) {
    if (i >= lineupIds.length - 1) return;
    stopAudio();
    const next = [...lineupIds];
    [next[i + 1], next[i]] = [next[i], next[i + 1]];
    let nextIndex = currentIndex;
    if (currentIndex === i) nextIndex = i + 1;
    else if (currentIndex === i + 1) nextIndex = i;

    setLineupIds(next);
    setCurrentIndex(nextIndex);
    await persist(next, nextIndex);
  }

  // Auto-advance when clip ends (and persist pointer)
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onEnded = async () => {
      setIsPlaying(false);
      const nextIndex = Math.min(lineupPlayers.length - 1, currentIndex + 1);
      setCurrentIndex(nextIndex);
      await persist(lineupIds, nextIndex);
    };

    a.addEventListener("ended", onEnded);
    return () => a.removeEventListener("ended", onEnded);
  }, [currentIndex, lineupIds, lineupPlayers.length]);

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Coach</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <input
          type="password"
          placeholder="Coach key"
          value={coachKey}
          onChange={(e) => setCoachKeyState(e.target.value)}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", minWidth: 260 }}
        />
        <button
          onClick={() => {
            setCoachKey(coachKey);
            loadFromServer(coachKey);
          }}
          style={{ padding: "10px 14px", borderRadius: 10, fontWeight: 800 }}
        >
          Load
        </button>
        <button
          onClick={() => {
            clearCoachKey();
            setCoachKeyState("");
            setLineupIds([]);
            setCurrentIndex(0);
            setUpdatedAt(null);
          }}
          style={{ padding: "10px 14px", borderRadius: 10 }}
        >
          Clear
        </button>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <button
            onClick={() => setTab("lineup")}
            style={{ padding: "10px 14px", borderRadius: 10, fontWeight: tab === "lineup" ? 900 : 400 }}
          >
            Lineup
          </button>
          <button
            onClick={() => setTab("game")}
            style={{ padding: "10px 14px", borderRadius: 10, fontWeight: tab === "game" ? 900 : 400 }}
          >
            Game Mode
          </button>
        </div>
      </div>

      {loading && <p>Loading…</p>}
      {err && <p style={{ color: "crimson" }}><strong>Error:</strong> {err}</p>}

      {tab === "lineup" && (
        <div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
            Shared across coaches/devices • Last updated: {updatedAt ? new Date(updatedAt).toLocaleString() : "—"}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {lineupPlayers.map((p, i) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: 12,
                  border: "1px solid #ddd",
                  borderRadius: 12,
                }}
              >
                <div>
                  <div style={{ fontWeight: 900 }}>
                    {i === currentIndex ? "👉 " : ""}
                    #{p.number} {p.first} {p.last}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    Final clip: {getFinalClipUrl(p.id) ? "Ready" : "Missing"}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setNow(i)} style={{ padding: "8px 10px", borderRadius: 10 }}>
                    Set Now
                  </button>
                  <button onClick={() => moveUp(i)} style={{ padding: "8px 10px", borderRadius: 10 }}>
                    ↑
                  </button>
                  <button onClick={() => moveDown(i)} style={{ padding: "8px 10px", borderRadius: 10 }}>
                    ↓
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "game" && (
        <div>
          <audio ref={audioRef} />

          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 900 }}>LAST UP</div>
              <div style={{ fontSize: 18, fontWeight: 900 }}>
                {lastPlayer ? `#${lastPlayer.number} ${lastPlayer.first} ${lastPlayer.last}` : "—"}
              </div>
            </div>

            <div style={{ padding: 18, border: "2px solid #111", borderRadius: 16 }}>
              <div style={{ fontSize: 14, opacity: 0.8, fontWeight: 900 }}>NOW BATTING</div>

              <div style={{ fontSize: 34, fontWeight: 900, marginTop: 6, lineHeight: 1.1 }}>
                {nowPlayer ? `#${nowPlayer.number} ${nowPlayer.first} ${nowPlayer.last}` : "No lineup"}
              </div>

              <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={playNow}
                  disabled={!nowPlayer || !getFinalClipUrl(nowPlayer?.id)}
                  style={{ padding: "12px 16px", borderRadius: 12, fontWeight: 900 }}
                >
                  ▶️ Play
                </button>

                <button
                  onClick={stopAudio}
                  disabled={!isPlaying}
                  style={{ padding: "12px 16px", borderRadius: 12, fontWeight: 900 }}
                >
                  ⏹️ Stop
                </button>

                <button onClick={goPrev} style={{ padding: "12px 16px", borderRadius: 12 }}>
                  ⬅️ Back
                </button>

                <button onClick={goNext} style={{ padding: "12px 16px", borderRadius: 12 }}>
                  Next ➡️
                </button>
              </div>
            </div>

            <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 900 }}>ON DECK</div>
              <div style={{ fontSize: 18, fontWeight: 900 }}>
                {nextPlayer ? `#${nextPlayer.number} ${nextPlayer.first} ${nextPlayer.last}` : "—"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
