import {
  getAdminKey,
  importSchedulingCsv,
  json,
} from "../../lib/scheduling.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    const key = getAdminKey(request);
    if (!key || key !== env.ADMIN_KEY) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const csvText = String(body.csvText || "");
    if (!csvText.trim()) {
      return json({ ok: false, error: "CSV text is required." }, 400);
    }

    const result = await importSchedulingCsv(env, csvText, {
      createdByRole: "admin_csv_import",
    });

    return json({
      ok: true,
      result,
      message: `Imported ${result.importedCount} reservation${result.importedCount === 1 ? "" : "s"}.`,
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
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "authorization,x-admin-key,content-type",
    },
  });
