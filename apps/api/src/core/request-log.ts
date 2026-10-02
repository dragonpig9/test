/**
 * In-memory ring buffer of recent API requests for the development Debug panel.
 * Stores method/path/status/timing/error code only — never bodies, passwords or tokens.
 */
export interface RequestLogEntry {
  at: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  correlationId: string;
  actorId: string | null;
  errorCode?: string;
  errorModule?: string;
  errorMessage?: string;
}

const MAX = 150;
const buffer: RequestLogEntry[] = [];

export function logRequest(e: RequestLogEntry) {
  buffer.push(e);
  if (buffer.length > MAX) buffer.shift();
  if (e.status >= 500) console.error(`[${e.correlationId}] ${e.method} ${e.path} -> ${e.status} ${e.errorCode ?? ''} ${e.errorMessage ?? ''}`);
}

export function recentRequests(): RequestLogEntry[] {
  return [...buffer].reverse();
}
