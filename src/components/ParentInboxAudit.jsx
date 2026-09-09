import { useEffect, useState } from "react";

export default function ParentInboxAudit({ adminHeaders, teamSlug, formatTimestamp }) {
  const [page, setPage] = useState({ entries: [], nextOffset: null });
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ view: "deleted", offset: String(offset) });
        if (teamSlug !== "all") params.set("team", teamSlug);
        const response = await fetch(`/api/admin/parent-inbox?${params}`, {
          headers: adminHeaders,
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Audit log failed to load (HTTP ${response.status}).`);
        const data = await response.json();
        if (!data.ok) throw new Error(data.error || "Audit log failed to load.");
        if (!controller.signal.aborted) {
          setPage({ entries: data.submissions || [], nextOffset: data.nextOffset });
        }
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message || "Audit log failed to load.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [adminHeaders, teamSlug, offset, revision]);

  function goToPage(nextOffset) {
    setLoading(true);
    setOffset(nextOffset);
  }

  return (
    <div style={{ marginTop: 12 }} aria-busy={loading}>
      <p style={{ fontSize: 13, opacity: 0.8 }}>
        Deleted submissions retain their player, team, song request, and timestamps here.
        Audio files are permanently removed. The team filter above also applies to this log.
      </p>
      <button className="btn-secondary btn-sm" disabled={loading} onClick={() => {
        setLoading(true);
        setOffset(0);
        setRevision((value) => value + 1);
      }}>Refresh audit log</button>
      {error ? <p role="alert" style={{ color: "crimson" }}>{error}</p> : null}
      {loading ? <p role="status">Loading audit log...</p> : !error ? (
        <>
          {page.entries.length === 0 ? <p>No deleted submissions for this team filter.</p> : (
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              {page.entries.map((entry) => (
                <article key={entry.id} style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 14, padding: 12, overflowWrap: "anywhere" }}>
                  <strong>Deleted: {entry.player_name || "Unnamed player"}</strong>
                  <div>{entry.team_name || entry.team_slug || "Unknown team"}</div>
                  <div style={{ marginTop: 8 }}><strong>Song request:</strong> {entry.song_request || "None provided"}</div>
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                    <div>Deleted (ET): {formatTimestamp(entry.deleted_at) || "Not recorded"}</div>
                    <div>Submitted (ET): {formatTimestamp(entry.created_at) || "Not recorded"}</div>
                    <div>Submission ID: {entry.id}</div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
        <button className="btn-secondary btn-sm" disabled={loading || offset === 0} onClick={() => goToPage(Math.max(0, offset - 50))}>Newer</button>
        <span>Page {Math.floor(offset / 50) + 1}</span>
        <button className="btn-secondary btn-sm" disabled={loading || !!error || page.nextOffset == null} onClick={() => goToPage(page.nextOffset)}>Older</button>
      </div>
    </div>
  );
}
