import assert from "node:assert/strict";
import { test } from "vitest";
import worker from "../src/index";
import { board, call, createCtx, createEnv, login, mockFetch, stateWith } from "./helpers";

const googleClient = { GOOGLE_CLIENT_ID: "client-id", GOOGLE_CLIENT_SECRET: "client-secret" };
const dropboxClient = { DROPBOX_CLIENT_ID: "dropbox-id", DROPBOX_CLIENT_SECRET: "dropbox-secret" };
const googleRecord = JSON.stringify({ refreshToken: "refresh-token", folderId: "folder-id", connectedAt: "2026-01-01T00:00:00.000Z" });
const dropboxRecord = JSON.stringify({ refreshToken: "refresh-token", connectedAt: "2026-01-01T00:00:00.000Z" });

async function runCron(env: Parameters<typeof worker.scheduled>[1]) {
  const { ctx, settle } = createCtx();
  await worker.scheduled({ cron: "17 * * * *", scheduledTime: Date.now(), noRetry() {} } as ScheduledController, env, ctx);
  await settle();
}

function googleHappyPath(files: unknown[] = []) {
  return mockFetch((url) => {
    if (url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "access-token", expires_in: 3600 });
    if (url.includes("upload/drive/v3/files")) return Response.json({ id: "drive-file-id" });
    if (url.includes("googleapis.com/drive/v3/files?")) return Response.json({ files });
    return new Response(null, { status: 204 });
  });
}

test("saving the board no longer triggers cloud uploads", async () => {
  const calls = googleHappyPath();
  const env = createEnv({ state: stateWith(), "cloud_backup:google": googleRecord }, googleClient);
  const auth = await login(env);
  const { ctx, tasks } = createCtx();
  const res = await call(env, "/api/board", { method: "PUT", auth, json: { version: 1, boards: [board] } }, ctx);
  assert.equal(res.status, 200);
  assert.equal(tasks.length, 0);
  assert.equal(calls.length, 0);
});

test("cron uploads to Google Drive when the board changed, and skips when unchanged", async () => {
  const calls = googleHappyPath();
  const env = createEnv({ state: stateWith(), "cloud_backup:google": googleRecord }, googleClient);

  await runCron(env);
  assert.match(calls[0].url, /oauth2\.googleapis\.com\/token/);
  assert.match(calls[1].url, /googleapis\.com\/upload\/drive\/v3\/files/);
  assert.match(String(calls[1].init.body), /state_backup_/);
  assert.match(String(calls[1].init.body), /folder-id/);
  assert.equal(calls.some((c) => /googleapis\.com\/drive\/v3\/files\?/.test(c.url)), true);
  const record = JSON.parse((await env.BOARD_KV.get("cloud_backup:google"))!);
  assert.equal(record.lastBackup.status, "success");
  assert.match(record.lastBackup.fileName, /^state_backup_/);
  assert.equal(record.lastBackup.stateUpdatedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(record.refreshToken, "refresh-token");

  const before = calls.length;
  await runCron(env);
  assert.equal(calls.length, before, "unchanged board should not be uploaded again");

  env.BOARD_KV.dump().set("state", stateWith({ version: 2, updatedAt: "2026-01-02T00:00:00.000Z" }));
  await runCron(env);
  assert.equal(calls.filter((c) => c.url.includes("upload/drive")).length, 2);
});

test("cron retries after a failed backup even if the board is unchanged", async () => {
  mockFetch(() => new Response("bad gateway", { status: 502 }));
  const env = createEnv({ state: stateWith(), "cloud_backup:google": googleRecord }, googleClient);
  await runCron(env);
  let record = JSON.parse((await env.BOARD_KV.get("cloud_backup:google"))!);
  assert.equal(record.lastBackup.status, "failed");
  assert.match(record.lastBackup.error, /Google Drive token refresh returned 502/);

  const calls = googleHappyPath();
  await runCron(env);
  assert.equal(calls.some((c) => c.url.includes("upload/drive")), true);
  record = JSON.parse((await env.BOARD_KV.get("cloud_backup:google"))!);
  assert.equal(record.lastBackup.status, "success");
});

test("Google Drive backup failure stores OAuth error details", async () => {
  mockFetch((url) => url.includes("oauth2.googleapis.com/token")
    ? Response.json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 })
    : new Response("unexpected", { status: 500 }));
  const env = createEnv({ state: stateWith(), "cloud_backup:google": googleRecord }, googleClient);
  await runCron(env);
  const { lastBackup } = JSON.parse((await env.BOARD_KV.get("cloud_backup:google"))!);
  assert.equal(lastBackup.status, "failed");
  assert.match(lastBackup.error, /Google Drive token refresh returned 400/);
  assert.match(lastBackup.error, /invalid_grant/);
  assert.match(lastBackup.error, /expired or revoked/i);
});

