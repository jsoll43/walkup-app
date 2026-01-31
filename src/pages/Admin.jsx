import { useEffect, useMemo, useState } from "react";
import { roster } from "../data/roster";

function getAdminKey() {
  return sessionStorage.getItem("ADMIN_KEY") || "";
}

export default function Admin() {
  const [adminKey, setAdminKey] = useState(getAdminKey());
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [loadingFinalStatus, setLoadingFinalStatus] = useState(false);
  const [uploadingFinal, setUploadingFinal] = useState(false);

  const [err, setErr] = useState("");

  // Voice inbox
  const [voiceObjects, setVoiceObjects] = useState([]);
  const [previewKey, setPreviewKey] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");

  // Final clip upload
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [finalFile, setFinalFile] = useState(null);

  // Final status from DB
  const [finalRows, setFinalRows] = useState([]);

  const rosterById = useMemo(() => new Map(roster.map((p) => [p.id, p])), []);
  const finalByPlayerId = useMemo(() => {
    const map = new Map();
    for (const r of finalRows) map.set(r.player_id, r);
    return map;
  }, [finalRows]);

  const groupedVoice = useMemo(() => {
    const map = new Map();
    for (const o of voiceObjects) {
      const [playerId] = o.key.split("/");
      if (!map.has(playerId)) map.set(playerId, []);
      map.get(playerId).push(o);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.uploaded < b.uploaded ? 1 : -1));
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] > b[0] ? 1 : -1));
  }, [voiceObjects]);

  async function fetchVoiceInbox(key) {
    setLoadingInbox(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/voice-inbox", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setVoiceObjects(json.objects || []);
    } catch (e) {
      setErr(e?.message || String(e));
      setVoiceObjects([]);
    } finally {
      setLoadingInbox(false);
    }
  }

  async function fetchFinalStatus(key) {
    setLoadingFinalStatus(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/final-status", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setFinalRows(json.rows || []);
    } catch (e) {
      setErr(e?.message || String(e));
      setFinalRows([]);
    } finally {
      setLoadingFinalStatus(false);
    }
  }

  async function previewOrDownloadVoice(key, objectKey, mode = "preview") {
    setErr("");
    try {
      const res = await fetch(`/api/admin/voice-file?key=${encodeURIComponent(objectKey)}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(await res.text());

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      if (mode === "preview") {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewKey(objectKey);
        setPreviewUrl(url);
        return;
      }

      const filename = objectKey.split("/").pop() || "voice";
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (e) {
      setErr(e?.message || String(e));
    }
  }

  async function uploadFinalClip(key) {
    setErr("");
    if (!selectedPlayerId) return setErr("Select a player first.");
    if (!finalFile) return setErr("Choose an audio file first.");

    setUploadingFinal(true);
    try {
      const form = new FormData();
      form.append("playerId", selectedPlayerId);
      form.append("file", finalFile);

      const res = await fetch("/api/admin/final-upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });

      if (!res.ok) throw new Error(await res.text());

      // Refresh status after upload
      await fetchFinalStatus(key);

      // clear file picker
      setFinalFile(null);
      alert("Final clip uploaded!");
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setUploadingFinal(false);
    }
  }

  function clearPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setPreviewKey("");
  }

  function loadAll(key) {
    fetchVoiceInbox(key);
    fetchFinalStatus(key);
  }

  useEffect(() => {
    // auto-load if key already in sessionStorage
    if (adminKey) loadAll(adminKey);

    return () => {
      // cleanup preview blob url on unmount
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Admin</h1>

      {/* Key + controls */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="password"
          placeholder="Admin key"
          value={adminKey}
          onChange={(e) => setAdminKey(e.target.value)}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", minWidth: 280 }}
        />
        <button
          onClick={() => {
            sessionStorage.setItem("ADMIN_KEY", adminKey);
            loadAll(adminKey);
          }}
          style={{ padding: "10px 14px", borderRadius: 10, fontWeight: 800 }}
        >
          Load
        </button>
        <button
          onClick={() => {
            sessionStorage.removeItem("ADMIN_KEY");
            setAdminKey("");
            setVoiceObjects([]);
            setFinalRows([]);
            setSelectedPlayerId("");
            setFinalFile(null);
            clearPreview();
            setErr("");
          }}
          style={{ padding: "10px 14px", borderRadius: 10 }}
        >
          Clear Key
        </button>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <button
            onClick={() => loadAll(adminKey)}
            disabled={!adminKey || loadingInbox || loadingFinalStatus}
            style={{ padding: "10px 14px", borderRadius: 10 }}
          >
            Refresh
          </button>
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 12, color: "crimson" }}>
          <strong>Error:</strong> {err}
        </div>
      )}

      <hr style={{ margin: "18px 0" }} />

      {/* Upload Final Clip */}
      <h2 style={{ margin: "0 0 10px 0" }}>Upload Final Clip</h2>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={selectedPlayerId}
          onChange={(e) => setSelectedPlayerId(e.target.value)}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", minWidth: 320 }}
        >
          <option value="">Select player…</option>
          {roster.map((p) => (
            <option key={p.id} value={p.id}>
              #{p.number} {p.first} {p.last} ({p.id})
            </option>
          ))}
        </select>

        <input
          type="file"
          accept="audio/*"
          onChange={(e) => setFinalFile(e.target.files?.[0] || null)}
        />

        <button
          disabled={!adminKey || !selectedPlayerId || !finalFile || uploadingFinal}
          onClick={() => uploadFinalClip(adminKey)}
          style={{ padding: "10px 14px", borderRadius: 10, fontWeight: 900 }}
        >
          {uploadingFinal ? "Uploading…" : "Upload"}
        </button>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
        This uploads the merged “final” walk-up clip to R2 and records it in the DB so coaches can play it.
      </div>

      <hr style={{ margin: "18px 0" }} />

      {/* Final clip status */}
      <h2 style={{ margin: "0 0 10px 0" }}>Final Clip Status</h2>
      {loadingFinalStatus ? (
        <p>Loading final status…</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {roster.map((p) => {
            const row = finalByPlayerId.get(p.id);
            const ready = !!row;
            return (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  padding: 12,
                  border: "1px solid #ddd",
                  borderRadius: 12,
                }}
              >
                <div>
                  <div style={{ fontWeight: 900 }}>
                    #{p.number} {p.first} {p.last}{" "}
                    <span style={{ fontSize: 12, opacity: 0.7 }}>({p.id})</span>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    {ready
                      ? `Ready • ${row.uploaded_at} • ${row.r2_key}`
                      : "Missing"}
                  </div>
                </div>

                <div style={{ fontWeight: 900 }}>
                  {ready ? "✅ READY" : "⏳ MISSING"}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <hr style={{ margin: "18px 0" }} />

      {/* Voice Inbox */}
      <h2 style={{ margin: "0 0 10px 0" }}>Voice Inbox (Parent recordings)</h2>

      {loadingInbox ? <p>Loading inbox…</p> : null}

      {previewUrl && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Preview</div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>{previewKey}</div>
          <audio controls src={previewUrl} style={{ width: "100%" }} />
          <div style={{ marginTop: 10 }}>
            <button onClick={clearPreview} style={{ padding: "8px 10px", borderRadius: 10 }}>
              Close Preview
            </button>
          </div>
        </div>
      )}

      {groupedVoice.length === 0 && !loadingInbox ? (
        <p style={{ opacity: 0.8 }}>No voice submissions found yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {groupedVoice.map(([playerId, arr]) => {
            const p = rosterById.get(playerId);
            const header = p
              ? `#${p.number} ${p.first} ${p.last} (${playerId})`
              : `Player ID: ${playerId}`;

            return (
              <div key={playerId} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 900 }}>{header}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{arr.length} file(s)</div>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  {arr.map((o) => (
                    <div
                      key={o.key}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 10,
                        padding: 10,
                        border: "1px solid #eee",
                        borderRadius: 10,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {o.key}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>
                          {o.uploaded ? new Date(o.uploaded).toLocaleString() : ""} •{" "}
                          {Math.round((o.size || 0) / 1024)} KB
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                        <button
                          onClick={() => previewOrDownloadVoice(adminKey, o.key, "preview")}
                          style={{ padding: "8px 10px", borderRadius: 10 }}
                          disabled={!adminKey}
                        >
                          Preview
                        </button>
                        <button
                          onClick={() => previewOrDownloadVoice(adminKey, o.key, "download")}
                          style={{ padding: "8px 10px", borderRadius: 10, fontWeight: 900 }}
                          disabled={!adminKey}
                        >
                          Download
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
