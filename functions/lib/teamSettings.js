export const DEFAULT_PARENT_RECORDING_MAX_SECONDS = 5;
export const MIN_PARENT_RECORDING_MAX_SECONDS = 1;
export const MAX_PARENT_RECORDING_MAX_SECONDS = 60;

export function normalizeParentRecordingMaxSeconds(value) {
  const seconds = Math.round(Number(value));
  if (!Number.isFinite(seconds)) return DEFAULT_PARENT_RECORDING_MAX_SECONDS;
  return Math.max(
    MIN_PARENT_RECORDING_MAX_SECONDS,
    Math.min(MAX_PARENT_RECORDING_MAX_SECONDS, seconds)
  );
}

export async function ensureTeamsRecordingLimitColumn(env) {
  try {
    await env.DB.prepare(
      `SELECT parent_recording_max_seconds
       FROM teams
       LIMIT 1`
    ).first();
  } catch {
    try {
      await env.DB.prepare(
        `ALTER TABLE teams
         ADD COLUMN parent_recording_max_seconds INTEGER NOT NULL DEFAULT 5`
      ).run();
    } catch (alterError) {
      if (!/duplicate column|already exists/i.test(String(alterError?.message || alterError))) {
        throw alterError;
      }
    }
  }
}
