import type { Env } from "./shared";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";

interface TokenResponse {
  access_token?: unknown;
}

export function scheduleGoogleDriveBackup(
  env: Env,
  key: string,
  rawState: string,
  ctx?: ExecutionContext
): void {
  if (!isGoogleDriveBackupConfigured(env)) return;

  const task = uploadGoogleDriveBackup(env, key, rawState).catch((error) => {
    console.warn("Google Drive backup failed:", error instanceof Error ? error.message : String(error));
  });

  if (ctx) {
    ctx.waitUntil(task);
  }
}

function isGoogleDriveBackupConfigured(env: Env): boolean {
  return Boolean(
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET &&
    env.GOOGLE_REFRESH_TOKEN &&
    env.GOOGLE_DRIVE_FOLDER_ID
  );
}

async function uploadGoogleDriveBackup(env: Env, key: string, rawState: string): Promise<void> {
  const accessToken = await getAccessToken(env);
  const fileName = `${key.replace(/[^a-zA-Z0-9._-]+/g, "_")}.json`;
  const metadata = {
    name: fileName,
    parents: [env.GOOGLE_DRIVE_FOLDER_ID]
  };
  const boundary = `board-trello-${Date.now().toString(36)}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    rawState,
    `--${boundary}--`,
    ""
  ].join("\r\n");

  const response = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });

  if (!response.ok) {
    throw new Error(`upload returned ${response.status}`);
  }
}

async function getAccessToken(env: Env): Promise<string> {
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID || "",
    client_secret: env.GOOGLE_CLIENT_SECRET || "",
    refresh_token: env.GOOGLE_REFRESH_TOKEN || "",
    grant_type: "refresh_token"
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!response.ok) {
    throw new Error(`token refresh returned ${response.status}`);
  }

  const parsed = (await response.json()) as TokenResponse;
  if (typeof parsed.access_token !== "string" || !parsed.access_token) {
    throw new Error("token refresh did not return an access token");
  }

  return parsed.access_token;
}
