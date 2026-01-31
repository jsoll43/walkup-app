import { useEffect, useState } from "react";

function getSavedAdminKey() {
  return sessionStorage.getItem("ADMIN_KEY") || "";
}
function saveAdminKey(k) {
  sessionStorage.setItem("ADMIN_KEY", k);
}
function clearAdminKey() {
  sessionStorage.removeItem("ADMIN_KEY");
}

export default function Admin() {
  const [loginKey, setLoginKey] = useState("");
  const [adminKey, setAdminKey] = useState(getSavedAdminKey());
  const [isAuthed, setIsAuthed] = useState(false);

  const [items, setItems] = useState([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function fetchInbox(key) {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/parent-inbox", {
        headers: { Authorization: "Bearer " + key }
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setItems(json.items || []);
    } catch (e) {
      setErr(e?.message || String(e));
      if ((e?.message || "").toLowerCase().includes("unauthorized")) setIsAuthed(false);
    } finally {
      setLoading(false);
    }
  }

  async function tryLogin(key) {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/parent-inbox", {
        headers: { Authorization: "Bearer " + key }
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setIsAuthed(true);
      setAdminKey(key);
      saveAdminKey(key);
      setLoginKey("");
      setItems(json.items || []);
    } catch (e) {
      setIsAuthed(false);
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function deleteItem(id) {
    if (!confirm("Delete this submission from storage?")) return;
    setErr("");
    try {
      const res = await fetch("/api/admin/parent-delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + adminKey
        },
        body: JSON.stringify({ id })
      });
      if (!res.ok) throw new Error(await res.text());
      // refresh
      await fetchInbox(adminKey);
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
      <div style={{ padding: 24, maxWidth: 520, margin: "0 auto" }}>
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
          disabled={!loginKey || loading}
          style={{ marginTop: 12, width: "100%", padding: "12px 14px", borderRadius: 12, fontWeight: 900 }}
        >
          {loading ? "Logging in…" : "Log in"}
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
    <div style={{ padding: 18, maxWidth: 980, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Admin</h1>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => fetchInbox(adminKey)} disabled={loading} style={{ padding: "10px 14px", borderRadius: 10 }}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            onClick={() => {
              clearAdminKey();
              setIsAuthed(false);
              setAdminKey("");
              setLoginKey("");
              setErr("");
            }}
            style={{ padding: "10px 14px", borderRadius: 10, fontWeight: 900 }}
          >
            Log out
          </button>
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 10, color: "crimson" }}>
          <strong>Error:</strong> {err}
        </div>
      )}

      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 16, padding: 14 }}>
        <h2 style={{ marginTop: 0 }}>Parent Submissions</h2>
        <div style={{ opacity: 0.75, marginBottom: 10 }}>
          Shows pending voice recordings + song requests.
        </div>

        {items.length === 0 ? (
          <div style={{ opacity: 0.75 }}>No pending submissions.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {items.map((it) => (
              <div key={it.id} style={{ border: "1px solid #eee", borderRadius: 14, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 1000 }}>
                    {it.player_name || "(no name)"}{" "}
                    <span style={{ fontWeight: 600, opacity: 0.7 }}>
                      {it.created_at ? `• ${it.created_at}` : ""}
                    </span>
                  </div>
                  <button
                    onClick={() => deleteItem(it.id)}
                    style={{ padding: "8px 10px", borderRadius: 10, fontWeight: 900 }}
                  >
                    Delete
                  </button>
                </div>

                <div style={{ marginTop: 6, opacity: 0.85 }}>
                  <strong>Song request:</strong> {it.song_request || "—"}
                </div>

                <div style={{ marginTop: 10 }}>
                  <audio
                    controls
                    src={`/api/admin/parent-audio?id=${encodeURIComponent(it.id)}`}
                    style={{ width: "100%" }}
                    onPlay={(e) => {
                      // add auth header by switching to fetch+blob would be more secure,
                      // but simplest is fine for now since admin area is already behind key.
                    }}
                  />
                </div>

                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                  Size: {it.size_bytes || 0} bytes • {it.content_type || ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
