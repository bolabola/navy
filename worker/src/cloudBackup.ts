import { isAuthenticated, isCsrfTokenValid } from "./auth";
import { jsonResponse, isPlainObject, type BoardStateEnvelope, type Env } from "./shared";
import { validateBoardState } from "./validation";

type ProviderId = "google" | "dropbox";

interface ProviderConfig {
  id: ProviderId;
  label: string;
  clientIdEnv: keyof Env;
  clientSecretEnv: keyof Env;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  extraAuthParams?: Record<string, string>;
  tokenAuth?: "body" | "basic";
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  error?: unknown;
  error_description?: unknown;
  error_subtype?: unknown;
}

interface OAuthState {
  provider: ProviderId;
  redirectUri: string;
}

interface StoredProviderConfig {
  refreshToken: string;
  folderId?: string;
}

interface ProviderBackupStatus {
  status: "success" | "failed";
  at: string;
  key: string;
  fileName: string;
  error?: string;
}

interface RemoteBackupFile {
  id: string;
  name: string;
  createdAt?: string;
}

const BACKUP_FOLDER_NAME = "board-trello-backups";
const BACKUP_FILE_PREFIX = "state_backup_";
const STATE_KEY = "state";
const LOCAL_BACKUP_PREFIX = "state_backup:";
const LOCAL_BACKUP_KEEP_COUNT = 10;
const CLOUD_BACKUP_KEEP_COUNT = 100;
const CLOUD_BACKUP_LIST_COUNT = 10;
const OAUTH_STATE_PREFIX = "cloud_backup_oauth_state:";
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

const PROVIDERS: ProviderConfig[] = [
  {
    id: "google",
    label: "Google Drive",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/drive.file",
    extraAuthParams: {
      access_type: "offline",
      prompt: "consent"
    }
  },
  {
    id: "dropbox",
    label: "Dropbox",
    clientIdEnv: "DROPBOX_CLIENT_ID",
    clientSecretEnv: "DROPBOX_CLIENT_SECRET",
    authorizeUrl: "https://www.dropbox.com/oauth2/authorize",
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    scope: "files.content.write files.metadata.read files.metadata.write",
    extraAuthParams: {
      token_access_type: "offline"
    },
    tokenAuth: "basic"
  }
];

export function scheduleCloudBackups(
  env: Env,
  key: string,
  rawState: string,
  ctx?: ExecutionContext
): void {
  const task = uploadCloudBackups(env, key, rawState).catch((error) => {
    console.warn("Cloud backup failed:", error instanceof Error ? error.message : String(error));
  });

  if (ctx) {
    ctx.waitUntil(task);
  }
}

