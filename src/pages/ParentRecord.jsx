import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { roster } from "../data/roster";

export default function ParentRecord() {
  const nav = useNavigate();
  const { playerId } = useParams();

  const player = useMemo(() => roster.find((p) => p.id === playerId), [playerId]);

  const [status, setStatus] = useState("idle"); // idle | recording | recorded | uploading | submitted
  const [err, setErr] = useState("");

  const [blob, setBlob] = useState(null);
  const [blobUrl, setBlobUrl] = useState("");

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  const promptText = useMemo(() => {
    if (!player) return "";
    return `Now batting, number ${player.number}, ${player.first} ${player.last}.`;
  }, [player]);

  function cleanupBlobUrl() {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl("");
  }

  async function startRecording() {
    setErr("");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Recording not supported in this browser.");
      }

      cleanupBlobUrl();
      setBlob(null);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        const b = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        setBlob(b);
        const url = URL.createObjectURL(b);
        setBlobUrl(url);
        setStatus("recorded");

        // stop tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
      };

      mr.start();
      setStatus("recording");
    } catch (e) {
      setStatus("idle");
      setErr(e?.message || String(e));
    }
  }

  function stopRecording() {
    try {
      const mr = mediaRecorderRef.current;
      if (mr && mr.state !== "inactive") mr.stop();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setStatus("idle");
    }
  }

  async function submit() {
    setErr("");
    if (!player) return setErr("Unknown player.");
    if (!blob) return setErr("Record something first.");

    try {
      setStatus("uploading");

      const form = new FormData();
      form.append("playerId", player.id);
      form.append("file", blob, `${player.id}_voice.webm`);

      const res = await fetch("/api/voice-upload", {
        method: "POST",
        body: form,
      });

      if (!res.ok) throw new Error(await res.text());

      // LOCK the screen after success
      cleanupBlobUrl();
      setBlob(null);
      setStatus("submitted");
    } catch (e) {
      setStatus("recorded");
      setErr(e?.message || String(e));
    }
  }

  // ---------- Submitted Screen ----------
  if (status === "submitted") {
    return (
      <div style={{ padding: 24, maxWidth: 820, margin: "0 auto" }}>
        <h1 style={{ marginTop: 0 }}>✅ Successfully submitted</h1>
        <div style={{ fontSize: 18, marginTop: 10 }}>
          Your recording has been submitted to the coaching staff.
        </div>
        <div style={{ marginTop: 14, opacity: 0.75 }}>
          You’re all set — no further action is needed.
        </div>

        <div style={{ marginTop: 18 }}>
          <button
            onClick={() => nav("/parent")}
            style={{ padding: "12px 14px", borderRadius: 12, fontWeight: 900 }}
          >
            Back to roster
          </button>
        </div>
      </div>
    );
  }

  if (!player) {
    return (
      <div style={{ padding: 24, maxWidth: 820, margin: "0 auto" }}>
        <h1 style={{ marginTop: 0 }}>Player not found</h1>
        <button onClick={() => nav("/parent")} style={{ padding: "10px 12px", borderRadius: 12 }}>
          Back to roster
        </button>
      </div>
    );
  }

  const canRecord = status === "idle" || status === "recorded";
  const isRecording = status === "recording";
  const canSubmit = status === "recorded";

  return (
    <div style={{ padding: 24, maxWidth: 820, margin: "0 auto" }}>
      <button onClick={() => nav("/parent")} style={{ marginBottom: 12 }}>
        ← Back to roster
      </button>

      <h1 style={{ marginTop: 0 }}>
        Record for: #{player.number} {player.first} {player.last}
      </h1>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 14,
          padding: 14,
          marginTop: 12,
          background: "#fafafa",
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Please say this</div>
        <div style={{ fontSize: 18 }}>{promptText}</div>
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
          Tip: Tap Record, hold the phone close, and speak clearly.
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 12, color: "crimson" }}>
          <strong>Error:</strong> {err}
        </div>
      )}

      <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {!isRecording ? (
          <button
            disabled={!canRecord}
            onClick={startRecording}
            style={{ padding: "12px 14px", borderRadius: 12, fontWeight: 900 }}
          >
            🎙️ Record
          </button>
        ) : (
          <button
            onClick={stopRecording}
            style={{ padding: "12px 14px", borderRadius: 12, fontWeight: 900 }}
          >
            ⏹ Stop
          </button>
        )}

        {canSubmit ? (
          <button
            onClick={submit}
            style={{ padding: "12px 14px", borderRadius: 12, fontWeight: 900 }}
          >
            Submit to coaching staff
          </button>
        ) : (
          <button disabled style={{ padding: "12px 14px", borderRadius: 12, opacity: 0.6 }}>
            Submit to coaching staff
          </button>
        )}
      </div>

      {status === "uploading" && (
        <div style={{ marginTop: 12, fontWeight: 900 }}>
          Uploading… please keep this page open.
        </div>
      )}

      {blobUrl && status === "recorded" && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Preview</div>
          <audio controls src={blobUrl} style={{ width: "100%" }} />
        </div>
      )}
    </div>
  );
}
