import type { ApiErrorBody, ErrorCode } from '@commonhours/shared';

/** Error thrown for any non-2xx API response; carries the backend's stable code and module. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    readonly module: string,
    readonly status: number,
    readonly correlationId?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'commonhours.token';
let token: string | null = (() => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
})();

export function setToken(t: string | null) {
  token = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: keep token in memory only */
  }
}
export const getToken = () => token;

/** Client-side log of recent calls for the Debug panel (never stores bodies or tokens). */
export interface ClientLogEntry {
  at: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  correlationId?: string;
  errorCode?: string;
  errorModule?: string;
  message?: string;
}
const clientLog: ClientLogEntry[] = [];
export const recentClientCalls = () => [...clientLog].reverse();

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const started = performance.now();
  const method = init.method ?? (init.body ? 'POST' : 'GET');
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    const e = new ApiError('Cannot reach the CommonHours API. Is the backend running on port 4000?', 'NETWORK_ERROR', 'web', 0);
    clientLog.push({ at: new Date().toISOString(), method, path, status: 0, ms: 0, errorCode: e.code, message: e.message });
    throw e;
  }
  const correlationId = res.headers.get('x-correlation-id') ?? undefined;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  const entry: ClientLogEntry = { at: new Date().toISOString(), method, path, status: res.status, ms: Math.round(performance.now() - started), correlationId };
  if (!res.ok) {
    const body = data as ApiErrorBody | null;
    const e = new ApiError(body?.error.message ?? `Request failed (${res.status})`, body?.error.code ?? 'INTERNAL_ERROR', body?.error.module ?? 'api', res.status, body?.error.correlationId ?? correlationId, body?.error.details);
    Object.assign(entry, { errorCode: e.code, errorModule: e.module, message: e.message });
    clientLog.push(entry);
    if (clientLog.length > 100) clientLog.shift();
    throw e;
  }
  clientLog.push(entry);
  if (clientLog.length > 100) clientLog.shift();
  return data as T;
}
