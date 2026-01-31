export function getParentKey() {
  return sessionStorage.getItem("PARENT_UPLOAD_KEY") || "";
}

export function setParentKey(key) {
  sessionStorage.setItem("PARENT_UPLOAD_KEY", key);
}

export function clearParentKey() {
  sessionStorage.removeItem("PARENT_UPLOAD_KEY");
}

export function requireParentKeyOrRedirect(navigate, redirectTo = "/parent") {
  const key = getParentKey();
  if (!key) {
    navigate("/parent-login", { replace: true, state: { redirectTo } });
    return false;
  }
  return true;
}
