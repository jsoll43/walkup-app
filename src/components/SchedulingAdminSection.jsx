import { useEffect, useState } from "react";

const SAMPLE_SCHEDULING_CSV = [
  "date,field,team,title,reservationType,startTime,endTime,notes",
  '2026-06-01,major,10U Blue,10U Blue Practice,practice,17:00,18:30,Regular Monday practice',
  '2026-06-01,minor,12U Gold,12U Gold Practice,practice,17:00,18:30,Use outfield station',
  '2026-06-06,major,BGSL,Tournament Setup,maintenance,08:00,12:00,Field closed for prep',
].join("\n");

async function safeJsonOrText(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function formatET(ts) {
  if (!ts) return "";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return String(ts);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

const ROLE_META = {
  coach: {
    title: "Coach Scheduling Password",
    button: "Set Coach Password",
    updateButton: "Update Coach Password",
    modalTitle: "Set Coach Scheduling Password",
  },
  board: {
    title: "Board Scheduling Password",
    button: "Set Board Password",
    updateButton: "Update Board Password",
    modalTitle: "Set Board Scheduling Password",
  },
};

export default function SchedulingAdminSection({ isAuthed, adminHeaders }) {
  const [settings, setSettings] = useState({
    coachPasswordConfigured: false,
    boardPasswordConfigured: false,
    updatedAt: "",
  });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [modalRole, setModalRole] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [csvFile, setCsvFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  async function loadSettings() {
    if (!isAuthed) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/scheduling-settings", {
        headers: adminHeaders,
      });
      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.raw || "Failed to load scheduling settings.");
      }
      setSettings(data.settings || {});
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAuthed) return;
    loadSettings().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, adminHeaders]);

  function openModal(role) {
    setModalRole(role);
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setStatus("");
    setError("");
  }

  function closeModal() {
    setModalRole("");
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
  }

  async function savePassword() {
    if (!modalRole) return;
    setError("");
    setStatus("");

    const cleanPassword = String(password || "").trim();
    const cleanConfirm = String(confirmPassword || "").trim();

    if (cleanPassword.length < 4) {
      setError("Password must be at least 4 characters.");
      return;
    }
    if (cleanPassword !== cleanConfirm) {
      setError("Passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/scheduling-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders,
        },
        body: JSON.stringify({
          role: modalRole,
          password: cleanPassword,
        }),
      });

      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.raw || "Failed to save scheduling password.");
      }

      setSettings(data.settings || {});
      setStatus(data.message || "Scheduling password saved.");
      closeModal();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  function downloadSampleCsv() {
    const blob = new Blob([SAMPLE_SCHEDULING_CSV], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "schedule-import-sample.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read the selected CSV file."));
      reader.readAsText(file);
    });
  }

  async function importCsv() {
    if (!csvFile) {
      setError("Choose a CSV file to import.");
      return;
    }

    setError("");
    setStatus("");
    setImportResult(null);
    setImporting(true);
    try {
      const csvText = await readFileAsText(csvFile);
      const res = await fetch("/api/admin/scheduling-import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders,
        },
        body: JSON.stringify({ csvText }),
      });

      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.raw || "Failed to import schedule CSV.");
      }

      setImportResult(data.result || null);
      setStatus(data.message || "Schedule CSV imported.");
      setCsvFile(null);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Scheduling Admin</h2>
          <div style={{ marginTop: 6, opacity: 0.8 }}>
            Manage the shared scheduling passwords for coaches and board members.
          </div>
        </div>

        <button className="btn-secondary" onClick={() => loadSettings()} disabled={loading}>
          {loading ? "Loading..." : "Reload settings"}
        </button>
      </div>

      <div
        style={{
          marginTop: 14,
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        }}
      >
        {Object.entries(ROLE_META).map(([role, meta]) => {
          const configured = role === "coach" ? settings.coachPasswordConfigured : settings.boardPasswordConfigured;
          return (
            <div
              key={role}
              style={{
                border: "1px solid rgba(0,0,0,0.12)",
                borderRadius: 14,
                padding: 14,
                background: "rgba(16, 46, 79, 0.04)",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 1000, opacity: 0.7, textTransform: "uppercase" }}>{meta.title}</div>
              <div style={{ marginTop: 8, fontWeight: 1000, fontSize: 16 }}>
                {configured ? "Configured" : "Not set yet"}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                Saved passwords are stored as hashes and are never shown back in plain text.
              </div>
              <button className="btn" style={{ marginTop: 12 }} onClick={() => openModal(role)}>
                {configured ? meta.updateButton : meta.button}
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>
        {settings.updatedAt ? `Last updated (ET): ${formatET(settings.updatedAt)}` : "Scheduling passwords have not been set yet."}
      </div>

      <div
        style={{
          marginTop: 18,
          paddingTop: 16,
          borderTop: "1px solid rgba(0,0,0,0.12)",
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 6 }}>Bulk Schedule CSV Import</h3>
        <div style={{ opacity: 0.8 }}>
          Download the sample CSV, fill in a full month of field reservations, then upload it here to create approved schedule blocks in bulk.
        </div>

        <div
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: 14,
            background: "rgba(16, 46, 79, 0.04)",
            border: "1px solid rgba(0,0,0,0.1)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 1000, opacity: 0.75, textTransform: "uppercase", marginBottom: 8 }}>
            CSV Columns
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            Required: <strong><code>date</code>, <code>field</code>, <code>team</code>, <code>startTime</code>, <code>endTime</code></strong>
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            Optional: <strong><code>title</code>, <code>reservationType</code>, <code>notes</code></strong>
          </div>
          <div style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>
            <code>field</code> must be <code>major</code> or <code>minor</code>. <code>reservationType</code> can be <code>practice</code>, <code>game</code>, <code>tournament</code>, <code>clinic</code>, <code>maintenance</code>, or <code>other</code>. Duplicate rows are skipped automatically.
          </div>
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn" onClick={downloadSampleCsv}>
            Download Sample CSV
          </button>

          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
          />

          <button className="btn-secondary" onClick={importCsv} disabled={importing || !csvFile}>
            {importing ? "Importing..." : "Upload CSV"}
          </button>
        </div>

        <div style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>
          {csvFile ? `Selected file: ${csvFile.name}` : "No CSV selected yet."}
        </div>

        {importResult ? (
          <div
            style={{
              marginTop: 14,
              padding: 14,
              borderRadius: 14,
              background: "rgba(16, 46, 79, 0.04)",
              border: "1px solid rgba(0,0,0,0.1)",
            }}
          >
            <div style={{ fontWeight: 1000, marginBottom: 8 }}>Last import results</div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 14 }}>
              <div><strong>Imported:</strong> {importResult.importedCount || 0}</div>
              <div><strong>Skipped:</strong> {importResult.skippedCount || 0}</div>
              <div><strong>Errors:</strong> {importResult.errorCount || 0}</div>
            </div>

            {Array.isArray(importResult.skipped) && importResult.skipped.length > 0 ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontWeight: 1000, fontSize: 13 }}>Skipped rows</div>
                <div style={{ marginTop: 6, display: "grid", gap: 4, fontSize: 13 }}>
                  {importResult.skipped.slice(0, 10).map((message) => (
                    <div key={message}>{message}</div>
                  ))}
                </div>
              </div>
            ) : null}

            {Array.isArray(importResult.errors) && importResult.errors.length > 0 ? (
              <div style={{ marginTop: 10, color: "#991b1b" }}>
                <div style={{ fontWeight: 1000, fontSize: 13 }}>Row errors</div>
                <div style={{ marginTop: 6, display: "grid", gap: 4, fontSize: 13 }}>
                  {importResult.errors.slice(0, 12).map((message) => (
                    <div key={message}>{message}</div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {status ? (
        <div style={{ marginTop: 10, color: "#065f46", fontWeight: 700 }}>{status}</div>
      ) : null}

      {error ? (
        <div style={{ marginTop: 10, color: "crimson", fontWeight: 700 }}>{error}</div>
      ) : null}

      {modalRole ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div style={{ background: "white", color: "#111", width: 520, maxWidth: "95%", borderRadius: 14, padding: 20 }}>
            <h3 style={{ marginTop: 0 }}>{ROLE_META[modalRole]?.modalTitle || "Set Scheduling Password"}</h3>

            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <label className="label">Password</label>
                <input
                  type={showPassword ? "text" : "password"}
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                />
              </div>

              <div>
                <label className="label">Confirm Password</label>
                <input
                  type={showPassword ? "text" : "password"}
                  className="input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                />
              </div>

              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, opacity: 0.85 }}>
                <input type="checkbox" checked={showPassword} onChange={() => setShowPassword((value) => !value)} />
                Show password
              </label>
            </div>

            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button className="btn-secondary" onClick={closeModal} disabled={saving}>
                Cancel
              </button>
              <button className="btn" onClick={savePassword} disabled={saving}>
                {saving ? "Saving..." : "Save Password"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
