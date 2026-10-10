import { requireAdmin } from "./auth";
import { commitResponse } from "./boardRoutes";
import { getBoardRepo } from "./boardRepo";
import { parseStoredBoardState } from "./boardStore";
import {
  BACKUP_FILE_PREFIX,
  CloudBackupProviderError,
  exchangeAuthorizationCode,
  CLIENT_ID_MAX_LENGTH,
  clientCredentialsKey,
  getAccessToken,
  getClientCredentials,
  getProvider,
  PROVIDERS,
  type CloudProvider,
  type ProviderId,
  type RemoteBackupFile
} from "./cloudProviders";
import {
  escapeHtml,
  HttpError,
  isoToBackupSuffix,
  isPlainObject,
  json,
  readJsonBody,
  text,
  type Env
} from "./shared";

const CLOUD_BACKUP_KEEP_COUNT = 100;
const CLOUD_BACKUP_LIST_COUNT = 10;
const OAUTH_STATE_PREFIX = "cloud_backup_oauth_state:";
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export interface ProviderBackupStatus {
  status: "success" | "failed";
  at: string;
  key: string;
  fileName: string;
  error?: string;
  /** 本次备份对应的看板 updatedAt，用于定时任务判断内容是否有变化。 */
  stateUpdatedAt?: string;
}

/** 每个云盘的全部持久化信息放在一个 KV key 里，读状态只需一次 get。 */
interface ProviderRecord {
  refreshToken?: string;
  folderId?: string;
  connectedAt?: string;
  lastBackup?: ProviderBackupStatus;
}

interface OAuthState {
  provider: ProviderId;
  redirectUri: string;
}

// ---------------- 存储 ----------------

function recordKey(provider: ProviderId): string {
  return `cloud_backup:${provider}`;
}

function legacyKey(provider: ProviderId, key: string): string {
  return `cloud_backup:${provider}:${key}`;
}

async function loadRecord(env: Env, provider: CloudProvider): Promise<ProviderRecord> {
  const raw = await env.BOARD_KV.get(recordKey(provider.id));
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isPlainObject(parsed)) return sanitizeRecord(parsed);
    } catch {
      // 损坏的记录按未连接处理
    }
    return {};
  }
  return migrateLegacyRecord(env, provider);
}

/** 兼容旧版本分散存储的 key（以及更早的 google_drive:* 和环境变量），读到后迁移为单条记录。 */
async function migrateLegacyRecord(env: Env, provider: CloudProvider): Promise<ProviderRecord> {
  if (!(await getClientCredentials(env, provider))) return {};
  const [refreshToken, folderId, connectedAt, lastBackupRaw] = await Promise.all([
    env.BOARD_KV.get(legacyKey(provider.id, "refresh_token")),
    env.BOARD_KV.get(legacyKey(provider.id, "folder_id")),
    env.BOARD_KV.get(legacyKey(provider.id, "connected_at")),
    env.BOARD_KV.get(legacyKey(provider.id, "last_backup"))
  ]);
  const record: ProviderRecord = {};
  record.refreshToken = refreshToken || undefined;
  record.folderId = folderId || undefined;
  record.connectedAt = connectedAt || undefined;
  if (lastBackupRaw) {
    try {
      record.lastBackup = sanitizeStatus(JSON.parse(lastBackupRaw));
    } catch {
      // ignore
    }
  }
  if (provider.id === "google") {
    if (!record.refreshToken) record.refreshToken = env.GOOGLE_REFRESH_TOKEN || await env.BOARD_KV.get("google_drive:refresh_token") || undefined;
    if (!record.folderId) record.folderId = env.GOOGLE_DRIVE_FOLDER_ID || await env.BOARD_KV.get("google_drive:folder_id") || undefined;
    if (!record.connectedAt) record.connectedAt = await env.BOARD_KV.get("google_drive:connected_at") || undefined;
  }
  if (record.refreshToken) {
    await env.BOARD_KV.put(recordKey(provider.id), JSON.stringify(record));
    await deleteLegacyKeys(env, provider.id);
  }
  return record;
}