test("Google Drive backup pruning keeps the newest 100 files", async () => {
  const files = Array.from({ length: 101 }, (_, index) => ({
    id: `file-${index + 1}`,
    name: `state_backup_2026-01-01T00-00-${String(index + 1).padStart(3, "0")}-000Z.json`,
    createdTime: "2026-01-01T00:00:00.000Z"
  }));
  const calls = googleHappyPath(files);
  const env = createEnv({ state: stateWith(), "cloud_backup:google": googleRecord }, googleClient);
  await runCron(env);
  const deletes = calls.filter((c) => c.init.method === "DELETE");
  assert.equal(deletes.length, 1);
  assert.match(deletes[0].url, /\/drive\/v3\/files\/file-1$/);
});

test("Dropbox backup pruning keeps the newest 100 files", async () => {
  const calls = mockFetch((url) => {
    if (url.includes("dropboxapi.com/oauth2/token")) return Response.json({ access_token: "dropbox-access" });
    if (url.includes("/2/files/upload")) return Response.json({ id: "uploaded" });
    if (url.includes("/2/files/list_folder")) {
      const entries = Array.from({ length: 101 }, (_, index) => ({
        ".tag": "file",
        name: `state_backup_2026-01-01T00-00-${String(index + 1).padStart(3, "0")}-000Z.json`,
        path_lower: `/board-trello-backups/state_backup_2026-01-01t00-00-${String(index + 1).padStart(3, "0")}-000z.json`
      }));
      return Response.json({ entries, cursor: "cursor", has_more: false });
    }
    return Response.json({});
  });
  const env = createEnv({ state: stateWith(), "cloud_backup:dropbox": dropboxRecord }, dropboxClient);
  await runCron(env);
  const tokenCall = calls.find((c) => c.url.includes("oauth2/token"))!;
  assert.match(String((tokenCall.init.headers as Record<string, string>).Authorization), /^Basic /);
  const deletes = calls.filter((c) => c.url.includes("/2/files/delete_v2"));
  assert.equal(deletes.length, 1);
  assert.deepEqual(JSON.parse(String(deletes[0].init.body)), {
    path: "/board-trello-backups/state_backup_2026-01-01t00-00-001-000z.json"
  });
});

test("access tokens are reused within an isolate until they expire", async () => {
  const calls = googleHappyPath();
  const env = createEnv({ state: stateWith(), "cloud_backup:google": googleRecord }, googleClient);
  const auth = await login(env);
  await call(env, "/api/cloud-backup/google/backups", { auth });
  await call(env, "/api/cloud-backup/google/backups", { auth });
  assert.equal(calls.filter((c) => c.url.includes("oauth2.googleapis.com/token")).length, 1);
});

test("manual run endpoint backs up immediately and reports status", async () => {
  googleHappyPath();
  const env = createEnv({ state: stateWith(), "cloud_backup:google": googleRecord }, googleClient);
  const auth = await login(env);
  const noCsrf = await call(env, "/api/cloud-backup/google/run", { method: "POST", headers: { Cookie: auth.cookie } });
  assert.equal(noCsrf.status, 403);
  const res = await call(env, "/api/cloud-backup/google/run", { method: "POST", auth });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, any>;
  assert.equal(body.lastBackup.status, "success");

  const notConnected = await call(env, "/api/cloud-backup/dropbox/run", { method: "POST", auth });
  assert.equal(notConnected.status, 500);
});

