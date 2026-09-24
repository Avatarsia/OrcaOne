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

// A file as the body itself (page "Import/Export"), and a file back as a Blob.
async function upload(url, file) {
  let response;
  try {
    response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
  } catch {
    throw new ApiError("network");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error || "unknown", data);
  return data;
}
async function download(url, body) {
  const raw = body instanceof Blob;
  let response;
  try {
    response = await fetch(url, { method: "POST", headers: { "Content-Type": raw ? "application/octet-stream" : "application/json" },
                                  body: raw ? body : JSON.stringify(body) });
  } catch {
    throw new ApiError("network");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(data.error || "unknown", data);
  }
  return response.blob();
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
  // The address of a printer model (page "Drucker"); every U1 with one has a camera
  // (orcaone/camera.py). The picture itself comes as image/jpeg.
  printers: () => request("GET", "/api/printers"),
  setPrinterHost: (model, host) => request("POST", "/api/printers", { model, host }),
  // About 6 s: Snapmaker printers that answer in the LAN (mDNS, as Snapmaker Orca looks for them).
  searchPrinters: () => request("POST", "/api/printers/search"),
  cameras: () => request("GET", "/api/cameras"),
  cameraEvery: (id, every) => request("POST", `/api/cameras/${encodeURIComponent(id)}`, { every }),
  wakeCamera: (id) => request("POST", `/api/cameras/${encodeURIComponent(id)}/wake`),
  // Page "Kalibrieren": the printer read live (spools, pressure advance), and the ticks.
  printerStatus: (id) => request("GET", `/api/cameras/${encodeURIComponent(id)}/status`),
  calibration: (id) => request("GET", `${instUrl(id)}/calibration`),
  markCalibration: (id, filament, step, done, temp) => request("POST", `${instUrl(id)}/calibration`, { filament, step, done, temp }),
  deleteBackup: (id, name) => request("DELETE", backupUrl(id, name)),
  // Page "Import/Export" (orcaone/importer.py): what a file holds, and own profiles as a ZIP.
  importFile: (id, file, name) => upload(`${instUrl(id)}/import?name=${encodeURIComponent(name)}`, file),
  // The slicer's own copies of user/ (user_backup-v…), and what one of them holds.
  slicerBackups: (id) => request("GET", `${instUrl(id)}/import/slicer-backups`),
  importSlicerBackup: (id, name) => request("GET", `${instUrl(id)}/import/slicer-backup?name=${encodeURIComponent(name)}`),
  exportProfiles: (id, profiles, flat) => download(`${instUrl(id)}/export`, { profiles, flat }),
  clean3mf: (file) => download("/api/clean-3mf", file),
  // Page "Änderungen": what changed since the installation was last marked seen (orcaone/snapshot.py).
  news: (id) => request("GET", `${instUrl(id)}/news`),
  newsSeen: (id) => request("POST", `${instUrl(id)}/news/seen`),
  restorePlan: (id, name) => request("POST", `${backupUrl(id, name)}/restore-plan`),
};
