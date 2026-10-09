// 本地缓存、API 请求与保存同步
import { confirmDialog } from "./dialog.js";
import { PAGE_MAX_COUNT, PAGE_NAME_MAX_LENGTH } from "../../shared/limits";
import { pickNewerLocalLastBackup, renderBackupMenu } from "./backup.js";
import { API_BASE, DEFAULT_PAGE_ID, SAVE_DEBOUNCE_MS, STORAGE_KEY, TEXT, defaultBoards } from "./constants.js";
import { uid } from "./dom.js";
import { normalizeBoards, normalizeLayoutSettings } from "./model.js";
import { render } from "./render.js";
import { applyViewPrefs } from "./viewPrefs.js";
import { app, auth, serverState, state, syncState, uiState } from "./state.js";

export function loadBoardsFromLocal() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      const fallbackPages = normalizePages(null, defaultBoards);
      return { boards: normalizeBoards(defaultBoards), pages: fallbackPages, activePageId: fallbackPages[0].id, hadData: false };
    }
    const parsed = JSON.parse(saved);
    const envelope = readBoardEnvelope(parsed);
    if (!envelope) {
      const fallbackPages = normalizePages(null, defaultBoards);
      return { boards: normalizeBoards(defaultBoards), pages: fallbackPages, activePageId: fallbackPages[0].id, hadData: false };
    }
    const parsedPages = normalizePages(envelope.pages, envelope.boards);
    return {
      boards: normalizeBoards(envelope.boards),
      pages: parsedPages,
      activePageId: normalizeActivePageId(envelope.activePageId, parsedPages),
      layout: normalizeLayoutSettings(envelope.layout),
      hadData: envelope.boards.length > 0 || parsedPages.some(function (page) { return page.boards.length > 0; })
    };
  } catch (error) {
    const fallbackPages = normalizePages(null, defaultBoards);
    return { boards: normalizeBoards(defaultBoards), pages: fallbackPages, activePageId: fallbackPages[0].id, hadData: false };
  }
}

export function cacheBoardsLocally() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(boardStatePayload()));
  } catch (error) {
    // localStorage 满或隐私模式 - 忽略
  }
}

export function boardStatePayload() {
  syncActivePageBoards();
  return {
    boards: boardStoragePayload(),
    pages: pageStoragePayload(),
    activePageId: state.activePageId,
    layout: layoutStoragePayload()
  };
}

export function boardStoragePayload(sourceBoards) {
  return (sourceBoards || state.boards).map(function (board) {
    const copy = Object.assign({}, board);
    delete copy.collapsed;
    return copy;
  });
}

export function boardMemoryPayload(sourceBoards) {
  return (sourceBoards || state.boards).map(function (board) {
    return Object.assign({}, board);
  });
}

export function pageStoragePayload() {
  return state.pages.map(function (page) {
    return {
      id: page.id,
      name: page.name,
      boards: boardStoragePayload(page.boards)
    };
  });
}

export function layoutStoragePayload() {
  return {
    columnMode: state.layoutSettings.columnMode,
    columns: state.layoutSettings.columns,
    columnWidth: state.layoutSettings.columnWidth,
    columnGap: state.layoutSettings.columnGap,
    rowGap: state.layoutSettings.rowGap,
    align: state.layoutSettings.align,
    showBoardIcon: state.layoutSettings.showBoardIcon,
    showBoardCount: state.layoutSettings.showBoardCount,
    showItemDragHandle: state.layoutSettings.showItemDragHandle
  };
}

export function apiGet(path) {
  return fetch(API_BASE + path, { credentials: "same-origin", cache: "no-store" }).then(function (res) {
    if (!res.ok) {
      const err = new Error("API " + path + " " + res.status);
      err.status = res.status;
      throw err;
    }
    return res.json();
  });
}

export function apiSend(path, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (auth.csrfToken) {
    headers["X-CSRF-Token"] = auth.csrfToken;
  }
  return fetch(API_BASE + path, {
    method: method,
    credentials: "same-origin",
    headers: headers,
    body: body == null ? null : JSON.stringify(body)
  }).then(function (res) {
    if (!res.ok) {
      return res.text().then(function (text) {
        const err = new Error("API " + path + " " + res.status);
        err.status = res.status;
        err.responseText = text;
        throw err;
      });
    }
    return res.json();
  });
}