test("cloud backup connect requires CSRF and returns OAuth authorization URLs", async () => {
  const env = createEnv({}, { ...googleClient, ...dropboxClient });
  const auth = await login(env);
  const noCsrf = await call(env, "/api/cloud-backup/google/connect", { method: "POST", headers: { Cookie: auth.cookie } });
  assert.equal(noCsrf.status, 403);

  for (const [provider, host] of [["google", "accounts.google.com"], ["dropbox", "www.dropbox.com"]]) {
    const redirectUri = `https://example.com/api/cloud-backup/${provider}/callback`;
    const res = await call(env, `/api/cloud-backup/${provider}/connect`, { method: "POST", auth });
    assert.equal(res.status, 200);
    const authUrl = new URL((await res.json() as { url: string }).url);
    assert.equal(authUrl.hostname, host);
    assert.equal(authUrl.searchParams.get("redirect_uri"), redirectUri);
    if (provider === "dropbox") {
      assert.equal(authUrl.searchParams.get("scope"), "files.content.read files.content.write files.metadata.read files.metadata.write");
    }
    const stored = JSON.parse((await env.BOARD_KV.get("cloud_backup_oauth_state:" + authUrl.searchParams.get("state")))!);
    assert.equal(stored.provider, provider);
    assert.equal(stored.redirectUri, redirectUri);
  }
});