export async function handleCloudBackupStatus(request: Request, env: Env): Promise<Response> {
  if (!(await isAuthenticated(request, env.SESSION_SECRET, env.ADMIN_PASSWORD, env.BOARD_KV))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const providers = await Promise.all(PROVIDERS.map(async (provider) => {
    const [stored, connectedAt, lastStatus] = await Promise.all([
      getStoredProviderConfig(env, provider),
      env.BOARD_KV.get(providerKey(provider.id, "connected_at")),
      getProviderBackupStatus(env, provider)
    ]);
    return {
      id: provider.id,
      label: provider.label,
      configured: isProviderClientConfigured(env, provider),
      connected: Boolean(stored),
      connectedAt: connectedAt || null,
      lastBackup: lastStatus
    };
  }));

  return jsonResponse(JSON.stringify({ providers }), 200, { "Cache-Control": "no-store" });
}

export async function handleCloudBackupConnect(request: Request, env: Env, providerId: string): Promise<Response> {
  if (!(await isAuthenticated(request, env.SESSION_SECRET, env.ADMIN_PASSWORD, env.BOARD_KV))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const provider = getProvider(providerId);
  if (!provider) return new Response("Unknown backup provider", { status: 404 });
  if (!isProviderClientConfigured(env, provider)) {
    return new Response(`${provider.label} OAuth client is not configured`, { status: 500 });
  }

  const redirectUri = getProviderRedirectUri(request, provider.id);
  const state = randomState();
  await env.BOARD_KV.put(OAUTH_STATE_PREFIX + state, JSON.stringify({ provider: provider.id, redirectUri }), {
    expirationTtl: OAUTH_STATE_TTL_SECONDS
  });

  const authUrl = new URL(provider.authorizeUrl);
  authUrl.searchParams.set("client_id", String(env[provider.clientIdEnv] || ""));
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", provider.scope);
  authUrl.searchParams.set("state", state);
  for (const [key, value] of Object.entries(provider.extraAuthParams || {})) {
    authUrl.searchParams.set(key, value);
  }

  return jsonResponse(JSON.stringify({ url: authUrl.toString() }), 200, { "Cache-Control": "no-store" });
}

export async function handleCloudBackupDisconnect(request: Request, env: Env, providerId: string): Promise<Response> {
  if (!(await isAuthenticated(request, env.SESSION_SECRET, env.ADMIN_PASSWORD, env.BOARD_KV))) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!(await isCsrfTokenValid(request, env.SESSION_SECRET, env.ADMIN_PASSWORD, env.BOARD_KV))) {
    return new Response("Invalid CSRF token", { status: 403 });
  }

  const provider = getProvider(providerId);
  if (!provider) return new Response("Unknown backup provider", { status: 404 });

  await Promise.all([
    env.BOARD_KV.delete(providerKey(provider.id, "refresh_token")),
    env.BOARD_KV.delete(providerKey(provider.id, "folder_id")),
    env.BOARD_KV.delete(providerKey(provider.id, "connected_at")),
    env.BOARD_KV.delete(providerKey(provider.id, "last_backup")),
    provider.id === "google" ? env.BOARD_KV.delete("google_drive:refresh_token") : Promise.resolve(),
    provider.id === "google" ? env.BOARD_KV.delete("google_drive:folder_id") : Promise.resolve(),
    provider.id === "google" ? env.BOARD_KV.delete("google_drive:connected_at") : Promise.resolve()
  ]);

  return jsonResponse(JSON.stringify({ ok: true }), 200, { "Cache-Control": "no-store" });
}

export async function handleCloudBackupListBackups(request: Request, env: Env, providerId: string): Promise<Response> {
  if (!(await isAuthenticated(request, env.SESSION_SECRET, env.ADMIN_PASSWORD, env.BOARD_KV))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const provider = getProvider(providerId);
  if (!provider) return new Response("Unknown backup provider", { status: 404 });
  if (!isProviderClientConfigured(env, provider)) {
    return new Response(`${provider.label} OAuth client is not configured`, { status: 500 });
  }

  const config = await getStoredProviderConfig(env, provider);
  if (!config) return new Response(`${provider.label} backup is not connected`, { status: 409 });

  const accessToken = await getAccessToken(env, provider, config.refreshToken);
  const backups = getRecentRemoteBackups(
    await listProviderBackups(provider, accessToken, config.folderId),
    CLOUD_BACKUP_LIST_COUNT
  );

  return jsonResponse(JSON.stringify({ provider: provider.id, backups }), 200, { "Cache-Control": "no-store" });
}

export async function handleCloudBackupRestore(request: Request, env: Env, providerId: string, ctx?: ExecutionContext): Promise<Response> {
  if (!(await isAuthenticated(request, env.SESSION_SECRET, env.ADMIN_PASSWORD, env.BOARD_KV))) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!(await isCsrfTokenValid(request, env.SESSION_SECRET, env.ADMIN_PASSWORD, env.BOARD_KV))) {
    return new Response("Invalid CSRF token", { status: 403 });
  }

  const provider = getProvider(providerId);
  if (!provider) return new Response("Unknown backup provider", { status: 404 });
  if (!isProviderClientConfigured(env, provider)) {
    return new Response(`${provider.label} OAuth client is not configured`, { status: 500 });
  }

  let payload: { id?: unknown };
  try {
    payload = (await request.json()) as { id?: unknown };
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (typeof payload.id !== "string" || !payload.id) {
    return new Response("Invalid backup id", { status: 400 });
  }

  const config = await getStoredProviderConfig(env, provider);
  if (!config) return new Response(`${provider.label} backup is not connected`, { status: 409 });

  const accessToken = await getAccessToken(env, provider, config.refreshToken);
  const backups = await listProviderBackups(provider, accessToken, config.folderId);
  const backup = backups.find((entry) => entry.id === payload.id);
  if (!backup) return new Response("Cloud backup not found", { status: 404 });

  const backupRaw = await downloadProviderBackup(provider, accessToken, backup);
  const restored = parseStoredBoardState(backupRaw);
  if (!restored) return new Response("Cloud backup is invalid", { status: 500 });

  const existingRaw = await env.BOARD_KV.get(STATE_KEY);
  const existing = existingRaw ? parseStoredBoardState(existingRaw) : null;
  if (existingRaw && !existing) return new Response("Stored board state is invalid", { status: 500 });

  const backupKey = existingRaw ? await writeLocalBoardBackup(env, existingRaw, ctx) : null;
  const nextState: BoardStateEnvelope = {
    version: existing ? existing.version + 1 : 1,
    updatedAt: new Date().toISOString(),
    boards: restored.boards
  };
  await env.BOARD_KV.put(STATE_KEY, JSON.stringify(nextState));
  await pruneLocalBoardBackups(env);

  return jsonResponse(JSON.stringify({
    ok: true,
    provider: provider.id,
    restoredBackup: backup,
    version: nextState.version,
    updatedAt: nextState.updatedAt,
    backupKey
  }), 200, { "Cache-Control": "no-store" });
}

export async function handleCloudBackupCallback(request: Request, env: Env, url: URL, providerId: string): Promise<Response> {
  const provider = getProvider(providerId);
  if (!provider) return htmlResponse("Backup authorization failed", "Unknown backup provider.");
  if (!isProviderClientConfigured(env, provider)) {
    return htmlResponse(`${provider.label} authorization failed`, `${provider.label} OAuth client is not configured.`);
  }

  const state = url.searchParams.get("state") || "";
  const stateKey = OAUTH_STATE_PREFIX + state;
  const storedState = state ? await env.BOARD_KV.get(stateKey) : null;
  const parsedState = storedState ? parseOAuthState(storedState) : null;
  if (!parsedState || parsedState.provider !== provider.id) {
    return htmlResponse(`${provider.label} authorization failed`, "The authorization link expired or is invalid.");
  }
  await env.BOARD_KV.delete(stateKey);

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return htmlResponse(`${provider.label} authorization failed`, `Provider returned: ${escapeHtml(oauthError)}`);
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return htmlResponse(`${provider.label} authorization failed`, "The provider did not return an authorization code.");
  }

  try {
    const tokens = await exchangeAuthorizationCode(env, provider, code, parsedState.redirectUri);
    const previous = await getStoredProviderConfig(env, provider);
    const refreshToken = typeof tokens.refresh_token === "string" && tokens.refresh_token
      ? tokens.refresh_token
      : previous?.refreshToken;
    const accessToken = typeof tokens.access_token === "string" ? tokens.access_token : "";
    if (!refreshToken || !accessToken) {
      return htmlResponse(`${provider.label} authorization failed`, "The provider did not return the tokens needed for backups.");
    }

    const folderId = await prepareProviderFolder(provider, accessToken);
    await storeProviderConfig(env, provider, refreshToken, folderId);

    return htmlResponse(`${provider.label} connected`, `${provider.label} backup is connected. You can return to the board.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return htmlResponse(`${provider.label} authorization failed`, escapeHtml(message));
  }
}

async function uploadCloudBackups(env: Env, key: string, rawState: string): Promise<void> {
  const results = await Promise.allSettled(PROVIDERS.map(async (provider) => {
    if (!isProviderClientConfigured(env, provider)) return;
    const config = await getStoredProviderConfig(env, provider);
    if (!config) return;

    const fileName = `${key.replace(/[^a-zA-Z0-9._-]+/g, "_")}.json`;
    try {
      const accessToken = await getAccessToken(env, provider, config.refreshToken);
      await uploadProviderFile(provider, accessToken, fileName, rawState, config.folderId);
      await storeProviderBackupStatus(env, provider, {
        status: "success",
        at: new Date().toISOString(),
        key,
        fileName
      });
    } catch (error) {
      await storeProviderBackupStatus(env, provider, {
        status: "failed",
        at: new Date().toISOString(),
        key,
        fileName,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }));

  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    throw new Error(`${failures.length} cloud backup provider(s) failed`);
  }
}

async function uploadProviderFile(
  provider: ProviderConfig,
  accessToken: string,
  fileName: string,
  rawState: string,
  folderId?: string
): Promise<void> {
  if (provider.id === "google") {
    await uploadGoogleFile(accessToken, fileName, rawState, folderId || "");
    await pruneGoogleBackups(accessToken, folderId || "");
    return;
  }
  if (provider.id === "dropbox") {
    await ensureDropboxFolder(accessToken);
    await uploadDropboxFile(accessToken, fileName, rawState);
    await pruneDropboxBackups(accessToken);
    return;
  }
}

async function uploadGoogleFile(accessToken: string, fileName: string, rawState: string, folderId: string): Promise<void> {
  if (!folderId) throw new Error("Google Drive folder id is missing");

  const boundary = `board-trello-${Date.now().toString(36)}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify({ name: fileName, parents: [folderId] }),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    rawState,
    `--${boundary}--`,
    ""
  ].join("\r\n");

  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });

  if (!response.ok) throw new Error(`Google Drive upload returned ${response.status}`);
}

