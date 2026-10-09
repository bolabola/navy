// 访客本机的查看偏好：折叠状态、显示模式、图标大小、当前标签页。
// 保存在 localStorage，按 board id 记录；board 被删除或改名后，对不上的记录会被忽略。
//
// - 折叠状态对所有人都只存本机（它纯粹是“怎么看”，从不写入服务器）。
// - 显示模式 / 图标大小 / 当前标签页：管理员的修改照常保存到服务器；
//   未登录访客的修改只存本机，加载时覆盖服务器上的值。
import { normalizeActiveTabId, normalizeDisplayMode, normalizeIconSize } from "./model.js";
import { getBoardTabs } from "./boards.js";

const VIEW_PREFS_KEY = "trello-nav-view-prefs-v1";
const MAX_REMEMBERED_BOARDS = 500;
export const VIEW_FIELDS = ["displayMode", "iconSize", "activeTabId"];

function readPrefs() {
  try {
    const raw = window.localStorage.getItem(VIEW_PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && parsed.boards && typeof parsed.boards === "object") {
      return parsed;
    }
  } catch (error) {
    // localStorage 不可用或内容损坏：当作没有偏好
  }
  return { boards: {} };
}

function writePrefs(prefs) {
  try {
    const ids = Object.keys(prefs.boards);
    if (ids.length > MAX_REMEMBERED_BOARDS) {
      ids.slice(0, ids.length - MAX_REMEMBERED_BOARDS).forEach(function (id) { delete prefs.boards[id]; });
    }
    window.localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(prefs));
  } catch (error) {
    // 隐私模式或存储已满：忽略，只是刷新后不记得
  }
}

function updateEntry(prefs, boardId, changes) {
  const entry = Object.assign({}, prefs.boards[boardId]);
  Object.keys(changes).forEach(function (key) {
    const value = changes[key];
    // 默认值（未折叠）和 undefined 不存，保持记录精简
    if (value === undefined || (key === "collapsed" && value !== true)) {
      delete entry[key];
    } else {
      entry[key] = value;
    }
  });
  if (Object.keys(entry).length) {
    prefs.boards[boardId] = entry;
  } else {
    delete prefs.boards[boardId];
  }
}

/** 记录一个 board 的若干偏好字段；值为 undefined 表示清除该字段。 */
export function rememberBoardView(boardId, changes) {
  if (!boardId) return;
  const prefs = readPrefs();
  updateEntry(prefs, boardId, changes);
  writePrefs(prefs);
}

/** 批量记录折叠状态（“全部折叠 / 恢复状态”）。 */
export function rememberCollapsedStates(boards) {
  const prefs = readPrefs();
  boards.forEach(function (board) {
    updateEntry(prefs, board.id, { collapsed: Boolean(board.collapsed) });
  });
  writePrefs(prefs);
}

/**
 * 把本机偏好叠加到刚加载的 boards 上。
 * includeViewFields 为 false（管理员）时只恢复折叠状态，显示模式等以服务器为准。
 */
export function applyViewPrefs(boards, includeViewFields) {
  const prefs = readPrefs();
  return boards.map(function (board) {
    const entry = prefs.boards[board.id];
    if (!entry) return board;
    const next = Object.assign({}, board);
    if (entry.collapsed === true) next.collapsed = true;
    if (includeViewFields) {
      if (typeof entry.displayMode === "string") next.displayMode = normalizeDisplayMode(entry.displayMode);
      if (typeof entry.iconSize === "string") next.iconSize = normalizeIconSize(entry.iconSize);
      if (typeof entry.activeTabId === "string") {
        const tabs = getBoardTabs(next);
        if (tabs.some(function (tab) { return tab.id === entry.activeTabId; })) {
          next.activeTabId = normalizeActiveTabId(entry.activeTabId, tabs);
        }
      }
    }
    return next;
  });
}
