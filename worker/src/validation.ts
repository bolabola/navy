import {
  BOARD_DISPLAY_MODES,
  BOARD_ICON_MAX_LENGTH,
  BOARD_ICON_SIZES,
  BOARD_ID_MAX_LENGTH,
  BOARD_ITEM_DESCRIPTION_MAX_LENGTH,
  BOARD_ITEM_NAME_MAX_LENGTH,
  BOARD_MAX_COUNT,
  BOARD_MAX_ITEMS,
  BOARD_MAX_ITEMS_PER_TAB,
  BOARD_MAX_TABS,
  BOARD_TAB_NAME_MAX_LENGTH,
  BOARD_TITLE_MAX_LENGTH,
  BOARD_URL_MAX_LENGTH,
  HEX_COLOR_PATTERN,
  ICON_NAME_PATTERN,
  MAX_BOARD_HEIGHT,
  MAX_LAYOUT_COLUMN_WIDTH,
  MAX_LAYOUT_GAP,
  MAX_MANUAL_COLUMNS,
  MIN_BOARD_HEIGHT,
  MIN_LAYOUT_COLUMN_WIDTH,
  MIN_LAYOUT_GAP,
  PAGE_ID_MAX_LENGTH,
  PAGE_MAX_COUNT,
  PAGE_NAME_MAX_LENGTH
} from "../../shared/limits";
import { isPlainObject } from "./shared";

const HEX_COLOR_RE = new RegExp(HEX_COLOR_PATTERN);
const ICON_NAME_RE = new RegExp(ICON_NAME_PATTERN);

type Obj = Record<string, unknown>;

export interface CleanBoardItem {
  id: string;
  name: string;
  url: string;
  icon?: string;
  description?: string;
  tabId?: string;
}

export interface CleanBoardTab {
  id: string;
  name: string;
}

export interface CleanBoard {
  id: string;
  title: string;
  accent?: string;
  icon?: string;
  height?: number;
  column?: number | null;
  displayMode?: string;
  iconSize?: string;
  tabs?: CleanBoardTab[];
  activeTabId?: string;
  items?: CleanBoardItem[];
}

export interface CleanPage {
  id: string;
  name: string;
  boards: CleanBoard[];
}

export interface CleanLayout {
  columnMode?: "auto" | "manual";
  columns?: number;
  columnWidth?: number;
  columnGap?: number;
  rowGap?: number;
  align?: "left" | "center";
  showBoardIcon?: boolean;
  showBoardCount?: boolean;
  showItemDragHandle?: boolean;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: string): Result<T> => ({ ok: false, error });

// ---- 公开的校验接口（只返回错误信息，兼容旧调用） ----

export function validateBoardState(value: unknown): string | null {
  const result = cleanBoards(value);
  return result.ok ? null : result.error;
}

export function validatePagesState(value: unknown): string | null {
  const result = cleanPages(value);
  return result.ok ? null : result.error;
}

export function validateLayoutSettings(value: unknown): string | null {
  const result = cleanLayout(value);
  return result.ok ? null : result.error;
}

// ---- 校验并按白名单清洗：未知字段会被丢弃，合法值原样保留 ----

export function cleanBoards(value: unknown): Result<CleanBoard[]> {
  if (!Array.isArray(value)) return fail("Expected array");
  if (value.length > BOARD_MAX_COUNT) return fail("Too many boards");

  const boards: CleanBoard[] = [];
  for (const entry of value) {
    const result = cleanBoard(entry);
    if (!result.ok) return result;
    boards.push(result.value);
  }
  return ok(boards);
}

export function cleanPages(value: unknown): Result<CleanPage[] | undefined> {
  if (value === undefined || value === null) return ok(undefined);
  if (!Array.isArray(value)) return fail("Invalid pages");
  if (value.length > PAGE_MAX_COUNT) return fail("Too many pages");

  const pageIds = new Set<string>();
  const pages: CleanPage[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) return fail("Invalid page");
    if (!isNonEmptyString(entry.id, PAGE_ID_MAX_LENGTH)) return fail("Invalid page id");
    if (pageIds.has(entry.id)) return fail("Duplicate page id");
    pageIds.add(entry.id);
    if (!isNonEmptyString(entry.name, PAGE_NAME_MAX_LENGTH)) return fail("Invalid page name");
    if (!Array.isArray(entry.boards)) return fail("Invalid page boards");
    const boards = cleanBoards(entry.boards);
    if (!boards.ok) return boards;
    pages.push({ id: entry.id, name: entry.name, boards: boards.value });
  }
  return ok(pages);
}

