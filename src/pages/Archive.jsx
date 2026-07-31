import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

function coachHeaders() {
  const key =
    sessionStorage.getItem("ARCHIVE_COACH_KEY") ||
    sessionStorage.getItem("COACH_KEY") ||
    "";
  const teamSlug = (
    sessionStorage.getItem("ARCHIVE_AUTH_TEAM_SLUG") ||
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
  const [hasCoachSession, setHasCoachSession] = useState(() => Boolean(
    (
      sessionStorage.getItem("ARCHIVE_COACH_KEY") ||
      sessionStorage.getItem("COACH_KEY") ||
      ""
    ).trim() &&
    (
      sessionStorage.getItem("ARCHIVE_AUTH_TEAM_SLUG") ||
      sessionStorage.getItem("TEAM_SLUG") ||
      sessionStorage.getItem("teamSlug") ||
      ""
    ).trim()
  ));
  const [currentSeason, setCurrentSeason] = useState(null);
  const [loginKey, setLoginKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
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
    async function loadCurrentSeason() {
      try {
        const response = await fetch("/api/public/teams");
        const data = await safeJson(response);
        if (!response.ok || data?.ok === false) return;
        if (cancelled) return;
        setCurrentSeason(data.currentSeason || null);
      } catch {
        // The login form will remain available and show no teams.
      }
    }
    loadCurrentSeason();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadArchive() {
      setLoading(true);
      setErr("");
      try {
        const response = await fetch("/api/coach/archive");
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
    if (!hasCoachSession || !teamId) {
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
          if (response.status === 401) {
            sessionStorage.removeItem("ARCHIVE_COACH_KEY");
            sessionStorage.removeItem("ARCHIVE_AUTH_TEAM_SLUG");
            setHasCoachSession(false);
          }
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
  }, [hasCoachSession, teamId]);

  async function loginToArchive() {
    if (!teamId || !loginKey.trim()) return;
    setLoginLoading(true);
    setErr("");
    try {
      const selectedTeam = archive.find((item) => item.team_id === teamId);
      if (!selectedTeam) throw new Error("Select an archived team.");
      const headers = {
        Authorization: `Bearer ${loginKey.trim()}`,
        "x-coach-key": loginKey.trim(),
        "x-team-slug": selectedTeam.team_slug,
      };
      const response = await fetch(
        `/api/coach/archive?teamId=${encodeURIComponent(teamId)}`,
        { headers }
      );
      const data = await safeJson(response);
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || data?.raw || "Invalid coach key.");
      }
      sessionStorage.setItem("ARCHIVE_COACH_KEY", loginKey.trim());
      sessionStorage.setItem("ARCHIVE_AUTH_TEAM_SLUG", selectedTeam.team_slug);
      setLoginKey("");
      setHasCoachSession(true);
    } catch (error) {
      setErr(error?.message || String(error));
    } finally {
      setLoginLoading(false);
    }
  }

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

  if (!hasCoachSession) {
    return (
      <div className="page" style={{ maxWidth: 620, margin: "0 auto" }}>
        <div className="card">
          <h1 style={{ marginTop: 0 }}>Walk-Up Song Archive</h1>
          <div style={{ fontWeight: 900 }}>
            Current season: {currentSeason?.label || "Loading…"}
          </div>
          <p>Select an archived season and team, then enter that team’s coach key.</p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <div>
              <label className="label">Archived season</label>
              <select
                className="input"
                value={seasonId}
                onChange={(event) => {
                  const nextSeasonId = event.target.value;
                  const firstTeam = archive.find((row) => row.season_id === nextSeasonId);
                  setSeasonId(nextSeasonId);
                  setTeamId(firstTeam?.team_id || "");
                }}
                disabled={seasons.length === 0}
              >
                {seasons.map((season) => (
                  <option key={season.id} value={season.id}>{season.label}</option>
                ))}
                {seasons.length === 0 ? <option value="">No archived seasons found</option> : null}
              </select>
            </div>
            <div>
              <label className="label">Archived team</label>
              <select
                className="input"
                value={teamId}
                onChange={(event) => setTeamId(event.target.value)}
                disabled={teams.length === 0}
              >
                {teams.map((item) => (
                  <option key={item.team_id} value={item.team_id}>{item.team_name}</option>
                ))}
                {teams.length === 0 ? <option value="">No archived teams found</option> : null}
              </select>
            </div>
          </div>

          <label className="label" style={{ marginTop: 14 }}>Coach key</label>
          <input
            className="input"
            type={showKey ? "text" : "password"}
            value={loginKey}
            onChange={(event) => setLoginKey(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" ? loginToArchive() : null}
            placeholder="Enter coach key…"
          />
          <label style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={showKey} onChange={() => setShowKey((value) => !value)} />
            Show key
          </label>

          {err ? <div style={{ marginTop: 12, color: "crimson" }}><strong>Error:</strong> {err}</div> : null}

          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              className="btn"
              onClick={loginToArchive}
              disabled={!teamId || !loginKey.trim() || loginLoading}
            >
              {loginLoading ? "Logging in…" : "Open Archive"}
            </button>
            <Link className="btn-secondary" to="/coach">Back to Current Season</Link>
          </div>
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
            <div style={{ marginTop: 6, fontWeight: 900 }}>
              Current season: {currentSeason?.label || "Loading…"} · Viewing archive
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
