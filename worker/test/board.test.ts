import assert from "node:assert/strict";
import { test } from "vitest";
import { BACKUP_KEEP_COUNT, BACKUP_MIN_INTERVAL_MS } from "../src/boardStore";
import { board, boardPayload, call, createEnv, login, stateWith } from "./helpers";

test("PUT /api/board stores state and rejects stale versions", async () => {
  const env = createEnv();
  const auth = await login(env);

  const created = await call(env, "/api/board", { method: "PUT", auth, json: boardPayload });
  assert.equal(created.status, 200);
  const createdBody = await created.json() as Record<string, unknown>;
  assert.equal(createdBody.version, 1);
  assert.equal(createdBody.backupKey, null);

  const stored = JSON.parse((await env.BOARD_KV.get("state"))!);
  assert.deepEqual(stored.layout, boardPayload.layout);
  assert.deepEqual(stored.pages, boardPayload.pages);
  assert.equal(stored.activePageId, "page-1");
  // 有 pages 时不再重复存储 boards
  assert.deepEqual(stored.boards, []);

  const stale = await call(env, "/api/board", { method: "PUT", auth, json: boardPayload });
  assert.equal(stale.status, 409);
});

test("GET /api/board derives boards from the active page for clients", async () => {
  const env = createEnv({
    state: stateWith({
      boards: [],
      activePageId: "p2",
      pages: [
        { id: "p1", name: "One", boards: [{ id: "b1", title: "B1" }] },
        { id: "p2", name: "Two", boards: [{ id: "b2", title: "B2" }] }
      ],
      lastBackupAt: "2026-01-01T00:00:00.000Z"
    })
  });
  const res = await call(env, "/api/board");
  const body = await res.json() as Record<string, any>;
  assert.equal(body.boards[0].id, "b2");
  assert.equal("lastBackupAt" in body, false);
});

test("legacy payload with both boards and pages is still accepted", async () => {
  const env = createEnv();
  const auth = await login(env);
  const res = await call(env, "/api/board", { method: "PUT", auth, json: { ...boardPayload, boards: [board] } });
  assert.equal(res.status, 200);
});

test("unknown fields are stripped and iconSize is validated", async () => {
  const env = createEnv();
  const auth = await login(env);
  const payload = {
    version: null,
    boards: [{ ...board, iconSize: "large", collapsed: true, evil: "<script>", items: [{ ...board.items[0], extra: 1 }] }]
  };
  const res = await call(env, "/api/board", { method: "PUT", auth, json: payload });
  assert.equal(res.status, 200);
  const stored = JSON.parse((await env.BOARD_KV.get("state"))!);
  assert.equal(stored.boards[0].iconSize, "large");
  assert.equal("evil" in stored.boards[0], false);
  assert.equal("collapsed" in stored.boards[0], false);
  assert.equal("extra" in stored.boards[0].items[0], false);

  const bad = await call(env, "/api/board", {
    method: "PUT",
    auth,
    json: { version: 1, boards: [{ ...board, iconSize: "huge" }] }
  });
  assert.equal(bad.status, 400);
  assert.equal(await bad.text(), "Invalid board icon size");
});

test("oversized and malformed bodies are rejected", async () => {
  const env = createEnv();
  const auth = await login(env);
  const malformed = await call(env, "/api/board", { method: "PUT", auth, body: "{not json" });
  assert.equal(malformed.status, 400);
  const huge = await call(env, "/api/board", { method: "PUT", auth, body: JSON.stringify({ version: null, boards: [], pad: "x".repeat(1024 * 1024) }) });
  assert.equal(huge.status, 413);
});

