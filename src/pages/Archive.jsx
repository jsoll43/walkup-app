import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

function coachHeaders() {
  const key = sessionStorage.getItem("COACH_KEY") || "";
  const teamSlug = (
    sessionStorage.getItem("TEAM_SLUG") ||
    sessionStorage.getItem("teamSlug") ||
    ""
  ).trim().toLowerCase();
  return {
    Authorization: `Bearer ${key}`,
    "x-coach-key": key,
    "x-team-slug": teamSlug,
  };
}

function formatPlayer(player) {
  const name = `${player?.first || ""} ${player?.last || ""}`.trim();
  return player?.number ? `#${player.number} ${name}` : name;
}

async function safeJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export default function Archive() {
  const [archive, setArchive] = useState([]);
  const [seasonId, setSeasonId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [team, setTeam] = useState(null);
  const [roster, setRoster] = useState([]);
  const [songStatus, setSongStatus] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [playingPlayerId, setPlayingPlayerId] = useState("");
  const audioRef = useRef(null);
  const audioUrlRef = useRef("");

  const seasons = useMemo(() => {
    const byId = new Map();
    for (const row of archive) {
      if (!byId.has(row.season_id)) {
        byId.set(row.season_id, {
          id: row.season_id,
          label: row.season_label,
        });
      }
    }
    return [...byId.values()];
  }, [archive]);

  const teams = useMemo(
    () => archive.filter((row) => row.season_id === seasonId),
    [archive, seasonId]
  );

  function stopAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    }
    setPlayingPlayerId("");
  }

  useEffect(() => stopAudio, []);

  useEffect(() => {
    let cancelled = false;
    async function loadArchive() {
      setLoading(true);
      setErr("");
      try {
        const response = await fetch("/api/coach/archive", { headers: coachHeaders() });
        const data = await safeJson(response);
        if (!response.ok || data?.ok === false) {
          throw new Error(data?.error || data?.raw || "Could not load the archive.");
        }
        if (cancelled) return;
        const rows = Array.isArray(data.archive) ? data.archive : [];
        setArchive(rows);
        if (rows.length) {
          setSeasonId(rows[0].season_id);
          setTeamId(rows[0].team_id);
        }
      } catch (error) {
        if (!cancelled) setErr(error?.message || String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadArchive();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!teamId) {
      setTeam(null);
      setRoster([]);
      setSongStatus({});
      return;
    }
    let cancelled = false;
    async function loadRoster() {
      setLoading(true);
      setErr("");
      stopAudio();
      try {
        const response = await fetch(
          `/api/coach/archive?teamId=${encodeURIComponent(teamId)}`,
          { headers: coachHeaders() }
        );
        const data = await safeJson(response);
        if (!response.ok || data?.ok === false) {
          throw new Error(data?.error || data?.raw || "Could not load the archived roster.");
        }
        if (!cancelled) {
          setTeam(data.team || null);
          setRoster(Array.isArray(data.roster) ? data.roster : []);
          setSongStatus(data.songStatus || {});
        }
      } catch (error) {
        if (!cancelled) setErr(error?.message || String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadRoster();
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  async function play(playerId) {
    setErr("");
    stopAudio();
    try {
      const response = await fetch(
        `/api/coach/archive-file?teamId=${encodeURIComponent(teamId)}&playerId=${encodeURIComponent(playerId)}`,
        { headers: coachHeaders() }
      );
      if (!response.ok) {
        const data = await safeJson(response);
        throw new Error(data?.error || data?.raw || "Could not play this song.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audioUrlRef.current = url;
      audio.onended = stopAudio;
      setPlayingPlayerId(playerId);
      await audio.play();
    } catch (error) {
      setErr(error?.message || String(error));
      stopAudio();
    }
  }

  const hasCoachSession = Boolean(
    (sessionStorage.getItem("COACH_KEY") || "").trim() &&
    (
      sessionStorage.getItem("TEAM_SLUG") ||
      sessionStorage.getItem("teamSlug") ||
      ""
    ).trim()
  );

  if (!hasCoachSession) {
    return (
      <div className="page">
        <div className="card">
          <h1 style={{ marginTop: 0 }}>Walk-Up Song Archive</h1>
          <p>Log in on the coach page before opening the archive.</p>
          <Link className="btn" to="/coach">Go to Coach Login</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 900, margin: "0 auto" }}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0 }}>Walk-Up Song Archive</h1>
            <div style={{ marginTop: 6, opacity: 0.75 }}>
              Every rostered player is available here, regardless of the saved lineup.
            </div>
          </div>
          <Link className="btn-secondary" to="/coach">Back to Current Season</Link>
        </div>

        {err ? <div style={{ marginTop: 12, color: "crimson" }}><strong>Error:</strong> {err}</div> : null}

        <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div>
            <label className="label">Season</label>
            <select
              className="input"
              value={seasonId}
              onChange={(event) => {
                const nextSeasonId = event.target.value;
                const firstTeam = archive.find((row) => row.season_id === nextSeasonId);
                setSeasonId(nextSeasonId);
                setTeamId(firstTeam?.team_id || "");
              }}
            >
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>{season.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Team</label>
            <select className="input" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
              {teams.map((item) => (
                <option key={item.team_id} value={item.team_id}>{item.team_name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{team ? `${team.season_label} — ${team.name}` : "Archived roster"}</h2>
        {loading ? (
          <div style={{ opacity: 0.75 }}>Loading…</div>
        ) : archive.length === 0 ? (
          <div style={{ opacity: 0.75 }}>No archived seasons are available yet.</div>
        ) : roster.length === 0 ? (
          <div style={{ opacity: 0.75 }}>This archived team has no rostered players.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {roster.map((player) => {
              const hasSong = Boolean(songStatus[player.id]);
              const isPlaying = playingPlayerId === player.id;
              return (
                <div key={player.id} className="coach-add-row">
                  <div>
                    <div className="coach-add-name">{formatPlayer(player)}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      {hasSong ? "Song archived" : "No song archived"}
                    </div>
                  </div>
                  <button
                    className={isPlaying ? "btn-secondary" : "btn"}
                    disabled={!hasSong}
                    onClick={() => isPlaying ? stopAudio() : play(player.id)}
                  >
                    {isPlaying ? "Stop" : "Play Song"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