async function uploadDropboxFile(accessToken: string, fileName: string, rawState: string): Promise<void> {
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
    body: rawState
  });

  if (!response.ok) throw new Error(`Dropbox upload returned ${response.status}`);
}

async function pruneGoogleBackups(accessToken: string, folderId: string): Promise<void> {
  const files = await listGoogleBackups(accessToken, folderId);

  await Promise.all(getOldRemoteBackups(files).map(async (file) => {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Google Drive backup delete returned ${response.status}`);
    }
  }));
}

async function pruneDropboxBackups(accessToken: string): Promise<void> {
  const files = await listDropboxBackups(accessToken);

  await Promise.all(getOldRemoteBackups(files).map(async (file) => {
    const response = await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ path: file.id })
    });
    if (!response.ok && response.status !== 409) {
      throw new Error(`Dropbox backup delete returned ${response.status}`);
    }
  }));
}

async function listProviderBackups(provider: ProviderConfig, accessToken: string, folderId?: string): Promise<RemoteBackupFile[]> {
  if (provider.id === "google") return listGoogleBackups(accessToken, folderId || "");
  if (provider.id === "dropbox") return listDropboxBackups(accessToken);
  return [];
}

async function listGoogleBackups(accessToken: string, folderId: string): Promise<RemoteBackupFile[]> {
  if (!folderId) throw new Error("Google Drive folder id is missing");

  const files: RemoteBackupFile[] = [];
  let pageToken = "";
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("fields", "nextPageToken,files(id,name,createdTime)");
    url.searchParams.set("q", `'${escapeDriveQueryValue(folderId)}' in parents and trashed = false and name contains '${BACKUP_FILE_PREFIX}'`);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
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
}

async function listDropboxBackups(accessToken: string): Promise<RemoteBackupFile[]> {
  const files: RemoteBackupFile[] = [];
  let cursor = "";
  let hasMore = false;

  do {
    const response = await fetch(cursor
      ? "https://api.dropboxapi.com/2/files/list_folder/continue"
      : "https://api.dropboxapi.com/2/files/list_folder", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(cursor ? { cursor } : {
        path: `/${BACKUP_FOLDER_NAME}`,
        recursive: false,
        include_deleted: false,
        limit: 2000
      })
    });
    if (!response.ok) throw new Error(`Dropbox backup list returned ${response.status}`);

    const parsed = (await response.json()) as {
      entries?: Array<{ ".tag"?: unknown; name?: unknown; path_lower?: unknown; server_modified?: unknown }>;
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
          id: entry.path_lower,
          name: entry.name,
          createdAt: typeof entry.server_modified === "string" ? entry.server_modified : undefined
        });
      }
    }
    cursor = typeof parsed.cursor === "string" ? parsed.cursor : "";
    hasMore = parsed.has_more === true;
  } while (hasMore && cursor);

  return files;
}

async function downloadProviderBackup(
  provider: ProviderConfig,
  accessToken: string,
  backup: RemoteBackupFile
): Promise<string> {
  if (provider.id === "google") return downloadGoogleBackup(accessToken, backup.id);
  if (provider.id === "dropbox") return downloadDropboxBackup(accessToken, backup.id);
  throw new Error(`Unsupported backup provider: ${provider.id}`);
}

async function downloadGoogleBackup(accessToken: string, fileId: string): Promise<string> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error(`Google Drive backup download returned ${response.status}`);
  return response.text();
}

async function downloadDropboxBackup(accessToken: string, path: string): Promise<string> {
  const response = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Dropbox-API-Arg": JSON.stringify({ path })
    }
  });
  if (!response.ok) throw new Error(`Dropbox backup download returned ${response.status}`);
  return response.text();
}

function getOldRemoteBackups(files: RemoteBackupFile[]): RemoteBackupFile[] {
  return getSortedRemoteBackups(files)
    .slice(CLOUD_BACKUP_KEEP_COUNT);
}

function getRecentRemoteBackups(files: RemoteBackupFile[], count: number): RemoteBackupFile[] {
  return getSortedRemoteBackups(files)
    .slice(0, count);
}

function getSortedRemoteBackups(files: RemoteBackupFile[]): RemoteBackupFile[] {
  return files
    .slice()
    .sort((a, b) => remoteBackupSortKey(b).localeCompare(remoteBackupSortKey(a)));
}

function remoteBackupSortKey(file: RemoteBackupFile): string {
  const match = /^state_backup_(.+)\.json$/.exec(file.name);
  return match ? match[1] : file.createdAt || file.name;
}

async function writeLocalBoardBackup(env: Env, existingRaw: string, ctx?: ExecutionContext): Promise<string> {
  const suffix = new Date().toISOString().replace(/[:.]/g, "-");
  const key = LOCAL_BACKUP_PREFIX + suffix;
  await env.BOARD_KV.put(key, existingRaw);
  scheduleCloudBackups(env, key, existingRaw, ctx);
  return key;
}

async function pruneLocalBoardBackups(env: Env): Promise<void> {
  const listed = await env.BOARD_KV.list({ prefix: LOCAL_BACKUP_PREFIX });
  const stale = listed.keys
    .map((key) => key.name)
    .sort()
    .reverse()
    .slice(LOCAL_BACKUP_KEEP_COUNT);

  await Promise.all(stale.map((key) => env.BOARD_KV.delete(key)));
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

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function prepareProviderFolder(provider: ProviderConfig, accessToken: string): Promise<string | undefined> {
  if (provider.id === "google") return createGoogleFolder(accessToken);
  if (provider.id === "dropbox") {
    await ensureDropboxFolder(accessToken);
    return undefined;
  }
}

async function createGoogleFolder(accessToken: string): Promise<string> {
  const response = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8"
    },
    body: JSON.stringify({
      name: BACKUP_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder"
    })
  });

  if (!response.ok) throw new Error(`Google Drive folder create returned ${response.status}`);
  const parsed = (await response.json()) as { id?: unknown };
  if (typeof parsed.id !== "string" || !parsed.id) {
    throw new Error("Google Drive folder create did not return a folder id");
  }
  return parsed.id;
}

async function ensureDropboxFolder(accessToken: string): Promise<void> {
  const response = await fetch("https://api.dropboxapi.com/2/files/create_folder_v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ path: `/${BACKUP_FOLDER_NAME}`, autorename: false })
  });

  if (response.ok || response.status === 409) return;
  throw new Error(`Dropbox folder create returned ${response.status}`);
}

async function getStoredProviderConfig(env: Env, provider: ProviderConfig): Promise<StoredProviderConfig | null> {
  const [storedRefreshToken, storedFolderId] = await Promise.all([
    env.BOARD_KV.get(providerKey(provider.id, "refresh_token")),
    env.BOARD_KV.get(providerKey(provider.id, "folder_id"))
  ]);

  const legacyRefreshToken = provider.id === "google" ? env.GOOGLE_REFRESH_TOKEN || await env.BOARD_KV.get("google_drive:refresh_token") : "";
  const legacyFolderId = provider.id === "google" ? env.GOOGLE_DRIVE_FOLDER_ID || await env.BOARD_KV.get("google_drive:folder_id") : "";
  const refreshToken = storedRefreshToken || legacyRefreshToken || "";
  const folderId = storedFolderId || legacyFolderId || "";
  if (!refreshToken) return null;
  if (provider.id === "google" && !folderId) return null;

  return { refreshToken, folderId: folderId || undefined };
}

async function storeProviderConfig(env: Env, provider: ProviderConfig, refreshToken: string, folderId?: string): Promise<void> {
  const writes: Promise<void>[] = [
    env.BOARD_KV.put(providerKey(provider.id, "refresh_token"), refreshToken),
    env.BOARD_KV.put(providerKey(provider.id, "connected_at"), new Date().toISOString())
  ];
  if (folderId) writes.push(env.BOARD_KV.put(providerKey(provider.id, "folder_id"), folderId));
  await Promise.all(writes);
}

async function getProviderBackupStatus(env: Env, provider: ProviderConfig): Promise<ProviderBackupStatus | null> {
  const raw = await env.BOARD_KV.get(providerKey(provider.id, "last_backup"));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ProviderBackupStatus>;
    if (
      (parsed.status === "success" || parsed.status === "failed") &&
      typeof parsed.at === "string" &&
      typeof parsed.key === "string" &&
      typeof parsed.fileName === "string"
    ) {
      return {
        status: parsed.status,
        at: parsed.at,
        key: parsed.key,
        fileName: parsed.fileName,
        error: typeof parsed.error === "string" ? parsed.error : undefined
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function storeProviderBackupStatus(env: Env, provider: ProviderConfig, status: ProviderBackupStatus): Promise<void> {
  await env.BOARD_KV.put(providerKey(provider.id, "last_backup"), JSON.stringify(status));
}

async function readTokenErrorMessage(response: Response, prefix: string): Promise<string> {
  const raw = (await response.text()).trim();
  if (!raw) {
    return `${prefix} ${response.status}`;
  }

  let detail = "";
  try {
    const parsed = JSON.parse(raw) as TokenResponse;
    const parts: string[] = [];
    if (typeof parsed.error === "string" && parsed.error) {
      parts.push(parsed.error);
    }
    if (typeof parsed.error_description === "string" && parsed.error_description) {
      parts.push(parsed.error_description);
    }
    if (typeof parsed.error_subtype === "string" && parsed.error_subtype) {
      parts.push(`subtype=${parsed.error_subtype}`);
    }
    detail = parts.join(": ");
  } catch {
    detail = raw.replace(/\s+/g, " ");
  }

  if (!detail) {
    return `${prefix} ${response.status}`;
  }

  const clipped = detail.length > 240 ? `${detail.slice(0, 240)}...` : detail;
  return `${prefix} ${response.status} (${clipped})`;
}

async function getAccessToken(env: Env, provider: ProviderConfig, refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });
  if (provider.tokenAuth !== "basic") {
    body.set("client_id", String(env[provider.clientIdEnv] || ""));
    body.set("client_secret", String(env[provider.clientSecretEnv] || ""));
  }
  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: tokenHeaders(env, provider),
    body
  });

  if (!response.ok) {
    throw new Error(await readTokenErrorMessage(response, `${provider.label} token refresh returned`));
  }
  const parsed = (await response.json()) as TokenResponse;
  if (typeof parsed.access_token !== "string" || !parsed.access_token) {
    throw new Error(`${provider.label} token refresh did not return an access token`);
  }

  return parsed.access_token;
}

async function exchangeAuthorizationCode(env: Env, provider: ProviderConfig, code: string, redirectUri: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  });
  if (provider.tokenAuth !== "basic") {
    body.set("client_id", String(env[provider.clientIdEnv] || ""));
    body.set("client_secret", String(env[provider.clientSecretEnv] || ""));
  }
  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: tokenHeaders(env, provider),
    body
  });

  if (!response.ok) {
    throw new Error(await readTokenErrorMessage(response, `${provider.label} authorization code exchange returned`));
  }
  return (await response.json()) as TokenResponse;
}

function tokenHeaders(env: Env, provider: ProviderConfig): HeadersInit {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (provider.tokenAuth === "basic") {
    const clientId = String(env[provider.clientIdEnv] || "");
    const clientSecret = String(env[provider.clientSecretEnv] || "");
    headers.Authorization = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
  }
  return headers;
}

function getProvider(providerId: string): ProviderConfig | null {
  return PROVIDERS.find((provider) => provider.id === providerId) || null;
}

function isProviderClientConfigured(env: Env, provider: ProviderConfig): boolean {
  return Boolean(env[provider.clientIdEnv] && env[provider.clientSecretEnv]);
}

function providerKey(provider: ProviderId, key: string): string {
  return `cloud_backup:${provider}:${key}`;
}

function getProviderRedirectUri(request: Request, provider: ProviderId): string {
  const url = new URL(request.url);
  return `${url.origin}/api/cloud-backup/${provider}/callback`;
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
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

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
    <p>${body}</p>
    <p><a href="/">Return to board</a></p>
  </main>
</body>
</html>`, {
    status: title.includes("failed") ? 400 : 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}