export function handleAuthExpired() {
  auth.isAdmin = false;
  auth.csrfToken = null;
  uiState.dataMenuOpen = false;
  uiState.backupMenuOpen = false;
  uiState.layoutMenuOpen = false;
  uiState.openBoardMenuId = null;
  uiState.openAddBoardId = null;
  uiState.editBoardId = null;
  uiState.editItemId = null;
  uiState.createBoardOpen = false;
  state.boards = applyViewPrefs(state.boards, true);
  render();
}

export function loadServerBoardState() {
  return apiGet("/board").then(function (value) {
    const boardData = readBoardEnvelope(value);
    if (boardData && Array.isArray(boardData.boards)) {
      serverState.version = boardData.version;
      serverState.updatedAt = boardData.updatedAt;
      applyBoardEnvelope(boardData);
      cacheBoardsLocally();
      return true;
    }
    if (value === null) {
      serverState.version = null;
      serverState.updatedAt = "";
      return false;
    }
    return false;
  });
}

export function readBoardEnvelope(value) {
  if (Array.isArray(value)) {
    return { boards: value, version: null, updatedAt: "" };
  }
  if (value && typeof value === "object" && Array.isArray(value.boards)) {
    return {
      boards: value.boards,
      pages: Array.isArray(value.pages) ? value.pages : null,
      activePageId: typeof value.activePageId === "string" ? value.activePageId : null,
      layout: value.layout,
      version: Number.isInteger(value.version) ? value.version : null,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : ""
    };
  }
  return null;
}

export function normalizePageName(name, fallback) {
  const value = typeof name === "string" ? name.trim().slice(0, PAGE_NAME_MAX_LENGTH) : "";
  if (value) return value;
  if (fallback !== undefined) return fallback;
  return TEXT.pageDefault;
}

export function normalizePages(sourcePages, fallbackBoards) {
  const rawPages = Array.isArray(sourcePages) ? sourcePages : [];
  const normalized = rawPages.slice(0, PAGE_MAX_COUNT).map(function (page, index) {
    const rawBoards = Array.isArray(page && page.boards) ? page.boards : [];
    return {
      id: typeof page.id === "string" && page.id.trim() ? page.id : uid("page"),
      name: normalizePageName(page.name, index === 0 ? TEXT.pageDefault : "页面 " + (index + 1)),
      boards: normalizeBoards(rawBoards)
    };
  }).filter(function (page) {
    return page.id && page.name;
  });

  if (normalized.length) {
    return normalized;
  }

  return [{
    id: DEFAULT_PAGE_ID,
    name: TEXT.pageDefault,
    boards: normalizeBoards(Array.isArray(fallbackBoards) ? fallbackBoards : defaultBoards)
  }];
}

export function normalizeActivePageId(pageId, sourcePages) {
  const list = Array.isArray(sourcePages) && sourcePages.length ? sourcePages : state.pages;
  if (typeof pageId === "string" && list.some(function (page) { return page.id === pageId; })) {
    return pageId;
  }
  return list[0] ? list[0].id : DEFAULT_PAGE_ID;
}

export function syncActivePageBoards() {
  state.pages = state.pages.map(function (page) {
    return page.id === state.activePageId
      ? Object.assign({}, page, { boards: normalizeBoards(boardMemoryPayload()) })
      : page;
  });
}

export function loadActivePageBoards() {
  const page = state.pages.find(function (entry) { return entry.id === state.activePageId; }) || state.pages[0];
  // 叠加访客本机的查看偏好（折叠状态；未登录时还包括显示模式、图标大小、当前标签页）。
  state.boards = applyViewPrefs(normalizeBoards(page ? page.boards : defaultBoards), !auth.isAdmin);
}

export function applyBoardEnvelope(boardData) {
  const nextPages = normalizePages(boardData.pages, boardData.boards);
  state.pages = nextPages;
  state.activePageId = normalizeActivePageId(boardData.activePageId, nextPages);
  loadActivePageBoards();
  state.layoutSettings = normalizeLayoutSettings(boardData.layout);
}

