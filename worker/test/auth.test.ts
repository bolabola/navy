import assert from "node:assert/strict";
import { test } from "vitest";
import { boardPayload, call, createEnv, login } from "./helpers";

test("worker rejects weak production configuration", async () => {
  const env = createEnv({}, { ADMIN_PASSWORD: "change-me-now" });
  const res = await call(env, "/api/auth");
  assert.equal(res.status, 500);
});

test("session secret is generated once and reused when SESSION_SECRET is not set", async () => {
  const env = createEnv({}, { SESSION_SECRET: undefined });
  assert.equal((await call(env, "/api/auth")).status, 200);
  const auth = await login(env);
  const generated = env.BOARD_KV.dump().get("meta:session_secret");
  assert.ok(generated && /^[0-9a-f]{64}$/.test(generated));

  const check = await call(env, "/api/auth", { headers: { Cookie: auth.cookie } });
  assert.equal((await check.json() as { isAdmin: boolean }).isAdmin, true);
  await login(env);
  assert.equal(env.BOARD_KV.dump().get("meta:session_secret"), generated);
});

test("worker rejects the placeholder secrets from .dev.vars.example", async () => {
  const password = createEnv({}, { ADMIN_PASSWORD: "replace-with-your-admin-password" });
  assert.equal((await call(password, "/api/auth")).status, 500);
  const secret = createEnv({}, { SESSION_SECRET: "replace-with-at-least-32-random-characters" });
  assert.equal((await call(secret, "/api/auth")).status, 500);
});

