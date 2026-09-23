// Thin wrapper around the JSON API. Errors are thrown as ApiError with the server's error code,
// which texts.js turns into a message; `data` keeps the rest of the answer ({"error": code, …}).

export class ApiError extends Error {
  constructor(code, data = {}) {
    super(code);
    this.code = code;
    this.data = data;
  }
}

async function request(method, url, body) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("network");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error || "unknown", data);
  return data;
}

const instUrl = (id) => `/api/instances/${encodeURIComponent(id)}`;
const backupUrl = (id, name) => `${instUrl(id)}/backups/${encodeURIComponent(name)}`;

export const api = {
  data: () => request("GET", "/api/data"),
  // OrcaOne's own settings (data/settings.json): so far the language of the page.
  settings: () => request("GET", "/api/settings"),
  setLanguage: (language) => request("POST", "/api/settings", { language }),
  addManual: (path) => request("POST", "/api/instances/manual", { path }),
  removeManual: (path) => request("DELETE", `/api/instances/manual?path=${encodeURIComponent(path)}`),
  // Writing takes two steps (hard rule 5): the plan shows what would happen, only its id goes to
  // /apply. The backend refuses the apply if a file changed since the plan (plan_outdated).
  plan: (id, changes) => request("POST", `${instUrl(id)}/plan`, { changes }),
  apply: (id, planId) => request("POST", `${instUrl(id)}/apply`, { plan_id: planId }),
  // One profile with its chain, files and every value (pages "Prozesse" and "Details").
  profile: (id, kind, name) => request("GET", `${instUrl(id)}/profile?kind=${kind}&name=${encodeURIComponent(name)}`),
  // The slicer's own logs, filtered on the server (orcaone/logs.py).
  logs: (id) => request("GET", `${instUrl(id)}/logs`),
  log: (id, name, show, q) => request("GET", `${instUrl(id)}/logs/${encodeURIComponent(name)}?show=${show}&q=${encodeURIComponent(q)}`),
  backups: (id) => request("GET", `${instUrl(id)}/backups`),
  backupNow: (id) => request("POST", `${instUrl(id)}/backups`),
  // Camera of the U1 (orcaone/camera.py); the picture itself comes as image/jpeg.
  cameras: () => request("GET", "/api/cameras"),
  addCamera: (host, name) => request("POST", "/api/cameras", { host, name }),
  removeCamera: (id) => request("DELETE", `/api/cameras/${encodeURIComponent(id)}`),
  cameraEvery: (id, every) => request("POST", `/api/cameras/${encodeURIComponent(id)}`, { every }),
  wakeCamera: (id) => request("POST", `/api/cameras/${encodeURIComponent(id)}/wake`),
  deleteBackup: (id, name) => request("DELETE", backupUrl(id, name)),
  restorePlan: (id, name) => request("POST", `${backupUrl(id, name)}/restore-plan`),
};
