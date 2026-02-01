// src/pages/ParentLogin.jsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getParentKey, setParentKey, getTeamSlug, setTeam } from "../auth/parentAuth";

async function safeJsonOrText(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function writeTeamToSessionStorage(slug, name) {
  try {
    sessionStorage.setItem("TEAM_SLUG", (slug || "").trim().toLowerCase());
    sessionStorage.setItem("TEAM_NAME", (name || "").trim());
    // Backward/alternate keys just in case other code reads these:
    sessionStorage.setItem("teamSlug", (slug || "").trim().toLowerCase());
    sessionStorage.setItem("teamName", (name || "").trim());
  } catch {}
}

export default function ParentLogin() {
  const nav = useNavigate();
  const loc = useLocation();
  const redirectTo = loc.state?.redirectTo || "/parent";

  const [teams, setTeams] = useState([]);
  const [teamSlug, setTeamSlug] = useState((getTeamSlug() || "default").trim().toLowerCase());
  const [key, setKey] = useState("");
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [err, setErr] = useState("");

  const selectedTeam = useMemo(() => {
    return teams.find((t) => String(t.slug || "").toLowerCase() === teamSlug) || null;
  }, [teams, teamSlug]);

  useEffect(() => {
    (async () => {
      setLoadingTeams(true);
      setErr("");
      try {
        const res = await fetch("/api/public/teams");
        const data = await safeJsonOrText(res);
        if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.raw || "Failed to load teams.");

        const list = Array.isArray(data.teams) ? data.teams : [];
        setTeams(list);

        // Resolve initial team selection
        if (list.length > 0) {
          const found = list.some((t) => String(t.slug || "").toLowerCase() === teamSlug);
          const nextSlug = found ? teamSlug : String(list[0].slug || "default").toLowerCase();
          setTeamSlug(nextSlug);

          const chosen = list.find((t) => String(t.slug || "").toLowerCase() === nextSlug) || list[0];
          const slug = String(chosen.slug || "default").toLowerCase();
          const name = String(chosen.name || slug);

          setTeam({ slug, name });
          writeTeamToSessionStorage(slug, name);
        } else {
          // No teams exist yet (admin hasn't created any) — keep default
          setTeam({ slug: "default", name: "Barrington Girls Softball" });
          writeTeamToSessionStorage("default", "Barrington Girls Softball");
        }

        // If key already saved, go straight through
        const saved = getParentKey();
        if (saved) {
          nav(redirectTo, { replace: true });
        }
      } catch (e) {
        setErr(e?.message || String(e));
      } finally {
        setLoadingTeams(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onChangeTeam(nextSlug) {
    const slug = String(nextSlug || "").trim().toLowerCase();
    setTeamSlug(slug);

    const t = teams.find((x) => String(x.slug || "").toLowerCase() === slug);
    if (t) {
      const name = String(t.name || slug);
      setTeam({ slug, name });
      writeTeamToSessionStorage(slug, name);
    }
  }

  function login() {
    setErr("");
    if (!selectedTeam) return setErr("Please select a team.");
    if (!key) return setErr("Please enter the Parent key.");

    const slug = String(selectedTeam.slug || "default").toLowerCase();
    const name = String(selectedTeam.name || slug);

    setTeam({ slug, name });
    writeTeamToSessionStorage(slug, name);
    setParentKey(key);

    nav(redirectTo, { replace: true });
  }

  return (
    <div style={{ padding: 24, maxWidth: 520, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Parent Access</h1>
      <div style={{ opacity: 0.75, marginTop: 8 }}>
        Select your team, then enter the Parent key to submit a walk-up announcement.
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 900, opacity: 0.75, marginBottom: 6 }}>
          Team
        </label>
        <select
          value={teamSlug}
          onChange={(e) => onChangeTeam(e.target.value)}
          disabled={loadingTeams || teams.length === 0}
          style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd" }}
        >
          {teams.length === 0 ? (
            <option value="default">{loadingTeams ? "Loading teams…" : "No teams found (ask admin)"}</option>
          ) : (
            teams.map((t) => (
              <option key={t.slug} value={String(t.slug || "").toLowerCase()}>
                {t.name}
              </option>
            ))
          )}
        </select>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 900, opacity: 0.75, marginBottom: 6 }}>
          Parent Key
        </label>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Enter parent key…"
          style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd" }}
          onKeyDown={(e) => (e.key === "Enter" ? login() : null)}
        />
      </div>

      <button
        onClick={login}
        disabled={!key || !selectedTeam || loadingTeams || teams.length === 0}
        style={{
          marginTop: 12,
          width: "100%",
          padding: "12px 14px",
          borderRadius: 12,
          fontWeight: 900,
        }}
      >
        Continue
      </button>

      {err && (
        <div style={{ marginTop: 12, color: "crimson" }}>
          <strong>Error:</strong> {err}
        </div>
      )}

      <div style={{ marginTop: 14, fontSize: 12, opacity: 0.7 }}>
        Privacy note: you must select the correct team and enter the Parent key to submit.
      </div>
    </div>
  );
}
