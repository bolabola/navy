import { getSession, requireAdmin } from "./auth";
import { getBoardRepo, getPublicBoardRepo } from "./boardRepo";
import { cleanBoardContent, toClientState, type CommitResult } from "./boardStore";
import { isPlainObject, json, readJsonBody, text, type Env } from "./shared";

const BOARD_BODY_MAX_BYTES = 1024 * 1024;

export async function handleGetBoard(request: Request, env: Env): Promise<Response> {
  // 带会话 cookie 的管理员读取权威数据；匿名访客读取 KV 镜像（边缘缓存，更快）。
  const isAdmin = request.headers.has("Cookie") && (await getSession(request, env)) !== null;
  const repo = isAdmin ? getBoardRepo(env) : getPublicBoardRepo(env);
  const state = await repo.read();
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

  const outcome = await getBoardRepo(env).save(version, content);
  if (!outcome.ok) {
    return json({ ok: false, error: "version_conflict", currentVersion: outcome.currentVersion }, 409);
  }
  return commitResponse(outcome.result);
}

export async function handleListBackups(request: Request, env: Env): Promise<Response> {
  const auth = await requireAdmin(request, env, { csrf: false });
  if (auth instanceof Response) return auth;
  return json({ backups: await getBoardRepo(env).listBackups() });
}

export async function handleRestoreBackup(request: Request, env: Env): Promise<Response> {
  const auth = await requireAdmin(request, env, { csrf: true });
  if (auth instanceof Response) return auth;

  const payload = await readJsonBody<{ key?: unknown }>(request);
  if (!isPlainObject(payload) || typeof payload.key !== "string") return text("Invalid backup key", 400);
  return commitResponse(await getBoardRepo(env).restoreBackup(payload.key));
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
