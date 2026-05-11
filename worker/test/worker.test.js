const test = require("node:test");
const assert = require("node:assert/strict");
const worker = require("../../.tmp-test/src/index.js").default;

function createKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async list(options = {}) {
      const prefix = options.prefix || "";
      return {
        keys: Array.from(store.keys())
          .filter((name) => name.startsWith(prefix))
          .sort()
          .map((name) => ({ name }))
      };
    },
    dump() {
      return store;
    }
  };
}

function createEnv(initial = {}, overrides = {}) {
  return {
    BOARD_KV: createKv(initial),
    ADMIN_PASSWORD: "strong-admin-password",
    SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    ASSETS: { fetch: async () => new Response("asset") },
    ...overrides
  };
}

const boardPayload = {
  version: null,
  boards: [{ id: "board-1", title: "Tools", items: [{ id: "item-1", name: "OpenAI", url: "https://openai.com/" }] }]
};

async function login(env) {
  const res = await worker.fetch(new Request("https://example.com/api/login", {
    method: "POST",
    body: JSON.stringify({ password: env.ADMIN_PASSWORD })
  }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.csrfToken, "string");
  const setCookie = res.headers.get("Set-Cookie");
  assert.match(setCookie, /^__Host-board_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\//);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const cookie = setCookie.split(";")[0];
  return { cookie, csrfToken: body.csrfToken };
}

test("worker rejects weak production configuration", async () => {
  const env = createEnv({}, { ADMIN_PASSWORD: "change-me-now" });
  const res = await worker.fetch(new Request("https://example.com/api/auth"), env);
  assert.equal(res.status, 500);
});

test("login fails after repeated bad passwords", async () => {
  const env = createEnv();
  for (let i = 0; i < 5; i += 1) {
    const res = await worker.fetch(new Request("https://example.com/api/login", {
      method: "POST",
      headers: { "CF-Connecting-IP": "203.0.113.10" },
      body: JSON.stringify({ password: "bad" })
    }), env);
    assert.equal(res.status, 401);
  }
  const blocked = await worker.fetch(new Request("https://example.com/api/login", {
    method: "POST",
    headers: { "CF-Connecting-IP": "203.0.113.10" },
    body: JSON.stringify({ password: "bad" })
  }), env);
  assert.equal(blocked.status, 429);
});

test("login has global short-window brute-force limit", async () => {
  const env = createEnv({ "login_fail:global": "50" });
  const blocked = await worker.fetch(new Request("https://example.com/api/login", {
    method: "POST",
    headers: { "CF-Connecting-IP": "203.0.113.200" },
    body: JSON.stringify({ password: "bad" })
  }), env);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("Retry-After"), "60");
});

test("successful login clears global failed-attempt counter", async () => {
  const env = createEnv({ "login_fail:global": "50", "login_fail:203.0.113.20": "2" });
  const res = await worker.fetch(new Request("https://example.com/api/login", {
    method: "POST",
    headers: { "CF-Connecting-IP": "203.0.113.20" },
    body: JSON.stringify({ password: env.ADMIN_PASSWORD })
  }), env);
  assert.equal(res.status, 200);
  assert.equal(env.BOARD_KV.dump().has("login_fail:global"), false);
  assert.equal(env.BOARD_KV.dump().has("login_fail:203.0.113.20"), false);
});

test("PUT /api/board stores state and rejects stale versions", async () => {
  const env = createEnv();
  const { cookie, csrfToken } = await login(env);
  const headers = { Cookie: cookie, "X-CSRF-Token": csrfToken };

  const created = await worker.fetch(new Request("https://example.com/api/board", {
    method: "PUT",
    headers,
    body: JSON.stringify(boardPayload)
  }), env);
  assert.equal(created.status, 200);
  assert.equal((await created.json()).version, 1);

  const stale = await worker.fetch(new Request("https://example.com/api/board", {
    method: "PUT",
    headers,
    body: JSON.stringify(boardPayload)
  }), env);
  assert.equal(stale.status, 409);
});

test("PUT /api/board schedules Google Drive backup when configured", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init });
    if (String(input).includes("oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "access-token" });
    }
    return Response.json({ id: "drive-file-id" });
  };

  try {
    const initialState = JSON.stringify({
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      boards: boardPayload.boards
    });
    const env = createEnv({ state: initialState }, {
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      GOOGLE_REFRESH_TOKEN: "refresh-token",
      GOOGLE_DRIVE_FOLDER_ID: "folder-id"
    });
    const waitUntilTasks = [];
    const ctx = { waitUntil: (promise) => waitUntilTasks.push(promise) };
    const { cookie, csrfToken } = await login(env);
    const res = await worker.fetch(new Request("https://example.com/api/board", {
      method: "PUT",
      headers: { Cookie: cookie, "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ version: 1, boards: boardPayload.boards })
    }), env, ctx);

    assert.equal(res.status, 200);
    assert.equal(waitUntilTasks.length, 1);
    await Promise.all(waitUntilTasks);
    assert.equal(calls.length, 2);
    assert.match(calls[0].input, /oauth2\.googleapis\.com\/token/);
    assert.match(calls[1].input, /googleapis\.com\/upload\/drive\/v3\/files/);
    assert.match(String(calls[1].init.body), /state_backup_/);
    assert.match(String(calls[1].init.body), /folder-id/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Google Drive backup failure does not block board save", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("bad gateway", { status: 502 });

  try {
    const initialState = JSON.stringify({
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      boards: boardPayload.boards
    });
    const env = createEnv({ state: initialState }, {
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      GOOGLE_REFRESH_TOKEN: "refresh-token",
      GOOGLE_DRIVE_FOLDER_ID: "folder-id"
    });
    const waitUntilTasks = [];
    const ctx = { waitUntil: (promise) => waitUntilTasks.push(promise) };
    const { cookie, csrfToken } = await login(env);
    const res = await worker.fetch(new Request("https://example.com/api/board", {
      method: "PUT",
      headers: { Cookie: cookie, "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ version: 1, boards: boardPayload.boards })
    }), env, ctx);

    assert.equal(res.status, 200);
    assert.equal((await res.json()).version, 2);
    assert.equal(waitUntilTasks.length, 1);
    await Promise.all(waitUntilTasks);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("authenticated write requests require CSRF token", async () => {
  const env = createEnv();
  const { cookie, csrfToken } = await login(env);

  const missingCsrf = await worker.fetch(new Request("https://example.com/api/board", {
    method: "PUT",
    headers: { Cookie: cookie },
    body: JSON.stringify(boardPayload)
  }), env);
  assert.equal(missingCsrf.status, 403);

  const wrongCsrf = await worker.fetch(new Request("https://example.com/api/board", {
    method: "PUT",
    headers: { Cookie: cookie, "X-CSRF-Token": "wrong-token" },
    body: JSON.stringify(boardPayload)
  }), env);
  assert.equal(wrongCsrf.status, 403);

  const ok = await worker.fetch(new Request("https://example.com/api/board", {
    method: "PUT",
    headers: { Cookie: cookie, "X-CSRF-Token": csrfToken },
    body: JSON.stringify(boardPayload)
  }), env);
  assert.equal(ok.status, 200);
});

test("write requests reject cross-origin Origin header", async () => {
  const env = createEnv();
  const { cookie, csrfToken } = await login(env);

  const blocked = await worker.fetch(new Request("https://example.com/api/board", {
    method: "PUT",
    headers: {
      Cookie: cookie,
      "X-CSRF-Token": csrfToken,
      Origin: "https://attacker.example"
    },
    body: JSON.stringify(boardPayload)
  }), env);
  assert.equal(blocked.status, 403);

  const allowed = await worker.fetch(new Request("https://example.com/api/board", {
    method: "PUT",
    headers: {
      Cookie: cookie,
      "X-CSRF-Token": csrfToken,
      Origin: "https://example.com"
    },
    body: JSON.stringify(boardPayload)
  }), env);
  assert.equal(allowed.status, 200);
});

test("auth check returns CSRF token only for authenticated sessions", async () => {
  const env = createEnv();
  const anonymous = await worker.fetch(new Request("https://example.com/api/auth"), env);
  assert.deepEqual(await anonymous.json(), { isAdmin: false, csrfToken: null });

  const { cookie, csrfToken } = await login(env);
  const authed = await worker.fetch(new Request("https://example.com/api/auth", {
    headers: { Cookie: cookie }
  }), env);
  assert.deepEqual(await authed.json(), { isAdmin: true, csrfToken });
});

test("authenticated sessions are revoked server-side", async () => {
  const env = createEnv();
  const { cookie, csrfToken } = await login(env);

  const beforeLogout = await worker.fetch(new Request("https://example.com/api/auth", {
    headers: { Cookie: cookie }
  }), env);
  assert.equal((await beforeLogout.json()).isAdmin, true);

  const logout = await worker.fetch(new Request("https://example.com/api/logout", {
    method: "POST",
    headers: { Cookie: cookie, "X-CSRF-Token": csrfToken }
  }), env);
  assert.equal(logout.status, 200);

  const afterLogout = await worker.fetch(new Request("https://example.com/api/auth", {
    headers: { Cookie: cookie }
  }), env);
  assert.deepEqual(await afterLogout.json(), { isAdmin: false, csrfToken: null });
});

test("missing server-side session record invalidates signed cookie", async () => {
  const env = createEnv();
  const { cookie } = await login(env);
  const keys = Array.from(env.BOARD_KV.dump().keys()).filter((key) => key.startsWith("session:"));
  assert.equal(keys.length, 1);
  await env.BOARD_KV.delete(keys[0]);

  const res = await worker.fetch(new Request("https://example.com/api/auth", {
    headers: { Cookie: cookie }
  }), env);
  assert.deepEqual(await res.json(), { isAdmin: false, csrfToken: null });
});

test("changing admin password invalidates existing sessions", async () => {
  const env = createEnv();
  const { cookie, csrfToken } = await login(env);
  env.ADMIN_PASSWORD = "new-strong-admin-password";

  const auth = await worker.fetch(new Request("https://example.com/api/auth", {
    headers: { Cookie: cookie }
  }), env);
  assert.deepEqual(await auth.json(), { isAdmin: false, csrfToken: null });

  const write = await worker.fetch(new Request("https://example.com/api/board", {
    method: "PUT",
    headers: { Cookie: cookie, "X-CSRF-Token": csrfToken },
    body: JSON.stringify(boardPayload)
  }), env);
  assert.equal(write.status, 401);
});

test("backup restore requires auth", async () => {
  const backupState = JSON.stringify({ version: 1, updatedAt: "2026-01-01T00:00:00.000Z", boards: boardPayload.boards });
  const env = createEnv({ "state_backup:2026-01-01T00-00-00-000Z": backupState });
  const res = await worker.fetch(new Request("https://example.com/api/backups/restore", {
    method: "POST",
    body: JSON.stringify({ key: "state_backup:2026-01-01T00-00-00-000Z" })
  }), env);
  assert.equal(res.status, 401);
});

test("logout clears cookie", async () => {
  const env = createEnv();
  const { cookie, csrfToken } = await login(env);
  const res = await worker.fetch(new Request("https://example.com/api/logout", {
    method: "POST",
    headers: { Cookie: cookie, "X-CSRF-Token": csrfToken }
  }), env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Set-Cookie"), /^__Host-board_session=/);
  assert.match(res.headers.get("Set-Cookie"), /Max-Age=0/);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});

test("favicon rejects malformed domains", async () => {
  const env = createEnv();
  const res = await worker.fetch(new Request("https://example.com/api/favicon?d=localhost"), env);
  assert.equal(res.status, 400);
});
