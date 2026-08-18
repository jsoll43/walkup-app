import {
  assertSameOrigin,
  createFinanceSession,
  destroyFinanceSession,
  financeAuthJson,
  getFinanceSession,
  requireFinanceAuth,
} from "../../../lib/financeAuth.js";
import {
  confirmFinanceImport,
  getFinanceAdmin,
  getFinanceBootstrap,
  getFinanceDashboard,
  getFinanceDocument,
  getFinanceTransactions,
  previewFinanceImport,
  rollbackFinanceImport,
  saveFinanceDocument,
  saveFinanceReconciliation,
  setFinancePeriodPublication,
  transactionsToCsv,
  updateFinanceReserve,
  updateFinanceTransaction,
  upsertFinanceAdminEntity,
} from "../../../lib/financeData.js";
import { getFinanceAiInsight, getFinanceAiUsage } from "../../../lib/financeAi.js";

function pathParts(params) {
  if (Array.isArray(params.path)) return params.path.filter(Boolean);
  return String(params.path || "").split("/").filter(Boolean);
}

function errorResponse(error) {
  return financeAuthJson(
    { ok: false, error: error?.message || String(error), ...(error?.details ? { details: error.details } : {}) },
    Number(error?.status) || 500,
  );
}

async function bodyJson(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw Object.assign(new Error("Content-Type must be application/json."), { status: 415 });
  }
  return request.json().catch(() => {
    throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 });
  });
}