export function cleanLayout(value: unknown): Result<CleanLayout | undefined> {
  if (value === undefined || value === null) return ok(undefined);
  if (!isPlainObject(value)) return fail("Invalid layout settings");
  const layout: CleanLayout = {};

  if (value.columnMode !== undefined) {
    if (value.columnMode !== "auto" && value.columnMode !== "manual") return fail("Invalid layout column mode");
    layout.columnMode = value.columnMode;
  }
  const intFields: Array<[keyof CleanLayout, number, number, string]> = [
    ["columns", 1, MAX_MANUAL_COLUMNS, "Invalid layout columns"],
    ["columnWidth", MIN_LAYOUT_COLUMN_WIDTH, MAX_LAYOUT_COLUMN_WIDTH, "Invalid layout column width"],
    ["columnGap", MIN_LAYOUT_GAP, MAX_LAYOUT_GAP, "Invalid layout column gap"],
    ["rowGap", MIN_LAYOUT_GAP, MAX_LAYOUT_GAP, "Invalid layout row gap"]
  ];
  for (const [field, min, max, error] of intFields) {
    const raw = value[field];
    if (raw === undefined) continue;
    if (!isIntInRange(raw, min, max)) return fail(error);
    (layout as Obj)[field] = raw;
  }
  if (value.align !== undefined) {
    if (value.align !== "left" && value.align !== "center") return fail("Invalid layout alignment");
    layout.align = value.align;
  }
  const boolFields: Array<[keyof CleanLayout, string]> = [
    ["showBoardIcon", "Invalid layout board icon visibility"],
    ["showBoardCount", "Invalid layout board count visibility"],
    ["showItemDragHandle", "Invalid layout item drag handle visibility"]
  ];
  for (const [field, error] of boolFields) {
    const raw = value[field];
    if (raw === undefined) continue;
    if (typeof raw !== "boolean") return fail(error);
    (layout as Obj)[field] = raw;
  }
  return ok(layout);
}

export function cleanActivePageId(value: unknown): Result<string | null | undefined> {
  if (value === undefined || value === null) return ok(value as null | undefined);
  if (typeof value !== "string" || value.length > PAGE_ID_MAX_LENGTH) return fail("Invalid active page id");
  return ok(value);
}