test("saves are cheap: backup is throttled to one per interval", async () => {
  const env = createEnv({ state: stateWith() });
  const auth = await login(env);
  const kv = env.BOARD_KV;

  // 第一次保存：旧状态没有 lastBackupAt，立即备份
  let res = await call(env, "/api/board", { method: "PUT", auth, json: { version: 1, boards: [board] } });
  let body = await res.json() as Record<string, any>;
  assert.match(body.backupKey, /^state_backup:/);
  assert.equal(typeof body.lastBackupAt, "string");

  // 紧接着的多次保存：不再备份，每次只有 1 次 KV 写入、0 次 list
  for (let version = 2; version < 6; version += 1) {
    const before = { ...kv.ops };
    res = await call(env, "/api/board", { method: "PUT", auth, json: { version, boards: [board] } });
    body = await res.json() as Record<string, any>;
    assert.equal(res.status, 200);
    assert.equal(body.backupKey, null);
    assert.equal(kv.ops.writes - before.writes, 1);
    assert.equal(kv.ops.lists - before.lists, 0);
    assert.equal(kv.ops.deletes - before.deletes, 0);
  }
  const backups = Array.from(kv.dump().keys()).filter((key) => key.startsWith("state_backup:"));
  assert.equal(backups.length, 1);

  // 超过间隔后再次保存：重新备份
  const stored = JSON.parse((await kv.get("state"))!);
  stored.lastBackupAt = new Date(Date.now() - BACKUP_MIN_INTERVAL_MS - 1000).toISOString();
  kv.dump().set("state", JSON.stringify(stored));
  res = await call(env, "/api/board", { method: "PUT", auth, json: { version: stored.version, boards: [board] } });
  body = await res.json() as Record<string, any>;
  assert.match(body.backupKey, /^state_backup:/);
});

test("backups are pruned to the configured count", async () => {
  const initial: Record<string, string> = { state: stateWith() };
  for (let i = 0; i < BACKUP_KEEP_COUNT + 3; i += 1) {
    initial[`state_backup:2020-01-01T00-00-${String(i).padStart(2, "0")}-000Z`] = stateWith();
  }
  const env = createEnv(initial);
  const auth = await login(env);
  const res = await call(env, "/api/board", { method: "PUT", auth, json: { version: 1, boards: [board] } });
  assert.equal(res.status, 200);
  const backups = Array.from(env.BOARD_KV.dump().keys()).filter((key) => key.startsWith("state_backup:"));
  assert.equal(backups.length, BACKUP_KEEP_COUNT);
  assert.equal(backups.includes("state_backup:2020-01-01T00-00-00-000Z"), false);
});

test("restoring a KV backup always backs up the current state first", async () => {
  const backupKey = "state_backup:2026-01-01T00-00-00-000Z";
  const env = createEnv({
    state: stateWith({ lastBackupAt: new Date().toISOString(), boards: [{ id: "current", title: "Current" }] }),
    [backupKey]: stateWith({ boards: [{ id: "old", title: "Old" }] })
  });
  const auth = await login(env);

  const list = await call(env, "/api/backups", { auth });
  const listBody = await list.json() as { backups: Array<{ key: string; createdAt: string }> };
  assert.deepEqual(listBody.backups, [{ key: backupKey, createdAt: "2026-01-01T00:00:00.000Z" }]);

  const res = await call(env, "/api/backups/restore", { method: "POST", auth, json: { key: backupKey } });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, any>;
  assert.equal(body.version, 2);
  assert.match(body.backupKey, /^state_backup:/);
  assert.equal(JSON.parse((await env.BOARD_KV.get(body.backupKey))!).boards[0].id, "current");
  const state = await (await call(env, "/api/board")).json() as Record<string, any>;
  assert.equal(state.boards[0].id, "old");

  const invalid = await call(env, "/api/backups/restore", { method: "POST", auth, json: { key: "state" } });
  assert.equal(invalid.status, 400);
  const missing = await call(env, "/api/backups/restore", { method: "POST", auth, json: { key: "state_backup:nope" } });
  assert.equal(missing.status, 404);
});

test("backup restore requires auth", async () => {
  const env = createEnv({ "state_backup:2026-01-01T00-00-00-000Z": stateWith() });
  const res = await call(env, "/api/backups/restore", { method: "POST", json: { key: "state_backup:2026-01-01T00-00-00-000Z" } });
  assert.equal(res.status, 401);
});

test("corrupt stored state returns 500 instead of crashing", async () => {
  const env = createEnv({ state: "{broken" });
  const res = await call(env, "/api/board");
  assert.equal(res.status, 500);
});
