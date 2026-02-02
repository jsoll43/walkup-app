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

function slugify(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export default function Admin() {
  const [loginKey, setLoginKey] = useState("");
  const [adminKey, setAdminKey] = useState(getSavedAdminKey());
  const [isAuthed, setIsAuthed] = useState(false);

  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  // Teams
  const [teams, setTeams] = useState([]);
  const [manageTeamSlug, setManageTeamSlug] = useState(
    sessionStorage.getItem("ADMIN_TEAM_SLUG") || "default"
  );
  const [inboxFilterSlug, setInboxFilterSlug] = useState("all");

  // Team create form
  const [newName, setNewName] = useState("");
  const [newParentKey, setNewParentKey] = useState("");
  const [newCoachKey, setNewCoachKey] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [deletingTeam, setDeletingTeam] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showManageKeysModal, setShowManageKeysModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTeamSlug, setDeleteTeamSlug] = useState(sessionStorage.getItem("ADMIN_TEAM_SLUG") || "default");
  // Separate selector for which team we are modifying players/finals for
  const [playersTeamSlug, setPlayersTeamSlug] = useState(sessionStorage.getItem("ADMIN_TEAM_SLUG") || "default");

  // Roster add form state  ✅ (hooks must live here, not inside createTeam)
  const [addNumber, setAddNumber] = useState("");
  const [addFirst, setAddFirst] = useState("");
  const [addLast, setAddLast] = useState("");

  // Data
  const [roster, setRoster] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [finalStatus, setFinalStatus] = useState({});
  const [finalUploading, setFinalUploading] = useState({});
  const [finalFile, setFinalFile] = useState({});
  const [finalRowError, setFinalRowError] = useState({});

  function adminHeadersFor(key) {
    const k = (key || "").trim();
    return { "x-admin-key": k, Authorization: `Bearer ${k}` };
  }

  const adminHeaders = useMemo(() => adminHeadersFor(adminKey), [adminKey]);

  const manageTeam = useMemo(
    () => teams.find((t) => t.slug === manageTeamSlug) || null,
    [teams, manageTeamSlug]
  );
  const playersTeam = useMemo(() => teams.find((t) => t.slug === playersTeamSlug) || null, [teams, playersTeamSlug]);

  // Edit keys for selected team
  const [editParentKey, setEditParentKey] = useState("");
  const [editCoachKey, setEditCoachKey] = useState("");
  useEffect(() => {
    setEditParentKey(
      manageTeam ? (manageTeam.parent_key || manageTeam.parentKey || "") : ""
    );
    setEditCoachKey(
      manageTeam ? (manageTeam.coach_key || manageTeam.coachKey || "") : ""
    );
  }, [manageTeam]);

  function teamHeaders(teamSlug, keyOverride) {
    const base = keyOverride ? adminHeadersFor(keyOverride) : adminHeaders;
    return {
      ...base,
      "x-team-slug": (teamSlug || "default").toLowerCase(),
    };
  }

  async function tryLogin(key) {
    setErr("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/parent-inbox", {
        headers: adminHeadersFor(key),
      });
      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.raw || "Unauthorized");
      }

      setIsAuthed(true);
      setAdminKey(key);
      saveAdminKey(key);
      setLoginKey("");

      // Refresh with the key we *know* is valid (avoids state timing issues)
      refreshAll(key).catch(() => {});
    } catch (e) {
      setIsAuthed(false);
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function fetchTeams(keyOverride) {
    const res = await fetch("/api/admin/teams", {
      headers: keyOverride ? adminHeadersFor(keyOverride) : adminHeaders,
    });
    const data = await safeJsonOrText(res);
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || data?.raw || `Teams failed (HTTP ${res.status})`);
    }

    const list = Array.isArray(data.teams) ? data.teams : [];
    setTeams(list);

    // Ensure manageTeamSlug is valid
    if (list.length > 0) {
      const found = list.some((t) => t.slug === manageTeamSlug);
      const next =
        found
          ? manageTeamSlug
          : list.find((t) => t.slug === "default")?.slug || list[0].slug;

      if (next !== manageTeamSlug) {
        setManageTeamSlug(next);
        sessionStorage.setItem("ADMIN_TEAM_SLUG", next);
      }
      return next;
    }
    return manageTeamSlug || "default";
  }

  async function fetchRosterForTeam(teamSlug, keyOverride) {
    const res = await fetch("/api/roster", { headers: teamHeaders(teamSlug, keyOverride) });
    const data = await safeJsonOrText(res);
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || data?.raw || `Roster failed (HTTP ${res.status})`);
    }
    setRoster(Array.isArray(data.roster) ? data.roster : []);
  }

  async function fetchInbox(keyOverride) {
    const res = await fetch("/api/admin/parent-inbox", {
      headers: keyOverride ? adminHeadersFor(keyOverride) : adminHeaders,
    });
    const data = await safeJsonOrText(res);
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || data?.raw || `Inbox failed (HTTP ${res.status})`);
    }
    const list = Array.isArray(data.submissions)
      ? data.submissions
      : Array.isArray(data.items)
      ? data.items
      : [];
    setInbox(list);
  }

  async function fetchFinalStatusForTeam(teamSlug, keyOverride) {
    const res = await fetch("/api/admin/final-status", {
      headers: teamHeaders(teamSlug, keyOverride),
    });
    const data = await safeJsonOrText(res);
    if (!res.ok || data?.ok === false) {
      throw new Error(
        data?.error || data?.raw || `Final status failed (HTTP ${res.status})`
      );
    }
    setFinalStatus(data.status && typeof data.status === "object" ? data.status : {});
  }

  async function refreshAll(keyOverride) {
    setErr("");
    setLoading(true);
    try {
      const resolvedTeamSlug = await fetchTeams(keyOverride);
      await Promise.all([
        fetchInbox(keyOverride),
        fetchRosterForTeam(resolvedTeamSlug, keyOverride),
        fetchFinalStatusForTeam(resolvedTeamSlug, keyOverride),
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
      const res = await fetch(`/api/admin/parent-audio?id=${encodeURIComponent(id)}`, {
        headers: adminHeaders,
      });
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
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.raw || `Delete failed (HTTP ${res.status})`);
      }
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
        throw new Error(
          data?.error ||
            data?.message ||
            data?.raw ||
            `Final upload failed (HTTP ${res.status}).`
        );
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
      const res = await fetch(
        `/api/admin/voice-file?playerId=${encodeURIComponent(playerId)}`,
        { headers: teamHeaders(manageTeamSlug) }
      );
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

  // ✅ finished + closed createTeam (this was your main break)
  async function createTeam() {
    setErr("");
    if (!newName.trim()) return setErr("Team name is required.");
    if (!newParentKey.trim()) return setErr("Parent key is required.");
    if (!newCoachKey.trim()) return setErr("Coach key is required.");

    setCreatingTeam(true);
    try {
      const res = await fetch("/api/admin/teams", {
        method: "POST",
        headers: { "content-type": "application/json", ...adminHeaders },
        body: JSON.stringify({
          name: newName.trim(),
          parentKey: newParentKey.trim(),
          coachKey: newCoachKey.trim(),
        }),
      });

      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.raw || `Create team failed (HTTP ${res.status})`);
      }

      // Reset form + close modal
      setNewName("");
      setNewParentKey("");
      setNewCoachKey("");
      setShowCreateModal(false);

      const next = await fetchTeams();
      setManageTeam(next);
      await Promise.all([fetchRosterForTeam(next), fetchFinalStatusForTeam(next)]).catch(() => {});
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setCreatingTeam(false);
    }
  }

  async function saveTeamUpdate() {
    setErr("");
    if (!manageTeamSlug) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/teams", {
        method: "PUT",
        headers: { "content-type": "application/json", ...adminHeaders },
        body: JSON.stringify({
          slug: manageTeamSlug,
          parentKey: editParentKey.trim(),
          coachKey: editCoachKey.trim(),
        }),
      });

      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.raw || `Save keys failed (HTTP ${res.status})`);
      }

      setShowManageKeysModal(false);
      await fetchTeams();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function addPlayer() {
    setErr("");
    if (!playersTeamSlug) return setErr("No team selected");
    if (!addFirst.trim() || !addLast.trim()) return setErr("First and last name are required");

    try {
      const res = await fetch("/api/admin/roster-upsert", {
        method: "POST",
        headers: { "content-type": "application/json", ...adminHeaders },
        body: JSON.stringify({
          number: addNumber.trim(),
          first: addFirst.trim(),
          last: addLast.trim(),
          teamSlug: playersTeamSlug,
        }),
      });

      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.raw || `Add player failed (HTTP ${res.status})`);
      }

      setAddNumber("");
      setAddFirst("");
      setAddLast("");
      await fetchRosterForTeam(playersTeamSlug);
    } catch (e) {
      setErr(e?.message || String(e));
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
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.raw || `Delete team failed (HTTP ${res.status})`);
      }

      // Refresh team list and switch to a valid team to avoid fetching the deleted team
      const next = await fetchTeams();
      setManageTeam(next);
      await Promise.all([fetchRosterForTeam(next), fetchFinalStatusForTeam(next)]).catch(() => {});
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

  // When the selected players team changes, refresh roster + final status for that team
  useEffect(() => {
    if (!playersTeamSlug) return;
    fetchRosterForTeam(playersTeamSlug).catch(() => {});
    fetchFinalStatusForTeam(playersTeamSlug).catch(() => {});
  }, [playersTeamSlug]);

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

          <button
            className="btn"
            onClick={() => tryLogin(loginKey)}
            disabled={!loginKey || loading}
            style={{ marginTop: 12, width: "100%" }}
          >
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
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
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

      {/* Team Management */}
      <div className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>Team Management</h2>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          <button className="btn" onClick={() => setShowCreateModal(true)}>Create a New Team</button>
          <button className="btn-danger" onClick={() => setShowDeleteModal(true)} disabled={deletingTeam}>Delete a Team</button>
          <button className="btn" onClick={() => setShowManageKeysModal(true)}>Manage Team Keys</button>
        </div>
      </div>

      {/* Inbox */}
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
                    {t.name}
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
                    <div style={{ fontWeight: 1000 }}>{it.team_name || it.teamName || "—"}</div>
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

      {/* Roster + Final Uploads */}
      <div className="card">
        <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 4 }}>Add/Remove players and set Final Walk-Up Clips</h2>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
              <div style={{ minWidth: 260 }}>
                <label className="label">Team to modify</label>
                <select className="input" value={playersTeamSlug} onChange={(e) => setPlayersTeamSlug(e.target.value)}>
                  {teams.length === 0 ? (
                    <option value="default">No teams</option>
                  ) : (
                    teams.map((t) => (
                      <option key={t.slug} value={t.slug}>{t.name}</option>
                    ))
                  )}
                </select>
              </div>

              <div style={{ fontSize: 12, opacity: 0.75 }}>
                Selected: <strong>{playersTeam ? `${playersTeam.name}` : playersTeamSlug}</strong>
              </div>
            </div>
          </div>
          <button className="btn-secondary" onClick={() => fetchFinalStatusForTeam(playersTeamSlug)} disabled={loading}>
            Reload status
          </button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ minWidth: 80 }}>
              <input className="input" placeholder="#" value={addNumber} onChange={(e) => setAddNumber(e.target.value)} />
            </div>
            <div style={{ minWidth: 160 }}>
              <input className="input" placeholder="First name" value={addFirst} onChange={(e) => setAddFirst(e.target.value)} />
            </div>
            <div style={{ minWidth: 160 }}>
              <input className="input" placeholder="Last name" value={addLast} onChange={(e) => setAddLast(e.target.value)} />
            </div>
            <div>
              <button className="btn" onClick={addPlayer}>
                Add player
              </button>
            </div>
          </div>

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
                      Status:{" "}
                      <strong style={{ color: exists ? "green" : "crimson" }}>{exists ? "Uploaded" : "Missing"}</strong>
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

        {/* Create Team Modal */}
        {showCreateModal ? (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
            }}
          >
            <div style={{ background: "white", padding: 20, borderRadius: 12, width: 560, maxWidth: "95%", color: "#111" }}>
              <h3 style={{ marginTop: 0 }}>Create new team</h3>
              <div style={{ display: "grid", gap: 8 }}>
                <div>
                  <label className="label">Team Name</label>
                  <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. 10U Blue" />
                </div>
                {/* slug removed: server generates slug from name */}
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label className="label">Parent Key</label>
                    <input className="input" value={newParentKey} onChange={(e) => setNewParentKey(e.target.value)} placeholder="Parent key" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="label">Coach Key</label>
                    <input className="input" value={newCoachKey} onChange={(e) => setNewCoachKey(e.target.value)} placeholder="Coach key" />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn-secondary" onClick={() => setShowCreateModal(false)}>
                    Cancel
                  </button>
                  <button className="btn" onClick={createTeam} disabled={creatingTeam}>
                    {creatingTeam ? "Creating…" : "Create"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Delete Team Modal */}
        {showDeleteModal ? (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
            <div style={{ background: "white", padding: 20, borderRadius: 12, width: 520, maxWidth: "95%", color: "#111" }}>
              <h3 style={{ marginTop: 0 }}>Delete team</h3>
              <div style={{ display: "grid", gap: 8 }}>
                <div>
                  <label className="label">Team to delete</label>
                  <select className="input" value={deleteTeamSlug} onChange={(e) => setDeleteTeamSlug(e.target.value)}>
                    {teams.length === 0 ? (
                      <option value="default">No teams</option>
                    ) : (
                      teams.filter((t) => t.slug !== "default").map((t) => (
                        <option key={t.slug} value={t.slug}>{t.name}</option>
                      ))
                    )}
                  </select>
                </div>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn-secondary" onClick={() => setShowDeleteModal(false)}>Cancel</button>
                  <button
                    className="btn-danger"
                    onClick={async () => {
                      setShowDeleteModal(false);
                      try {
                        await deleteTeam(deleteTeamSlug);
                      } catch (e) {
                        setErr(e?.message || String(e));
                      }
                    }}
                    disabled={!deleteTeamSlug || deleteTeamSlug === "default"}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Manage Team Keys Modal */}
        {showManageKeysModal ? (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
            }}
          >
            <div style={{ background: "white", padding: 20, borderRadius: 12, width: 520, maxWidth: "95%", color: "#111" }}>
              <h3 style={{ marginTop: 0 }}>Manage team keys</h3>
              <div style={{ display: "grid", gap: 8 }}>
                <div>
                  <label className="label">Parent Key</label>
                  <input className="input" value={editParentKey} onChange={(e) => setEditParentKey(e.target.value)} placeholder="Parent key" />
                </div>
                <div>
                  <label className="label">Coach Key</label>
                  <input className="input" value={editCoachKey} onChange={(e) => setEditCoachKey(e.target.value)} placeholder="Coach key" />
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn-secondary" onClick={() => setShowManageKeysModal(false)}>
                    Cancel
                  </button>
                  <button className="btn" onClick={saveTeamUpdate} disabled={loading}>
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
