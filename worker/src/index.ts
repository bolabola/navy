import { handleAuthCheck, handleLogin, handleLogout } from "./authRoutes";
import { handleGetBoard, handleListBackups, handlePutBoard, handleRestoreBackup } from "./boardRoutes";
import {
  handleCloudBackupCallback,
  handleCloudBackupConnect,
  handleCloudBackupDisconnect,
  handleCloudBackupListBackups,
  handleCloudBackupRestore,
  handleCloudBackupRun,
  handleCloudBackupStatus,
  runScheduledCloudBackups
} from "./cloudBackup";
import { getConfigError } from "./config";
import { handleFavicon, handleUrlTitles } from "./miscRoutes";
import { HttpError, isSameOriginWrite, methodNotAllowed, text, withSecurityHeaders, type Env } from "./shared";

interface RouteContext {
  request: Request;
  env: Env;
  url: URL;
  ctx?: ExecutionContext;
  params: string[];
}

type Handler = (c: RouteContext) => Promise<Response>;

interface Route {
  pattern: RegExp;
  methods: Partial<Record<string, Handler>>;
  /** 跳过同源检查（OAuth 回调由第三方跳转回来）。 */
  allowCrossOrigin?: boolean;
}

const routes: Route[] = [
  {
    pattern: /^\/api\/board$/,
    methods: {
      GET: (c) => handleGetBoard(c.env),
      PUT: (c) => handlePutBoard(c.request, c.env)
    }
  },
  { pattern: /^\/api\/backups$/, methods: { GET: (c) => handleListBackups(c.request, c.env) } },
  { pattern: /^\/api\/backups\/restore$/, methods: { POST: (c) => handleRestoreBackup(c.request, c.env) } },
  { pattern: /^\/api\/cloud-backup\/status$/, methods: { GET: (c) => handleCloudBackupStatus(c.request, c.env) } },
  {
    pattern: /^\/api\/cloud-backup\/([^/]+)\/callback$/,
    allowCrossOrigin: true,
    methods: { GET: (c) => handleCloudBackupCallback(c.request, c.env, c.url, c.params[0], c.ctx) }
  },
  { pattern: /^\/api\/cloud-backup\/([^/]+)\/connect$/, methods: { POST: (c) => handleCloudBackupConnect(c.request, c.env, c.params[0]) } },
  { pattern: /^\/api\/cloud-backup\/([^/]+)\/disconnect$/, methods: { POST: (c) => handleCloudBackupDisconnect(c.request, c.env, c.params[0]) } },
  { pattern: /^\/api\/cloud-backup\/([^/]+)\/run$/, methods: { POST: (c) => handleCloudBackupRun(c.request, c.env, c.params[0]) } },
  { pattern: /^\/api\/cloud-backup\/([^/]+)\/backups$/, methods: { GET: (c) => handleCloudBackupListBackups(c.request, c.env, c.params[0]) } },
  { pattern: /^\/api\/cloud-backup\/([^/]+)\/restore$/, methods: { POST: (c) => handleCloudBackupRestore(c.request, c.env, c.params[0]) } },
  { pattern: /^\/api\/url-titles$/, methods: { POST: (c) => handleUrlTitles(c.request, c.env) } },
  { pattern: /^\/api\/favicon$/, methods: { GET: (c) => handleFavicon(c.request, c.url, c.env, c.ctx) } },
  { pattern: /^\/api\/login$/, methods: { POST: (c) => handleLogin(c.request, c.env) } },
  { pattern: /^\/api\/logout$/, methods: { POST: (c) => handleLogout(c.request, c.env) } },
  { pattern: /^\/api\/auth$/, methods: { GET: (c) => handleAuthCheck(c.request, c.env) } }
];

async function routeApi(request: Request, env: Env, url: URL, ctx?: ExecutionContext): Promise<Response> {
  for (const route of routes) {
    const match = url.pathname.match(route.pattern);
    if (!match) continue;

    const handler = route.methods[request.method];
    if (!handler) return methodNotAllowed(Object.keys(route.methods).join(", "));
    if (!route.allowCrossOrigin && !isSameOriginWrite(request)) {
      return text("Cross-origin writes are not allowed", 403);
    }
    try {
      const params = match.slice(1).map((part) => decodeURIComponent(part));
      return await handler({ request, env, url, ctx, params });
    } catch (error) {
      if (error instanceof URIError) return text("Bad request", 400);
      if (error instanceof HttpError) return text(error.message, error.status);
      console.error("Unhandled API error:", error);
      return text("Internal error", 500);
    }
  }
  return text("Not found", 404);
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // 静态资源默认由 Workers Static Assets 直接返回、不经过这里，安全头由 src/_headers 提供；
    // 这里只兜底处理未命中静态资源的非 API 请求。
    if (!url.pathname.startsWith("/api/")) {
      return withSecurityHeaders(await env.ASSETS.fetch(request));
    }

    const configError = getConfigError(env);
    if (configError) {
      return withSecurityHeaders(text(configError, 500));
    }

    return withSecurityHeaders(await routeApi(request, env, url, ctx));
  },

  // Cron Trigger：定时把看板备份到已连接的云盘（见 wrangler.toml [triggers]）。
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (getConfigError(env)) return;
    ctx.waitUntil(runScheduledCloudBackups(env));
  }
};

export { routeApi };
export default worker;
