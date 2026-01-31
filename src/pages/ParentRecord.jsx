// src/pages/ParentRecord.jsx
import { useEffect, useRef, useState } from "react";

function floatTo16BitPCM(output, offset, input) {
  for (let i = 0; i < input.length; i++) {
    let s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function encodeWav({ samples, sampleRate, numChannels = 1 }) {
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, "WAVE");

  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);

  writeString(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  floatTo16BitPCM(view, 44, samples);
  return new Blob([view], { type: "audio/wav" });
}

function mergeFloat32(chunks) {
  let totalLength = 0;
  for (const c of chunks) totalLength += c.length;
  const result = new Float32Array(totalLength);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

export default function ParentRecord({ onBlob, disabled = false, playerName = "" }) {
  const MAX_SECONDS = 5;

  const [isRecording, setIsRecording] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [err, setErr] = useState("");

  const mediaStreamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const sourceRef = useRef(null);
  const processorRef = useRef(null);
  const gainRef = useRef(null);

  const chunksRef = useRef([]);
  const recordingRef = useRef(false);
  const stopTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      try {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
      } catch {}
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cleanup() {
    try {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    } catch {}
    stopTimerRef.current = null;

    try {
      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current.onaudioprocess = null;
      }
    } catch {}
    try {
      if (sourceRef.current) sourceRef.current.disconnect();
    } catch {}
    try {
      if (gainRef.current) gainRef.current.disconnect();
    } catch {}
    try {
      if (audioCtxRef.current) audioCtxRef.current.close();
    } catch {}
    try {
      if (mediaStreamRef.current) {
        for (const t of mediaStreamRef.current.getTracks()) t.stop();
      }
    } catch {}

    processorRef.current = null;
    sourceRef.current = null;
    gainRef.current = null;
    audioCtxRef.current = null;
    mediaStreamRef.current = null;

    recordingRef.current = false;
    setIsRecording(false);
  }

  async function start() {
    setErr("");
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mediaStreamRef.current = stream;

      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      // mute output (prevents feedback)
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gainRef.current = gain;

      recordingRef.current = true;
      setIsRecording(true);

      processor.onaudioprocess = (e) => {
        if (!recordingRef.current) return;
        const input = e.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(input));
      };

      source.connect(processor);
      processor.connect(gain);
      gain.connect(ctx.destination);

      // Auto-stop at MAX_SECONDS
      stopTimerRef.current = setTimeout(() => {
        stop();
      }, MAX_SECONDS * 1000);
    } catch (e) {
      setErr(e?.message || String(e));
      cleanup();
    }
  }

  async function stop() {
    setErr("");
    if (!recordingRef.current) return;

    try {
      recordingRef.current = false;
      setIsRecording(false);

      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;

      const ctx = audioCtxRef.current;
      const sampleRate = ctx?.sampleRate || 48000;

      const merged = mergeFloat32(chunksRef.current);
      const wavBlob = encodeWav({ samples: merged, sampleRate, numChannels: 1 });

      if (previewUrl) {
        try {
          URL.revokeObjectURL(previewUrl);
        } catch {}
      }
      const url = URL.createObjectURL(wavBlob);
      setPreviewUrl(url);

      if (typeof onBlob === "function") onBlob(wavBlob);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      cleanup();
    }
  }

  function clear() {
    setErr("");
    chunksRef.current = [];
    recordingRef.current = false;
    setIsRecording(false);

    if (stopTimerRef.current) {
      try {
        clearTimeout(stopTimerRef.current);
      } catch {}
    }
    stopTimerRef.current = null;

    if (previewUrl) {
      try {
        URL.revokeObjectURL(previewUrl);
      } catch {}
    }
    setPreviewUrl("");

    if (typeof onBlob === "function") onBlob(null);
    cleanup();
  }

  const namePart = (playerName || "").trim() || "player name";
  const scriptText = `Please record: “Now batting, (jersey #), ${namePart}” — keep it under ${MAX_SECONDS} seconds.`;

  return (
    <div className="card">
      <div className="cardTitle">Voice recording (WAV)</div>

      <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
        {scriptText}
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn" onClick={start} disabled={disabled || isRecording}>
          {isRecording ? "Recording…" : "Start recording"}
        </button>

        <button className="btn-secondary" onClick={stop} disabled={disabled || !isRecording}>
          Stop
        </button>

        <button className="btn-danger" onClick={clear} disabled={disabled}>
          Clear
        </button>
      </div>

      {previewUrl ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.8, marginBottom: 6 }}>Preview</div>
          <audio controls src={previewUrl} style={{ width: "100%" }} />
        </div>
      ) : null}

      {err ? (
        <div style={{ marginTop: 10, color: "crimson" }}>
          <strong>Error:</strong> {err}
        </div>
      ) : null}
    </div>
  );
}
