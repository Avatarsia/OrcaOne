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
  addManual: (path) => request("POST", "/api/instances/manual", { path }),
  removeManual: (path) => request("DELETE", `/api/instances/manual?path=${encodeURIComponent(path)}`),
  // Writing takes two steps (hard rule 5): the plan shows what would happen, only its id goes to
  // /apply. The backend refuses the apply if a file changed since the plan (plan_outdated).
  plan: (id, changes) => request("POST", `${instUrl(id)}/plan`, { changes }),
  apply: (id, planId) => request("POST", `${instUrl(id)}/apply`, { plan_id: planId }),
  backups: (id) => request("GET", `${instUrl(id)}/backups`),
  backupNow: (id) => request("POST", `${instUrl(id)}/backups`),
  deleteBackup: (id, name) => request("DELETE", backupUrl(id, name)),
  restorePlan: (id, name) => request("POST", `${backupUrl(id, name)}/restore-plan`),
};