test("Google Drive callback stores a single record and runs the first backup", async () => {
  const calls = mockFetch((url) => {
    if (url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
    if (url.includes("upload/drive")) return Response.json({ id: "uploaded" });
    if (url.includes("drive/v3/files?")) return Response.json({ files: [] });
    return Response.json({ id: "folder-id" });
  });
  const env = createEnv({
    state: stateWith(),
    "cloud_backup_oauth_state:state-1": JSON.stringify({ provider: "google", redirectUri: "https://example.com/api/cloud-backup/google/callback" })
  }, googleClient);
  const { ctx, settle } = createCtx();
  const res = await call(env, "/api/cloud-backup/google/callback?state=state-1&code=code-1", {}, ctx);
  assert.equal(res.status, 200);
  await settle();
  const record = JSON.parse((await env.BOARD_KV.get("cloud_backup:google"))!);
  assert.equal(record.refreshToken, "refresh-token");
  assert.equal(record.folderId, "folder-id");
  assert.equal(record.lastBackup.status, "success");
  assert.equal(await env.BOARD_KV.get("cloud_backup_oauth_state:state-1"), null);
  assert.match(calls[0].url, /oauth2\.googleapis\.com\/token/);
  assert.match(calls[1].url, /googleapis\.com\/drive\/v3\/files$/);
});

test("OAuth callback escapes provider error text", async () => {
  const env = createEnv({
    "cloud_backup_oauth_state:s": JSON.stringify({ provider: "google", redirectUri: "https://example.com/api/cloud-backup/google/callback" })
  }, googleClient);
  const res = await call(env, "/api/cloud-backup/google/callback?state=s&error=" + encodeURIComponent("<img src=x>"));
  assert.equal(res.status, 400);
  const html = await res.text();
  assert.equal(html.includes("<img"), false);
  assert.match(html, /&lt;img src=x&gt;/);
});

test("Dropbox callback stores refresh token", async () => {
  mockFetch((url) => url.includes("dropboxapi.com/oauth2/token")
    ? Response.json({ access_token: "dropbox-access", refresh_token: "dropbox-refresh" })
    : Response.json({ id: "ok" }));
  const env = createEnv({
    "cloud_backup_oauth_state:dropbox-state": JSON.stringify({ provider: "dropbox", redirectUri: "https://example.com/api/cloud-backup/dropbox/callback" })
  }, dropboxClient);
  const res = await call(env, "/api/cloud-backup/dropbox/callback?state=dropbox-state&code=code-1");
  assert.equal(res.status, 200);
  assert.equal(JSON.parse((await env.BOARD_KV.get("cloud_backup:dropbox"))!).refreshToken, "dropbox-refresh");
});

test("legacy per-field keys are migrated into one record", async () => {
  const env = createEnv({
    "cloud_backup:google:refresh_token": "refresh-token",
    "cloud_backup:google:folder_id": "folder-id",
    "cloud_backup:google:connected_at": "2026-01-01T00:00:00.000Z",
    "cloud_backup:google:last_backup": JSON.stringify({
      status: "success",
      at: "2026-01-01T00:01:00.000Z",
      key: "state_backup:2026-01-01T00-00-00-000Z",
      fileName: "state_backup_2026-01-01T00-00-00-000Z.json"
    })
  }, { ...googleClient, ...dropboxClient });
  const auth = await login(env);

  const status = await call(env, "/api/cloud-backup/status", { auth });
  const body = await status.json() as { providers: Array<Record<string, any>> };
  const google = body.providers.find((p) => p.id === "google")!;
  assert.equal(google.connected, true);
  assert.equal(google.lastBackup.status, "success");
  assert.equal(body.providers.find((p) => p.id === "dropbox")!.configured, true);
  assert.equal(await env.BOARD_KV.get("cloud_backup:google:refresh_token"), null);
  assert.equal(JSON.parse((await env.BOARD_KV.get("cloud_backup:google"))!).folderId, "folder-id");

  // 迁移后再次读取状态只需要 1 次 get
  const before = env.BOARD_KV.ops.reads;
  await call(env, "/api/cloud-backup/status", { auth });
  // session 1 次 + google 1 次 + dropbox（无记录，查 4 个旧 key + 1 次新 key）
  assert.ok(env.BOARD_KV.ops.reads - before <= 7);

  const disconnected = await call(env, "/api/cloud-backup/google/disconnect", { method: "POST", auth });
  assert.equal(disconnected.status, 200);
  assert.equal(await env.BOARD_KV.get("cloud_backup:google"), null);
});

test("Google Drive cloud backup list and restore remote state", async () => {
  const remoteState = JSON.stringify({
    version: 1,
    updatedAt: "2026-01-02T00:00:00.000Z",
    activePageId: "page-restore",
    pages: [{ id: "page-restore", name: "Restored Page", boards: [{ id: "restored-board", title: "Restored", items: [] }] }],
    boards: [{ id: "restored-board", title: "Restored", items: [] }]
  });
  const remoteFiles = Array.from({ length: 12 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return { id: index === 11 ? "cloud-file" : `cloud-file-${index + 1}`, name: `state_backup_2026-01-${day}T00-00-00-000Z.json` };
  });
  mockFetch((url) => {
    if (url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "access-token" });
    if (url.includes("drive/v3/files/cloud-file") && url.includes("alt=media")) return new Response(remoteState);
    if (url.includes("drive/v3/files?")) return Response.json({ files: remoteFiles });
    return new Response(null, { status: 204 });
  });
  const env = createEnv({ state: stateWith(), "cloud_backup:google": googleRecord }, googleClient);
  const auth = await login(env);

  const listed = await call(env, "/api/cloud-backup/google/backups", { auth });
  const listedBody = await listed.json() as { backups: Array<{ id: string }> };
  assert.equal(listedBody.backups.length, 10);
  assert.deepEqual(listedBody.backups.map((b) => b.id).slice(0, 3), ["cloud-file", "cloud-file-11", "cloud-file-10"]);

  const restored = await call(env, "/api/cloud-backup/google/restore", { method: "POST", auth, json: { id: "cloud-file" } });
  assert.equal(restored.status, 200);
  const body = await restored.json() as Record<string, any>;
  assert.equal(body.version, 2);
  assert.equal(body.restoredBackup.id, "cloud-file");
  assert.match(body.backupKey, /^state_backup:/);
  assert.equal(JSON.parse((await env.BOARD_KV.get(body.backupKey))!).boards[0].id, "board-1");
  const state = await (await call(env, "/api/board")).json() as Record<string, any>;
  assert.equal(state.boards[0].id, "restored-board");
  assert.equal(state.activePageId, "page-restore");

  const missing = await call(env, "/api/cloud-backup/google/restore", { method: "POST", auth, json: { id: "nope" } });
  assert.equal(missing.status, 404);
});

