// board / 标签页查询
import { BOARD_ACCENTS, DEFAULT_BOARD_ICONS, DEFAULT_TAB_ID, DEFAULT_TAB_NAME } from "./constants.js";
import { normalizeActiveTabId } from "./model.js";
import { state } from "./state.js";

export function nextBoardAccent() {
  return BOARD_ACCENTS[state.boards.length % BOARD_ACCENTS.length];
}

export function nextBoardIcon() {
  return DEFAULT_BOARD_ICONS[state.boards.length % DEFAULT_BOARD_ICONS.length];
}

export function findBoard(boardId) {
  return state.boards.find(function (board) {
    return board.id === boardId;
  });
}

export function getBoardTabs(board) {
  return Array.isArray(board && board.tabs) && board.tabs.length
    ? board.tabs
    : [{ id: DEFAULT_TAB_ID, name: DEFAULT_TAB_NAME }];
}

export function getBoardActiveTabId(board) {
  const tabs = getBoardTabs(board);
  return normalizeActiveTabId(board && board.activeTabId, tabs);
}

export function getBoardActiveTab(board) {
  const tabs = getBoardTabs(board);
  const activeTabId = getBoardActiveTabId(board);
  return tabs.find(function (tab) {
    return tab.id === activeTabId;
  }) || tabs[0];
}

export function getBoardItemsForTab(board, tabId) {
  const activeTabId = tabId || getBoardActiveTabId(board);
  return (Array.isArray(board && board.items) ? board.items : []).filter(function (item) {
    return (item.tabId || DEFAULT_TAB_ID) === activeTabId;
  });
}

export function getBoardItemsForActiveTab(board) {
  return getBoardItemsForTab(board, getBoardActiveTabId(board));
}

export function shouldShowBoardTabs(board) {
  const tabs = getBoardTabs(board);
  return tabs.length > 1;
}
