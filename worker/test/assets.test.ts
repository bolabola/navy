import assert from "node:assert/strict";
import { exports } from "cloudflare:workers";
import { test } from "vitest";
import headersFile from "../../src/_headers?raw";
import { SECURITY_HEADERS } from "../src/shared";

// 静态资源命中时不经过 Worker 代码，安全头由 src/_headers 提供；这里保证两处配置一致。
test("_headers declares the same security headers as the Worker", () => {
  const declared = new Map<string, string>();
  for (const line of headersFile.split("\n")) {
    const match = /^\s+([A-Za-z-]+):\s*(.+)$/.exec(line);
    if (match) declared.set(match[1], match[2].trim());
  }
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    assert.equal(declared.get(name), value, name);
  }
  assert.match(headersFile, /^\/\*$/m);
});

test("unknown non-API paths fall through to the assets binding with security headers", async () => {
  const res = await exports.default.fetch("https://example.com/definitely-missing");
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  await res.arrayBuffer();
});

test("index.html is reachable through the assets binding", async () => {
  const res = await exports.default.fetch("https://example.com/");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type") || "", /text\/html/);
  assert.match(res.headers.get("Content-Security-Policy") || "", /default-src 'self'/);
  await res.arrayBuffer();
});
