// src/auth/parentAuth.js
export function getParentKey() {
  return sessionStorage.getItem("PARENT_KEY") || sessionStorage.getItem("PARENT_UPLOAD_KEY") || "";
}
export function setParentKey(k) {
  sessionStorage.setItem("PARENT_KEY", k);
}
export function clearParentKey() {
  sessionStorage.removeItem("PARENT_KEY");
  sessionStorage.removeItem("PARENT_UPLOAD_KEY");
}

export function getTeamSlug() {
  return sessionStorage.getItem("TEAM_SLUG") || "default";
}
export function getTeamName() {
  return sessionStorage.getItem("TEAM_NAME") || "Barrington Girls Softball";
}
export function setTeam(team) {
  if (!team) return;
  if (team.slug) sessionStorage.setItem("TEAM_SLUG", team.slug);
  if (team.name) sessionStorage.setItem("TEAM_NAME", team.name);
}
export function clearTeam() {
  sessionStorage.removeItem("TEAM_SLUG");
  sessionStorage.removeItem("TEAM_NAME");
}