function cleanBoard(value: unknown): Result<CleanBoard> {
  if (!isPlainObject(value)) return fail("Invalid board");
  const b = value;

  if (!isNonEmptyString(b.id, BOARD_ID_MAX_LENGTH)) return fail("Invalid board id");
  if (!isNonEmptyString(b.title, BOARD_TITLE_MAX_LENGTH)) return fail("Invalid board title");
  const board: CleanBoard = { id: b.id, title: b.title };

  if (b.accent !== undefined) {
    if (typeof b.accent !== "string" || !HEX_COLOR_RE.test(b.accent)) return fail("Invalid board accent");
    board.accent = b.accent;
  }
  if (b.icon !== undefined) {
    if (typeof b.icon !== "string" || b.icon.length > BOARD_ICON_MAX_LENGTH || !ICON_NAME_RE.test(b.icon)) return fail("Invalid board icon");
    board.icon = b.icon;
  }
  if (b.height !== undefined) {
    if (typeof b.height !== "number" || !Number.isFinite(b.height)) return fail("Invalid board height");
    board.height = Math.min(MAX_BOARD_HEIGHT, Math.max(MIN_BOARD_HEIGHT, b.height));
  }
  // collapsed 只是视图状态，接受但不存储（前端加载时总是展开）。
  if (b.collapsed !== undefined && typeof b.collapsed !== "boolean") return fail("Invalid board collapsed flag");
  if (b.column !== undefined) {
    if (b.column !== null && !Number.isInteger(b.column)) return fail("Invalid board column");
    board.column = b.column as number | null;
  }
  if (b.displayMode !== undefined) {
    if (!(BOARD_DISPLAY_MODES as readonly unknown[]).includes(b.displayMode)) return fail("Invalid board display mode");
    board.displayMode = b.displayMode as string;
  }
  if (b.iconSize !== undefined) {
    if (!(BOARD_ICON_SIZES as readonly unknown[]).includes(b.iconSize)) return fail("Invalid board icon size");
    board.iconSize = b.iconSize as string;
  }
  if (b.tabs !== undefined && !Array.isArray(b.tabs)) return fail("Invalid board tabs");
  if (b.activeTabId !== undefined && (typeof b.activeTabId !== "string" || b.activeTabId.length > BOARD_ID_MAX_LENGTH)) return fail("Invalid board active tab");
  if (b.items !== undefined && !Array.isArray(b.items)) return fail("Invalid board items");

  const rawTabs = Array.isArray(b.tabs) ? b.tabs : [];
  if (rawTabs.length > BOARD_MAX_TABS) return fail("Too many board tabs");
  const tabIds = new Set<string>();
  const tabs: CleanBoardTab[] = [];
  for (const tab of rawTabs) {
    if (!isPlainObject(tab)) return fail("Invalid board tab");
    if (!isNonEmptyString(tab.id, BOARD_ID_MAX_LENGTH)) return fail("Invalid board tab id");
    if (!isNonEmptyString(tab.name, BOARD_TAB_NAME_MAX_LENGTH)) return fail("Invalid board tab name");
    if (tabIds.has(tab.id)) return fail("Duplicate board tab id");
    tabIds.add(tab.id);
    tabs.push({ id: tab.id, name: tab.name });
  }
  if (typeof b.activeTabId === "string" && tabIds.size > 0 && !tabIds.has(b.activeTabId)) return fail("Invalid board active tab");
  if (b.tabs !== undefined) board.tabs = tabs;
  if (b.activeTabId !== undefined) board.activeTabId = b.activeTabId as string;

  const rawItems = Array.isArray(b.items) ? b.items : [];
  if (rawItems.length > BOARD_MAX_ITEMS) return fail("Too many board items");
  const tabItemCounts = new Map<string, number>();
  const items: CleanBoardItem[] = [];
  for (const entry of rawItems) {
    const result = cleanBoardItem(entry, tabIds);
    if (!result.ok) return result;
    const tabId = result.value.tabId ?? "default";
    const count = (tabItemCounts.get(tabId) || 0) + 1;
    if (count > BOARD_MAX_ITEMS_PER_TAB) return fail("Too many board tab items");
    tabItemCounts.set(tabId, count);
    items.push(result.value);
  }
  if (b.items !== undefined) board.items = items;

  return ok(board);
}

function cleanBoardItem(value: unknown, tabIds: Set<string>): Result<CleanBoardItem> {
  if (!isPlainObject(value)) return fail("Invalid board item");
  const i = value;

  if (!isNonEmptyString(i.id, BOARD_ID_MAX_LENGTH)) return fail("Invalid item id");
  if (typeof i.name !== "string" || i.name.length > BOARD_ITEM_NAME_MAX_LENGTH) return fail("Invalid item name");
  if (typeof i.url !== "string" || !isStoredUrlAllowed(i.url)) return fail("Invalid item URL");
  const item: CleanBoardItem = { id: i.id, name: i.name, url: i.url };

  if (i.icon !== undefined) {
    if (typeof i.icon !== "string" || i.icon.length > BOARD_ICON_MAX_LENGTH || (i.icon.length > 0 && !ICON_NAME_RE.test(i.icon))) return fail("Invalid item icon");
    item.icon = i.icon;
  }
  if (i.description !== undefined) {
    if (typeof i.description !== "string" || i.description.length > BOARD_ITEM_DESCRIPTION_MAX_LENGTH) return fail("Invalid item description");
    item.description = i.description;
  }
  if (i.tabId !== undefined) {
    if (typeof i.tabId !== "string" || i.tabId.length > BOARD_ID_MAX_LENGTH) return fail("Invalid item tab");
    if (tabIds.size > 0 && !tabIds.has(i.tabId)) return fail("Invalid item tab");
    item.tabId = i.tabId;
  }
  return ok(item);
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function isStoredUrlAllowed(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > BOARD_URL_MAX_LENGTH || /\s/.test(trimmed)) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^https?:/i.test(trimmed)) return false;

  try {
    const parsed = new URL(toHttpUrlForValidation(trimmed));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function toHttpUrlForValidation(raw: string): string {
  if (/^\/\//.test(raw)) return "https:" + raw;
  if (/^[a-z][a-z\d+.-]*:/i.test(raw)) return raw;
  return "https://" + raw;
}
