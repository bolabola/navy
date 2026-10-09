import {
  backupSuffixToIso,
  HttpError,
  isoToBackupSuffix,
  isPlainObject,
  type Env
} from "./shared";
import {
  cleanActivePageId,
  cleanBoards,
  cleanLayout,
  cleanPages,
  type CleanBoard,
  type CleanLayout,
  type CleanPage
} from "./validation";

export const STATE_KEY = "state";
export const BACKUP_PREFIX = "state_backup:";
/** KV 历史备份保留份数。 */
export const BACKUP_KEEP_COUNT = 20;
/**
 * 两次自动备份的最小间隔。连续编辑期间只在第一次保存时备份一次“编辑前”的状态，
 * 之后每隔这么久最多再备份一次，避免每次保存都产生 KV 写入和 list 操作。
 */
export const BACKUP_MIN_INTERVAL_MS = 10 * 60 * 1000;

export interface BoardContent {
  boards: CleanBoard[];
  pages?: CleanPage[];
  activePageId?: string | null;
  layout?: CleanLayout;
}

export interface StoredState extends BoardContent {
  version: number;
  updatedAt: string;
  /** 最近一次 KV 历史备份的时间（ISO）。 */
  lastBackupAt?: string;
}

export interface CurrentState {
  raw: string | null;
  state: StoredState | null;
}

export interface CommitResult {
  state: StoredState;
  backupKey: string | null;
}

/**
 * 校验并清洗一份看板内容。
 * 有 pages 时以 pages 为准，boards 由当前页推导，不再要求客户端重复发送。
 */
export function cleanBoardContent(input: {
  boards?: unknown;
  pages?: unknown;
  activePageId?: unknown;
  layout?: unknown;
}): BoardContent | string {
  const pages = cleanPages(input.pages);
  if (!pages.ok) return pages.error;
  const layout = cleanLayout(input.layout);
  if (!layout.ok) return layout.error;
  const activePageId = cleanActivePageId(input.activePageId);
  if (!activePageId.ok) return activePageId.error;

  let boards: CleanBoard[];
  if (input.boards !== undefined) {
    const cleaned = cleanBoards(input.boards);
    if (!cleaned.ok) return cleaned.error;
    boards = cleaned.value;
  } else if (pages.value && pages.value.length) {
    boards = [];
  } else {
    return "Expected board state payload";
  }

  const content: BoardContent = { boards };
  if (pages.value !== undefined) content.pages = pages.value;
  if (activePageId.value !== undefined) content.activePageId = activePageId.value;
  if (layout.value !== undefined) content.layout = layout.value;
  return normalizeContent(content);
}

/** 有 pages 时，存储里不再保留重复的 boards（读取时按当前页推导）。 */
function normalizeContent(content: BoardContent): BoardContent {
  if (content.pages && content.pages.length) {
    return { ...content, boards: [] };
  }
  return content;
}

/** 给客户端的视图：补齐当前页的 boards，兼容旧前端。 */
export function toClientState(state: StoredState): Omit<StoredState, "lastBackupAt"> {
  const { lastBackupAt: _ignored, ...rest } = state;
  return { ...rest, boards: activeBoards(state) };
}

export function activeBoards(content: BoardContent): CleanBoard[] {
  if (content.pages && content.pages.length) {
    const active = content.pages.find((page) => page.id === content.activePageId) || content.pages[0];
    return active.boards;
  }
  return content.boards;
}

export function parseStoredBoardState(raw: string): StoredState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  // 最早的存储格式：直接是 boards 数组。
  if (Array.isArray(parsed)) {
    const boards = cleanBoards(parsed);
    return boards.ok ? { version: 0, updatedAt: "", boards: boards.value } : null;
  }

  if (!isPlainObject(parsed)) return null;
  const { version, updatedAt, lastBackupAt } = parsed;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) return null;
  if (typeof updatedAt !== "string") return null;

  const content = cleanBoardContent({
    boards: Array.isArray(parsed.boards) ? parsed.boards : parsed.pages ? undefined : parsed.boards,
    pages: parsed.pages,
    activePageId: parsed.activePageId,
    layout: parsed.layout
  });
  if (typeof content === "string") return null;

  const state: StoredState = { version, updatedAt, ...content };
  if (typeof lastBackupAt === "string") state.lastBackupAt = lastBackupAt;
  return state;
}

export async function readState(env: Env): Promise<CurrentState> {
  const raw = await env.BOARD_KV.get(STATE_KEY);
  if (!raw) return { raw: null, state: null };
  const state = parseStoredBoardState(raw);
  if (!state) throw new HttpError(500, "Stored board state is invalid");
  return { raw, state };
}

/**
 * 写入新状态。必要时先把旧状态写成历史备份：
 * - forceBackup（恢复备份等破坏性操作）总是备份；
 * - 普通保存距离上次备份超过 BACKUP_MIN_INTERVAL_MS 才备份。
 */
export async function commitState(
  env: Env,
  current: CurrentState,
  content: BoardContent,
  options: { forceBackup?: boolean; now?: Date } = {}
): Promise<CommitResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const previous = current.state;

  let backupKey: string | null = null;
  let lastBackupAt = previous?.lastBackupAt;
  if (current.raw && previous && shouldBackup(previous, now, options.forceBackup === true)) {
    backupKey = BACKUP_PREFIX + isoToBackupSuffix(nowIso);
    await env.BOARD_KV.put(backupKey, current.raw);
    lastBackupAt = nowIso;
  }

  const state: StoredState = {
    version: previous ? previous.version + 1 : 1,
    updatedAt: nowIso,
    ...normalizeContent(content)
  };
  if (lastBackupAt) state.lastBackupAt = lastBackupAt;

  await env.BOARD_KV.put(STATE_KEY, JSON.stringify(state));
  if (backupKey) await pruneBackups(env);
  return { state, backupKey };
}

function shouldBackup(previous: StoredState, now: Date, force: boolean): boolean {
  if (force) return true;
  if (!previous.lastBackupAt) return true;
  const last = Date.parse(previous.lastBackupAt);
  return !Number.isFinite(last) || now.getTime() - last >= BACKUP_MIN_INTERVAL_MS;
}

export interface BackupEntry {
  key: string;
  createdAt: string;
}

export async function listBackups(env: Env): Promise<BackupEntry[]> {
  const listed = await env.BOARD_KV.list({ prefix: BACKUP_PREFIX });
  return listed.keys
    .map((key) => ({ key: key.name, createdAt: backupSuffixToIso(key.name.slice(BACKUP_PREFIX.length)) }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

async function pruneBackups(env: Env): Promise<void> {
  const stale = (await listBackups(env)).slice(BACKUP_KEEP_COUNT);
  await Promise.all(stale.map((entry) => env.BOARD_KV.delete(entry.key)));
}

export async function readBackup(env: Env, key: string): Promise<StoredState> {
  if (!key.startsWith(BACKUP_PREFIX)) throw new HttpError(400, "Invalid backup key");
  const raw = await env.BOARD_KV.get(key);
  if (!raw) throw new HttpError(404, "Backup not found");
  const state = parseStoredBoardState(raw);
  if (!state) throw new HttpError(500, "Backup is invalid");
  return state;
}

/** 用一份备份内容覆盖当前状态（总是先备份当前状态）。 */
export async function restoreContent(env: Env, backup: BoardContent): Promise<CommitResult> {
  const current = await readState(env);
  return commitState(env, current, {
    boards: backup.boards,
    pages: backup.pages,
    activePageId: backup.activePageId,
    layout: backup.layout
  }, { forceBackup: true });
}
