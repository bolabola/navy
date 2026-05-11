import {
  handleAuthCheck,
  handleLogin,
  handleLogout
} from "./authRoutes";
import {
  handleGetBoard,
  handleListBackups,
  handlePutBoard,
  handleRestoreBackup
} from "./boardRoutes";
import { getConfigError } from "./config";
import { handleFavicon, handleUrlTitles } from "./miscRoutes";
import { isSameOriginWrite, methodNotAllowed, withSecurityHeaders, type Env } from "./shared";

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return withSecurityHeaders(await env.ASSETS.fetch(request));
    }

    const configError = getConfigError(env);
    if (configError) {
      return withSecurityHeaders(new Response(configError, { status: 500 }));
    }

    return withSecurityHeaders(await routeApi(request, env, url, ctx));
  }
};

export { routeApi };
export default worker;

async function routeApi(request: Request, env: Env, url: URL, ctx?: ExecutionContext): Promise<Response> {
  if (!isSameOriginWrite(request)) {
    return new Response("Cross-origin writes are not allowed", { status: 403 });
  }

  if (url.pathname === "/api/board") {
    if (request.method === "GET") return handleGetBoard(env);
    if (request.method === "PUT") return handlePutBoard(request, env, ctx);
    return methodNotAllowed("GET, PUT");
  }

  if (url.pathname === "/api/backups") {
    if (request.method === "GET") return handleListBackups(request, env);
    return methodNotAllowed("GET");
  }

  if (url.pathname === "/api/backups/restore") {
    if (request.method === "POST") return handleRestoreBackup(request, env, ctx);
    return methodNotAllowed("POST");
  }

  if (url.pathname === "/api/url-titles" && request.method === "POST") {
    return handleUrlTitles(request, env);
  }

  if (url.pathname === "/api/favicon" && request.method === "GET") {
    return handleFavicon(request, url);
  }

  if (url.pathname === "/api/login" && request.method === "POST") {
    return handleLogin(request, env);
  }

  if (url.pathname === "/api/logout" && request.method === "POST") {
    return handleLogout(request, env);
  }

  if (url.pathname === "/api/auth" && request.method === "GET") {
    return handleAuthCheck(request, env);
  }

  return new Response("Not found", { status: 404 });
}