test("Dropbox restore falls back from file id to path", async () => {
  const remoteState = stateWith({ updatedAt: "2026-01-03T00:00:00.000Z", boards: [{ id: "dropbox-restored-board", title: "Restored" }] });
  const calls = mockFetch((url, init) => {
    if (url.includes("api.dropboxapi.com/oauth2/token")) return Response.json({ access_token: "access-token" });
    if (url.includes("content.dropboxapi.com/2/files/download")) {
      const arg = JSON.parse((init.headers as Record<string, string>)["Dropbox-API-Arg"]);
      return arg.path === "id:dropbox-cloud-file" ? new Response("invalid file id", { status: 400 }) : new Response(remoteState);
    }
    if (url.includes("/2/files/list_folder")) {
      return Response.json({
        entries: [{ ".tag": "file", id: "id:dropbox-cloud-file", name: "state_backup_2026-01-03T00-00-00-000Z.json", path_lower: "/board-trello-backups/state_backup_2026-01-03t00-00-00-000z.json" }],
        has_more: false
      });
    }
    return new Response(null, { status: 204 });
  });
  const env = createEnv({ state: stateWith(), "cloud_backup:dropbox": dropboxRecord }, dropboxClient);
  const auth = await login(env);
  const restored = await call(env, "/api/cloud-backup/dropbox/restore", { method: "POST", auth, json: { id: "id:dropbox-cloud-file" } });
  assert.equal(restored.status, 200);
  const state = await (await call(env, "/api/board")).json() as Record<string, any>;
  assert.equal(state.boards[0].id, "dropbox-restored-board");
  const paths = calls.filter((c) => c.url.includes("files/download")).map((c) => JSON.parse((c.init.headers as Record<string, string>)["Dropbox-API-Arg"]).path);
  assert.deepEqual(paths, ["id:dropbox-cloud-file", "/board-trello-backups/state_backup_2026-01-03t00-00-00-000z.json"]);
});

test("OAuth client credentials can be saved in the app and are used for connect and token refresh", async () => {
  const env = createEnv({ state: stateWith() });
  const auth = await login(env);

  const before = await (await call(env, "/api/cloud-backup/status", { auth })).json() as { providers: Array<Record<string, unknown>> };
  const googleBefore = before.providers.find((p) => p.id === "google")!;
  assert.equal(googleBefore.configured, false);
  assert.equal(googleBefore.callbackUrl, "https://example.com/api/cloud-backup/google/callback");

  // 需要 CSRF；字段不能为空或带空白
  assert.equal((await call(env, "/api/cloud-backup/google/client", { method: "PUT", headers: { Cookie: auth.cookie }, json: { clientId: "a", clientSecret: "b" } })).status, 403);
  assert.equal((await call(env, "/api/cloud-backup/google/client", { method: "PUT", auth, json: { clientId: "has space", clientSecret: "b" } })).status, 400);

  const saved = await call(env, "/api/cloud-backup/google/client", { method: "PUT", auth, json: { clientId: " app-client-id ", clientSecret: "app-secret" } });
  assert.equal(saved.status, 200);

  const statusRes = await call(env, "/api/cloud-backup/status", { auth });
  const statusText = await statusRes.text();
  assert.ok(!statusText.includes("app-secret"), "the client secret must never be returned");
  const google = (JSON.parse(statusText) as { providers: Array<Record<string, unknown>> }).providers.find((p) => p.id === "google")!;
  assert.equal(google.configured, true);
  assert.equal(google.configuredBy, "app");

  const connect = await call(env, "/api/cloud-backup/google/connect", { method: "POST", auth, json: {} });
  const { url } = await connect.json() as { url: string };
  assert.equal(new URL(url).searchParams.get("client_id"), "app-client-id");

  // 刷新 access token 时也用网站里保存的凭据
  env.BOARD_KV.dump().set("cloud_backup:google", googleRecord);
  const calls = googleHappyPath();
  assert.equal((await call(env, "/api/cloud-backup/google/run", { method: "POST", auth, json: {} })).status, 200);
  const tokenCall = calls.find((c) => c.url.includes("oauth2.googleapis.com/token"))!;
  assert.match(String(tokenCall.init?.body), /client_id=app-client-id/);
  assert.match(String(tokenCall.init?.body), /client_secret=app-secret/);

  // 移除配置会同时断开连接
  assert.equal((await call(env, "/api/cloud-backup/google/client", { method: "DELETE", auth })).status, 200);
  assert.equal(env.BOARD_KV.dump().has("cloud_backup:google:client"), false);
  assert.equal(env.BOARD_KV.dump().has("cloud_backup:google"), false);
});

test("credentials from Cloudflare variables take priority and cannot be changed in the app", async () => {
  const env = createEnv({ state: stateWith() }, googleClient);
  const auth = await login(env);
  const status = await (await call(env, "/api/cloud-backup/status", { auth })).json() as { providers: Array<Record<string, unknown>> };
  assert.equal(status.providers.find((p) => p.id === "google")!.configuredBy, "env");
  const res = await call(env, "/api/cloud-backup/google/client", { method: "PUT", auth, json: { clientId: "other", clientSecret: "other" } });
  assert.equal(res.status, 409);
});
