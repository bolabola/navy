import { isAuthenticated, isCsrfTokenValid } from "./auth";
import { scheduleCloudBackups } from "./cloudBackup";
import { jsonResponse, isPlainObject, type BoardPutPayload, type BoardStateEnvelope, type Env } from "./shared";
import { validateBoardState } from "./validation";

const STATE_KEY = "state";
const BACKUP_PREFIX = "state_backup:";
const BACKUP_KEEP_COUNT = 10;
const BOARD_BODY_MAX_BYTES = 1024 * 1024;
const encoder = new TextEncoder();

export async function handleGetBoard(env: Env): Promise<Response> {
  const data = await env.BOARD_KV.get(STATE_KEY);
  if (!data) return jsonResponse("null", 200, { "Cache-Control": "no-store" });

  const state = parseStoredBoardState(data);
  if (!state) return new Response("Stored board state is invalid", { status: 500 });
  return jsonResponse(JSON.stringify(state), 200, { "Cache-Control": "no-store" });
}

export async function handlePutBoard(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  if (!(await isAuthenticated(request, env.SESSION_SECRET, env.ADMIN_PASSWORD, env.BOARD_KV))) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!(await isCsrfTokenValid(request, env.SESSION_SECRET, env.ADMIN_PASSWORD, env.BOARD_KV))) {
    return new Response("Invalid CSRF token", { status: 403 });
  }
  const body = await request.text();
  if (encoder.encode(body).byteLength > BOARD_BODY_MAX_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const payload = parseBoardPutPayload(parsed);
  if (!payload) {
    return new Response("Expected board state payload", { status: 400 });
  }

  const validationError = validateBoardState(payload.boards);
  if (validationError) {
    return new Response(validationError, { status: 400 });
  }

  const existingRaw = await env.BOARD_KV.get(STATE_KEY);
  const existing = existingRaw ? parseStoredBoardState(existingRaw) : null;
  if (existingRaw && !existing) {
    return new Response("Stored board state is invalid", { status: 500 });
  }

  const currentVersion = existing ? existing.version : null;
  if (payload.version !== currentVersion) {
    return jsonResponse(JSON.stringify({
      ok: false,
      error: "version_conflict",
      currentVersion
    }), 409, { "Cache-Control": "no-store" });
  }

  if (existingRaw) {
    await writeBoardBackup(env, existingRaw, ctx);
  }

  const nextState: BoardStateEnvelope = {
    version: currentVersion == null ? 1 : currentVersion + 1,
    updatedAt: new Date().toISOString(),
    boards: payload.boards
  };

  await env.BOARD_KV.put(STATE_KEY, JSON.stringify(nextState));
  await pruneBoardBackups(env);

  return jsonResponse(JSON.stringify({
    ok: true,
    version: nextState.version,
    updatedAt: nextState.updatedAt
  }), 200, { "Cache-Control": "no-store" });
}

export async function handleListBackups(request: Request, env: Env): Promise<Response> {
  if (!(await isAuthenticated(request, env.SESSION_SECRET, env.ADMIN_PASSWORD, env.BOARD_KV))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const listed = await env.BOARD_KV.list({ prefix: BACKUP_PREFIX });
  const backups = listed.keys
    .map((key) => ({
      key: key.name,
      createdAt: parseBackupCreatedAt(key.name)
    }))
    .sort((a, b) => b.key.localeCompare(a.key));

  return jsonResponse(JSON.stringify({ backups }), 200, { "Cache-Control": "no-store" });
}

export async function handleRestoreBackup(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  if (!(await isAuthenticated(request, env.SESSION_SECRET, env.ADMIN_PASSWORD, env.BOARD_KV))) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!(await isCsrfTokenValid(request, env.SESSION_SECRET, env.ADMIN_PASSWORD, env.BOARD_KV))) {
    return new Response("Invalid CSRF token", { status: 403 });
  }
  let payload: { key?: unknown };
  try {
    payload = (await request.json()) as { key?: unknown };
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (typeof payload.key !== "string" || !payload.key.startsWith(BACKUP_PREFIX)) {
    return new Response("Invalid backup key", { status: 400 });
  }

  const backupRaw = await env.BOARD_KV.get(payload.key);
  if (!backupRaw) return new Response("Backup not found", { status: 404 });

  const backup = parseStoredBoardState(backupRaw);
  if (!backup) return new Response("Backup is invalid", { status: 500 });

  const existingRaw = await env.BOARD_KV.get(STATE_KEY);
  const existing = existingRaw ? parseStoredBoardState(existingRaw) : null;
  if (existingRaw && !existing) return new Response("Stored board state is invalid", { status: 500 });

  if (existingRaw) {
    await writeBoardBackup(env, existingRaw, ctx);
  }

  const nextVersion = existing ? existing.version + 1 : 1;
  const nextState: BoardStateEnvelope = {
    version: nextVersion,
    updatedAt: new Date().toISOString(),
    boards: backup.boards
  };
  await env.BOARD_KV.put(STATE_KEY, JSON.stringify(nextState));
  await pruneBoardBackups(env);

  return jsonResponse(JSON.stringify({
    ok: true,
    version: nextState.version,
    updatedAt: nextState.updatedAt
  }), 200, { "Cache-Control": "no-store" });
}

async function writeBoardBackup(env: Env, existingRaw: string, ctx?: ExecutionContext): Promise<void> {
  const suffix = new Date().toISOString().replace(/[:.]/g, "-");
  const key = BACKUP_PREFIX + suffix;
  await env.BOARD_KV.put(key, existingRaw);
  scheduleCloudBackups(env, key, existingRaw, ctx);
}

async function pruneBoardBackups(env: Env): Promise<void> {
  const listed = await env.BOARD_KV.list({ prefix: BACKUP_PREFIX });
  const stale = listed.keys
    .map((key) => key.name)
    .sort()
    .reverse()
    .slice(BACKUP_KEEP_COUNT);

  await Promise.all(stale.map((key) => env.BOARD_KV.delete(key)));
}

function parseBackupCreatedAt(key: string): string {
  const raw = key.slice(BACKUP_PREFIX.length);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (!match) return "";
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
}

function parseStoredBoardState(raw: string): BoardStateEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (Array.isArray(parsed)) {
    const error = validateBoardState(parsed);
    return error ? null : { version: 0, updatedAt: "", boards: parsed };
  }

  if (!isPlainObject(parsed)) return null;
  const version = parsed.version;
  const updatedAt = parsed.updatedAt;
  const boards = parsed.boards;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) return null;
  if (typeof updatedAt !== "string") return null;
  if (!Array.isArray(boards)) return null;
  const error = validateBoardState(boards);
  return error ? null : { version, updatedAt, boards };
}

function parseBoardPutPayload(value: unknown): { version: number | null; boards: unknown[] } | null {
  if (Array.isArray(value)) {
    return { version: null, boards: value };
  }

  if (!isPlainObject(value)) return null;
  const payload = value as BoardPutPayload;
  const version = payload.version;
  if (version !== null && !Number.isInteger(version)) return null;
  if (!Array.isArray(payload.boards)) return null;

  return { version: version as number | null, boards: payload.boards };
}
