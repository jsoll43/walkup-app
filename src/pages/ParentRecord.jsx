import { useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { roster } from "../data/roster";

function pickMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/aac",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  for (const t of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return ""; // let browser choose
}

function extForMime(mime) {
  if (!mime) return "webm";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("aac")) return "aac";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

async function uploadVoice({ playerId, blob, filename }) {
  // For now we prompt for the shared parent key.
  // Later we’ll remove this and use kid-specific QR tokens so parents never type anything.
  const key = window.prompt("Enter the Team Upload Key:");
  if (!key) throw new Error("Upload key is required.");

  const form = new FormData();
  form.append("playerId", playerId);
  form.append("file", blob, filename);

  const res = await fetch("/api/voice-upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Upload failed (${res.status})`);
  }
  return res.json();
}

export default function ParentRecord() {
  const { playerId } = useParams();
  const [uploading, setUploading] = useState(false);
const [uploadedKey, setUploadedKey] = useState("");
  const player = useMemo(
    () => roster.find((p) => p.id === playerId),
    [playerId]
  );

  const [status, setStatus] = useState("idle"); // idle | recording | recorded | error
  const [error, setError] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [audioBlob, setAudioBlob] = useState(null);
  const [mimeType, setMimeType] = useState("");

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  if (!player) {
    return (
      <div style={{ padding: 24 }}>
        <p>Player not found.</p>
        <Link to="/">Back</Link>
      </div>
    );
  }

  const script = `Now batting, number ${player.number}, ${player.first} ${player.last}.`;

  async function startRecording() {
    setError("");
    setStatus("idle");
    setAudioUrl("");
    setAudioBlob(null);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chosen = pickMimeType();
      setMimeType(chosen);

      const mr = new MediaRecorder(stream, chosen ? { mimeType: chosen } : undefined);
      mediaRecorderRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        // stop mic tracks
        stream.getTracks().forEach((t) => t.stop());

        const blob = new Blob(chunksRef.current, { type: chosen || "audio/webm" });
        const url = URL.createObjectURL(blob);

        setAudioBlob(blob);
        setAudioUrl(url);
        setStatus("recorded");
      };

      mr.start();
      setStatus("recording");
    } catch (e) {
      setStatus("error");
      setError(
        e?.name === "NotAllowedError"
          ? "Microphone permission denied. Please allow mic access and try again."
          : `Could not start recording: ${e?.message || e}`
      );
    }
  }

  function stopRecording() {
    try {
      mediaRecorderRef.current?.stop();
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setError(`Could not stop recording: ${e?.message || e}`);
    }
  }

  function downloadRecording() {
    if (!audioBlob) return;
    const ext = extForMime(mimeType || audioBlob.type);
    const filename = `${player.number}_${player.first}_${player.last}_voice.${ext}`.replaceAll(" ", "_");

    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = filename;
    a.click();
  }

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <Link to="/" style={{ textDecoration: "none" }}>← Back to roster</Link>

      <h1 style={{ marginBottom: 6, marginTop: 12 }}>
        Record for: #{player.number} {player.first} {player.last}
      </h1>

      <div style={{ padding: 14, border: "1px solid #ddd", borderRadius: 12, marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Please say this</div>
        <div style={{ fontSize: 18, lineHeight: 1.4 }}>{script}</div>
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
          Tip: Tap Record, hold the phone close, and speak clearly.
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center" }}>
        {status !== "recording" ? (
          <button
            onClick={startRecording}
            style={{ padding: "12px 16px", borderRadius: 12, fontWeight: 700 }}
          >
            🎙️ Record
          </button>
        ) : (
          <button
            onClick={stopRecording}
            style={{ padding: "12px 16px", borderRadius: 12, fontWeight: 700 }}
          >
            ⏹️ Stop
          </button>
        )}

        {audioUrl && (
          <button
            onClick={downloadRecording}
            style={{ padding: "12px 16px", borderRadius: 12, fontWeight: 700 }}
          >
            ⬇️ Download
          </button>
        )}
		{audioBlob && (
  <button
    disabled={uploading}
    onClick={async () => {
      try {
        setError("");
        setUploading(true);
        setUploadedKey("");

        const ext = extForMime(mimeType || audioBlob.type);
        const filename = `${player.number}_${player.first}_${player.last}_voice.${ext}`.replaceAll(" ", "_");

        const result = await uploadVoice({
          playerId: player.id,
          blob: audioBlob,
          filename,
        });

        setUploadedKey(result.key || "");
      } catch (e) {
        setError(e?.message || String(e));
      } finally {
        setUploading(false);
      }
    }}
    style={{ padding: "12px 16px", borderRadius: 12, fontWeight: 700 }}
  >
    {uploading ? "⏫ Uploading..." : "✅ Submit to Coach"}
  </button>
)}

      </div>

      {audioUrl && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Preview</div>
          <audio controls src={audioUrl} style={{ width: "100%" }} />
        </div>
      )}
{uploadedKey && (
  <div style={{ marginTop: 14, padding: 12, border: "1px solid #cfe9cf", borderRadius: 12 }}>
    <strong>Submitted!</strong>
    <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
      Your coach/admin can download it from the Admin Inbox.
    </div>
  </div>
)}

      {error && (
        <div style={{ marginTop: 14, color: "crimson" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <div style={{ marginTop: 18, fontSize: 12, opacity: 0.75 }}>
        Note: “Submit to coach” comes next once we add storage + an Admin inbox.
      </div>
    </div>
  );
}
