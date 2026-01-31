import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { roster } from "../data/roster";

function getParentKey() {
  return sessionStorage.getItem("PARENT_UPLOAD_KEY") || "";
}
function clearParentKey() {
  sessionStorage.removeItem("PARENT_UPLOAD_KEY");
}

export default function ParentHome() {
  const nav = useNavigate();

  // Gate access: if no key, send them to parent login
  useEffect(() => {
    const key = getParentKey();
    if (!key) {
      nav("/parent-login", { replace: true, state: { redirectTo: "/parent" } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sorted = useMemo(() => {
    return [...roster].sort((a, b) => (a.number > b.number ? 1 : -1));
  }, []);

  // While redirecting, render nothing
  if (!getParentKey()) return null;

  return (
    <div style={{ padding: 24, maxWidth: 820, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h1 style={{ marginTop: 0, marginBottom: 0 }}>Roster</h1>
        <button
          onClick={() => {
            clearParentKey();
            nav("/parent-login", { replace: true, state: { redirectTo: "/parent" } });
          }}
          style={{ padding: "10px 12px", borderRadius: 12, fontWeight: 900 }}
        >
          Log out
        </button>
      </div>

      <div style={{ marginTop: 12, opacity: 0.75 }}>
        Tap your player to record the announcement.
      </div>

      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {sorted.map((p) => (
          <button
            key={p.id}
            onClick={() => nav(`/parent/${p.id}`)}
            style={{
              textAlign: "left",
              padding: "14px 14px",
              borderRadius: 14,
              border: "1px solid #ddd",
              fontWeight: 900,
            }}
          >
            #{p.number} {p.first} {p.last}
          </button>
        ))}
      </div>
    </div>
  );
}
