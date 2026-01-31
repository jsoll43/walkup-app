import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getParentKey, setParentKey } from "../auth/parentAuth";

export default function ParentLogin() {
  const nav = useNavigate();
  const loc = useLocation();
  const redirectTo = loc.state?.redirectTo || "/parent";

  const [key, setKey] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    const saved = getParentKey();
    if (saved) {
      // Already "logged in" for this session
      nav(redirectTo, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function login() {
    setErr("");
    if (!key) return setErr("Please enter the key.");
    setParentKey(key);
    nav(redirectTo, { replace: true });
  }

  return (
    <div style={{ padding: 24, maxWidth: 520, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Parent Access</h1>
      <div style={{ opacity: 0.75, marginTop: 8 }}>
        Enter the team key to view the roster and submit a walk-up announcement.
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 900, opacity: 0.75, marginBottom: 6 }}>
          Team Key
        </label>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Enter key…"
          style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #ddd" }}
          onKeyDown={(e) => (e.key === "Enter" ? login() : null)}
        />
      </div>

      <button
        onClick={login}
        disabled={!key}
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
        Privacy note: the roster is hidden unless you enter the key.
      </div>
    </div>
  );
}
