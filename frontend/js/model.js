// 数据规范化
import { BOARD_ITEM_DESCRIPTION_MAX_LENGTH, BOARD_TAB_NAME_MAX_LENGTH, MAX_LAYOUT_COLUMN_WIDTH, MAX_LAYOUT_GAP, MAX_MANUAL_COLUMNS, MIN_LAYOUT_COLUMN_WIDTH, MIN_LAYOUT_GAP } from "../../shared/limits";
import {
  BOARD_ACCENTS,
  DEFAULT_BOARD_ICONS,
  DEFAULT_LAYOUT_SETTINGS,
  DEFAULT_TAB_ID,
  DEFAULT_TAB_NAME,
  ICON_NAME_RE,
  LEGACY_ICON_MAP,
  TEXT
} from "./constants.js";
import { clampHeight, uid } from "./dom.js";
import { normalizeItemName } from "./importExport.js";
import { auth, state } from "./state.js";
import { cacheBoardsLocally, pushToBackend } from "./sync.js";

export function normalizeIconName(raw) {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (LEGACY_ICON_MAP[v]) return LEGACY_ICON_MAP[v];
  if (ICON_NAME_RE.test(v)) return v;
  return DEFAULT_BOARD_ICONS[0];
}

export function discoverLucideIcons() {
  const out = new Set();
  Array.from(document.styleSheets).forEach(function (sheet) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch (_) {
      return;
    }
    if (!rules) return;
    Array.from(rules).forEach(function (rule) {
      if (!rule.selectorText) return;
      const m = rule.selectorText.match(/\.icon-([a-z0-9-]+)/g);
      if (!m) return;
      m.forEach(function (sel) { out.add(sel.slice(6)); });
    });
  });
  if (out.size > 50) {
    state.allLucideIcons = Array.from(out).sort();
    return;
  }
  const link = document.querySelector('link[href*="lucide"]');
  if (!link) return;
  fetch(link.href).then(function (r) {
    return r.ok ? r.text() : "";
  }).then(function (text) {
    const matches = text.match(/\.icon-([a-z0-9-]+)/g);
    if (matches) {
      matches.forEach(function (sel) { out.add(sel.slice(6)); });
    }
    state.allLucideIcons = Array.from(out).sort();
  }).catch(function () {});
}

export function normalizeBoards(sourceBoards) {
  return sourceBoards.map(function (board) {
    const tabs = normalizeBoardTabs(board.tabs);
    return {
      id: board.id,
      title: board.title,
      accent: board.accent || BOARD_ACCENTS[0],
      icon: normalizeIconName(board.icon),
      height: clampHeight(board.height),
      collapsed: false,
      column: Number.isInteger(board.column) ? board.column : null,
      displayMode: normalizeDisplayMode(board.displayMode),
      iconSize: normalizeIconSize(board.iconSize),
      tabs: tabs,
      activeTabId: normalizeActiveTabId(board.activeTabId, tabs),
      items: normalizeBoardItems(board.items, tabs)
    };
  });
}

export function normalizeLayoutSettings(value) {
  const input = value && typeof value === "object" ? value : {};
  const columnMode = input.columnMode === "manual" ? "manual" : "auto";
  const columns = Math.min(MAX_MANUAL_COLUMNS, Math.max(1, Number(input.columns) || DEFAULT_LAYOUT_SETTINGS.columns));
  const columnWidth = Math.min(MAX_LAYOUT_COLUMN_WIDTH, Math.max(MIN_LAYOUT_COLUMN_WIDTH, Number(input.columnWidth) || DEFAULT_LAYOUT_SETTINGS.columnWidth));
  const columnGap = Math.min(MAX_LAYOUT_GAP, Math.max(MIN_LAYOUT_GAP, input.columnGap == null ? DEFAULT_LAYOUT_SETTINGS.columnGap : Number(input.columnGap)));
  const rowGap = Math.min(MAX_LAYOUT_GAP, Math.max(MIN_LAYOUT_GAP, input.rowGap == null ? DEFAULT_LAYOUT_SETTINGS.rowGap : Number(input.rowGap)));
  const align = input.align === "center" ? "center" : "left";
  const showBoardIcon = input.showBoardIcon !== false;
  const showBoardCount = input.showBoardCount !== false;
  const showItemDragHandle = input.showItemDragHandle !== false;
  return {
    columnMode: columnMode,
    columns: Math.round(columns),
    columnWidth: Math.round(columnWidth),
    columnGap: Math.round(columnGap),
    rowGap: Math.round(rowGap),
    align: align,
    showBoardIcon: showBoardIcon,
    showBoardCount: showBoardCount,
    showItemDragHandle: showItemDragHandle
  };
}

