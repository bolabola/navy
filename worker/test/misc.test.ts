import assert from "node:assert/strict";
import { test } from "vitest";
import { sniffImageType } from "../src/miscRoutes";
import { call, createCtx, createEnv, login, mockCache, mockFetch } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const png = (marker: number) => new Uint8Array([...PNG, marker]);

test("url titles returns title and description metadata", async () => {
  const calls = mockFetch(() => new Response(
    "<!doctype html><html><head><title>Example &amp; Tools</title><meta name=\"description\" content=\"Helpful board links &amp; references\"></head></html>",
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  ));
  const env = createEnv();
  const auth = await login(env);
  const res = await call(env, "/api/url-titles", { method: "POST", auth, json: { urls: ["example.com/tools"] } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), [{ url: "https://example.com/tools", title: "Example & Tools", description: "Helpful board links & references" }]);
  assert.deepEqual(calls.map((c) => c.url), ["https://example.com/tools"]);
});

test("url titles rejects private targets and unsafe redirects", async () => {
  mockFetch((url) => url === "https://example.com/r"
    ? new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/admin" } })
    : new Response("<title>secret</title>", { headers: { "Content-Type": "text/html" } }));
  const env = createEnv();
  const auth = await login(env);
  const priv = await call(env, "/api/url-titles", { method: "POST", auth, json: { urls: ["http://10.0.0.1/"] } });
  assert.equal(priv.status, 400);
  const redirected = await call(env, "/api/url-titles", { method: "POST", auth, json: { urls: ["https://example.com/r"] } });
  assert.deepEqual(await redirected.json(), [{ url: "https://example.com/r", title: null, description: null }]);
});

test("favicon rejects malformed domains", async () => {
  const res = await call(createEnv(), "/api/favicon?d=localhost");
  assert.equal(res.status, 400);
});

test("favicon refresh bypasses the cache only for admins", async () => {
  mockCache();
  let n = 0;
  mockFetch((url) => {
    if (url === "https://example.com/") return new Response("<html></html>", { headers: { "Content-Type": "text/html" } });
    if (url.includes("google.com/s2/favicons")) { n += 1; return new Response(png(n), { headers: { "Content-Type": "image/png" } }); }
    return new Response(null, { status: 404 });
  });
  const env = createEnv();
  const marker = async (res: Response) => new Uint8Array(await res.arrayBuffer()).at(-1);

  const first = await call(env, "/api/favicon?d=example.com");
  assert.equal(first.headers.get("Content-Type"), "image/png");
  assert.equal(await marker(first), 1);

  // 匿名 refresh、以及附加随机参数都命中缓存
  assert.equal(await marker(await call(env, "/api/favicon?d=example.com&refresh=1")), 1);
  assert.equal(await marker(await call(env, "/api/favicon?d=EXAMPLE.com&bust=123")), 1);
  assert.equal(n, 1);

  const auth = await login(env);
  const refreshed = await call(env, "/api/favicon?d=example.com&refresh=1", { headers: { Cookie: auth.cookie } });
  assert.equal(await marker(refreshed), 2);
  assert.equal(await marker(await call(env, "/api/favicon?d=example.com")), 2);
});

test("favicon prefers declared icon links over aggregators", async () => {
  mockCache();
  mockFetch((url) => {
    if (url === "https://custom.example/") {
      return new Response('<html><head><link rel="icon" href="@/assets/img/nav_icon_g.png"></head></html>', { headers: { "Content-Type": "text/html" } });
    }
    if (url === "https://custom.example/assets/img/nav_icon_g.png") return new Response(png(7), { headers: { "Content-Type": "application/octet-stream" } });
    if (url.includes("google.com")) return new Response(png(9), { headers: { "Content-Type": "image/png" } });
    return new Response(null, { status: 404 });
  });
  const res = await call(createEnv(), "/api/favicon?d=custom.example");
  assert.equal(res.status, 200);
  // octet-stream 也能通过文件头识别为 PNG
  assert.equal(res.headers.get("Content-Type"), "image/png");
  assert.equal(new Uint8Array(await res.arrayBuffer()).at(-1), 7);
});

test("favicon rejects non-image and oversized upstream bodies", async () => {
  mockCache();
  mockFetch((url) => {
    if (url === "https://bad.example/") {
      return new Response('<link rel="icon" href="/a.png"><link rel="icon" href="/big.png">', { headers: { "Content-Type": "text/html" } });
    }
    if (url.endsWith("/a.png")) return new Response("<script>alert(1)</script>", { headers: { "Content-Type": "image/png" } });
    if (url.endsWith("/big.png")) return new Response(new Uint8Array(300 * 1024).fill(0x89), { headers: { "Content-Type": "image/png" } });
    return new Response(null, { status: 404 });
  });
  const res = await call(createEnv(), "/api/favicon?d=bad.example");
  assert.equal(res.headers.get("X-Favicon-Fallback"), "1");
});

test("SVG favicons are served with a locked-down CSP", async () => {
  mockCache();
  mockFetch((url) => {
    if (url === "https://svg.example/") return new Response('<link rel="icon" href="/i.svg">', { headers: { "Content-Type": "text/html" } });
    if (url.endsWith("/i.svg")) return new Response('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', { headers: { "Content-Type": "image/svg+xml" } });
    return new Response(null, { status: 404 });
  });
  const res = await call(createEnv(), "/api/favicon?d=svg.example");
  assert.equal(res.headers.get("Content-Type"), "image/svg+xml");
  assert.match(res.headers.get("Content-Security-Policy")!, /default-src 'none'/);
  assert.match(res.headers.get("Content-Security-Policy")!, /sandbox/);
});

test("favicon returns a cacheable fallback when upstream sources fail", async () => {
  mockCache();
  const calls = mockFetch(() => new Response("no icon", { status: 404 }));
  const env = createEnv();
  const { ctx, settle } = createCtx();
  const first = await call(env, "/api/favicon?d=missing.example", {}, ctx);
  await settle();
  assert.equal(first.headers.get("X-Favicon-Fallback"), "1");
  assert.match(first.headers.get("Content-Type")!, /image\/svg\+xml/);
  assert.match(await first.text(), /<svg[^>]*width="1"[^>]*height="1"/);
  assert.equal(calls.length, 4);

  const cached = await call(env, "/api/favicon?d=missing.example");
  assert.equal(cached.headers.get("X-Favicon-Fallback"), "1");
  assert.equal(calls.length, 4);
});

test("sniffImageType recognises common icon formats", () => {
  assert.equal(sniffImageType(PNG, ""), "image/png");
  assert.equal(sniffImageType(new Uint8Array([0, 0, 1, 0, 1]), "application/octet-stream"), "image/x-icon");
  assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "text/plain"), "image/jpeg");
  assert.equal(sniffImageType(new TextEncoder().encode("<svg></svg>"), "image/svg+xml"), "image/svg+xml");
  assert.equal(sniffImageType(new TextEncoder().encode("<svg></svg>"), "text/html"), null);
  assert.equal(sniffImageType(new TextEncoder().encode("<html>"), "image/png"), null);
});
