const BOARD_MAX_COUNT = 100;
const BOARD_MAX_TABS = 100;
const BOARD_MAX_ITEMS_PER_TAB = 500;
const BOARD_MAX_ITEMS = BOARD_MAX_TABS * BOARD_MAX_ITEMS_PER_TAB;
const BOARD_ID_MAX_LENGTH = 128;
const BOARD_TITLE_MAX_LENGTH = 120;
const BOARD_ICON_MAX_LENGTH = 64;
const BOARD_TAB_NAME_MAX_LENGTH = 40;
const BOARD_ITEM_NAME_MAX_LENGTH = 200;
const BOARD_ITEM_DESCRIPTION_MAX_LENGTH = 300;
const BOARD_URL_MAX_LENGTH = 2048;
const MIN_LAYOUT_COLUMN_WIDTH = 220;
const MAX_LAYOUT_COLUMN_WIDTH = 360;
const MAX_MANUAL_COLUMNS = 6;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ICON_NAME_RE = /^[a-z0-9-]+$/;

interface BoardItem {
  id?: unknown;
  name?: unknown;
  url?: unknown;
  icon?: unknown;
  description?: unknown;
  tabId?: unknown;
}

interface BoardTab {
  id?: unknown;
  name?: unknown;
}

interface Board {
  id?: unknown;
  title?: unknown;
  accent?: unknown;
  icon?: unknown;
  height?: unknown;
  collapsed?: unknown;
  column?: unknown;
  displayMode?: unknown;
  tabs?: unknown;
  activeTabId?: unknown;
  items?: unknown;
}

interface LayoutSettings {
  columnMode?: unknown;
  columns?: unknown;
  columnWidth?: unknown;
  align?: unknown;
}

export function validateBoardState(value: unknown): string | null {
  if (!Array.isArray(value)) return "Expected array";
  if (value.length > BOARD_MAX_COUNT) return "Too many boards";

  for (const board of value) {
    const error = validateBoard(board);
    if (error) return error;
  }

  return null;
}

export function validateLayoutSettings(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) return "Invalid layout settings";
  const layout = value as LayoutSettings;
  const columns = layout.columns;
  const columnWidth = layout.columnWidth;
  if (layout.columnMode !== undefined && layout.columnMode !== "auto" && layout.columnMode !== "manual") return "Invalid layout column mode";
  if (
    columns !== undefined &&
    (typeof columns !== "number" || !Number.isInteger(columns) || columns < 1 || columns > MAX_MANUAL_COLUMNS)
  ) return "Invalid layout columns";
  if (
    columnWidth !== undefined &&
    (typeof columnWidth !== "number" || !Number.isInteger(columnWidth) || columnWidth < MIN_LAYOUT_COLUMN_WIDTH || columnWidth > MAX_LAYOUT_COLUMN_WIDTH)
  ) return "Invalid layout column width";
  if (layout.align !== undefined && layout.align !== "left" && layout.align !== "center") return "Invalid layout alignment";
  return null;
}

function validateBoard(value: unknown): string | null {
  if (!isPlainObject(value)) return "Invalid board";
  const board = value as Board;

  if (!isNonEmptyString(board.id, BOARD_ID_MAX_LENGTH)) return "Invalid board id";
  if (!isNonEmptyString(board.title, BOARD_TITLE_MAX_LENGTH)) return "Invalid board title";
  if (board.accent !== undefined && (typeof board.accent !== "string" || !HEX_COLOR_RE.test(board.accent))) return "Invalid board accent";
  if (board.icon !== undefined && (typeof board.icon !== "string" || board.icon.length > BOARD_ICON_MAX_LENGTH || !ICON_NAME_RE.test(board.icon))) return "Invalid board icon";
  if (board.height !== undefined && (typeof board.height !== "number" || !Number.isFinite(board.height))) return "Invalid board height";
  if (board.collapsed !== undefined && typeof board.collapsed !== "boolean") return "Invalid board collapsed flag";
  if (board.column !== undefined && board.column !== null && !Number.isInteger(board.column)) return "Invalid board column";
  if (
    board.displayMode !== undefined &&
    board.displayMode !== "list" &&
    board.displayMode !== "icons" &&
    board.displayMode !== "urls"
  ) return "Invalid board display mode";
  if (board.tabs !== undefined && !Array.isArray(board.tabs)) return "Invalid board tabs";
  if (board.activeTabId !== undefined && (typeof board.activeTabId !== "string" || board.activeTabId.length > BOARD_ID_MAX_LENGTH)) return "Invalid board active tab";
  if (board.items !== undefined && !Array.isArray(board.items)) return "Invalid board items";

  const tabs = Array.isArray(board.tabs) ? board.tabs : [];
  if (tabs.length > BOARD_MAX_TABS) return "Too many board tabs";
  const tabIds = new Set<string>();
  for (const tab of tabs) {
    const error = validateBoardTab(tab);
    if (error) return error;
    const tabId = (tab as BoardTab).id as string;
    if (tabIds.has(tabId)) return "Duplicate board tab id";
    tabIds.add(tabId);
  }
  if (typeof board.activeTabId === "string" && tabIds.size > 0 && !tabIds.has(board.activeTabId)) return "Invalid board active tab";

  const items = Array.isArray(board.items) ? board.items : [];
  if (items.length > BOARD_MAX_ITEMS) return "Too many board items";
  const tabItemCounts = new Map<string, number>();
  for (const item of items) {
    const error = validateBoardItem(item, tabIds);
    if (error) return error;
    const itemTabId = (item as BoardItem).tabId;
    const tabId = typeof itemTabId === "string" ? itemTabId : "default";
    const count = (tabItemCounts.get(tabId) || 0) + 1;
    if (count > BOARD_MAX_ITEMS_PER_TAB) return "Too many board tab items";
    tabItemCounts.set(tabId, count);
  }

  return null;
}

function validateBoardTab(value: unknown): string | null {
  if (!isPlainObject(value)) return "Invalid board tab";
  const tab = value as BoardTab;

  if (!isNonEmptyString(tab.id, BOARD_ID_MAX_LENGTH)) return "Invalid board tab id";
  if (!isNonEmptyString(tab.name, BOARD_TAB_NAME_MAX_LENGTH)) return "Invalid board tab name";

  return null;
}

function validateBoardItem(value: unknown, tabIds: Set<string>): string | null {
  if (!isPlainObject(value)) return "Invalid board item";
  const item = value as BoardItem;

  if (!isNonEmptyString(item.id, BOARD_ID_MAX_LENGTH)) return "Invalid item id";
  if (typeof item.name !== "string" || item.name.length > BOARD_ITEM_NAME_MAX_LENGTH) return "Invalid item name";
  if (typeof item.url !== "string" || !isStoredUrlAllowed(item.url)) return "Invalid item URL";
  if (item.icon !== undefined && (typeof item.icon !== "string" || item.icon.length > BOARD_ICON_MAX_LENGTH || (item.icon.length > 0 && !ICON_NAME_RE.test(item.icon)))) return "Invalid item icon";
  if (item.description !== undefined && (typeof item.description !== "string" || item.description.length > BOARD_ITEM_DESCRIPTION_MAX_LENGTH)) return "Invalid item description";
  if (item.tabId !== undefined && (typeof item.tabId !== "string" || item.tabId.length > BOARD_ID_MAX_LENGTH)) return "Invalid item tab";
  if (typeof item.tabId === "string" && tabIds.size > 0 && !tabIds.has(item.tabId)) return "Invalid item tab";

  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
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