export function pushToBackend() {
  if (!auth.isAdmin) {
    return;
  }
  state.savePending = true;
  if (state.saveTimer) {
    window.clearTimeout(state.saveTimer);
  }
  setSyncState("saving", TEXT.syncSaving);
  state.saveTimer = window.setTimeout(function () {
    state.saveTimer = null;
    flushPendingSave();
  }, SAVE_DEBOUNCE_MS);
}

export function flushPendingSave() {
  if (!auth.isAdmin || state.saveInFlight || !state.savePending) {
    return;
  }

  state.savePending = false;
  state.saveInFlight = true;
  const payloadVersion = serverState.version;
  syncActivePageBoards();

  // 只发送 pages：当前页的 boards 已包含在 pages 里，后端会按 activePageId 推导，避免数据重复一倍。
  apiSend("/board", "PUT", {
    version: payloadVersion,
    pages: pageStoragePayload(),
    activePageId: state.activePageId,
    layout: layoutStoragePayload()
  }).then(function (result) {
    if (result && Number.isInteger(result.version)) {
      serverState.version = result.version;
      serverState.updatedAt = typeof result.updatedAt === "string" ? result.updatedAt : serverState.updatedAt;
    }
    noteBackupFromCommit(result);
    setSyncState("saved", TEXT.syncSaved);
  }).catch(function (error) {
      if (error && error.status === 401) {
        auth.isAdmin = false;
        auth.csrfToken = null;
        state.savePending = false;
        if (state.saveTimer) {
          window.clearTimeout(state.saveTimer);
          state.saveTimer = null;
        }
        uiState.dataMenuOpen = false;
        uiState.backupMenuOpen = false;
        uiState.layoutMenuOpen = false;
        uiState.backupStatus = null;
        uiState.localLastBackup = null;
        uiState.openBoardMenuId = null;
        uiState.openAddBoardId = null;
        uiState.editBoardId = null;
        uiState.layoutMenuOpen = false;
        uiState.createBoardOpen = false;
        setSyncState("failed", TEXT.syncLoginExpired);
        render();
        return;
      }
      if (error && error.status === 409) {
        state.savePending = false;
        setSyncState("failed", TEXT.syncConflict);
        handleSaveConflict();
        return;
      }
      setSyncState("failed", TEXT.syncFailed);
      console.warn("Sync to backend failed:", error);
  }).finally(function () {
    state.saveInFlight = false;
    if (state.savePending && auth.isAdmin) {
      setSyncState("saving", TEXT.syncSaving);
      if (state.saveTimer) {
        window.clearTimeout(state.saveTimer);
      }
      state.saveTimer = window.setTimeout(function () {
        state.saveTimer = null;
        flushPendingSave();
      }, SAVE_DEBOUNCE_MS);
    }
  });
}

export function setSyncState(status, message) {
  syncState.status = status;
  syncState.message = message || "";
  updateSyncIndicator();
}

export /** 保存 / 恢复接口返回的 lastBackupAt 就是最近一次 KV 历史备份时间，直接更新菜单，无需轮询。 */
function noteBackupFromCommit(result) {
  if (result && typeof result.lastBackupAt === "string") {
    uiState.localLastBackup = pickNewerLocalLastBackup(uiState.localLastBackup, {
      status: "success",
      at: result.lastBackupAt,
      key: "state_backup:" + result.lastBackupAt.replace(/[:.]/g, "-")
    });
  }
  updateBackupMenu();
}

export function handleSaveConflict() {
  cacheBoardsLocally();
  confirmDialog({
    title: "远端数据已更新",
    message: TEXT.syncConflictConfirm,
    confirmText: "加载远端版本",
    cancelText: "保留本地版本"
  }).then(function (ok) {
    if (!ok) return;
    loadServerBoardState().then(function () {
      render();
    }).catch(function (error) {
      console.warn("Reload remote board failed:", error);
    });
  });
}

export function updateSyncIndicator() {
  updateBackupMenu();
}

export function updateBackupMenu() {
  const trigger = app.querySelector(".workspace__save-status");
  const wrapper = trigger ? trigger.closest(".workspace__menu") : null;
  if (!wrapper) {
    return;
  }
  wrapper.replaceWith(renderBackupMenu());
}