async function deleteLegacyKeys(env: Env, provider: ProviderId): Promise<void> {
  const keys = ["refresh_token", "folder_id", "connected_at", "last_backup"].map((key) => legacyKey(provider, key));
  if (provider === "google") keys.push("google_drive:refresh_token", "google_drive:folder_id", "google_drive:connected_at");
  await Promise.all(keys.map((key) => env.BOARD_KV.delete(key)));
}

function sanitizeRecord(value: Record<string, unknown>): ProviderRecord {
  return {
    refreshToken: typeof value.refreshToken === "string" && value.refreshToken ? value.refreshToken : undefined,
    folderId: typeof value.folderId === "string" && value.folderId ? value.folderId : undefined,
    connectedAt: typeof value.connectedAt === "string" ? value.connectedAt : undefined,
    lastBackup: sanitizeStatus(value.lastBackup)
  };
}

function sanitizeStatus(value: unknown): ProviderBackupStatus | undefined {
  if (!isPlainObject(value)) return undefined;
  if (
    (value.status === "success" || value.status === "failed") &&
    typeof value.at === "string" &&
    typeof value.key === "string" &&
    typeof value.fileName === "string"
  ) {
    return {
      status: value.status,
      at: value.at,
      key: value.key,
      fileName: value.fileName,
      error: typeof value.error === "string" ? value.error : undefined,
      stateUpdatedAt: typeof value.stateUpdatedAt === "string" ? value.stateUpdatedAt : undefined
    };
  }
  return undefined;
}

async function saveRecord(env: Env, provider: ProviderId, record: ProviderRecord): Promise<void> {
  await env.BOARD_KV.put(recordKey(provider), JSON.stringify(record));
}

interface ConnectedConfig {
  refreshToken: string;
  folderId?: string;
}

function connectedConfig(provider: CloudProvider, record: ProviderRecord): ConnectedConfig | null {
  if (!record.refreshToken) return null;
  if (provider.requiresFolderId && !record.folderId) return null;
  return { refreshToken: record.refreshToken, folderId: record.folderId };
}

async function requireConnected(env: Env, provider: CloudProvider): Promise<{ record: ProviderRecord; config: ConnectedConfig }> {
  if (!(await getClientCredentials(env, provider))) {
    throw new HttpError(500, `${provider.label} OAuth client is not configured`);
  }
  const record = await loadRecord(env, provider);
  const config = connectedConfig(provider, record);
  if (!config) throw new HttpError(409, `${provider.label} backup is not connected`);
  return { record, config };
}

function requireProvider(providerId: string): CloudProvider {
  const provider = getProvider(providerId);
  if (!provider) throw new HttpError(404, "Unknown backup provider");
  return provider;
}

// ---------------- 备份执行 ----------------

/** 上传一份备份到指定云盘并清理旧文件，结果写回记录。失败不会抛出，返回 failed 状态。 */
async function backupToProvider(
  env: Env,
  provider: CloudProvider,
  record: ProviderRecord,
  config: ConnectedConfig,
  rawState: string,
  stateUpdatedAt: string | undefined,
  now: Date
): Promise<ProviderBackupStatus> {
  const suffix = isoToBackupSuffix(now.toISOString());
  const fileName = `${BACKUP_FILE_PREFIX}${suffix}.json`;
  const base = { at: now.toISOString(), key: `state_backup:${suffix}`, fileName, stateUpdatedAt };
  let status: ProviderBackupStatus;
  try {
    const accessToken = await getAccessToken(env, provider, config.refreshToken);
    await provider.upload(accessToken, fileName, rawState, config.folderId);
    await pruneRemoteBackups(provider, accessToken, config.folderId);
    status = { status: "success", ...base };
  } catch (error) {
    status = { status: "failed", ...base, error: error instanceof Error ? error.message : String(error) };
    console.warn(`${provider.label} cloud backup failed:`, status.error);
  }
  await saveRecord(env, provider.id, { ...record, lastBackup: status });
  return status;
}

