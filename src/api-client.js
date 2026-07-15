export const SESSION_STORAGE_KEY = "det-dashboard-user";
export const UNAUTHORIZED_EVENT = "det-dashboard:unauthorized";
export const ASSET_SCOPES = Object.freeze(["mine", "shared", "public"]);

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function readSession() {
  try {
    const value = storage()?.getItem(SESSION_STORAGE_KEY);
    if (!value) return null;
    const session = JSON.parse(value);
    return session && typeof session === "object" ? session : null;
  } catch {
    return null;
  }
}

export function writeSession(session) {
  if (!session || typeof session !== "object") {
    clearSession();
    return null;
  }

  try {
    storage()?.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Authentication can still work for this page load when storage is blocked.
  }
  return session;
}

export function clearSession() {
  try {
    storage()?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Storage access is best-effort in restricted browser contexts.
  }
}

export function getSessionToken(session = readSession()) {
  return String(session?.token || session?.accessToken || session?.access_token || "").trim();
}

function responseMessage(status, statusText, data) {
  const candidate = data?.error?.message
    || data?.error
    || data?.message
    || data?.detail
    || statusText;
  return String(candidate || `API request failed (${status})`);
}

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(String(message || "API request failed"), options.cause ? { cause: options.cause } : undefined);
    this.name = "ApiError";
    this.status = Number(options.status) || 0;
    this.statusCode = this.status;
    this.code = options.code || options.data?.error?.code || options.data?.code || null;
    this.data = options.data ?? null;
    this.details = options.details ?? options.data?.error?.details ?? options.data?.details ?? null;
    this.url = options.url || "";
    this.method = options.method || "GET";
    this.response = options.response || null;
  }
}

function currentLocation() {
  return globalThis.location || globalThis.window?.location || null;
}

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (typeof URL !== "undefined" && input instanceof URL) return input.href;
  return input?.url || String(input);
}

function isSameOriginApi(input) {
  const rawUrl = requestUrl(input);
  const location = currentLocation();
  try {
    const base = location?.href || "http://det-dashboard.local/";
    const url = new URL(rawUrl, base);
    const sameOrigin = location ? url.origin === location.origin : !/^[a-z][a-z\d+.-]*:/i.test(rawUrl);
    return sameOrigin && (url.pathname === "/api" || url.pathname.startsWith("/api/"));
  } catch {
    return false;
  }
}

function dispatchUnauthorized(error) {
  const target = globalThis.window || globalThis;
  if (typeof target?.dispatchEvent !== "function") return;

  try {
    const EventType = globalThis.CustomEvent || globalThis.window?.CustomEvent;
    if (typeof EventType === "function") {
      target.dispatchEvent(new EventType(UNAUTHORIZED_EVENT, { detail: error }));
      return;
    }
    target.dispatchEvent({ type: UNAUTHORIZED_EVENT, detail: error });
  } catch {
    // An event listener must not replace the original API error.
  }
}

async function decodeResponse(response) {
  if (response.status === 204 || response.status === 205) return null;
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiFetch(input, init = {}) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, name) => headers.set(name, value));

  if (isSameOriginApi(input) && !headers.has("authorization")) {
    const token = getSessionToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
  }

  const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  const url = requestUrl(input);
  let response;
  try {
    response = await fetch(input, { ...init, headers });
  } catch (cause) {
    throw new ApiError(cause?.message || "Network request failed", { cause, method, url });
  }

  let data;
  try {
    data = await decodeResponse(response);
  } catch (cause) {
    throw new ApiError("Unable to read API response", {
      cause,
      status: response.status,
      method,
      url: response.url || url,
      response,
    });
  }

  if (!response.ok) {
    const error = new ApiError(responseMessage(response.status, response.statusText, data), {
      status: response.status,
      code: data?.error?.code || data?.code,
      data,
      method,
      url: response.url || url,
      response,
    });
    if (response.status === 401) dispatchUnauthorized(error);
    throw error;
  }

  return data;
}

function sessionFromAuthResponse(payload) {
  if (!payload || typeof payload !== "object") return payload;
  if (!payload.user || typeof payload.user !== "object") return payload;
  return {
    ...payload.user,
    token: payload.token || payload.accessToken || payload.access_token,
    ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
    ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
  };
}

async function authenticate(path, credentials) {
  const payload = await apiFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials || {}),
  });
  return writeSession(sessionFromAuthResponse(payload));
}

export function login(credentials, password) {
  const payload = typeof credentials === "string" ? { username: credentials, password } : credentials;
  return authenticate("/api/auth/login", payload);
}

export function register(credentials, password, displayName) {
  const payload = typeof credentials === "string"
    ? { username: credentials, password, displayName }
    : credentials;
  return authenticate("/api/auth/register", payload);
}

export async function logout() {
  try {
    return await apiFetch("/api/auth/logout", { method: "POST" });
  } finally {
    clearSession();
  }
}

export async function me() {
  const payload = await apiFetch("/api/auth/me");
  const current = readSession();
  const user = payload?.user || payload;
  if (current && user && typeof user === "object") writeSession({ ...current, ...user });
  return payload;
}

export const auth = Object.freeze({ login, register, logout, me });

export function normalizeScope(scope, fallback = "mine") {
  const value = String(scope || "").trim().toLowerCase();
  return ASSET_SCOPES.includes(value) ? value : fallback;
}

export function toQueryParams(query = {}) {
  const params = query instanceof URLSearchParams ? new URLSearchParams(query) : new URLSearchParams();
  if (query instanceof URLSearchParams) return params;

  for (const [key, rawValue] of Object.entries(query || {})) {
    if (rawValue === undefined || rawValue === null || rawValue === "") continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value === undefined || value === null || value === "") continue;
      params.append(key, value instanceof Date ? value.toISOString() : String(value));
    }
  }
  return params;
}

export function buildQuery(query = {}) {
  const value = toQueryParams(query).toString();
  return value ? `?${value}` : "";
}

export function withQuery(url, query = {}) {
  const suffix = toQueryParams(query).toString();
  if (!suffix) return String(url);
  const separator = String(url).includes("?") ? "&" : "?";
  return `${url}${separator}${suffix}`;
}

export function scopeQuery(scope, query = {}) {
  return { ...query, scope: normalizeScope(scope) };
}

export function withScope(url, scope, query = {}) {
  return withQuery(url, scopeQuery(scope, query));
}

export const buildQueryString = buildQuery;
export const appendQuery = withQuery;
