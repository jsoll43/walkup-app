// src/pages/Admin.jsx
import { useEffect, useMemo, useState } from "react";

function getSavedAdminKey() {
  return sessionStorage.getItem("ADMIN_KEY") || "";
}
function saveAdminKey(k) {
  sessionStorage.setItem("ADMIN_KEY", k);
}
function clearAdminKey() {
  sessionStorage.removeItem("ADMIN_KEY");
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

function formatPlayer(p) {
  const name = `${p.first || ""} ${p.last || ""}`.trim();
  return p.number ? `#${p.number} ${name}`.trim() : name || p.id;
}

export default function Admin() {
  const [loginKey, setLoginKey] = useState("");
  const [adminKey, setAdminKey] = useState(getSavedAdminKey());
  const [isAuthed, setIsAuthed] = useState(false);

  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  // Teams
  const [teams, setTeams] = useState([]);
  const [manageTeamSlug, setManageTeamSlug] = useState(sessionStorage.getItem("ADMIN_TEAM_SLUG") || "default");
  const [inboxFilterSlug, setInboxFilterSlug] = useState("all");

  // Team create form
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newParentKey, setNewParentKey] = useState("");
  const [newCoachKey, setNewCoachKey] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [deletingTeam, setDeletingTeam] = useState(false);

  // Data
  const [roster, setRoster] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [finalStatus, setFinalStatus] = useState({});
  const [finalUploading, setFinalUploading] = useState({});
  const [finalFile, setFinalFile] = useState({});
  const [finalRowError, setFinalRowError] = useState({});

  const adminHeaders = useMemo(() => {
    return { "x-admin-key": adminKey, Authorization: `Bearer ${adminKey}` };
  }, [adminKey]);

  const manageTeam = useMemo(() => teams.find((t) => t.slug === manageTeamSlug) || null, [teams, manageTeamSlug]);

  function teamHeaders(teamSlug) {
    return { ...adminHeaders, "x-team-slug": (teamSlug || "default").toLowerCase() };
  }

  async function tryLogin(key) {
    setErr("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/parent-inbox", {
        headers: { "x-admin-key": key, Authorization: `Bearer ${key}` },
      });
      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.raw || "Unauthorized");

      setIsAuthed(true);
      setAdminKey(key);
      saveAdminKey(key);
      setLoginKey("");

      // Important: after setting key, refresh everything (no “override headers” that drop team headers)
      await refreshAll();
    } catch (e) {
      setIsAuthed(false);
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function fetchTeams() {
    const res = await fetch("/api/admin/teams", { headers: adminHeaders });
    const data = await safeJsonOrText(res);
    if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.raw || `Teams failed (HTTP ${res.status})`);

    const list = Array.isArray(data.teams) ? data.teams : [];
    setTeams(list);

    // Ensure manageTeamSlug is valid
    if (list.length > 0) {
      const found = list.some((t) => t.slug === manageTeamSlug);
      const next = found ? manageTeamSlug : (list.find((t) => t.slug === "default")?.slug || list[0].slug);
      if (next !== manageTeamSlug) {
        setManageTeamSlug(next);
        sessionStorage.setItem("ADMIN_TEAM_SLUG", next);
      }
      return next;
    }
    return manageTeamSlug || "default";
  }

  async function fetchRosterForTeam(teamSlug) {
    const res = await fetch("/api/roster", { headers: teamHeaders(teamSlug) });
    const data = await safeJsonOrText(res);
    if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.raw || `Roster failed (HTTP ${res.status})`);
    setRoster(Array.isArray(data.roster) ? data.roster : []);
  }

  async function fetchInbox() {
    const res = await fetch("/api/admin/parent-inbox", { headers: adminHeaders });
    const data = await safeJsonOrText(res);
    if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.raw || `Inbox failed (HTTP ${res.status})`);
    const list = Array.isArray(data.submissions) ? data.submissions : Array.isArray(data.items) ? data.items : [];
    setInbox(list);
  }

  async function fetchFinalStatusForTeam(teamSlug) {
    const res = await fetch("/api/admin/final-status", { headers: teamHeaders(teamSlug) });
    const data = await safeJsonOrText(res);
    if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.raw || `Final status failed (HTTP ${res.status})`);
    setFinalStatus(data.status && typeof data.status === "object" ? data.status : {});
  }

  async function refreshAll() {
    setErr("");
    setLoading(true);
    try {
      const resolvedTeamSlug = await fetchTeams();
      await Promise.all([
        fetchInbox(),
        fetchRosterForTeam(resolvedTeamSlug),
        fetchFinalStatusForTeam(resolvedTeamSlug),
      ]);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function previewSubmission(id) {
    setErr("");
    try {
      const url = `/api/admin/parent-audio?id=${encodeURIComponent(id)}`;
      const w = window.open(url, "_blank");
      if (!w) throw new Error("Popup blocked. Please allow popups or use Download.");
    } catch (e) {
      setErr(e?.message || String(e));
    }
  }

  async function downloadSubmission(id, playerName = "parent-recording") {
    setErr("");
    try {
      const res = await fetch(`/api/admin/parent-audio?id=${encodeURIComponent(id)}`, { headers: adminHeaders });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `${playerName || "parent-recording"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e?.message || String(e));
    }
  }

  async function deleteSubmission(id) {
    setErr("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/parent-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminHeaders },
        body: JSON.stringify({ id }),
      });
      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.raw || `Delete failed (HTTP ${res.status})`);
      await fetchInbox();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function uploadFinal(playerId) {
    setFinalRowError((prev) => ({ ...prev, [playerId]: "" }));
    const file = finalFile[playerId];
    if (!file) {
      setFinalRowError((prev) => ({ ...prev, [playerId]: "Choose a file first." }));
      return;
    }

    setFinalUploading((prev) => ({ ...prev, [playerId]: true }));
    try {
      const fd = new FormData();
      fd.append("playerId", playerId);
      fd.append("file", file);

      const res = await fetch("/api/admin/final-upload", {
        method: "POST",
        headers: teamHeaders(manageTeamSlug),
        body: fd,
      });

      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.message || data?.raw || `Final upload failed (HTTP ${res.status}).`);
      }

      await fetchFinalStatusForTeam(manageTeamSlug);
    } catch (e) {
      setFinalRowError((prev) => ({ ...prev, [playerId]: e?.message || String(e) }));
    } finally {
      setFinalUploading((prev) => ({ ...prev, [playerId]: false }));
    }
  }

  async function downloadFinal(playerId) {
    setErr("");
    try {
      const res = await fetch(`/api/admin/voice-file?playerId=${encodeURIComponent(playerId)}`, {
        headers: teamHeaders(manageTeamSlug),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `${playerId}-final`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e?.message || String(e));
    }
  }

  async function createTeam() {
    setErr("");
    if (!newName.trim()) return setErr("Team name is required.");
    if (!newSlug.trim()) return setErr("Team slug is required.");
    if (!newParentKey.trim()) return setErr("Parent key is required.");
    if (!newCoachKey.trim()) return setErr("Coach key is required.");

    setCreatingTeam(true);
    try {
      const res = await fetch("/api/admin/teams", {
        method: "POST",
        headers: { "content-type": "application/json", ...adminHeaders },
        body: JSON.stringify({
          name: newName.trim(),
          slug: newSlug.trim().toLowerCase(),
          parentKey: newParentKey.trim(),
          coachKey: newCoachKey.trim(),
        }),
      });

      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.raw || `Create team failed (HTTP ${res.status})`);

      setNewName("");
      setNewSlug("");
      setNewParentKey("");
      setNewCoachKey("");

      await refreshAll();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setCreatingTeam(false);
    }
  }

  async function deleteTeam(slug) {
    if (!slug) return;
    if (slug === "default") return setErr("Cannot delete the default team.");

    const ok = window.confirm(`Delete team "${slug}"? This hides it from parents/coaches.`);
    if (!ok) return;

    setDeletingTeam(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/teams", {
        method: "DELETE",
        headers: { "content-type": "application/json", ...adminHeaders },
        body: JSON.stringify({ slug }),
      });
      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.raw || `Delete team failed (HTTP ${res.status})`);

      await refreshAll();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setDeletingTeam(false);
    }
  }

  function setManageTeam(nextSlug) {
    setManageTeamSlug(nextSlug);
    sessionStorage.setItem("ADMIN_TEAM_SLUG", nextSlug);
    fetchRosterForTeam(nextSlug).catch(() => {});
    fetchFinalStatusForTeam(nextSlug).catch(() => {});
  }

  const filteredInbox = useMemo(() => {
    if (inboxFilterSlug === "all") return inbox;
    return inbox.filter((x) => (x.team_slug || x.teamSlug || "") === inboxFilterSlug);
  }, [inbox, inboxFilterSlug]);

  useEffect(() => {
    const saved = getSavedAdminKey();
    if (saved) tryLogin(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isAuthed) {
    return (
      <div className="page">
        <div className="card">
          <h1 style={{ marginTop: 0 }}>Admin Login</h1>

          <label className="label" style={{ marginTop: 12 }}>
            Admin Key
          </label>
          <input
            type="password"
            value={loginKey}
            onChange={(e) => setLoginKey(e.target.value)}
            placeholder="Enter admin key…"
            className="input"
            onKeyDown={(e) => (e.key === "Enter" ? tryLogin(loginKey) : null)}
          />

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
      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", marginBottom: 12 }}>
        <h1 style={{ margin: 0, color: "white" }}>Admin</h1>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn-secondary" onClick={() => refreshAll()} disabled={loading}>
            Refresh all
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              clearAdminKey();
              setIsAuthed(false);
              setAdminKey("");
              setLoginKey("");
              setErr("");
            }}
          >
            Log out
          </button>
        </div>
      </div>

      {err ? (
        <div className="card" style={{ borderColor: "rgba(220,38,38,0.35)", marginBottom: 12 }}>
          <div style={{ color: "crimson" }}>
            <strong>Error:</strong> {err}
          </div>
        </div>
      ) : null}

      {/* TEAM MANAGEMENT */}
      <div className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>Teams</h2>

        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 1000 }}>Create a new team</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label className="label">Team Name</label>
                <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. 10U Blue" />
              </div>
              <div>
                <label className="label">Team Slug</label>
                <input className="input" value={newSlug} onChange={(e) => setNewSlug(e.target.value)} placeholder="e.g. 10u-blue" />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label className="label">Parent Key</label>
                <input className="input" value={newParentKey} onChange={(e) => setNewParentKey(e.target.value)} placeholder="Set a parent key…" />
              </div>
              <div>
                <label className="label">Coach Key</label>
                <input className="input" value={newCoachKey} onChange={(e) => setNewCoachKey(e.target.value)} placeholder="Set a coach key…" />
              </div>
            </div>

            <button className="btn" onClick={createTeam} disabled={creatingTeam}>
              {creatingTeam ? "Creating…" : "Create team"}
            </button>
          </div>

          <div style={{ borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: 12 }}>
            <div style={{ fontWeight: 1000, marginBottom: 8 }}>Manage a team</div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ minWidth: 240 }}>
                <label className="label">Managing Team (roster + finals)</label>
                <select className="input" value={manageTeamSlug} onChange={(e) => setManageTeam(e.target.value)}>
                  {teams.map((t) => (
                    <option key={t.slug} value={t.slug}>
                      {t.name} ({t.slug})
                    </option>
                  ))}
                </select>
              </div>

              <button className="btn-danger" onClick={() => deleteTeam(manageTeamSlug)} disabled={deletingTeam || manageTeamSlug === "default"}>
                {deletingTeam ? "Deleting…" : "Delete this team"}
              </button>

              <div style={{ fontSize: 12, opacity: 0.75 }}>
                Selected: <strong>{manageTeam ? `${manageTeam.name} (${manageTeam.slug})` : manageTeamSlug}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* INBOX */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ marginTop: 0 }}>Parent Inbox</h2>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ minWidth: 220 }}>
              <label className="label">Filter inbox by team</label>
              <select className="input" value={inboxFilterSlug} onChange={(e) => setInboxFilterSlug(e.target.value)}>
                <option value="all">All teams</option>
                {teams.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name} ({t.slug})
                  </option>
                ))}
              </select>
            </div>

            <button className="btn-secondary" onClick={() => fetchInbox()} disabled={loading}>
              Reload inbox
            </button>
          </div>
        </div>

        {filteredInbox.length === 0 ? (
          <div style={{ opacity: 0.75 }}>No submissions yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {filteredInbox.map((it) => (
              <div key={it.id} style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 14, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 1000, fontSize: 16 }}>{it.player_name || it.playerName || "—"}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      Submitted (ET): {formatET(it.created_at || it.createdAt || "") || "—"}
                    </div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>Team</div>
                    <div style={{ fontWeight: 1000 }}>
                      {(it.team_name || it.teamName || "—")}&nbsp;
                      <span style={{ fontSize: 12, opacity: 0.75 }}>({it.team_slug || it.teamSlug || "—"})</span>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 8, opacity: 0.9 }}>
                  <strong>Song request:</strong> {it.song_request || it.songRequest || "—"}
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="btn-secondary" onClick={() => previewSubmission(it.id)}>
                    ▶️ Preview
                  </button>
                  <button className="btn-secondary" onClick={() => downloadSubmission(it.id, it.player_name || "parent-recording")}>
                    ⬇️ Download
                  </button>
                  <button className="btn-danger" onClick={() => deleteSubmission(it.id)}>
                    🗑 Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FINALS */}
      <div className="card">
        <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 4 }}>Final Walk-Up Clips</h2>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Managing team: <strong>{manageTeam ? `${manageTeam.name} (${manageTeam.slug})` : manageTeamSlug}</strong>
            </div>
          </div>
          <button className="btn-secondary" onClick={() => fetchFinalStatusForTeam(manageTeamSlug)} disabled={loading}>
            Reload status
          </button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {roster.length === 0 ? (
            <div style={{ opacity: 0.75 }}>No roster found yet for this team.</div>
          ) : (
            roster.map((p) => {
              const pid = p.id;
              const exists = !!finalStatus[pid];
              const uploading = !!finalUploading[pid];
              const rowErr = finalRowError[pid] || "";

              return (
                <div key={pid} style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 14, padding: 12 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 1000 }}>{formatPlayer(p)}</div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      Status: <strong style={{ color: exists ? "green" : "crimson" }}>{exists ? "Uploaded" : "Missing"}</strong>
                    </div>
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(e) => {
                        const f = e.target.files && e.target.files[0];
                        setFinalFile((prev) => ({ ...prev, [pid]: f || null }));
                        setFinalRowError((prev) => ({ ...prev, [pid]: "" }));
                      }}
                    />

                    <button className="btn" onClick={() => uploadFinal(pid)} disabled={uploading || !finalFile[pid]}>
                      {uploading ? "Uploading…" : "Upload final"}
                    </button>

                    <button className="btn-secondary" onClick={() => downloadFinal(pid)} disabled={!exists}>
                      Download
                    </button>
                  </div>

                  {rowErr ? (
                    <div style={{ marginTop: 8, color: "crimson" }}>
                      <strong>Upload error:</strong> {rowErr}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
