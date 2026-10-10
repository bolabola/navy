import type { Env } from "./shared";

export type ProviderId = "google" | "dropbox";

export interface RemoteBackupFile {
  id: string;
  name: string;
  createdAt?: string;
  path?: string;
}

export interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
  error_subtype?: unknown;
}

export class CloudBackupProviderError extends Error {
  readonly status: number;

  constructor(message: string, providerStatus: number) {
    super(message);
    this.name = "CloudBackupProviderError";
    this.status = providerStatus >= 400 && providerStatus < 500 ? providerStatus : 502;
  }
}

export const BACKUP_FOLDER_NAME = "board-trello-backups";
export const BACKUP_FILE_PREFIX = "state_backup_";

export interface CloudProvider {
  id: ProviderId;
  label: string;
  clientIdEnv: keyof Env;
  clientSecretEnv: keyof Env;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  extraAuthParams: Record<string, string>;
  tokenAuth: "body" | "basic";
  /** 授权完成后准备备份目录，返回需要持久化的 folderId（如果有）。 */
  prepareFolder(accessToken: string): Promise<string | undefined>;
  /** 是否必须有 folderId 才算连接完成。 */
  requiresFolderId: boolean;
  upload(accessToken: string, fileName: string, body: string, folderId?: string): Promise<void>;
  list(accessToken: string, folderId?: string): Promise<RemoteBackupFile[]>;
  download(accessToken: string, file: RemoteBackupFile): Promise<string>;
  remove(accessToken: string, file: RemoteBackupFile): Promise<void>;
}

// ---------------- Google Drive ----------------

