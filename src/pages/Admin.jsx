import { useEffect, useMemo, useState } from "react";

function getAdminKey() {
  return sessionStorage.getItem("ADMIN_KEY") || "";
}

export default function Admin() {
  const [adminKey, setAdminKey] = useState(getAdminKey());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [objects, setObjects] = useState([]);
  const [previewKey, setPreviewKey] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");

  const grouped = useMemo(() => {
    // group by playerId (first path segment)
    const map = new Map();
    for (const o of objects) {
      const [playerId] = o.key.split("/");
      if (!map.has(playerId)) map.set(playerId, []);
      map.get(playerId).push(o);
    }
    // sort newest first per player
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => (a.uploaded < b.uploaded ? 1 : -1));
    }
    // return sorted by playerId
    return Array.from(map.entries()).sort((a, b) => (a[0] > b[0] ? 1 : -1));
  }, [objects]);

  async function fetchInbox(key) {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/voice-inbox", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setObjects(json.objects || []);
    } catch (e) {
      setErr(e?.message || String(e));
      setObjects([]);
    } finally {
      setLoading(false);
    }
  }

  async function downloadOrPreview(key, objectKey, mode = "download") {
    setErr("");
    try {
      const res = await fetch(`/api/admin/voice-file?key=${encodeURIComponent(objectKey)}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      if (mode === "preview") {
        // cleanup prior preview url
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewKey(objectKey);
        setPreviewUrl(url);
        return;
      }

      // download
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

  useEffect(() => {
    // if key already stored in session, auto-load inbox
    if (adminKey) fetchInbox(adminKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Admin</h1>

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
            fetchInbox(adminKey);
          }}
          style={{ padding: "10px 14px", borderRadius: 10, fontWeight: 700 }}
        >
          Load Inbox
        </button>
        <button
          onClick={() => {
            sessionStorage.removeItem("ADMIN_KEY");
            setAdminKey("");
            setObjects([]);
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setPreviewUrl("");
            setPreviewKey("");
          }}
          style={{ padding: "10px 14px", borderRadius: 10 }}
        >
          Clear Key
        </button>
      </div>

      {loading && <p style={{ marginTop: 12 }}>Loading…</p>}

      {err && (
        <div style={{ marginTop: 12, color: "crimson" }}>
          <strong>Error:</strong> {err}
        </div>
      )}

      {previewUrl && (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Preview</div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>{previewKey}</div>
          <audio controls src={previewUrl} style={{ width: "100%" }} />
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={{ margin: 0 }}>Voice Inbox</h2>
          <button
            onClick={() => fetchInbox(adminKey)}
            disabled={!adminKey || loading}
            style={{ padding: "8px 12px", borderRadius: 10 }}
          >
            Refresh
          </button>
        </div>

        {grouped.length === 0 && !loading && (
          <p style={{ opacity: 0.8 }}>No submissions found yet.</p>
        )}

        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {grouped.map(([playerId, arr]) => (
            <div key={playerId} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 800 }}>Player ID: {playerId}</div>
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
                      <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {o.key}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>
                        {o.uploaded ? new Date(o.uploaded).toLocaleString() : ""} • {Math.round((o.size || 0) / 1024)} KB
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      <button
                        onClick={() => downloadOrPreview(adminKey, o.key, "preview")}
                        style={{ padding: "8px 10px", borderRadius: 10 }}
                      >
                        Preview
                      </button>
                      <button
                        onClick={() => downloadOrPreview(adminKey, o.key, "download")}
                        style={{ padding: "8px 10px", borderRadius: 10, fontWeight: 700 }}
                      >
                        Download
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
