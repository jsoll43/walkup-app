// src/pages/ParentRecord.jsx
import { useEffect, useMemo, useRef, useState } from "react";

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
  // 16-bit PCM WAV
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, "WAVE");

  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM
  view.setUint16(20, 1, true); // format = 1 (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample

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

/**
 * Props:
 * - onBlob(blob): called when a recording is finalized
 * - disabled: optional boolean
 */
export default function ParentRecord({ onBlob, disabled = false }) {
  const [isRecording, setIsRecording] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [err, setErr] = useState("");

  const mediaStreamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const sourceRef = useRef(null);
  const processorRef = useRef(null);
  const chunksRef = useRef([]);

  const canStart = useMemo(() => !disabled && !isRecording, [disabled, isRecording]);

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
      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current.onaudioprocess = null;
      }
    } catch {}
    try {
      if (sourceRef.current) sourceRef.current.disconnect();
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
    audioCtxRef.current = null;
    mediaStreamRef.current = null;
  }

  async function start() {
    setErr("");
    setHasRecording(false);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // ScriptProcessorNode is deprecated but still widely supported; works fine for this use.
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!isRecording) return;
        const input = e.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(input));
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      setIsRecording(true);
    } catch (e) {
      setErr(e?.message || String(e));
      cleanup();
      setIsRecording(false);
    }
  }

  async function stop() {
    setErr("");
    try {
      setIsRecording(false);

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
      setHasRecording(true);

      if (typeof onBlob === "function") onBlob(wavBlob);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      cleanup();
    }
  }

  function clear() {
    setErr("");
    setHasRecording(false);
    if (previewUrl) {
      try {
        URL.revokeObjectURL(previewUrl);
      } catch {}
    }
    setPreviewUrl("");
    chunksRef.current = [];
    if (typeof onBlob === "function") onBlob(null);
  }

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 16, padding: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.75 }}>VOICE RECORDING (WAV)</div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={start}
          disabled={!canStart}
          style={{ padding: "10px 14px", borderRadius: 12, fontWeight: 900 }}
        >
          {isRecording ? "Recording…" : "Start recording"}
        </button>

        <button
          onClick={stop}
          disabled={disabled || !isRecording}
          style={{ padding: "10px 14px", borderRadius: 12, fontWeight: 900 }}
        >
          Stop
        </button>

        <button
          onClick={clear}
          disabled={disabled || (!hasRecording && !previewUrl && !chunksRef.current.length)}
          style={{ padding: "10px 14px", borderRadius: 12, fontWeight: 900 }}
        >
          Clear
        </button>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
        This records a WAV file so it opens cleanly in Audacity.
      </div>

      {previewUrl ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.75, marginBottom: 6 }}>Preview</div>
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
