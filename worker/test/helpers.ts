import assert from "node:assert/strict";
import { afterEach, beforeEach, vi } from "vitest";
import worker from "../src/index";
import { clearAccessTokenCache } from "../src/cloudProviders";
import type { Env } from "../src/shared";

export { worker };

export interface MockKv extends KVNamespace {
  dump(): Map<string, string>;
  ops: { reads: number; writes: number; deletes: number; lists: number };
}

/** 内存 KV，记录各类操作次数，便于断言 KV 额度消耗。 */
export function createKv(initial: Record<string, string> = {}): MockKv {
  const store = new Map(Object.entries(initial));
  const ops = { reads: 0, writes: 0, deletes: 0, lists: 0 };
  const kv = {
    ops,
    async get(key: string) {
      ops.reads += 1;
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string) {
      ops.writes += 1;
      store.set(key, value);
    },
    async delete(key: string) {
      ops.deletes += 1;
      store.delete(key);
    },
    async list(options: { prefix?: string } = {}) {
      ops.lists += 1;
      const prefix = options.prefix || "";
      return {
        keys: Array.from(store.keys()).filter((name) => name.startsWith(prefix)).sort().map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null
      };
    },
    dump() {
      return store;
    }
  };
  return kv as unknown as MockKv;
}

export type TestEnv = Env & { BOARD_KV: MockKv };

export function createEnv(initial: Record<string, string> = {}, overrides: Partial<Env> = {}): TestEnv {
  return {
    BOARD_KV: createKv(initial),
    ADMIN_PASSWORD: "strong-admin-password",
    SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher,
    ...overrides
  } as TestEnv;
}

export function createCtx() {
  const tasks: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => { tasks.push(promise); },
    passThroughOnException: () => {},
    props: {}
  } as unknown as ExecutionContext;
  return { ctx, tasks, settle: () => Promise.all(tasks) };
}

export const board = { id: "board-1", title: "Tools", items: [{ id: "item-1", name: "OpenAI", url: "https://openai.com/" }] };

export const boardPayload = {
  version: null as number | null,
  layout: { columnMode: "manual", columns: 3, columnWidth: 280, columnGap: 14, rowGap: 18, align: "center", showBoardIcon: false, showBoardCount: true, showItemDragHandle: false },
  activePageId: "page-1",
  pages: [{ id: "page-1", name: "Home", boards: [board] }]
};

export function stateWith(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 1, updatedAt: "2026-01-01T00:00:00.000Z", boards: [board], ...fields });
}

export async function login(env: Env): Promise<{ cookie: string; csrfToken: string }> {
  const res = await worker.fetch(new Request("https://example.com/api/login", {
    method: "POST",
    body: JSON.stringify({ password: env.ADMIN_PASSWORD })
  }), env, createCtx().ctx);
  assert.equal(res.status, 200);
  const body = await res.json() as { ok: boolean; csrfToken: string };
  assert.equal(body.ok, true);
  const setCookie = res.headers.get("Set-Cookie")!;
  return { cookie: setCookie.split(";")[0], csrfToken: body.csrfToken };
}

export async function call(env: Env, path: string, init: RequestInit & { auth?: { cookie: string; csrfToken: string }; json?: unknown } = {}, ctx?: ExecutionContext): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.auth) {
    headers.set("Cookie", init.auth.cookie);
    headers.set("X-CSRF-Token", init.auth.csrfToken);
  }
  const body = init.json !== undefined ? JSON.stringify(init.json) : init.body;
  return worker.fetch(new Request("https://example.com" + path, { ...init, headers, body }), env, ctx ?? createCtx().ctx);
}

type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** 拦截出站 fetch，返回调用记录。 */
export function mockFetch(handler: FetchHandler) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  });
  return calls;
}

/** 用内存 Map 代替 caches.default。 */
export function mockCache() {
  const store = new Map<string, Response>();
  vi.stubGlobal("caches", {
    default: {
      async match(request: Request) {
        const cached = store.get(request.url);
        return cached ? cached.clone() : undefined;
      },
      async put(request: Request, response: Response) {
        store.set(request.url, response.clone());
      }
    }
  });
  return store;
}

beforeEach(() => {
  clearAccessTokenCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
