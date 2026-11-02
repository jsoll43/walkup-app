import {
  createSchedulingTeam,
  deleteSchedulingTeam,
  verifyBaseballAdmin,
  json,
  listSchedulingTeams,
  updateSchedulingTeam,
} from "../../../lib/baseballScheduling.js";

async function isAuthed(request, env) {
  return (await verifyBaseballAdmin(request, env)).ok;
}

export const onRequestGet = async ({ request, env }) => {
  try {
    if (!await isAuthed(request, env)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const teams = await listSchedulingTeams(env);
    return json({ ok: true, teams });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    if (!await isAuthed(request, env)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const teams = await createSchedulingTeam(env, body?.name);
    return json({
      ok: true,
      teams,
      message: "Scheduling team added.",
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 400);
  }
};

export const onRequestPut = async ({ request, env }) => {
  try {
    if (!await isAuthed(request, env)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const teams = await updateSchedulingTeam(env, body?.id, body?.name);
    return json({
      ok: true,
      teams,
      message: "Scheduling team updated.",
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 400);
  }
};

export const onRequestDelete = async ({ request, env }) => {
  try {
    if (!await isAuthed(request, env)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const teams = await deleteSchedulingTeam(env, body?.id);
    return json({
      ok: true,
      teams,
      message: "Scheduling team removed.",
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 400);
  }
};

export const onRequestOptions = async () =>
  new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
      "access-control-allow-headers": "authorization,x-admin-key,content-type",
    },
  });
