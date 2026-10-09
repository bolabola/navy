import { requireAdmin } from "./auth";
import {
  cleanBoardContent,
  commitState,
  listBackups,
  readBackup,
  readState,
  restoreContent,
  toClientState,
  type CommitResult
} from "./boardStore";
import { isPlainObject, json, readJsonBody, text, type Env } from "./shared";

const BOARD_BODY_MAX_BYTES = 1024 * 1024;

export async function handleGetBoard(env: Env): Promise<Response> {
  const { state } = await readState(env);
  return json(state ? toClientState(state) : null);
}

export async function handlePutBoard(request: Request, env: Env): Promise<Response> {
  const auth = await requireAdmin(request, env, { csrf: true });
  if (auth instanceof Response) return auth;

  const parsed = await readJsonBody(request, BOARD_BODY_MAX_BYTES);
  let version: number | null;
  let input: { boards?: unknown; pages?: unknown; activePageId?: unknown; layout?: unknown };
  if (Array.isArray(parsed)) {
    version = null;
    input = { boards: parsed };
  } else if (isPlainObject(parsed) && (parsed.version === null || Number.isInteger(parsed.version))) {
    version = parsed.version as number | null;
    input = parsed;
  } else {
    return text("Expected board state payload", 400);
  }

  const content = cleanBoardContent(input);
  if (typeof content === "string") return text(content, 400);

  const current = await readState(env);
  const currentVersion = current.state ? current.state.version : null;
  if (version !== currentVersion) {
    return json({ ok: false, error: "version_conflict", currentVersion }, 409);
  }

  return commitResponse(await commitState(env, current, content));
}

export async function handleListBackups(request: Request, env: Env): Promise<Response> {
  const auth = await requireAdmin(request, env, { csrf: false });
  if (auth instanceof Response) return auth;
  return json({ backups: await listBackups(env) });
}

export async function handleRestoreBackup(request: Request, env: Env): Promise<Response> {
  const auth = await requireAdmin(request, env, { csrf: true });
  if (auth instanceof Response) return auth;

  const payload = await readJsonBody<{ key?: unknown }>(request);
  if (!isPlainObject(payload) || typeof payload.key !== "string") return text("Invalid backup key", 400);

  const backup = await readBackup(env, payload.key);
  return commitResponse(await restoreContent(env, backup));
}

export function commitResponse(result: CommitResult, extra: Record<string, unknown> = {}): Response {
  return json({
    ok: true,
    ...extra,
    version: result.state.version,
    updatedAt: result.state.updatedAt,
    backupKey: result.backupKey,
    lastBackupAt: result.state.lastBackupAt ?? null
  });
}
