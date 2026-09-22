// Thin wrapper around the JSON API. Errors are thrown as ApiError with the
// server's error code, which texts.js turns into a message.

export class ApiError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
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
  if (!response.ok) throw new ApiError(data.error || "unknown");
  return data;
}

export const api = {
  data: () => request("GET", "/api/data"),
  addManual: (path) => request("POST", "/api/instances/manual", { path }),
  removeManual: (path) => request("DELETE", `/api/instances/manual?path=${encodeURIComponent(path)}`),
};
