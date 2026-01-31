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

  // roster
  const [roster, setRoster] = useState([]);

  // parent inbox
  const [inbox, setInbox] = useState([]);

  // final statuses: { [playerId]: true/false }
  const [finalStatus, setFinalStatus] = useState({});
  const [finalUploading, setFinalUploading] = useState({}); // { [playerId]: boolean }
  const [finalFile, setFinalFile] = useState({}); // { [playerId]: File }
  const [finalRowError, setFinalRowError] = useState({}); // { [playerId]: string }

  const authedHeaders = useMemo(() => {
    return {
      "x-admin-key": adminKey,
      Authorization: `Bearer ${adminKey}`,
    };
  }, [adminKey]);

  async function tryLogin(key) {
    setErr("");
    setLoading(true);
    try {
      // validate by calling a known admin endpoint
      const res = await fetch("/api/admin/parent-inbox", {
        headers: {
          "x-admin-key": key,
          Authorization: `Bearer ${key}`,
        },
      });
      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.raw || "Unauthorized");

      setIsAuthed(true);
      setAdminKey(key);
      saveAdminKey(key);
      setLoginKey("");

      await refreshAll(key);
    } catch (e) {
      setIsAuthed(false);
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function fetchRoster() {
    const res = await fetch("/api/roster", { headers: authedHeaders });
    const data = await safeJsonOrText(res);
    if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.raw || `Roster failed (HTTP ${res.status})`);
    setRoster(Array.isArray(data.roster) ? data.roster : []);
  }

  async function fetchInbox() {
    const res = await fetch("/api/admin/parent-inbox", { headers: authedHeaders });
    const data = await safeJsonOrText(res);
    if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.raw || `Inbox failed (HTTP ${res.status})`);
    setInbox(Array.isArray(data.items) ? data.items : Array.isArray(data.results) ? data.results : []);
  }

  async function fetchFinalStatus() {
    const res = await fetch("/api/admin/final-status", { headers: authedHeaders });
    const data = await safeJsonOrText(res);
    if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.raw || `Final status failed (HTTP ${res.status})`);

    // Accept a few possible shapes
    // 1) { ok:true, status: {playerId:true}}
    // 2) { ok:true, items:[{playerId, exists}]}
    // 3) { ok:true, results:[...]}
    let map = {};
    if (data?.status && typeof data.status === "object") {
      map = data.status;
    } else if (Array.isArray(data?.items)) {
      for (const it of data.items) map[it.playerId] = !!it.exists;
    } else if (Array.isArray(data?.results)) {
      for (const it of data.results) map[it.playerId] = !!it.exists;
    }
    setFinalStatus(map);
  }

  async function refreshAll(keyOverride) {
    setErr("");
    setLoading(true);
    try {
      if (keyOverride) {
        const headers = { "x-admin-key": keyOverride, Authorization: `Bearer ${keyOverride}` };
        const [r1, r2, r3] = await Promise.all([
          fetch("/api/roster", { headers }),
          fetch("/api/admin/parent-inbox", { headers }),
          fetch("/api/admin/final-status", { headers }),
        ]);

        const rosterData = await safeJsonOrText(r1);
        if (!r1.ok || rosterData?.ok === false) throw new Error(rosterData?.error || rosterData?.raw || `Roster failed (HTTP ${r1.status})`);
        setRoster(Array.isArray(rosterData.roster) ? rosterData.roster : []);

        const inboxData = await safeJsonOrText(r2);
        if (!r2.ok || inboxData?.ok === false) throw new Error(inboxData?.error || inboxData?.raw || `Inbox failed (HTTP ${r2.status})`);
        setInbox(Array.isArray(inboxData.items) ? inboxData.items : Array.isArray(inboxData.results) ? inboxData.results : []);

        const statusData = await safeJsonOrText(r3);
        if (!r3.ok || statusData?.ok === false) throw new Error(statusData?.error || statusData?.raw || `Final status failed (HTTP ${r3.status})`);
        let map = {};
        if (statusData?.status && typeof statusData.status === "object") map = statusData.status;
        else if (Array.isArray(statusData?.items)) for (const it of statusData.items) map[it.playerId] = !!it.exists;
        else if (Array.isArray(statusData?.results)) for (const it of statusData.results) map[it.playerId] = !!it.exists;
        setFinalStatus(map);

        return;
      }

      await Promise.all([fetchRoster(), fetchInbox(), fetchFinalStatus()]);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function previewSubmission(id) {
    setErr("");
    try {
      // open in new tab (streams audio)
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
      const res = await fetch(`/api/admin/parent-audio?id=${encodeURIComponent(id)}`, { headers: authedHeaders });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `${playerName || "parent-recording"}.wav`; // even if it’s webm, this is just filename
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
        headers: { "Content-Type": "application/json", ...authedHeaders },
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
        headers: authedHeaders, // NOTE: do NOT set Content-Type for FormData
        body: fd,
      });

      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.message || data?.raw || `Final upload failed (HTTP ${res.status}).`);
      }

      // refresh status so download enables
      await fetchFinalStatus();
    } catch (e) {
      setFinalRowError((prev) => ({ ...prev, [playerId]: e?.message || String(e) }));
    } finally {
      setFinalUploading((prev) => ({ ...prev, [playerId]: false }));
    }
  }

  async function downloadFinal(playerId) {
    setErr("");
    try {
      const res = await fetch(`/api/admin/voice-file?playerId=${encodeURIComponent(playerId)}`, { headers: authedHeaders });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `${playerId}-final.wav`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e?.message || String(e));
    }
  }

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

      {/* Parent Inbox */}
      <div className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>Parent Inbox</h2>

        {inbox.length === 0 ? (
          <div style={{ opacity: 0.75 }}>No submissions yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {inbox.map((it) => (
              <div key={it.id} style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 14, padding: 12 }}>
                <div style={{ fontWeight: 1000, fontSize: 16 }}>{it.player_name || it.playerName || "—"}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  Submitted: {it.created_at || it.createdAt || "—"}
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

      {/* Final Walk-Up Clips */}
      <div className="card">
        <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <h2 style={{ marginTop: 0 }}>Final Walk-Up Clips</h2>
          <button className="btn-secondary" onClick={() => fetchFinalStatus()} disabled={loading}>
            Reload status
          </button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {roster.length === 0 ? (
            <div style={{ opacity: 0.75 }}>
              No roster found yet. Add roster players first (or ensure the roster endpoints are working).
            </div>
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
                      <strong style={{ color: exists ? "green" : "crimson" }}>
                        {exists ? "Uploaded" : "Missing"}
                      </strong>
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
