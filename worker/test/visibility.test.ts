import assert from "node:assert/strict";
import { test } from "vitest";
import { call, createEnv, login } from "./helpers";

const privateBoard = { id: "secret-board", title: "Secret", items: [{ id: "s1", name: "Bank", url: "https://bank.example/" }] };
const publicBoard = { id: "public-board", title: "Public", items: [{ id: "p1", name: "News", url: "https://news.example/" }] };

function pagesPayload(version: number | null, activePageId = "private-page") {
  return {
    version,
    activePageId,
    pages: [
      { id: "private-page", name: "私人", isPublic: false, boards: [privateBoard] },
      { id: "public-page", name: "公开", boards: [publicBoard] }
    ]
  };
}

test("anonymous visitors never receive private pages", async () => {
  const env = createEnv();
  const auth = await login(env);
  assert.equal((await call(env, "/api/board", { method: "PUT", auth, json: pagesPayload(null) })).status, 200);

  const anonymous = await call(env, "/api/board");
  const raw = await anonymous.text();
  assert.equal(raw.includes("secret-board"), false);
  assert.equal(raw.includes("bank.example"), false);
  assert.equal(raw.includes("私人"), false);
  const body = JSON.parse(raw);
  assert.deepEqual(body.pages.map((p: { id: string }) => p.id), ["public-page"]);
  // 当前页是私密页时，访客落到第一个公开页
  assert.equal(body.activePageId, "public-page");
  assert.equal(body.boards[0].id, "public-board");
  assert.equal(body.publicView, true);
  // 公开视图不暴露真实版本号
  assert.equal(body.version, null);

  const admin = await call(env, "/api/board", { headers: { Cookie: auth.cookie } });
  const adminBody = await admin.json() as Record<string, any>;
  assert.deepEqual(adminBody.pages.map((p: { id: string }) => p.id), ["private-page", "public-page"]);
  assert.equal(adminBody.pages[0].isPublic, false);
  assert.equal("isPublic" in adminBody.pages[1], false);
  assert.equal(adminBody.version, 1);
  assert.equal(adminBody.publicView, undefined);
});

test("an invalid cookie gets the public view", async () => {
  const env = createEnv();
  const auth = await login(env);
  await call(env, "/api/board", { method: "PUT", auth, json: pagesPayload(null) });
  const res = await call(env, "/api/board", { headers: { Cookie: "__Host-board_session=forged.token" } });
  assert.equal((await res.text()).includes("secret-board"), false);
});

test("when every page is private visitors get an empty public view", async () => {
  const env = createEnv();
  const auth = await login(env);
  const payload = pagesPayload(null);
  payload.pages[1] = { ...payload.pages[1], isPublic: false };
  await call(env, "/api/board", { method: "PUT", auth, json: payload });
  const body = await (await call(env, "/api/board")).json() as Record<string, any>;
  assert.deepEqual(body.pages, []);
  assert.deepEqual(body.boards, []);
  assert.equal(body.activePageId, null);
  assert.equal(body.publicView, true);
});

test("a save based on the public view is rejected instead of dropping private pages", async () => {
  const env = createEnv();
  const auth = await login(env);
  await call(env, "/api/board", { method: "PUT", auth, json: pagesPayload(null) });
  const publicView = await (await call(env, "/api/board")).json() as Record<string, any>;
  const res = await call(env, "/api/board", {
    method: "PUT",
    auth,
    json: { version: publicView.version, pages: publicView.pages, activePageId: publicView.activePageId }
  });
  assert.equal(res.status, 409);
  const admin = await (await call(env, "/api/board", { headers: { Cookie: auth.cookie } })).json() as Record<string, any>;
  assert.equal(admin.pages.length, 2);
});

test("page visibility is validated and stored compactly", async () => {
  const env = createEnv();
  const auth = await login(env);
  const bad = pagesPayload(null);
  (bad.pages[0] as Record<string, unknown>).isPublic = "no";
  const rejected = await call(env, "/api/board", { method: "PUT", auth, json: bad });
  assert.equal(rejected.status, 400);
  assert.equal(await rejected.text(), "Invalid page visibility");

  const explicitTrue = pagesPayload(null);
  (explicitTrue.pages[1] as Record<string, unknown>).isPublic = true;
  assert.equal((await call(env, "/api/board", { method: "PUT", auth, json: explicitTrue })).status, 200);
  const stored = JSON.parse((await env.BOARD_KV.get("state"))!);
  assert.equal(stored.pages[0].isPublic, false);
  assert.equal("isPublic" in stored.pages[1], false);
});