async function pruneRemoteBackups(provider: CloudProvider, accessToken: string, folderId?: string): Promise<void> {
  const files = await provider.list(accessToken, folderId);
  const stale = sortRemoteBackups(files).slice(CLOUD_BACKUP_KEEP_COUNT);
  await Promise.all(stale.map((file) => provider.remove(accessToken, file)));
}

function sortRemoteBackups(files: RemoteBackupFile[]): RemoteBackupFile[] {
  const sortKey = (file: RemoteBackupFile) => {
    const match = /^state_backup_(.+)\.json$/.exec(file.name);
    return match ? match[1] : file.createdAt || file.name;
  };
  return files.slice().sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
}

function readStateMarker(rawState: string): string | undefined {
  const parsed = parseStoredBoardState(rawState);
  return parsed ? parsed.updatedAt || String(parsed.version) : undefined;
}

/**
 * 定时任务入口（Cron Trigger）。只有看板内容自上次成功备份后有变化时才上传，
 * 避免产生大量重复的云端文件。
 */
export async function runScheduledCloudBackups(env: Env, now = new Date()): Promise<void> {
  const rawState = await getBoardRepo(env).readRaw();
  if (!rawState) return;
  const marker = readStateMarker(rawState);

  await Promise.all(PROVIDERS.map(async (provider) => {
    if (!(await getClientCredentials(env, provider))) return;
    const record = await loadRecord(env, provider);
    const config = connectedConfig(provider, record);
    if (!config) return;
    const last = record.lastBackup;
    if (last && last.status === "success" && marker && last.stateUpdatedAt === marker) return;
    await backupToProvider(env, provider, record, config, rawState, marker, now);
  }));
}

// ---------------- 路由 ----------------

export async function handleCloudBackupStatus(request: Request, env: Env): Promise<Response> {
  const auth = await requireAdmin(request, env, { csrf: false });
  if (auth instanceof Response) return auth;

  const origin = new URL(request.url).origin;
  const providers = await Promise.all(PROVIDERS.map(async (provider) => {
    const [record, credentials] = await Promise.all([loadRecord(env, provider), getClientCredentials(env, provider)]);
    return {
      id: provider.id,
      label: provider.label,
      configured: credentials !== null,
      /** env：在 Cloudflare 后台配置；app：在网站里配置，可以在网站里修改。 */
      configuredBy: credentials ? credentials.source : null,
      /** 配置 OAuth 应用时要填写的回调地址 */
      callbackUrl: callbackUrl(origin, provider.id),
      connected: connectedConfig(provider, record) !== null,
      connectedAt: record.connectedAt || null,
      lastBackup: record.lastBackup || null
    };
  }));

  return json({ providers });
}

export async function handleCloudBackupConnect(request: Request, env: Env, providerId: string): Promise<Response> {
  const auth = await requireAdmin(request, env, { csrf: true });
  if (auth instanceof Response) return auth;

  const provider = requireProvider(providerId);
  const credentials = await getClientCredentials(env, provider);
  if (!credentials) {
    return text(`${provider.label} OAuth client is not configured`, 500);
  }

  const redirectUri = callbackUrl(new URL(request.url).origin, provider.id);
  const state = randomState();
  const oauthState: OAuthState = { provider: provider.id, redirectUri };
  await env.BOARD_KV.put(OAUTH_STATE_PREFIX + state, JSON.stringify(oauthState), {
    expirationTtl: OAUTH_STATE_TTL_SECONDS
  });

  const authUrl = new URL(provider.authorizeUrl);
  authUrl.searchParams.set("client_id", credentials.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", provider.scope);
  authUrl.searchParams.set("state", state);
  for (const [key, value] of Object.entries(provider.extraAuthParams)) {
    authUrl.searchParams.set(key, value);
  }

  return json({ url: authUrl.toString() });
}

function callbackUrl(origin: string, provider: ProviderId): string {
  return `${origin}/api/cloud-backup/${provider}/callback`;
}

function readClientField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > CLIENT_ID_MAX_LENGTH || /\s/.test(trimmed)) return null;
  return trimmed;
}

