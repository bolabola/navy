import {
  buildClearCookieHeader,
  buildSetCookieHeader,
  createSessionToken,
  getSession,
  resolveSessionSecret,
  revokeSession
} from "./auth";
import { json, readJsonBody, text, timingSafeEqualString, type Env } from "./shared";

const LOGIN_FAIL_LIMIT = 5;
const LOGIN_FAIL_WINDOW_SECONDS = 600;
const LOGIN_GLOBAL_FAIL_LIMIT = 50;
const LOGIN_GLOBAL_FAIL_WINDOW_SECONDS = 60;

function tooManyAttempts(retryAfterSeconds: number): Response {
  return text("Too many failed attempts. Try again later.", 429, { "Retry-After": String(retryAfterSeconds) });
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("x-forwarded-for") ||
    "unknown";
  const failKey = "login_fail:" + ip;
  const globalFailKey = "login_fail:global";

  const [failCountStr, globalFailCountStr] = await Promise.all([
    env.BOARD_KV.get(failKey),
    env.BOARD_KV.get(globalFailKey)
  ]);
  const failCount = failCountStr ? parseInt(failCountStr, 10) || 0 : 0;
  const globalFailCount = globalFailCountStr ? parseInt(globalFailCountStr, 10) || 0 : 0;
  if (failCount >= LOGIN_FAIL_LIMIT) return tooManyAttempts(LOGIN_FAIL_WINDOW_SECONDS);

  const payload = await readJsonBody<{ password?: unknown }>(request, 4 * 1024);
  const passwordOk = typeof payload?.password === "string" &&
    await timingSafeEqualString(payload.password, env.ADMIN_PASSWORD);

  if (!passwordOk) {
    if (globalFailCount >= LOGIN_GLOBAL_FAIL_LIMIT) return tooManyAttempts(LOGIN_GLOBAL_FAIL_WINDOW_SECONDS);

    await Promise.all([
      env.BOARD_KV.put(failKey, String(failCount + 1), { expirationTtl: LOGIN_FAIL_WINDOW_SECONDS }),
      env.BOARD_KV.put(globalFailKey, String(globalFailCount + 1), { expirationTtl: LOGIN_GLOBAL_FAIL_WINDOW_SECONDS })
    ]);
    return text("Unauthorized", 401);
  }

  // 只在确实存在失败计数时才删除，减少 KV 写操作。
  await Promise.all([
    failCountStr !== null ? env.BOARD_KV.delete(failKey) : null,
    globalFailCountStr !== null ? env.BOARD_KV.delete(globalFailKey) : null
  ]);

  const session = await createSessionToken(await resolveSessionSecret(env), env.ADMIN_PASSWORD, env.BOARD_KV);
  return json({ ok: true, csrfToken: session.csrfToken }, 200, {
    "Set-Cookie": buildSetCookieHeader(session.token)
  });
}

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  await revokeSession(request, env);
  return json({ ok: true }, 200, { "Set-Cookie": buildClearCookieHeader() });
}

export async function handleAuthCheck(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env);
  return json({
    isAdmin: session !== null,
    csrfToken: session ? session.csrf : null
  });
}
