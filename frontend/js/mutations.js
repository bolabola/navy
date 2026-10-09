// board 数据修改
import { BOARD_TAB_NAME_MAX_LENGTH } from "../../shared/limits";
import { findBoard, getBoardActiveTab, getBoardActiveTabId, getBoardTabs } from "./boards.js";
import { DEFAULT_TAB_ID } from "./constants.js";
import { shouldCollapseAllBoards, syncAllCollapseButton, uid } from "./dom.js";
import { saveBoards } from "./model.js";
import { rerenderBoardInPlace, rerenderBoardWall } from "./render.js";
import { auth, state, uiState } from "./state.js";

export function mutateBoard(boardId, updater) {
  state.boards = state.boards.map(function (board) {
    return board.id === boardId ? updater(board) : board;
  });
  saveBoards();
  rerenderBoardInPlace(boardId);
}

export function mutateBoardUiPreference(boardId, updater) {
  state.boards = state.boards.map(function (board) {
    return board.id === boardId ? updater(board) : board;
  });
  if (auth.isAdmin) {
    saveBoards();
  }
  rerenderBoardInPlace(boardId);
}

export function mutateBoardSessionState(boardId, updater) {
  state.boards = state.boards.map(function (board) {
    return board.id === boardId ? updater(board) : board;
  });
  rerenderBoardInPlace(boardId);
}

export function addBoardTab(boardId, rawName) {
  const name = String(rawName || "").trim().slice(0, BOARD_TAB_NAME_MAX_LENGTH);
  if (!name) return;
  mutateBoard(boardId, function (board) {
    const tab = { id: uid("tab"), name: name };
    return Object.assign({}, board, {
      tabs: getBoardTabs(board).concat(tab),
      activeTabId: tab.id,
      collapsed: false
    });
  });
}

export function renameActiveBoardTab(boardId, rawName) {
  const board = findBoard(boardId);
  const activeTab = getBoardActiveTab(board);
  if (!board || !activeTab) return;
  const name = String(rawName || "").trim().slice(0, BOARD_TAB_NAME_MAX_LENGTH);
  if (!name) return;
  mutateBoard(boardId, function (entry) {
    return Object.assign({}, entry, {
      tabs: getBoardTabs(entry).map(function (tab) {
        return tab.id === activeTab.id ? Object.assign({}, tab, { name: name }) : tab;
      })
    });
  });
}

export function deleteActiveBoardTab(boardId) {
  const board = findBoard(boardId);
  const activeTabId = getBoardActiveTabId(board);
  if (!board) return;
  if (activeTabId === DEFAULT_TAB_ID) {
    window.alert("默认 tab 不能删除。");
    return;
  }
  if (!window.confirm("删除当前 tab？里面的 item 会移动到默认 tab。")) {
    return;
  }
  mutateBoard(boardId, function (entry) {
    return Object.assign({}, entry, {
      tabs: getBoardTabs(entry).filter(function (tab) {
        return tab.id !== activeTabId;
      }),
      activeTabId: DEFAULT_TAB_ID,
      items: entry.items.map(function (item) {
        return item.tabId === activeTabId ? Object.assign({}, item, { tabId: DEFAULT_TAB_ID }) : item;
      })
    });
  });
}

export function rememberAllCollapseSnapshot() {
  uiState.allCollapseSnapshot = state.boards.map(function (board) {
    return {
      id: board.id,
      collapsed: Boolean(board.collapsed)
    };
  });
}

export function restoreAllCollapseSnapshot() {
  const snapshot = uiState.allCollapseSnapshot;
  uiState.allCollapseSnapshot = null;
  if (!snapshot) {
    return;
  }

  const collapsedById = new Map(snapshot.map(function (entry) {
    return [entry.id, entry.collapsed];
  }));

  uiState.openBoardMenuId = null;
  uiState.openAddBoardId = null;
  uiState.editBoardId = null;

  state.boards = state.boards.map(function (board) {
    if (!collapsedById.has(board.id)) {
      return board;
    }

    return Object.assign({}, board, { collapsed: collapsedById.get(board.id) });
  });
  rerenderBoardWall(false);
  syncAllCollapseButton();
}

export function collapseAllBoards() {
  if (!state.boards.length || !shouldCollapseAllBoards()) {
    return;
  }

  rememberAllCollapseSnapshot();
  uiState.openBoardMenuId = null;
  uiState.openAddBoardId = null;
  uiState.editBoardId = null;

  state.boards = state.boards.map(function (board) {
    return Object.assign({}, board, { collapsed: true });
  });
  rerenderBoardWall(false);
  syncAllCollapseButton();
}