const google: CloudProvider = {
  id: "google",
  label: "Google Drive",
  clientIdEnv: "GOOGLE_CLIENT_ID",
  clientSecretEnv: "GOOGLE_CLIENT_SECRET",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scope: "https://www.googleapis.com/auth/drive.file",
  extraAuthParams: { access_type: "offline", prompt: "consent" },
  tokenAuth: "body",
  requiresFolderId: true,

  async prepareFolder(accessToken) {
    const response = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ name: BACKUP_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
    });
    if (!response.ok) throw new Error(`Google Drive folder create returned ${response.status}`);
    const parsed = (await response.json()) as { id?: unknown };
    if (typeof parsed.id !== "string" || !parsed.id) {
      throw new Error("Google Drive folder create did not return a folder id");
    }
    return parsed.id;
  },

  async upload(accessToken, fileName, body, folderId) {
    if (!folderId) throw new Error("Google Drive folder id is missing");
    const boundary = `board-trello-${Date.now().toString(36)}`;
    const multipart = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify({ name: fileName, parents: [folderId] }),
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      body,
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body: multipart
    });
    if (!response.ok) throw new Error(`Google Drive upload returned ${response.status}`);
  },

  async list(accessToken, folderId) {
    if (!folderId) throw new Error("Google Drive folder id is missing");
    const files: RemoteBackupFile[] = [];
    let pageToken = "";
    do {
      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.searchParams.set("pageSize", "1000");
      url.searchParams.set("fields", "nextPageToken,files(id,name,createdTime)");
      url.searchParams.set("q", `'${escapeDriveQueryValue(folderId)}' in parents and trashed = false and name contains '${BACKUP_FILE_PREFIX}'`);
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error(`Google Drive backup list returned ${response.status}`);

      const parsed = (await response.json()) as {
        nextPageToken?: unknown;
        files?: Array<{ id?: unknown; name?: unknown; createdTime?: unknown }>;
      };
      for (const file of parsed.files || []) {
        if (typeof file.id === "string" && typeof file.name === "string" && file.name.startsWith(BACKUP_FILE_PREFIX)) {
          files.push({
            id: file.id,
            name: file.name,
            createdAt: typeof file.createdTime === "string" ? file.createdTime : undefined
          });
        }
      }
      pageToken = typeof parsed.nextPageToken === "string" ? parsed.nextPageToken : "";
    } while (pageToken);
    return files;
  },

  async download(accessToken, file) {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      throw new CloudBackupProviderError(`Google Drive backup download returned ${response.status}`, response.status);
    }
    return response.text();
  },

  async remove(accessToken, file) {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Google Drive backup delete returned ${response.status}`);
    }
  }
};

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ---------------- Dropbox ----------------

async function ensureDropboxFolder(accessToken: string): Promise<void> {
  const response = await fetch("https://api.dropboxapi.com/2/files/create_folder_v2", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path: `/${BACKUP_FOLDER_NAME}`, autorename: false })
  });
  if (response.ok || response.status === 409) return;
  throw new Error(`Dropbox folder create returned ${response.status}`);
}

const dropbox: CloudProvider = {
  id: "dropbox",
  label: "Dropbox",
  clientIdEnv: "DROPBOX_CLIENT_ID",
  clientSecretEnv: "DROPBOX_CLIENT_SECRET",
  authorizeUrl: "https://www.dropbox.com/oauth2/authorize",
  tokenUrl: "https://api.dropboxapi.com/oauth2/token",
  scope: "files.content.read files.content.write files.metadata.read files.metadata.write",
  extraAuthParams: { token_access_type: "offline" },
  tokenAuth: "basic",
  requiresFolderId: false,

  async prepareFolder(accessToken) {
    await ensureDropboxFolder(accessToken);
    return undefined;
  },

  async upload(accessToken, fileName, body) {
    // 目录在授权时已创建；上传到不存在的目录时 Dropbox 也会自动创建父目录。
    const response = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({
          path: `/${BACKUP_FOLDER_NAME}/${fileName}`,
          mode: "add",
          autorename: true,
          mute: true,
          strict_conflict: false
        })
      },
      body
    });
    if (!response.ok) throw new Error(`Dropbox upload returned ${response.status}`);
  },

  async list(accessToken) {
    const files: RemoteBackupFile[] = [];
    let cursor = "";
    let hasMore = false;
    do {
      const response = await fetch(cursor
        ? "https://api.dropboxapi.com/2/files/list_folder/continue"
        : "https://api.dropboxapi.com/2/files/list_folder", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(cursor ? { cursor } : {
          path: `/${BACKUP_FOLDER_NAME}`,
          recursive: false,
          include_deleted: false,
          limit: 2000
        })
      });
      if (!response.ok) throw new Error(`Dropbox backup list returned ${response.status}`);

      const parsed = (await response.json()) as {
        entries?: Array<{ ".tag"?: unknown; id?: unknown; name?: unknown; path_lower?: unknown; server_modified?: unknown }>;
        cursor?: unknown;
        has_more?: unknown;
      };
      for (const entry of parsed.entries || []) {
        if (
          entry[".tag"] === "file" &&
          typeof entry.name === "string" &&
          entry.name.startsWith(BACKUP_FILE_PREFIX) &&
          typeof entry.path_lower === "string"
        ) {
          files.push({
            id: typeof entry.id === "string" ? entry.id : entry.path_lower,
            name: entry.name,
            path: entry.path_lower,
            createdAt: typeof entry.server_modified === "string" ? entry.server_modified : undefined
          });
        }
      }
      cursor = typeof parsed.cursor === "string" ? parsed.cursor : "";
      hasMore = parsed.has_more === true;
    } while (hasMore && cursor);
    return files;
  },

  async download(accessToken, file) {
    const targets = Array.from(new Set([file.id, file.path].filter((value): value is string => Boolean(value))));
    let lastError = "";
    let lastStatus = 502;
    for (const target of targets) {
      const response = await fetch("https://content.dropboxapi.com/2/files/download", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Dropbox-API-Arg": JSON.stringify({ path: target }) }
      });
      if (response.ok) return response.text();
      lastStatus = response.status;
      const details = await readResponseText(response);
      lastError = `Dropbox backup download returned ${response.status}${details ? `: ${details}` : ""}`;
    }
    throw new CloudBackupProviderError(lastError || "Dropbox backup download failed", lastStatus);
  },

  async remove(accessToken, file) {
    const response = await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path: file.path || file.id })
    });
    if (!response.ok && response.status !== 409) {
      throw new Error(`Dropbox backup delete returned ${response.status}`);
    }
  }
};

async function readResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}

export const PROVIDERS: CloudProvider[] = [google, dropbox];

export function getProvider(providerId: string): CloudProvider | null {
  return PROVIDERS.find((provider) => provider.id === providerId) || null;
}

// ---------------- OAuth 客户端凭据 ----------------

export interface ClientCredentials {
  clientId: string;
  clientSecret: string;
  /** env：来自 Cloudflare 运行时变量；app：管理员在网站里填写并保存在 KV。 */
  source: "env" | "app";
}

export const CLIENT_ID_MAX_LENGTH = 512;

export function clientCredentialsKey(provider: ProviderId): string {
  return `cloud_backup:${provider}:client`;
}

/** 运行时变量优先；没有设置时使用管理员在网站里保存的凭据。都没有时返回 null。 */
export async function getClientCredentials(env: Env, provider: CloudProvider): Promise<ClientCredentials | null> {
  const envId = env[provider.clientIdEnv];
  const envSecret = env[provider.clientSecretEnv];
  if (typeof envId === "string" && envId && typeof envSecret === "string" && envSecret) {
    return { clientId: envId, clientSecret: envSecret, source: "env" };
  }
  const raw = await env.BOARD_KV.get(clientCredentialsKey(provider.id));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { clientId?: unknown; clientSecret?: unknown };
    if (typeof parsed.clientId === "string" && parsed.clientId && typeof parsed.clientSecret === "string" && parsed.clientSecret) {
      return { clientId: parsed.clientId, clientSecret: parsed.clientSecret, source: "app" };
    }
  } catch {
    // 损坏的记录按未配置处理
  }
  return null;
}

async function requireClientCredentials(env: Env, provider: CloudProvider): Promise<ClientCredentials> {
  const credentials = await getClientCredentials(env, provider);
  if (!credentials) throw new Error(`${provider.label} OAuth client is not configured`);
  return credentials;
}

// ---------------- OAuth token ----------------

function tokenRequestInit(credentials: ClientCredentials, provider: CloudProvider, params: Record<string, string>): RequestInit {
  const { clientId, clientSecret } = credentials;
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (provider.tokenAuth === "basic") {
    headers.Authorization = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
  } else {
    body.set("client_id", clientId);
    body.set("client_secret", clientSecret);
  }
  return { method: "POST", headers, body };
}

async function readTokenErrorMessage(response: Response, prefix: string): Promise<string> {
  const raw = (await response.text()).trim();
  if (!raw) return `${prefix} ${response.status}`;

  let detail = "";
  try {
    const parsed = JSON.parse(raw) as TokenResponse;
    const parts: string[] = [];
    if (typeof parsed.error === "string" && parsed.error) parts.push(parsed.error);
    if (typeof parsed.error_description === "string" && parsed.error_description) parts.push(parsed.error_description);
    if (typeof parsed.error_subtype === "string" && parsed.error_subtype) parts.push(`subtype=${parsed.error_subtype}`);
    detail = parts.join(": ");
  } catch {
    detail = raw.replace(/\s+/g, " ");
  }

  if (!detail) return `${prefix} ${response.status}`;
  const clipped = detail.length > 240 ? `${detail.slice(0, 240)}...` : detail;
  return `${prefix} ${response.status} (${clipped})`;
}

// isolate 内存级 access token 缓存：同一实例里连续的 list / restore / 备份请求复用 token，
// 不额外占用 KV 写入额度。
const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();
const TOKEN_EXPIRY_MARGIN_MS = 2 * 60 * 1000;

export function clearAccessTokenCache(): void {
  accessTokenCache.clear();
}

export async function getAccessToken(env: Env, provider: CloudProvider, refreshToken: string): Promise<string> {
  const cacheKey = provider.id + "\u0000" + refreshToken;
  const cached = accessTokenCache.get(cacheKey);
  if (cached && cached.expiresAt - TOKEN_EXPIRY_MARGIN_MS > Date.now()) return cached.token;

  const credentials = await requireClientCredentials(env, provider);
  const response = await fetch(provider.tokenUrl, tokenRequestInit(credentials, provider, {
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  }));
  if (!response.ok) {
    accessTokenCache.delete(cacheKey);
    throw new Error(await readTokenErrorMessage(response, `${provider.label} token refresh returned`));
  }
  const parsed = (await response.json()) as TokenResponse;
  if (typeof parsed.access_token !== "string" || !parsed.access_token) {
    throw new Error(`${provider.label} token refresh did not return an access token`);
  }
  const expiresIn = typeof parsed.expires_in === "number" && parsed.expires_in > 0 ? parsed.expires_in : 0;
  if (expiresIn) {
    accessTokenCache.set(cacheKey, { token: parsed.access_token, expiresAt: Date.now() + expiresIn * 1000 });
  }
  return parsed.access_token;
}

export async function exchangeAuthorizationCode(env: Env, provider: CloudProvider, code: string, redirectUri: string): Promise<TokenResponse> {
  const credentials = await requireClientCredentials(env, provider);
  const response = await fetch(provider.tokenUrl, tokenRequestInit(credentials, provider, {
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  }));
  if (!response.ok) {
    throw new Error(await readTokenErrorMessage(response, `${provider.label} authorization code exchange returned`));
  }
  return (await response.json()) as TokenResponse;
}