export function normalizeDisplayMode(mode) {
  return mode === "icons" || mode === "urls" ? mode : "list";
}

export function nextDisplayMode(mode) {
  if (mode === "list") return "icons";
  if (mode === "icons") return "urls";
  return "list";
}

export function displayModeButtonIcon(mode) {
  if (mode === "icons") return "icon-link";
  if (mode === "urls") return "icon-align-justify";
  return "icon-layout-grid";
}

export function normalizeIconSize(size) {
  if (size === "large" || size === "small") return size;
  if (size === "medium") return "medium";
  return "small";
}

export function nextIconSize(size) {
  const current = normalizeIconSize(size);
  if (current === "medium") return "large";
  if (current === "large") return "small";
  return "medium";
}

export function iconSizeButtonIcon(size) {
  if (size === "large") return "icon-maximize-2";
  if (size === "small") return "icon-minimize-2";
  return "icon-scaling";
}

export function iconSizeLabel(size) {
  if (size === "large") return TEXT.iconSizeLarge;
  if (size === "small") return TEXT.iconSizeSmall;
  return TEXT.iconSizeMedium;
}

export function iconSizeTooltip(size) {
  return TEXT.iconSize + "：" + iconSizeLabel(size);
}

export function getBoardIconTileSize(board) {
  const size = normalizeIconSize(board && board.iconSize);
  if (size === "large") return 42;
  if (size === "medium") return 36;
  return 30;
}

export function normalizeBoardTabs(sourceTabs) {
  const tabs = [];
  const seen = new Set();

  function pushTab(id, name) {
    const tabId = typeof id === "string" && id.trim() ? id.trim() : uid("tab");
    if (seen.has(tabId)) return;
    seen.add(tabId);
    tabs.push({
      id: tabId,
      name: typeof name === "string" && name.trim() ? name.trim().slice(0, BOARD_TAB_NAME_MAX_LENGTH) : DEFAULT_TAB_NAME
    });
  }

  if (Array.isArray(sourceTabs)) {
    sourceTabs.forEach(function (tab) {
      if (!tab || typeof tab !== "object") return;
      pushTab(tab.id, tab.name);
    });
  }

  if (!seen.has(DEFAULT_TAB_ID)) {
    tabs.unshift({ id: DEFAULT_TAB_ID, name: DEFAULT_TAB_NAME });
    seen.add(DEFAULT_TAB_ID);
  }

  if (!tabs.length) {
    tabs.push({ id: DEFAULT_TAB_ID, name: DEFAULT_TAB_NAME });
  }

  return tabs;
}

export function normalizeActiveTabId(activeTabId, tabs) {
  const list = Array.isArray(tabs) && tabs.length ? tabs : [{ id: DEFAULT_TAB_ID }];
  const requested = typeof activeTabId === "string" ? activeTabId : "";
  return list.some(function (tab) { return tab.id === requested; }) ? requested : list[0].id;
}

export function normalizeBoardItems(sourceItems, tabs) {
  if (!Array.isArray(sourceItems)) return [];
  const tabIds = new Set((Array.isArray(tabs) ? tabs : []).map(function (tab) {
    return tab.id;
  }));
  return sourceItems.map(function (item) {
    const tabId = typeof item.tabId === "string" && tabIds.has(item.tabId) ? item.tabId : DEFAULT_TAB_ID;
    return {
      id: typeof item.id === "string" && item.id.trim() ? item.id : uid("item"),
      name: typeof item.name === "string" ? normalizeItemName(item.name) : "",
      url: typeof item.url === "string" ? item.url : "",
      icon: typeof item.icon === "string" && item.icon.trim() && ICON_NAME_RE.test(item.icon.trim()) ? normalizeIconName(item.icon) : "",
      description: typeof item.description === "string" ? item.description.slice(0, BOARD_ITEM_DESCRIPTION_MAX_LENGTH) : "",
      tabId: tabId
    };
  });
}

export function saveBoards() {
  if (!auth.isAdmin) {
    return;
  }
  cacheBoardsLocally();
  pushToBackend();
}
