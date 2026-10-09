import type { BoardStateObject } from "./boardRepo";

export interface Env {
  BOARD_KV: KVNamespace;
  /** 看板状态的 Durable Object（强一致）。未绑定时退回直接读写 KV。 */
  BOARD_STATE?: DurableObjectNamespace<BoardStateObject>;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  GOOGLE_DRIVE_FOLDER_ID?: string;
  DROPBOX_CLIENT_ID?: string;
  DROPBOX_CLIENT_SECRET?: string;
}

// 与 src/_headers 中的静态资源安全头保持一致。
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

export function jsonResponse(body: string, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}

/** 返回不缓存的 JSON 响应。 */
export function json(value: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return jsonResponse(JSON.stringify(value), status, { "Cache-Control": "no-store", ...extraHeaders });
}

export function text(message: string, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(message, { status, headers: extraHeaders });
}

export function methodNotAllowed(allow: string): Response {
  return text("Method not allowed", 405, { Allow: allow });
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const encoder = new TextEncoder();

/**
 * 读取并解析 JSON 请求体，带字节上限。
 * 失败时抛出 HttpError（400 / 413），由路由层统一转成响应。
 */
export async function readJsonBody<T = unknown>(request: Request, maxBytes = 64 * 1024): Promise<T> {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, "Payload too large");
  const body = await request.text();
  if (body.length > maxBytes || encoder.encode(body).byteLength > maxBytes) {
    throw new HttpError(413, "Payload too large");
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

export function isSameOriginWrite(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return true;
  }

  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  if (origin) return origin === requestOrigin;

  const referer = request.headers.get("Referer");
  if (!referer) return true;

  try {
    return new URL(referer).origin === requestOrigin;
  } catch {
    return false;
  }
}

export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 常量时间字符串比较，避免通过响应时间推测密码。 */
export async function timingSafeEqualString(a: string, b: string): Promise<boolean> {
  // 先各自做 SHA-256，长度固定后再逐字节比较，长度差异也不会泄漏。
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b))
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i += 1) diff |= va[i] ^ vb[i];
  return diff === 0 && a.length === b.length;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

/** state_backup:2026-01-01T00-00-00-000Z → 2026-01-01T00:00:00.000Z */
export function backupSuffixToIso(suffix: string): string {
  const match = suffix.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (!match) return "";
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
}

export function isoToBackupSuffix(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}