/** 管理员在网站里保存 OAuth 客户端凭据。凭据变了，旧的授权就失效了，一并断开。 */
export async function handleCloudBackupSaveClient(request: Request, env: Env, providerId: string): Promise<Response> {
  const auth = await requireAdmin(request, env, { csrf: true });
  if (auth instanceof Response) return auth;

  const provider = requireProvider(providerId);
  const existing = await getClientCredentials(env, provider);
  if (existing && existing.source === "env") {
    return text(`${provider.label} OAuth client is configured in Cloudflare and cannot be changed here`, 409);
  }

  const payload = await readJsonBody<{ clientId?: unknown; clientSecret?: unknown }>(request);
  const clientId = isPlainObject(payload) ? readClientField(payload.clientId) : null;
  const clientSecret = isPlainObject(payload) ? readClientField(payload.clientSecret) : null;
  if (!clientId || !clientSecret) return text("Invalid client id or secret", 400);

  await env.BOARD_KV.put(clientCredentialsKey(provider.id), JSON.stringify({ clientId, clientSecret }));
  if (!existing || existing.clientId !== clientId || existing.clientSecret !== clientSecret) {
    await env.BOARD_KV.delete(recordKey(provider.id));
  }
  return json({ ok: true });
}

/** 移除网站里保存的 OAuth 客户端凭据，同时断开连接。 */
export async function handleCloudBackupDeleteClient(request: Request, env: Env, providerId: string): Promise<Response> {
  const auth = await requireAdmin(request, env, { csrf: true });
  if (auth instanceof Response) return auth;

  const provider = requireProvider(providerId);
  await Promise.all([
    env.BOARD_KV.delete(clientCredentialsKey(provider.id)),
    env.BOARD_KV.delete(recordKey(provider.id))
  ]);
  return json({ ok: true });
}

export async function handleCloudBackupDisconnect(request: Request, env: Env, providerId: string): Promise<Response> {
  const auth = await requireAdmin(request, env, { csrf: true });
  if (auth instanceof Response) return auth;

  const provider = requireProvider(providerId);
  await Promise.all([
    env.BOARD_KV.delete(recordKey(provider.id)),
    deleteLegacyKeys(env, provider.id)
  ]);
  return json({ ok: true });
}

/** 立即备份当前看板到指定云盘（不检查内容是否变化）。 */
export async function handleCloudBackupRun(request: Request, env: Env, providerId: string): Promise<Response> {
  const auth = await requireAdmin(request, env, { csrf: true });
  if (auth instanceof Response) return auth;

  const provider = requireProvider(providerId);
  const { record, config } = await requireConnected(env, provider);
  const rawState = await getBoardRepo(env).readRaw();
  if (!rawState) return text("Board has no saved state yet", 409);

  const status = await backupToProvider(env, provider, record, config, rawState, readStateMarker(rawState), new Date());
  return json({ ok: status.status === "success", provider: provider.id, lastBackup: status }, status.status === "success" ? 200 : 502);
}

export async function handleCloudBackupListBackups(request: Request, env: Env, providerId: string): Promise<Response> {
  const auth = await requireAdmin(request, env, { csrf: false });
  if (auth instanceof Response) return auth;

  const provider = requireProvider(providerId);
  const { config } = await requireConnected(env, provider);
  const accessToken = await getAccessToken(env, provider, config.refreshToken);
  const backups = sortRemoteBackups(await provider.list(accessToken, config.folderId)).slice(0, CLOUD_BACKUP_LIST_COUNT);
  return json({ provider: provider.id, backups });
}

