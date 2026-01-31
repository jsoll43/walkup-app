// src/pages/ParentHome.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

function getStoredParentKey() {
  return (
    sessionStorage.getItem("PARENT_UPLOAD_KEY") ||
    sessionStorage.getItem("parentUploadKey") ||
    sessionStorage.getItem("parentKey") ||
    sessionStorage.getItem("key") ||
    ""
  ).trim();
}

function pickBestMimeType() {
  // Prefer webm/opus where available
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  for (const t of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      // ignore
    }
  }
  return "";
}

export default function ParentHome() {
  const navigate = useNavigate();

  const parentKey = useMemo(() => getStoredParentKey(), []);
  const [playerName, setPlayerName] = useState("");
  const [songRequest, setSongRequest] = useState("");

  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => {
    if (!parentKey) navigate("/parent-login", { replace: true });
  }, [parentKey, navigate]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      try {
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        }
      } catch {
        // ignore
      }
    };
  }, [audioUrl]);

  const resetRecording = () => {
    setError("");
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl("");
    chunksRef.current = [];
  };

  const startRecording = async () => {
    setError("");
    resetRecording();

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Your browser doesn’t support microphone recording.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mimeType = pickBestMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);

        // Stop tracks so mic icon turns off
        try {
          stream.getTracks().forEach((t) => t.stop());
        } catch {
          // ignore
        }
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        chunksRef.current = [];
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (e) {
      setError(
        "Couldn’t access the microphone. Please allow mic permissions and try again."
      );
    }
  };

  const stopRecording = () => {
    setError("");
    try {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      setIsRecording(false);
    } catch (e) {
      setError("Something went wrong stopping the recording. Please try again.");
      setIsRecording(false);
    }
  };

  const canSubmit = playerName.trim().length > 0 && !!audioBlob && !submitting && !submitted;

  const handleSubmit = async () => {
    setError("");

    const name = playerName.trim();
    if (!name) {
      setError("Player Name is required.");
      return;
    }
    if (!audioBlob) {
      setError("Please record a short clip before submitting.");
      return;
    }

    try {
      setSubmitting(true);

      const fd = new FormData();
      fd.append("playerName", name);
      fd.append("songRequest", songRequest.trim());
      fd.append("file", audioBlob, "walkup.webm");

      // Send the key in multiple common headers so it works with whichever you implemented server-side.
      const res = await fetch("/api/voice-upload", {
        method: "POST",
        headers: {
          "x-parent-upload-key": parentKey,
          "x-parent-key": parentKey,
          "x-api-key": parentKey,
        },
        body: fd,
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }

      if (!res.ok || data?.ok === false) {
        const msg = data?.error || data?.message || `Upload failed (HTTP ${res.status}).`;
        setError(msg);
        setSubmitting(false);
        return;
      }

      setSubmitted(true);
      setSubmitting(false);
    } catch (e) {
      setError("Upload failed. Please check your connection and try again.");
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: 20 }}>
        <h1 style={{ marginBottom: 8 }}>Submitted ✅</h1>
        <p style={{ marginTop: 0 }}>
          Thanks! Your request has been sent to the coach/admin.
        </p>
        <div
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.15)",
          }}
        >
          <div style={{ marginBottom: 6 }}>
            <strong>Player Name:</strong> {playerName.trim()}
          </div>
          <div style={{ marginBottom: 6 }}>
            <strong>Song Request:</strong> {songRequest.trim() || "(none)"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 20 }}>
      <h1 style={{ marginBottom: 6 }}>Walk-Up Song Submission</h1>
      <p style={{ marginTop: 0, opacity: 0.85 }}>
        Enter the player’s name, optionally add a song request, then record a short voice clip.
      </p>

      <div style={{ marginTop: 16 }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
          Player Name <span style={{ opacity: 0.8 }}>(required)</span>
        </label>
        <input
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          placeholder="e.g., Ava S."
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(0,0,0,0.2)",
            color: "inherit",
          }}
          disabled={submitting}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
          Song Request <span style={{ opacity: 0.8 }}>(optional)</span>
        </label>
        <input
          value={songRequest}
          onChange={(e) => setSongRequest(e.target.value)}
          placeholder="e.g., Taylor Swift – Shake It Off"
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(0,0,0,0.2)",
            color: "inherit",
          }}
          disabled={submitting}
        />
      </div>

      <div style={{ marginTop: 18 }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>
          Voice Recording
        </label>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {!isRecording ? (
            <button
              onClick={startRecording}
              disabled={submitting}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.08)",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              {audioBlob ? "Record again" : "Start recording"}
            </button>
          ) : (
            <button
              onClick={stopRecording}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,80,80,0.22)",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              Stop recording
            </button>
          )}

          {isRecording && (
            <span style={{ opacity: 0.9 }}>
              Recording… (keep it short)
            </span>
          )}
        </div>

        {audioUrl && (
          <div style={{ marginTop: 12 }}>
            <audio controls src={audioUrl} style={{ width: "100%" }} />
          </div>
        )}
      </div>

      {error && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 10,
            background: "rgba(255,0,0,0.12)",
            border: "1px solid rgba(255,0,0,0.25)",
          }}
        >
          {error}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            width: "100%",
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.18)",
            background: canSubmit ? "rgba(100,200,255,0.22)" : "rgba(255,255,255,0.06)",
            color: "inherit",
            cursor: canSubmit ? "pointer" : "not-allowed",
            fontWeight: 700,
          }}
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </div>
    </div>
  );
}
