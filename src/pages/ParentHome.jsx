import { Link } from "react-router-dom";
import { roster } from "../data/roster";

export default function ParentHome() {
  return (
    <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 6 }}>Walk-Up: Parent</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Select your player to record the announcer clip.
      </p>

      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {roster.map((p) => (
          <Link
            key={p.id}
            to={`/record/${p.id}`}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: 14,
              border: "1px solid #ddd",
              borderRadius: 12,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <div>
              <div style={{ fontWeight: 700 }}>#{p.number} {p.first} {p.last}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Tap to record</div>
            </div>
            <div style={{ fontWeight: 700 }}>Record →</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