export async function handleCloudBackupRestore(request: Request, env: Env, providerId: string): Promise<Response> {
  const auth = await requireAdmin(request, env, { csrf: true });
  if (auth instanceof Response) return auth;

  const provider = requireProvider(providerId);
  if (!(await getClientCredentials(env, provider))) {
    return text(`${provider.label} OAuth client is not configured`, 500);
  }
  const payload = await readJsonBody<{ id?: unknown }>(request);
  if (!isPlainObject(payload) || typeof payload.id !== "string" || !payload.id) {
    return text("Invalid backup id", 400);
  }

  const { config } = await requireConnected(env, provider);
  const accessToken = await getAccessToken(env, provider, config.refreshToken);
  const backups = await provider.list(accessToken, config.folderId);
  const backup = backups.find((entry) => entry.id === payload.id);
  if (!backup) return text("Cloud backup not found", 404);

  let backupRaw: string;
  try {
    backupRaw = await provider.download(accessToken, backup);
  } catch (error) {
    if (error instanceof CloudBackupProviderError) return text(error.message, error.status);
    throw error;
  }
  const restored = parseStoredBoardState(backupRaw);
  if (!restored) return text("Cloud backup is invalid", 500);

  const result = await getBoardRepo(env).restoreContent(restored);
  return commitResponse(result, { provider: provider.id, restoredBackup: backup });
}

export async function handleCloudBackupCallback(
  request: Request,
  env: Env,
  url: URL,
  providerId: string,
  ctx?: ExecutionContext
): Promise<Response> {
  const provider = getProvider(providerId);
  if (!provider) return htmlResponse("Backup authorization failed", "Unknown backup provider.");
  const failed = `${provider.label} authorization failed`;
  if (!(await getClientCredentials(env, provider))) {
    return htmlResponse(failed, `${provider.label} OAuth client is not configured.`);
  }

  const state = url.searchParams.get("state") || "";
  const stateKey = OAUTH_STATE_PREFIX + state;
  const storedState = state ? await env.BOARD_KV.get(stateKey) : null;
  const parsedState = storedState ? parseOAuthState(storedState) : null;
  if (!parsedState || parsedState.provider !== provider.id) {
    return htmlResponse(failed, "The authorization link expired or is invalid.");
  }
  await env.BOARD_KV.delete(stateKey);

  const oauthError = url.searchParams.get("error");
  if (oauthError) return htmlResponse(failed, `Provider returned: ${oauthError}`);

  const code = url.searchParams.get("code");
  if (!code) return htmlResponse(failed, "The provider did not return an authorization code.");

  try {
    const tokens = await exchangeAuthorizationCode(env, provider, code, parsedState.redirectUri);
    const previous = await loadRecord(env, provider);
    const refreshToken = typeof tokens.refresh_token === "string" && tokens.refresh_token
      ? tokens.refresh_token
      : previous.refreshToken;
    const accessToken = typeof tokens.access_token === "string" ? tokens.access_token : "";
    if (!refreshToken || !accessToken) {
      return htmlResponse(failed, "The provider did not return the tokens needed for backups.");
    }

    const folderId = await provider.prepareFolder(accessToken);
    const record: ProviderRecord = {
      refreshToken,
      folderId: folderId || previous.folderId,
      connectedAt: new Date().toISOString()
    };
    await saveRecord(env, provider.id, record);

    // 连接成功后立即做一次首份备份，不阻塞页面跳转。
    const config = connectedConfig(provider, record);
    if (ctx && config) {
      ctx.waitUntil((async () => {
        const rawState = await getBoardRepo(env).readRaw();
        if (rawState) await backupToProvider(env, provider, record, config, rawState, readStateMarker(rawState), new Date());
      })().catch(() => {}));
    }

    return htmlResponse(`${provider.label} connected`, `${provider.label} backup is connected. You can return to the board.`);
  } catch (error) {
    return htmlResponse(failed, error instanceof Error ? error.message : String(error));
  }
}

function parseOAuthState(raw: string): OAuthState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<OAuthState>;
    if ((parsed.provider === "google" || parsed.provider === "dropbox") && typeof parsed.redirectUri === "string") {
      return { provider: parsed.provider, redirectUri: parsed.redirectUri };
    }
  } catch {
    return null;
  }
  return null;
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** OAuth 回调结果页。body 为纯文本，这里统一转义。 */
function htmlResponse(title: string, body: string): Response {
  return new Response(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="2; url=/">
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(body)}</p>
    <p><a href="/">Return to board</a></p>
  </main>
</body>
</html>`, {
    status: title.includes("failed") ? 400 : 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}
