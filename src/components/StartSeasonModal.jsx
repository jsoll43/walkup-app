export default function StartSeasonModal({
  currentSeasonLabel,
  label,
  year,
  term,
  copyTeams,
  isStarting,
  onLabelChange,
  onYearChange,
  onTermChange,
  onCopyTeamsChange,
  onCancel,
  onConfirm,
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-season-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: "white",
          padding: 20,
          borderRadius: 12,
          width: 560,
          maxWidth: "95%",
          color: "#111",
        }}
      >
        <h3 id="start-season-title" style={{ marginTop: 0 }}>
          Start a new season
        </h3>
        <div
          style={{
            padding: 10,
            borderRadius: 10,
            background: "#fff7ed",
            border: "1px solid #fdba74",
            fontSize: 13,
          }}
        >
          Starting a season immediately archives{" "}
          <strong>{currentSeasonLabel || "the current season"}</strong> and
          changes which teams parents and coaches see.
        </div>

        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          <div>
            <label className="label">New season label</label>
            <input
              className="input"
              value={label}
              onChange={(event) => onLabelChange(event.target.value)}
            />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            <div>
              <label className="label">Year</label>
              <input
                className="input"
                inputMode="numeric"
                value={year}
                onChange={(event) => onYearChange(event.target.value)}
              />
            </div>
            <div>
              <label className="label">Term</label>
              <select
                className="input"
                value={term}
                onChange={(event) => onTermChange(event.target.value)}
              >
                <option value="spring">Spring</option>
                <option value="summer">Summer</option>
                <option value="fall">Fall</option>
                <option value="winter">Winter</option>
              </select>
            </div>
          </div>
          <label
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <input
              type="checkbox"
              checked={copyTeams}
              onChange={(event) => onCopyTeamsChange(event.target.checked)}
            />
            Copy previous team shells into the new season
          </label>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            New seasons start empty by default. Copying team shells includes
            names, keys, and settings—not rosters or songs.
          </div>
        </div>

        <div
          style={{
            marginTop: 18,
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <button
            className="btn-secondary"
            onClick={onCancel}
            disabled={isStarting}
          >
            Cancel
          </button>
          <button
            className="btn-danger"
            onClick={onConfirm}
            disabled={isStarting}
          >
            {isStarting ? "Starting…" : "Make New Season Current"}
          </button>
        </div>
      </div>
    </div>
  );
}