async function handle(request, env, params) {
  const parts = pathParts(params);
  const method = request.method.toUpperCase();

  if (parts[0] === "session" && parts[1] === "login" && method === "POST") {
    assertSameOrigin(request);
    return createFinanceSession(request, env, await bodyJson(request));
  }
  if (parts[0] === "session" && method === "DELETE") return destroyFinanceSession(request, env);
  if (parts[0] === "session" && method === "GET") {
    const session = await getFinanceSession(request, env);
    return session.ok
      ? financeAuthJson({ ok: true, session: { role: session.role, actor: session.actor, expiresAt: session.expiresAt || "", localBypass: Boolean(session.localBypass) } })
      : financeAuthJson({ ok: false, error: session.error }, session.status);
  }

  const isAiInsightRequest = parts[0] === "ai-insights" && parts.length === 1 && method === "POST";
  const isMutation = method !== "GET" && method !== "HEAD";
  const needsEditor = isMutation && !isAiInsightRequest;
  const session = await requireFinanceAuth(request, env, { editor: needsEditor });
  if (!session.ok) return financeAuthJson({ ok: false, error: session.error }, session.status);
  if (isMutation) assertSameOrigin(request);

  const url = new URL(request.url);
  const fiscalYearId = url.searchParams.get("fiscalYear") || "";

  if (parts[0] === "bootstrap" && method === "GET") {
    return financeAuthJson({ ok: true, ...(await getFinanceBootstrap(env, session)) });
  }
  if (parts[0] === "dashboard" && method === "GET") {
    if (!fiscalYearId) throw Object.assign(new Error("fiscalYear is required."), { status: 400 });
    return financeAuthJson({ ok: true, dashboard: await getFinanceDashboard(env, session, fiscalYearId) });
  }
  if (parts[0] === "ai-usage" && parts.length === 1 && method === "GET") {
    return financeAuthJson({ ok: true, usage: await getFinanceAiUsage(env) });
  }
  if (isAiInsightRequest) {
    return financeAuthJson({ ok: true, insight: await getFinanceAiInsight(env, session, fiscalYearId, await bodyJson(request)) });
  }
  if (parts[0] === "transactions" && parts.length === 1 && method === "GET") {
    if (!fiscalYearId) throw Object.assign(new Error("fiscalYear is required."), { status: 400 });
    const filters = {
      month: url.searchParams.get("month") || "",
      accountId: url.searchParams.get("account") || "",
      categoryId: url.searchParams.get("category") || "",
      classification: url.searchParams.get("classification") || "",
      oneTime: url.searchParams.get("oneTime") || "",
      search: url.searchParams.get("search") || "",
    };
    const transactions = await getFinanceTransactions(env, session, fiscalYearId, filters);
    if (url.searchParams.get("format") === "csv") {
      return new Response(transactionsToCsv(transactions), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="bgsl-finance-${fiscalYearId}.csv"`,
          "cache-control": "no-store",
        },
      });
    }
    return financeAuthJson({ ok: true, transactions });
  }
  if (parts[0] === "transactions" && parts[1] && method === "PUT") {
    return financeAuthJson({ ok: true, transaction: await updateFinanceTransaction(env, session, parts[1], await bodyJson(request)) });
  }
  if (parts[0] === "imports" && parts[1] === "preview" && method === "POST") {
    return financeAuthJson({ ok: true, preview: await previewFinanceImport(env, session, await bodyJson(request)) }, 201);
  }
  if (parts[0] === "imports" && parts[1] && parts[2] === "confirm" && method === "POST") {
    return financeAuthJson({ ok: true, result: await confirmFinanceImport(env, session, parts[1], await bodyJson(request)) });
  }
  if (parts[0] === "imports" && parts[1] && parts[2] === "rollback" && method === "POST") {
    return financeAuthJson({ ok: true, result: await rollbackFinanceImport(env, session, parts[1]) });
  }
  if (parts[0] === "reconciliations" && parts[1] && method === "PUT") {
    return financeAuthJson({ ok: true, reconciliation: await saveFinanceReconciliation(env, session, parts[1], await bodyJson(request)) });
  }
  if (parts[0] === "periods" && parts[1] && method === "PUT") {
    const body = await bodyJson(request);
    return financeAuthJson({ ok: true, period: await setFinancePeriodPublication(env, session, parts[1], body.publish === true) });
  }
  if (parts[0] === "admin" && parts.length === 1 && method === "GET") {
    if (session.role !== "editor") return financeAuthJson({ ok: false, error: "Finance editor access is required." }, 403);
    if (!fiscalYearId) throw Object.assign(new Error("fiscalYear is required."), { status: 400 });
    return financeAuthJson({ ok: true, admin: await getFinanceAdmin(env, fiscalYearId) });
  }
  if (parts[0] === "admin" && parts[1] === "reserve" && method === "PUT") {
    const body = await bodyJson(request);
    return financeAuthJson({ ok: true, reserve: await updateFinanceReserve(env, session, String(body.fiscalYearId || ""), Number(body.reserveCents)) });
  }
  if (parts[0] === "admin" && ["fund", "commitment", "mapping", "forecast"].includes(parts[1]) && (method === "POST" || method === "PUT")) {
    const record = await upsertFinanceAdminEntity(env, session, parts[1], method === "PUT" ? parts[2] : "", await bodyJson(request));
    return financeAuthJson({ ok: true, record }, method === "POST" ? 201 : 200);
  }
  if (parts[0] === "documents" && parts.length === 1 && method === "POST") {
    return financeAuthJson({ ok: true, document: await saveFinanceDocument(env, session, await request.formData()) }, 201);
  }
  if (parts[0] === "documents" && parts[1] && method === "GET") {
    const { metadata, object } = await getFinanceDocument(env, parts[1]);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-type", metadata.content_type);
    headers.set("content-disposition", `inline; filename="${metadata.filename.replace(/["\r\n]/g, "")}"`);
    headers.set("cache-control", "private, no-store");
    headers.set("x-content-type-options", "nosniff");
    return new Response(object.body, { headers });
  }

  return financeAuthJson({ ok: false, error: "Finance endpoint not found." }, 404);
}

export const onRequest = async ({ request, env, params }) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { Allow: "GET,POST,PUT,DELETE,OPTIONS" } });
  try {
    if (!env?.DB) throw Object.assign(new Error("D1 binding DB is missing."), { status: 500 });
    return await handle(request, env, params);
  } catch (error) {
    return errorResponse(error);
  }
};
