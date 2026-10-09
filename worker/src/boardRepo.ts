import { DurableObject } from "cloudflare:workers";
import {
  BACKUP_PREFIX,
  commitState,
  listBackups,
  readBackup,
  readState,
  restoreContent,
  STATE_KEY,
  type BackupEntry,
  type BoardContent,
  type CommitResult,
  type KvLike,
  type StoredState
} from "./boardStore";
import { HttpError, type Env } from "./shared";

export type SaveOutcome =
  | { ok: true; result: CommitResult }
  | { ok: false; conflict: true; currentVersion: number | null };

/** 看板状态的读写入口。路由层只依赖这个接口，不关心底层是 KV 还是 Durable Object。 */
export interface BoardRepo {
  read(): Promise<StoredState | null>;
  readRaw(): Promise<string | null>;
  save(version: number | null, content: BoardContent): Promise<SaveOutcome>;
  restoreBackup(key: string): Promise<CommitResult>;
  restoreContent(content: BoardContent): Promise<CommitResult>;
  listBackups(): Promise<BackupEntry[]>;
}

/** 业务逻辑本体：基于任意 KvLike 存储。 */
class BoardRepoCore implements BoardRepo {
  constructor(
    private readonly store: KvLike,
    private readonly afterCommit: (result: CommitResult) => Promise<void> = async () => {}
  ) {}

  async read() {
    return (await readState(this.store)).state;
  }

  async readRaw() {
    return this.store.get(STATE_KEY);
  }

  async save(version: number | null, content: BoardContent): Promise<SaveOutcome> {
    const current = await readState(this.store);
    const currentVersion = current.state ? current.state.version : null;
    if (version !== currentVersion) return { ok: false, conflict: true, currentVersion };
    const result = await commitState(this.store, current, content);
    await this.afterCommit(result);
    return { ok: true, result };
  }

  async restoreBackup(key: string) {
    const backup = await readBackup(this.store, key);
    return this.restoreContent(backup);
  }

  async restoreContent(content: BoardContent) {
    const result = await restoreContent(this.store, content);
    await this.afterCommit(result);
    return result;
  }

  listBackups() {
    return listBackups(this.store);
  }
}

// ---------------- Durable Object ----------------

const MIGRATED_KEY = "meta:migrated_from_kv";

/** 把 Durable Object 存储包装成 KvLike。DO 存储是强一致的，且同一对象内的请求串行执行。 */
function storageAsKv(storage: DurableObjectStorage): KvLike {
  return {
    async get(key) {
      const value = await storage.get<string>(key);
      return typeof value === "string" ? value : null;
    },
    async put(key, value) {
      await storage.put(key, value);
    },
    async delete(key) {
      await storage.delete(key);
    },
    async list({ prefix }) {
      const entries = await storage.list<string>({ prefix });
      return { keys: Array.from(entries.keys(), (name) => ({ name })) };
    }
  };
}

type RpcResult<T> = { ok: true; value: T } | { ok: false; status: number; message: string };

async function rpc<T>(fn: () => Promise<T>): Promise<RpcResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    if (error instanceof HttpError) return { ok: false, status: error.status, message: error.message };
    throw error;
  }
}

/**
 * 看板状态的权威存储。整个看板只有一个实例（idFromName("board")），
 * 因此“检查版本号 → 写入”天然是原子的，不会出现 KV 最终一致性导致的覆盖。
 * 每次提交后把最新状态镜像写回 KV，供匿名访客在边缘快速读取。
 */
export class BoardStateObject extends DurableObject<Env> {
  private readonly core: BoardRepoCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const store = storageAsKv(ctx.storage);
    this.core = new BoardRepoCore(store, async (result) => {
      await env.BOARD_KV.put(STATE_KEY, JSON.stringify(result.state));
    });
    ctx.blockConcurrencyWhile(() => this.migrateFromKv(store));
  }

  /** 首次启动时把旧版本存放在 KV 里的状态和历史备份搬进来。 */
  private async migrateFromKv(store: KvLike): Promise<void> {
    if (await this.ctx.storage.get(MIGRATED_KEY)) return;
    const kv = this.env.BOARD_KV;
    const state = await kv.get(STATE_KEY);
    const backupKeys = (await kv.list({ prefix: BACKUP_PREFIX })).keys.map((key) => key.name);
    const backups = await Promise.all(backupKeys.map(async (key) => [key, await kv.get(key)] as const));
    if (state) await store.put(STATE_KEY, state);
    for (const [key, value] of backups) {
      if (value) await store.put(key, value);
    }
    await this.ctx.storage.put(MIGRATED_KEY, new Date().toISOString());
    await Promise.all(backupKeys.map((key) => kv.delete(key)));
  }

  read() { return rpc(() => this.core.read()); }
  readRaw() { return rpc(() => this.core.readRaw()); }
  save(version: number | null, content: BoardContent) { return rpc(() => this.core.save(version, content)); }
  restoreBackup(key: string) { return rpc(() => this.core.restoreBackup(key)); }
  restoreContent(content: BoardContent) { return rpc(() => this.core.restoreContent(content)); }
  listBackups() { return rpc(() => this.core.listBackups()); }
}

function unwrap<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new HttpError(result.status, result.message);
  return result.value;
}

class DurableBoardRepo implements BoardRepo {
  constructor(private readonly stub: DurableObjectStub<BoardStateObject>) {}
  async read() { return unwrap(await this.stub.read()) as StoredState | null; }
  async readRaw() { return unwrap(await this.stub.readRaw()); }
  async save(version: number | null, content: BoardContent) { return unwrap(await this.stub.save(version, content)) as SaveOutcome; }
  async restoreBackup(key: string) { return unwrap(await this.stub.restoreBackup(key)) as CommitResult; }
  async restoreContent(content: BoardContent) { return unwrap(await this.stub.restoreContent(content)) as CommitResult; }
  async listBackups() { return unwrap(await this.stub.listBackups()); }
}

/** 管理员读写走 Durable Object（未配置时退回 KV）。 */
export function getBoardRepo(env: Env): BoardRepo {
  if (env.BOARD_STATE) {
    return new DurableBoardRepo(env.BOARD_STATE.get(env.BOARD_STATE.idFromName("board")));
  }
  return new BoardRepoCore(env.BOARD_KV);
}

/** 匿名访客读取 KV 镜像：边缘缓存、延迟低，允许短暂滞后。 */
export function getPublicBoardRepo(env: Env): BoardRepo {
  return new BoardRepoCore(env.BOARD_KV);
}
