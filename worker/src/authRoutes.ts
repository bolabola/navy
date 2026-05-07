import {
  buildClearCookieHeader,
  buildSetCookieHeader,
  createSessionToken,
  getAuthenticatedSession,
  revokeSession
} from "./auth";
import { jsonResponse, type Env } from "./shared";

const LOGIN_FAIL_LIMIT = 5;
const LOGIN_FAIL_WINDOW_SECONDS = 600;
const LOGIN_GLOBAL_FAIL_LIMIT = 50;
const LOGIN_GLOBAL_FAIL_WINDOW_SECONDS = 60;

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
  if (failCount >= LOGIN_FAIL_LIMIT) {
    return new Response("Too many failed attempts. Try again later.", {
      status: 429,
      headers: { "Retry-After": String(LOGIN_FAIL_WINDOW_SECONDS) }
    });
  }

  let payload: { password?: unknown };
  try {
    payload = (await request.json()) as { password?: unknown };
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (typeof payload.password !== "string" || payload.password !== env.ADMIN_PASSWORD) {
    if (globalFailCount >= LOGIN_GLOBAL_FAIL_LIMIT) {
      return new Response("Too many failed attempts. Try again later.", {
        status: 429,
        headers: { "Retry-After": String(LOGIN_GLOBAL_FAIL_WINDOW_SECONDS) }
      });
    }

    await Promise.all([
      env.BOARD_KV.put(failKey, String(failCount + 1), {
        expirationTtl: LOGIN_FAIL_WINDOW_SECONDS
      }),
      env.BOARD_KV.put(globalFailKey, String(globalFailCount + 1), {
        expirationTtl: LOGIN_GLOBAL_FAIL_WINDOW_SECONDS
      })
    ]);
    return new Response("Unauthorized", { status: 401 });
  }

  await Promise.all([
    env.BOARD_KV.delete(failKey),
    env.BOARD_KV.delete(globalFailKey)
  ]);

  const session = await createSessionToken(env.SESSION_SECRET, env.ADMIN_PASSWORD, env.BOARD_KV);
  return jsonResponse(JSON.stringify({ ok: true, csrfToken: session.csrfToken }), 200, {
    "Set-Cookie": buildSetCookieHeader(session.token),
    "Cache-Control": "no-store"
  });
}

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  await revokeSession(request, env.SESSION_SECRET, env.ADMIN_PASSWORD, env.BOARD_KV);
  return jsonResponse('{"ok":true}', 200, {
    "Set-Cookie": buildClearCookieHeader(),
    "Cache-Control": "no-store"
  });
}

export async function handleAuthCheck(request: Request, env: Env): Promise<Response> {
  const session = await getAuthenticatedSession(request, env.SESSION_SECRET, env.ADMIN_PASSWORD, env.BOARD_KV);
  return jsonResponse(JSON.stringify({
    isAdmin: session !== null,
    csrfToken: session ? session.csrf : null
  }), 200, { "Cache-Control": "no-store" });
}
