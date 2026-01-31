import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { roster } from "../data/roster";
import { clearParentKey, getParentKey, setParentKey } from "../auth/parentAuth";

export default function ParentRecord() {
  const nav = useNavigate();
  const { playerId } = useParams();

  // Gate access
  useEffect(() => {
    const key = getParentKey();
    if (!key) {
      nav("/parent-login", { replace: true, state: { redirectTo: `/parent/${playerId}` } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

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
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Recording not supported in this browser.");

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
        setBlobUrl(URL.createObjectURL(b));
        setStatus("recorded");

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

  function ensureParentKey() {
    let key = getParentKey();
    if (!key) {
      key = prompt("Team Key:");
      if (!key) return "";
      setParentKey(key);
    }
    return key;
  }

  async function submit() {
    setErr("");
    if (!player) return setErr("Unknown player.");
    if (!blob) return setErr("Record something first.");

    setStatus("uploading");

    try {
      const key = ensureParentKey();
      if (!key) {
        setStatus("recorded");
        return;
      }

      const form = new FormData();
      form.append("playerId", player.id);
      form.append("file", blob, `${player.id}_voice.webm`);

      const res = await fetch("/api/voice-upload", {
        method: "POST",
        headers: { Authorization: "Bearer " + key },
        body: form,
      });

      if (res.status === 401) {
        clearParentKey();
        throw new Error("Unauthorized. The team key may have changed. Please go back and re-enter the key.");
      }

      if (!res.ok) throw new Error(await res.text());

      cleanupBlobUrl();
      setBlob(null);
      setStatus("submitted");
    } catch (e) {
      setStatus("recorded");
      setErr(e?.message || String(e));
    }
  }

  if (!getParentKey()) return null; // while redirecting

  // Submitted lock screen
  if (status === "submitted") {
    return (
      <div style={{ padding: 24, maxWidth: 820, margin: "0 auto" }}>
        <h1 style={{ marginTop: 0 }}>✅ Successfully submitted</h1>
        <div style={{ fontSize: 18, marginTop: 10 }}>
          Your recording has been submitted to the coaching staff.
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

      <div style={{ border: "1px solid #ddd", borderRadius: 14, padding: 14, marginTop: 12, background: "#fafafa" }}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>
          Please say this
        </div>
        <div style={{ fontSize: 18 }}>{promptText}</div>
      </div>

      {err && (
        <div style={{ marginTop: 12, color: "crimson" }}>
          <strong>Error:</strong> {err}
        </div>
      )}

      <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {!isRecording ? (
          <button
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

        <button
          disabled={!canSubmit || status === "uploading"}
          onClick={submit}
          style={{ padding: "12px 14px", borderRadius: 12, fontWeight: 900 }}
        >
          {status === "uploading" ? "Submitting…" : "Submit to coaching staff"}
        </button>
      </div>

      {blobUrl && status === "recorded" && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Preview</div>
          <audio controls src={blobUrl} style={{ width: "100%" }} />
        </div>
      )}
    </div>
  );
}
