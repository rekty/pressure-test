// Bring Your Own Pollen for a static page: device flow, no redirect, no backend.
// The token stays in this tab and is only sent to gen.pollinations.ai.

export const ENDPOINTS = {
  gen: "https://gen.pollinations.ai",
  enter: "https://enter.pollinations.ai",
};

export const APP_KEY = "pk_TRM5Aq2QwxGsVj12";

const KEY = "pt.key";
const DEVICE = "pt.device";
const UNTIL = "pt.until";

function memoryStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

const box = (() => {
  try {
    if (globalThis.sessionStorage) return globalThis.sessionStorage;
  } catch {
    /* private mode */
  }
  return memoryStore();
})();

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function httpError(response, body) {
  const detail = body?.error?.details ? ` (${JSON.stringify(body.error.details).slice(0, 120)})` : "";
  const message = (body?.error?.message || body?.message || body?.error || `HTTP ${response.status}`) + detail;
  const error = new Error(message);
  if (response.status === 401 || response.status === 403) error.code = "auth";
  if (response.status === 402 || response.status === 429) error.code = "quota";
  return error;
}

export const connected = () => Boolean(box.getItem(KEY));

export function useKey(value) {
  const key = String(value || "").trim();
  if (!/^sk_/.test(key)) throw new Error("that is not an sk_ key");
  box.setItem(KEY, key);
}

export function signOut() {
  for (const k of [KEY, DEVICE, UNTIL]) box.removeItem(k);
}

export async function startDevice(send = globalThis.fetch) {
  const response = await send(`${ENDPOINTS.enter}/api/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: APP_KEY }),
  });
  const body = await readJson(response);
  if (!response.ok || !body.device_code) throw httpError(response, body);
  box.setItem(DEVICE, body.device_code);
  box.setItem(UNTIL, String(Date.now() + (body.expires_in || 1800) * 1000));
  return { userCode: body.user_code, verify: body.verification_uri_complete || body.verification_uri };
}

export async function pollDevice(send = globalThis.fetch) {
  const device = box.getItem(DEVICE);
  if (!device) return { state: "idle" };
  if (Date.now() > Number(box.getItem(UNTIL) || 0)) {
    box.removeItem(DEVICE);
    return { state: "expired" };
  }
  const response = await send(`${ENDPOINTS.enter}/api/device/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_code: device }),
  });
  const body = await readJson(response);
  if (body.access_token) {
    box.removeItem(DEVICE);
    box.removeItem(UNTIL);
    box.setItem(KEY, body.access_token);
    return { state: "connected" };
  }
  if (body.error === "authorization_pending" || response.status === 428) return { state: "pending" };
  box.removeItem(DEVICE);
  return { state: "error", message: body.error_description || body.error || `HTTP ${response.status}` };
}

export async function models(send = globalThis.fetch) {
  const response = await send(`${ENDPOINTS.gen}/models`);
  const body = await readJson(response);
  if (!response.ok) throw httpError(response, body);
  return Array.isArray(body) ? body : body.data || [];
}

// One typed decision: the model returns a choice plus a distribution over the
// options, which is what this game samples and displays.
export async function decide(model, state, questions) {
  const key = box.getItem(KEY);
  if (!key) {
    const error = new Error("connect your Pollen first");
    error.code = "auth";
    throw error;
  }
  const started = performance.now();
  const response = await fetch(`${ENDPOINTS.gen}/alpha/decisions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, state, questions }),
  });
  const body = await readJson(response);
  const ms = Math.round(performance.now() - started);
  if (!response.ok) {
    const error = httpError(response, body);
    error.ms = ms;
    throw error;
  }
  return { answers: body.answers || {}, usage: body.usage || null, ms, model };
}
