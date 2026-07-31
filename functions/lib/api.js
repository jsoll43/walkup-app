export function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function getRequestKey(request, fallbackHeader) {
  const bearer = (request.headers.get("authorization") || "").trim();
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return fallbackHeader
    ? (request.headers.get(fallbackHeader) || "").trim()
    : "";
}

export function getTeamSlug(request, fallback = "") {
  const url = new URL(request.url);
  return (
    (request.headers.get("x-team-slug") || "").trim().toLowerCase() ||
    (url.searchParams.get("teamSlug") || "").trim().toLowerCase() ||
    fallback
  );
}
