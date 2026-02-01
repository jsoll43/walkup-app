import { useMemo, useState } from "react";
import ParentRecord from "./ParentRecord.jsx";
import { getParentKey, getTeamSlug, getTeamName } from "../auth/parentAuth";

async function readJsonOrText(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export default function ParentHome() {
  const parentKey = useMemo(() => getParentKey(), []);
  const teamSlug = useMemo(() => getTeamSlug(), []);
  const teamName = useMemo(() => getTeamName(), []);

  const [playerName, setPlayerName] = useState("");
  const [songRequest, setSongRequest] = useState("");
  const [wavBlob, setWavBlob] = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");

    if (!teamSlug) {
      setErr("Missing team selection. Go back to Parent Login and select a team.");
      return;
    }
    if (!parentKey) {
      setErr("Missing parent key. Go back to Parent Login and enter the Parent key.");
      return;
    }
    if (!playerName.trim()) {
      setErr("Player Name is required.");
      return;
    }
    if (!wavBlob) {
      setErr("Please record audio first.");
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("playerName", playerName.trim());
      fd.append("songRequest", songRequest.trim());

      const file = new File([wavBlob], "walkup.wav", { type: "audio/wav" });
      fd.append("file", file);

      const res = await fetch("/api/voice-upload", {
        method: "POST",
        headers: {
          "x-team-slug": teamSlug,
          "x-parent-key": parentKey,
          Authorization: `Bearer ${parentKey}`,
        },
        body: fd,
      });

      const data = await readJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.message || data?.raw || `Upload failed (HTTP ${res.status}).`);
      }

      setSubmitted(true);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="page">
        <div className="card">
          <div className="cardTitle">Team</div>
          <div style={{ fontWeight: 1000, marginTop: 6 }}>{teamName || "—"}</div>

          <h1 style={{ marginTop: 12 }}>Submitted ✅</h1>
          <div style={{ marginTop: 10, opacity: 0.85 }}>Thanks! Your walk-up request has been submitted.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="card">
        <div className="cardTitle">Team</div>
        <div style={{ fontWeight: 1000, marginTop: 6 }}>{teamName || "—"}</div>

        <h1 style={{ marginTop: 12 }}>Parent Submission</h1>

        <div style={{ marginTop: 14 }}>
          <label className="label">Player Name (required)</label>
          <input
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Type player name…"
            className="input"
          />
        </div>

        <div style={{ marginTop: 14 }}>
          <label className="label">Song Request (optional)</label>
          <input
            value={songRequest}
            onChange={(e) => setSongRequest(e.target.value)}
            placeholder="example: Taylor Swift - Shake it Off"
            className="input"
          />
        </div>

        <div style={{ marginTop: 14 }}>
          <ParentRecord onBlob={setWavBlob} disabled={submitting} playerName={playerName} />
        </div>

        <button className="btn" onClick={submit} disabled={submitting} style={{ marginTop: 14, width: "100%" }}>
          {submitting ? "Submitting…" : "Submit"}
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
