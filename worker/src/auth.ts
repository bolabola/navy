const COOKIE_NAME = "__Host-board_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const SESSION_PREFIX = "session:";

interface SessionPayload {
  sid: string;
  exp: number;
  csrf: string;
  passwordTag: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function createPasswordTag(secret: string, adminPassword: string): Promise<string> {
  const key = await importKey(secret);
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode("admin-password:" + adminPassword));
  return base64UrlEncode(new Uint8Array(sigBuf));
}

export interface CreatedSession {
  token: string;
  csrfToken: string;
}

export async function createSessionToken(secret: string, adminPassword: string, kv: KVNamespace): Promise<CreatedSession> {
  const sid = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const csrfToken = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload: SessionPayload = {
    sid,
    exp,
    csrf: csrfToken,
    passwordTag: await createPasswordTag(secret, adminPassword)
  };
  const payloadStr = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await importKey(secret);
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadStr));
  const sigStr = base64UrlEncode(new Uint8Array(sigBuf));
  await kv.put(SESSION_PREFIX + sid, String(exp), { expirationTtl: SESSION_TTL_SECONDS });
  return {
    token: `${payloadStr}.${sigStr}`,
    csrfToken
  };
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  const parts = header.split(";");
  for (const part of parts) {
    const [rawKey, ...rest] = part.split("=");
    if (rawKey && rawKey.trim() === name) {
      return rest.join("=").trim();
    }
  }
  return null;
}

export async function isAuthenticated(request: Request, secret: string, adminPassword: string, kv: KVNamespace): Promise<boolean> {
  return (await getAuthenticatedSession(request, secret, adminPassword, kv)) !== null;
}

export async function getAuthenticatedSession(request: Request, secret: string, adminPassword: string, kv: KVNamespace): Promise<SessionPayload | null> {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return null;

  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const payloadStr = token.slice(0, dot);
  const sigStr = token.slice(dot + 1);

  let sigBytes: Uint8Array;
  try {
    sigBytes = base64UrlDecode(sigStr);
  } catch {
    return null;
  }

  const key = await importKey(secret);
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(payloadStr));
  if (!valid) return null;

  try {
    const payload = JSON.parse(decoder.decode(base64UrlDecode(payloadStr))) as SessionPayload;
    if (typeof payload.sid !== "string" || payload.sid.length < 32) return null;
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (typeof payload.csrf !== "string" || payload.csrf.length < 32) return null;
    if (typeof payload.passwordTag !== "string" || payload.passwordTag !== await createPasswordTag(secret, adminPassword)) return null;
    const storedExp = await kv.get(SESSION_PREFIX + payload.sid);
    if (storedExp !== String(payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function isCsrfTokenValid(request: Request, secret: string, adminPassword: string, kv: KVNamespace): Promise<boolean> {
  const session = await getAuthenticatedSession(request, secret, adminPassword, kv);
  if (!session) return false;
  const header = request.headers.get("X-CSRF-Token");
  return typeof header === "string" && header === session.csrf;
}

export async function revokeSession(request: Request, secret: string, adminPassword: string, kv: KVNamespace): Promise<void> {
  const session = await getAuthenticatedSession(request, secret, adminPassword, kv);
  if (!session) return;
  await kv.delete(SESSION_PREFIX + session.sid);
}

export function buildSetCookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function buildClearCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
