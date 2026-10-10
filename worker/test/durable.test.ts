import assert from "node:assert/strict";
import { env, exports } from "cloudflare:workers";
import { test } from "vitest";

// 集成测试：真实的 Durable Object + KV 绑定，走完整的 Worker 入口。
const ORIGIN = "https://example.com";

async function login() {
  const res = await exports.default.fetch(ORIGIN + "/api/login", {
    method: "POST",
    body: JSON.stringify({ password: "strong-admin-password" })
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { csrfToken: string };
  return { Cookie: res.headers.get("Set-Cookie")!.split(";")[0], "X-CSRF-Token": body.csrfToken };
}

const page = (title: string) => ({
  activePageId: "p1",
  pages: [{ id: "p1", name: "Home", boards: [{ id: "b1", title, items: [] }] }]
});

test("writes go through the Durable Object and are mirrored to KV", async () => {
  const headers = await login();
  const current = await (await exports.default.fetch(ORIGIN + "/api/board", { headers })).json() as { version: number } | null;
  const version = current ? current.version : null;

  const saved = await exports.default.fetch(ORIGIN + "/api/board", {
    method: "PUT",
    headers,
    body: JSON.stringify({ version, ...page("Saved") })
  });
  assert.equal(saved.status, 200);
  const savedBody = await saved.json() as { version: number };
  assert.equal(savedBody.version, (version ?? 0) + 1);

  // 两个并发写入基于同一版本号：只能有一个成功
  const [a, b] = await Promise.all(["A", "B"].map((title) => exports.default.fetch(ORIGIN + "/api/board", {
    method: "PUT",
    headers,
    body: JSON.stringify({ version: savedBody.version, ...page(title) })
  })));
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  await a.arrayBuffer(); await b.arrayBuffer();

  // 管理员读到的是 DO 中的权威数据
  const adminView = await (await exports.default.fetch(ORIGIN + "/api/board", { headers })).json() as Record<string, any>;
  assert.equal(adminView.version, savedBody.version + 1);
  // KV 镜像同步更新，匿名访客可以读到
  const mirror = JSON.parse((await env.BOARD_KV.get("state"))!);
  assert.equal(mirror.version, adminView.version);
  const publicView = await (await exports.default.fetch(ORIGIN + "/api/board")).json() as Record<string, any>;
  assert.equal(publicView.boards[0].title, adminView.boards[0].title);
});

test("a fresh Durable Object imports existing state and backups from KV", async () => {
  const legacyState = JSON.stringify({ version: 7, updatedAt: "2025-01-01T00:00:00.000Z", boards: [{ id: "legacy", title: "Legacy" }] });
  await env.BOARD_KV.put("state", legacyState);
  await env.BOARD_KV.put("state_backup:2025-01-01T00-00-00-000Z", legacyState);

  const stub = env.BOARD_STATE!.get(env.BOARD_STATE!.idFromName("migration-test"));
  const read = await stub.read();
  assert.ok(read.ok);
  assert.equal((read.value as { version: number }).version, 7);
  const backups = await stub.listBackups();
  assert.ok(backups.ok);
  assert.deepEqual(backups.value.map((b) => b.key), ["state_backup:2025-01-01T00-00-00-000Z"]);
  // 已搬迁的备份从 KV 中删除，避免两边不一致
  assert.equal(await env.BOARD_KV.get("state_backup:2025-01-01T00-00-00-000Z"), null);
});

test("the Durable Object generates the session secret only once", async () => {
  const stub = env.BOARD_STATE!.get(env.BOARD_STATE!.idFromName("session-secret-test"));
  const [a, b] = await Promise.all([stub.getSessionSecret(), stub.getSessionSecret()]);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, b);
  assert.equal(await stub.getSessionSecret(), a);
});