test("login sets a hardened session cookie", async () => {
  const env = createEnv();
  const res = await call(env, "/api/login", { method: "POST", json: { password: env.ADMIN_PASSWORD } });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get("Set-Cookie")!;
  assert.match(setCookie, /^__Host-board_session=/);
  for (const flag of [/HttpOnly/, /Secure/, /SameSite=Strict/, /Path=\//]) assert.match(setCookie, flag);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});

test("login fails after repeated bad passwords", async () => {
  const env = createEnv();
  const headers = { "CF-Connecting-IP": "203.0.113.10" };
  for (let i = 0; i < 5; i += 1) {
    const res = await call(env, "/api/login", { method: "POST", headers, json: { password: "bad" } });
    assert.equal(res.status, 401);
  }
  const blocked = await call(env, "/api/login", { method: "POST", headers, json: { password: "bad" } });
  assert.equal(blocked.status, 429);
});

test("login rejects passwords that only share a prefix", async () => {
  const env = createEnv();
  const res = await call(env, "/api/login", { method: "POST", json: { password: env.ADMIN_PASSWORD + "x" } });
  assert.equal(res.status, 401);
  const nonString = await call(env, "/api/login", { method: "POST", json: { password: 123 } });
  assert.equal(nonString.status, 401);
});

test("login has global short-window brute-force limit", async () => {
  const env = createEnv({ "login_fail:global": "50" });
  const blocked = await call(env, "/api/login", {
    method: "POST",
    headers: { "CF-Connecting-IP": "203.0.113.200" },
    json: { password: "bad" }
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("Retry-After"), "60");
});

test("successful login clears failed-attempt counters", async () => {
  const env = createEnv({ "login_fail:global": "50", "login_fail:203.0.113.20": "2" });
  const res = await call(env, "/api/login", {
    method: "POST",
    headers: { "CF-Connecting-IP": "203.0.113.20" },
    json: { password: env.ADMIN_PASSWORD }
  });
  assert.equal(res.status, 200);
  assert.equal(env.BOARD_KV.dump().has("login_fail:global"), false);
  assert.equal(env.BOARD_KV.dump().has("login_fail:203.0.113.20"), false);
});

test("successful login without failures does not issue deletes", async () => {
  const env = createEnv();
  await login(env);
  assert.equal(env.BOARD_KV.ops.deletes, 0);
});

test("authenticated write requests require CSRF token", async () => {
  const env = createEnv();
  const auth = await login(env);
  const missing = await call(env, "/api/board", { method: "PUT", headers: { Cookie: auth.cookie }, json: boardPayload });
  assert.equal(missing.status, 403);
  const wrong = await call(env, "/api/board", { method: "PUT", auth: { ...auth, csrfToken: "wrong" }, json: boardPayload });
  assert.equal(wrong.status, 403);
  const ok = await call(env, "/api/board", { method: "PUT", auth, json: boardPayload });
  assert.equal(ok.status, 200);
});

test("a write request reads the session from KV only once", async () => {
  const env = createEnv();
  const auth = await login(env);
  const before = env.BOARD_KV.ops.reads;
  await call(env, "/api/board", { method: "PUT", auth, json: boardPayload });
  // 1 次 session + 1 次 state
  assert.equal(env.BOARD_KV.ops.reads - before, 2);
});

test("write requests reject cross-origin Origin header", async () => {
  const env = createEnv();
  const auth = await login(env);
  const blocked = await call(env, "/api/board", { method: "PUT", auth, headers: { Origin: "https://attacker.example" }, json: boardPayload });
  assert.equal(blocked.status, 403);
  const allowed = await call(env, "/api/board", { method: "PUT", auth, headers: { Origin: "https://example.com" }, json: boardPayload });
  assert.equal(allowed.status, 200);
});

test("auth check returns CSRF token only for authenticated sessions", async () => {
  const env = createEnv();
  const anonymous = await call(env, "/api/auth");
  assert.deepEqual(await anonymous.json(), { isAdmin: false, csrfToken: null });
  const auth = await login(env);
  const authed = await call(env, "/api/auth", { headers: { Cookie: auth.cookie } });
  assert.deepEqual(await authed.json(), { isAdmin: true, csrfToken: auth.csrfToken });
});

test("sessions are revoked server-side on logout", async () => {
  const env = createEnv();
  const auth = await login(env);
  const logout = await call(env, "/api/logout", { method: "POST", auth });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("Set-Cookie")!, /Max-Age=0/);
  const after = await call(env, "/api/auth", { headers: { Cookie: auth.cookie } });
  assert.deepEqual(await after.json(), { isAdmin: false, csrfToken: null });
});

test("missing server-side session record invalidates signed cookie", async () => {
  const env = createEnv();
  const auth = await login(env);
  const keys = Array.from(env.BOARD_KV.dump().keys()).filter((key) => key.startsWith("session:"));
  assert.equal(keys.length, 1);
  await env.BOARD_KV.delete(keys[0]);
  const res = await call(env, "/api/auth", { headers: { Cookie: auth.cookie } });
  assert.deepEqual(await res.json(), { isAdmin: false, csrfToken: null });
});

test("changing admin password invalidates existing sessions", async () => {
  const env = createEnv();
  const auth = await login(env);
  env.ADMIN_PASSWORD = "new-strong-admin-password";
  const check = await call(env, "/api/auth", { headers: { Cookie: auth.cookie } });
  assert.deepEqual(await check.json(), { isAdmin: false, csrfToken: null });
  const write = await call(env, "/api/board", { method: "PUT", auth, json: boardPayload });
  assert.equal(write.status, 401);
});

test("router returns 405 with Allow header and 404 for unknown routes", async () => {
  const env = createEnv();
  const res = await call(env, "/api/board", { method: "DELETE" });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("Allow"), "GET, PUT");
  assert.equal((await call(env, "/api/nope")).status, 404);
  assert.equal((await call(env, "/api/cloud-backup/%E0%A4%A/connect", { method: "POST" })).status, 400);
});

test("API responses carry security headers", async () => {
  const env = createEnv();
  const res = await call(env, "/api/auth");
  assert.match(res.headers.get("Content-Security-Policy")!, /default-src 'self'/);
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
});
