// src/pages/Admin.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { roster } from "../data/roster";

function getSavedAdminKey() {
  return (sessionStorage.getItem("ADMIN_KEY") || "").trim();
}
function saveAdminKey(k) {
  sessionStorage.setItem("ADMIN_KEY", (k || "").trim());
}
function clearAdminKey() {
  sessionStorage.removeItem("ADMIN_KEY");
}

function formatTs(ts) {
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

function extractErr(data, fallback) {
  return data?.error || data?.message || data?.raw || fallback;
}

export default function Admin() {
  const [loginKey, setLoginKey] = useState("");
  const [adminKey, setAdminKey] = useState(getSavedAdminKey());
  const [isAuthed, setIsAuthed] = useState(!!getSavedAdminKey());

  const [err, setErr] = useState("");
  const [loadingLogin, setLoadingLogin] = useState(false);

  // Parent inbox
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inbox, setInbox] = useState([]);
  const [inboxBusyId, setInboxBusyId] = useState("");
  const inboxAudioRef = useRef(null);

  // Final uploads
  const [finalLoading, setFinalLoading] = useState(false);
  const [finalMap, setFinalMap] = useState(new Map()); // playerId -> meta
  const [finalUploadingId, setFinalUploadingId] = useState("");
  const [finalFiles, setFinalFiles] = useState({}); // playerId -> File

  const rosterById = useMemo(() => new Map(roster.map((p) => [p.id, p])), []);

  const authHeaders = useMemo(() => {
    const k = (adminKey || "").trim();
    return k
      ? {
          "x-admin-key": k,
          Authorization: `Bearer ${k}`,
        }
      : {};
  }, [adminKey]);

  function hardLogout() {
    try {
      if (inboxAudioRef.current) {
        inboxAudioRef.current.pause();
        inboxAudioRef.current.currentTime = 0;
      }
    } catch {}
    inboxAudioRef.current = null;

    clearAdminKey();
    setAdminKey("");
    setIsAuthed(false);
    setLoginKey("");
    setErr("");
    setInbox([]);
    setFinalMap(new Map());
    setFinalFiles({});
  }

  async function tryLogin(key) {
    setErr("");
    setLoadingLogin(true);
    try {
      const k = (key || "").trim();
      if (!k) throw new Error("Admin key required.");

      const res = await fetch("/api/admin/parent-inbox", {
        headers: { "x-admin-key": k, Authorization: `Bearer ${k}` },
      });

      if (!res.ok) {
        const data = await readJsonOrText(res);
        throw new Error(extractErr(data, `Login failed (HTTP ${res.status}).`));
      }

      saveAdminKey(k);
      setAdminKey(k);
      setIsAuthed(true);
      setLoginKey("");
    } catch (e) {
      hardLogout();
      setErr(e?.message || String(e));
    } finally {
      setLoadingLogin(false);
    }
  }

  async function loadInbox() {
    setErr("");
    setInboxLoading(true);
    try {
      const res = await fetch("/api/admin/parent-inbox", { headers: authHeaders });
      const data = await readJsonOrText(res);

      if (!res.ok || data?.ok === false) {
        if (res.status === 401) hardLogout();
        throw new Error(extractErr(data, `Failed to load inbox (HTTP ${res.status}).`));
      }

      const items =
        Array.isArray(data?.submissions) ? data.submissions :
        Array.isArray(data?.items) ? data.items :
        Array.isArray(data) ? data :
        [];

      setInbox(items);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setInboxLoading(false);
    }
  }

  async function loadFinalStatus() {
    setErr("");
    setFinalLoading(true);
    try {
      const res = await fetch("/api/admin/final-status", { headers: authHeaders });
      const data = await readJsonOrText(res);

      if (!res.ok || data?.ok === false) {
        if (res.status === 401) hardLogout();
        throw new Error(extractErr(data, `Failed to load final status (HTTP ${res.status}).`));
      }

      const items =
        Array.isArray(data?.items) ? data.items :
        Array.isArray(data?.finals) ? data.finals :
        Array.isArray(data) ? data :
        [];

      const map = new Map();
      for (const it of items) {
        const pid = it?.playerId || it?.player_id || it?.id;
        if (pid) map.set(pid, it);
      }
      setFinalMap(map);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setFinalLoading(false);
    }
  }

  async function previewInbox(id) {
    if (!id) return;
    setErr("");
    setInboxBusyId(id);

    try {
      try {
        if (inboxAudioRef.current) {
          inboxAudioRef.current.pause();
          inboxAudioRef.current.currentTime = 0;
        }
      } catch {}
      inboxAudioRef.current = null;

      const res = await fetch(`/api/admin/parent-audio?id=${encodeURIComponent(id)}`, {
        headers: authHeaders,
      });

      if (!res.ok) {
        const data = await readJsonOrText(res);
        throw new Error(extractErr(data, `Preview failed (HTTP ${res.status}).`));
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = new Audio(url);
      inboxAudioRef.current = a;

      a.onended = () => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
        inboxAudioRef.current = null;
      };

      await a.play();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setInboxBusyId("");
    }
  }

  async function downloadInbox(id, nameHint) {
    if (!id) return;
    setErr("");
    setInboxBusyId(id);

    try {
      const res = await fetch(`/api/admin/parent-audio?id=${encodeURIComponent(id)}`, {
        headers: authHeaders,
      });

      if (!res.ok) {
        const data = await readJsonOrText(res);
        throw new Error(extractErr(data, `Download failed (HTTP ${res.status}).`));
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = nameHint || `parent-submission-${id}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setInboxBusyId("");
    }
  }

  async function deleteInbox(id) {
    if (!id) return;
    setErr("");
    setInboxBusyId(id);

    try {
      const res = await fetch("/api/admin/parent-delete", {
        method: "POST",
        headers: {
          ...authHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id }),
      });

      const data = await readJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(extractErr(data, `Delete failed (HTTP ${res.status}).`));
      }

      setInbox((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setInboxBusyId("");
    }
  }

  async function uploadFinal(playerId) {
    const file = finalFiles[playerId];
    if (!playerId || !file) return;

    setErr("");
    setFinalUploadingId(playerId);

    try {
      const fd = new FormData();
      fd.append("file", file);
      // ALSO include playerId in the body for compatibility with older handlers
      fd.append("playerId", playerId);

      const res = await fetch(`/api/admin/final-upload?playerId=${encodeURIComponent(playerId)}`, {
        method: "POST",
        headers: authHeaders,
        body: fd,
      });

      const data = await readJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(extractErr(data, `Final upload failed (HTTP ${res.status}).`));
      }

      await loadFinalStatus();
      setFinalFiles((prev) => {
        const copy = { ...prev };
        delete copy[playerId];
        return copy;
      });
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setFinalUploadingId("");
    }
  }

  async function downloadFinal(playerId) {
    if (!playerId) return;
    setErr("");

    try {
      const res = await fetch(`/api/admin/final-file?playerId=${encodeURIComponent(playerId)}`, {
        headers: authHeaders,
      });

      if (!res.ok) {
        const data = await readJsonOrText(res);
        throw new Error(extractErr(data, `Final download failed (HTTP ${res.status}).`));
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const p = rosterById.get(playerId);
      const niceName = p
        ? `${(p.first || "").trim()}_${(p.last || "").trim()}`.trim().replace(/\s+/g, "_")
        : playerId;

      const a = document.createElement("a");
      a.href = url;
      a.download = `${niceName || playerId}-final`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (e) {
      setErr(e?.message || String(e));
    }
  }

  useEffect(() => {
    if (!isAuthed || !adminKey) return;
    loadInbox();
    loadFinalStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, adminKey]);

  if (!isAuthed) {
    return (
      <div style={{ padding: 24, maxWidth: 560, margin: "0 auto" }}>
        <h1 style={{ marginTop: 0 }}>Admin Login</h1>

        <div style={{ marginTop: 14 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 900, opacity: 0.75, marginBottom: 6 }}>
            Admin Key
          </label>
          <input
            type="password"
            value={loginKey}
            onChange={(e) => setLoginKey(e.target.value)}
            placeholder="Enter admin key…"
            style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd" }}
          />
        </div>

        <button
          onClick={() => tryLogin(loginKey)}
          disabled={!loginKey || loadingLogin}
          style={{ marginTop: 12, width: "100%", padding: "12px 14px", borderRadius: 12, fontWeight: 900 }}
        >
          {loadingLogin ? "Logging in…" : "Log in"}
        </button>

        {err && (
          <div style={{ marginTop: 12, color: "crimson" }}>
            <strong>Error:</strong> {err}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: 18, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h1 style={{ margin: 0 }}>Admin</h1>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => {
              loadInbox();
              loadFinalStatus();
            }}
            disabled={inboxLoading || finalLoading}
            style={{ padding: "10px 14px", borderRadius: 10 }}
          >
            Refresh
          </button>
          <button onClick={hardLogout} style={{ padding: "10px 14px", borderRadius: 10, fontWeight: 900 }}>
            Log out
          </button>
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 10, color: "crimson" }}>
          <strong>Error:</strong> {err}
        </div>
      )}

      {/* Parent Inbox */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 16, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Parent Inbox</h2>
          <button onClick={loadInbox} disabled={inboxLoading} style={{ padding: "10px 14px", borderRadius: 10 }}>
            {inboxLoading ? "Loading…" : "Reload"}
          </button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {inbox.length === 0 ? (
            <div style={{ opacity: 0.75 }}>No pending submissions.</div>
          ) : (
            inbox.map((s) => {
              const playerName = s.player_name || s.playerName || "(no name)";
              const songRequest = s.song_request || s.songRequest || "";
              const createdAt = s.created_at || s.createdAt || "";
              const created = createdAt ? formatTs(createdAt) : "";

              return (
                <div
                  key={s.id}
                  style={{
                    border: "1px solid #eee",
                    borderRadius: 14,
                    padding: 12,
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 1000 }}>{playerName}</div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>{created ? `Submitted: ${created}` : ""}</div>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.6 }}>ID: {s.id}</div>
                  </div>

                  <div style={{ fontSize: 14, opacity: 0.9 }}>
                    <strong>Song request:</strong> {songRequest || "(none)"}
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      onClick={() => previewInbox(s.id)}
                      disabled={inboxBusyId === s.id}
                      style={{ padding: "10px 12px", borderRadius: 12, fontWeight: 900 }}
                    >
                      {inboxBusyId === s.id ? "Working…" : "▶️ Preview"}
                    </button>
                    <button
                      onClick={() => downloadInbox(s.id, `${playerName.replace(/\s+/g, "_") || s.id}-parent.webm`)}
                      disabled={inboxBusyId === s.id}
                      style={{ padding: "10px 12px", borderRadius: 12, fontWeight: 900 }}
                    >
                      ⬇️ Download
                    </button>
                    <button
                      onClick={() => deleteInbox(s.id)}
                      disabled={inboxBusyId === s.id}
                      style={{ padding: "10px 12px", borderRadius: 12, fontWeight: 900 }}
                    >
                      🗑 Delete
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Final Clips */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 16, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Final Walk-Up Clips</h2>
          <button onClick={loadFinalStatus} disabled={finalLoading} style={{ padding: "10px 14px", borderRadius: 10 }}>
            {finalLoading ? "Loading…" : "Reload status"}
          </button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {roster.map((p) => {
            const meta = finalMap.get(p.id);
            const hasFinal = !!meta;
            const uploaded =
              meta?.uploadedAt || meta?.uploaded_at || meta?.uploaded || meta?.updatedAt || meta?.updated_at || "";

            const pendingFile = finalFiles[p.id];

            return (
              <div
                key={p.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 10,
                  padding: 12,
                  borderRadius: 14,
                  border: "1px solid #eee",
                }}
              >
                <div>
                  <div style={{ fontWeight: 1000 }}>
                    {p.number ? `#${p.number} ` : ""}
                    {(p.first || "") + " " + (p.last || "")}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    {hasFinal ? `✅ Uploaded${uploaded ? `: ${formatTs(uploaded)}` : ""}` : "⚠️ Missing final clip"}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(e) => {
                      const f = e.target.files && e.target.files[0];
                      setFinalFiles((prev) => ({ ...prev, [p.id]: f || null }));
                    }}
                    style={{ maxWidth: 260 }}
                  />

                  <button
                    onClick={() => uploadFinal(p.id)}
                    disabled={!pendingFile || finalUploadingId === p.id}
                    style={{ padding: "10px 12px", borderRadius: 12, fontWeight: 900 }}
                  >
                    {finalUploadingId === p.id ? "Uploading…" : "Upload final"}
                  </button>

                  <button
                    onClick={() => downloadFinal(p.id)}
                    disabled={!hasFinal}
                    style={{ padding: "10px 12px", borderRadius: 12, fontWeight: 900 }}
                  >
                    Download
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          Workflow: download a parent recording → mix it with the requested song offline → upload the final clip for that player here.
        </div>
      </div>
    </div>
  );
}
