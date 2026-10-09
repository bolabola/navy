// 导入导出（JSON / 书签 / CSV）
import { alertDialog, confirmDialog } from "./dialog.js";
import { BOARD_ITEM_DESCRIPTION_MAX_LENGTH, BOARD_ITEM_NAME_MAX_LENGTH, BOARD_TAB_NAME_MAX_LENGTH } from "../../shared/limits";
import { findBoard, getBoardActiveTabId } from "./boards.js";
import {
  BOARD_ACCENTS,
  BOOKMARK_IMPORT_MAX_BOARDS,
  BOOKMARK_IMPORT_MAX_ITEMS_PER_TAB,
  BOOKMARK_IMPORT_MAX_TABS_PER_BOARD,
  DEFAULT_NEW_BOARD_HEIGHT,
  DEFAULT_TAB_ID,
  DEFAULT_TAB_NAME,
  FULL_BACKUP_SCHEMA,
  IMPORT_MAX_URLS,
  TEXT,
  URL_TITLE_BATCH_SIZE
} from "./constants.js";
import { uid } from "./dom.js";
import { normalizeLayoutSettings, saveBoards } from "./model.js";
import { render, rerenderBoardInPlace } from "./render.js";
import { serverState, state, uiState } from "./state.js";
import {
  apiSend,
  boardStoragePayload,
  cacheBoardsLocally,
  handleSaveConflict,
  layoutStoragePayload,
  loadActivePageBoards,
  normalizeActivePageId,
  normalizePages,
  noteBackupFromCommit,
  pageStoragePayload,
  setSyncState,
  syncActivePageBoards
} from "./sync.js";
import { displayName, extractUrlsFromText, normalizeUrl } from "./urls.js";

export function openLinkInBackground(url) {
  var w = window.open(url, "_blank", "noopener,noreferrer");
  if (w) {
    w.blur();
    window.focus();
  }
}

export function pickFileForBoard(boardId) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".txt,.md,.html,.csv,.json,text/*";
  input.style.display = "none";
  input.addEventListener("change", function () {
    const file = input.files && input.files[0];
    if (file) {
      handleImportFile(boardId, file);
    }
  });
  document.body.appendChild(input);
  input.click();
  setTimeout(function () { input.remove(); }, 0);
}

export function pickFullBackupFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.style.display = "none";
  input.addEventListener("change", function () {
    const file = input.files && input.files[0];
    if (file) {
      handleFullBackupImport(file);
    }
  });
  document.body.appendChild(input);
  input.click();
  setTimeout(function () { input.remove(); }, 0);
}

export function pickBookmarksHtmlFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".html,.htm,text/html";
  input.style.display = "none";
  input.addEventListener("change", function () {
    const file = input.files && input.files[0];
    if (file) {
      handleBookmarksHtmlImport(file);
    }
  });
  document.body.appendChild(input);
  input.click();
  setTimeout(function () { input.remove(); }, 0);
}

export function exportFullBackup() {
  syncActivePageBoards();
  const payload = {
    schema: FULL_BACKUP_SCHEMA,
    exportedAt: new Date().toISOString(),
    serverVersion: serverState.version,
    serverUpdatedAt: serverState.updatedAt,
    layout: layoutStoragePayload(),
    activePageId: state.activePageId,
    pages: pageStoragePayload(),
    boards: boardStoragePayload()
  };
  const text = JSON.stringify(payload, null, 2) + "\n";
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const objUrl = URL.createObjectURL(blob);
  const stamp = payload.exportedAt.replace(/[:.]/g, "-");
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = "board-trello-backup-" + stamp + ".json";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    a.remove();
    URL.revokeObjectURL(objUrl);
  }, 0);
}

export function handleFullBackupImport(file) {
  const reader = new FileReader();
  reader.onerror = function () {
    alertDialog("导入失败。");
  };
  reader.onload = function () {
    try {
      const text = typeof reader.result === "string" ? reader.result : "";
      const parsed = JSON.parse(text);
      const importedPages = parseFullBackupPages(parsed);
      const importedActivePageId = normalizeActivePageId(parsed && typeof parsed === "object" ? parsed.activePageId : null, importedPages);
      const importedLayout = normalizeLayoutSettings(parsed && typeof parsed === "object" ? parsed.layout : null);
      confirmDialog({
        title: "导入这份 JSON 备份？",
        message: "会用备份内容替换当前整个看板。导入前当前状态会先自动备份。",
        confirmText: "导入"
      }).then(function (ok) {
      if (!ok) return;
      const previousBoards = state.boards;
      const previousPages = state.pages;
      const previousActivePageId = state.activePageId;
      const previousLayout = state.layoutSettings;
      state.pages = importedPages;
      state.activePageId = importedActivePageId;
      loadActivePageBoards();
      state.layoutSettings = importedLayout;
      cacheBoardsLocally();
      setSyncState("saving", TEXT.syncSaving);
      syncActivePageBoards();
      apiSend("/board", "PUT", {
        version: serverState.version,
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
        render();
      }).catch(function (error) {
        if (error && error.status === 409) {
          setSyncState("failed", TEXT.syncConflict);
          handleSaveConflict();
          return;
        }
        state.boards = previousBoards;
        state.pages = previousPages;
        state.activePageId = previousActivePageId;
        state.layoutSettings = previousLayout;
        cacheBoardsLocally();
        setSyncState("failed", TEXT.syncFailed);
        alertDialog("导入失败，看板已恢复为导入前的状态。");
        render();
      });
      render();
      });
    } catch (error) {
      alertDialog("这不是有效的 JSON 备份文件。");
    }
  };
  reader.readAsText(file, "utf-8");
}

export function parseFullBackupPages(value) {
  if (value && typeof value === "object" && Array.isArray(value.pages)) {
    return normalizePages(value.pages, value.boards);
  }
  const sourceBoards = Array.isArray(value)
    ? value
    : (value && typeof value === "object" && Array.isArray(value.boards) ? value.boards : null);
  if (!sourceBoards) {
    throw new Error("Invalid backup");
  }
  return normalizePages(null, sourceBoards);
}

export function handleBookmarksHtmlImport(file) {
  const reader = new FileReader();
  reader.onerror = function () {
    alertDialog("导入收藏 HTML 失败。");
  };
  reader.onload = function () {
    try {
      const text = typeof reader.result === "string" ? reader.result : "";
      const tree = parseBookmarksHtml(text);
      const foundCount = countBookmarkBranchLinks(tree);
      const importedBoards = buildBookmarkImportBoards(tree);
      const importedCount = importedBoards.reduce(function (count, board) {
        return count + board.items.length;
      }, 0);
      if (!importedBoards.length || importedCount === 0) {
        if (foundCount > 0 && state.boards.length >= BOOKMARK_IMPORT_MAX_BOARDS) {
          alertDialog("当前 board 数量已达到上限，无法继续导入。");
          return;
        }
        alertDialog("收藏 HTML 里没找到可导入的网址。");
        return;
      }
      state.boards = state.boards.concat(importedBoards);
      uiState.openBoardMenuId = null;
      uiState.openAddBoardId = null;
      uiState.editBoardId = null;
      uiState.editItemId = null;
      saveBoards();
      render();
      alertDialog("已导入 " + importedBoards.length + " 个 board，" + importedCount + " 个网址。"
        + (foundCount > importedCount ? " 当前最多保存 100 个 board，已自动截断。" : ""));
    } catch (error) {
      alertDialog("导入收藏 HTML 失败。");
    }
  };
  reader.readAsText(file, "utf-8");
}

export function parseBookmarksHtml(text) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  const rootDl = doc.querySelector("dl");
  if (!rootDl) {
    return { links: [], folders: [] };
  }
  return unwrapBrowserBookmarkRoot(parseBookmarkDl(rootDl));
}

export function unwrapBrowserBookmarkRoot(tree) {
  const folders = tree && Array.isArray(tree.folders) ? tree.folders : [];
  const bookmarkBar = folders.find(function (folder) {
    return isBookmarkBarFolderName(folder.title);
  });
  if (!bookmarkBar) return tree;
  return {
    links: (tree.links || []).concat(bookmarkBar.links || []),
    folders: (bookmarkBar.folders || []).concat(folders.filter(function (folder) {
      return folder !== bookmarkBar;
    }))
  };
}

export function isBookmarkBarFolderName(name) {
  const normalized = normalizeBookmarkTitle(name).toLowerCase();
  return normalized === "书签栏"
    || normalized === "收藏夹栏"
    || normalized === "bookmarks bar"
    || normalized === "bookmarks toolbar"
    || normalized === "favorites bar";
}

export function parseBookmarkDl(dl) {
  const branch = { links: [], folders: [] };
  let pendingFolder = null;
  Array.from(dl.children).forEach(function (child) {
    const tag = child.tagName;
    if (tag === "DT") {
      const folderTitle = directChildTag(child, "H3");
      const link = directChildTag(child, "A");
      if (folderTitle) {
        pendingFolder = {
          title: normalizeBookmarkTitle(folderTitle.textContent) || "未命名文件夹",
          links: [],
          folders: []
        };
        branch.folders.push(pendingFolder);
        const nestedDl = directChildTag(child, "DL");
        if (nestedDl) {
          mergeBookmarkBranch(pendingFolder, parseBookmarkDl(nestedDl));
          pendingFolder = null;
        }
        return;
      }
      if (link) {
        const item = readBookmarkLink(link);
        if (item) branch.links.push(item);
      }
      return;
    }
    if (tag === "DL") {
      const parsed = parseBookmarkDl(child);
      if (pendingFolder) {
        mergeBookmarkBranch(pendingFolder, parsed);
        pendingFolder = null;
      } else {
        mergeBookmarkBranch(branch, parsed);
      }
    }
  });
  return branch;
}

export function directChildTag(node, tagName) {
  const wanted = String(tagName || "").toUpperCase();
  return Array.from(node.children).find(function (child) {
    return child.tagName === wanted;
  }) || null;
}

export function mergeBookmarkBranch(target, source) {
  target.links = target.links.concat(source.links || []);
  target.folders = target.folders.concat(source.folders || []);
}

export function readBookmarkLink(anchor) {
  const rawUrl = anchor.getAttribute("href") || "";
  let url;
  try {
    url = normalizeUrl(rawUrl);
  } catch (error) {
    return null;
  }
  return {
    title: normalizeItemName(anchor.textContent) || displayName(url, ""),
    url: url
  };
}

export function normalizeBookmarkTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeItemName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, BOARD_ITEM_NAME_MAX_LENGTH);
}

export function buildBookmarkImportBoards(tree) {
  const result = [];
  const usedTitles = new Set(state.boards.map(function (board) {
    return String(board.title || "").trim().toLowerCase();
  }));

  if (tree.links && tree.links.length) {
    appendBookmarkBoards(result, "书签栏", tree.links, [], usedTitles);
  }

  (tree.folders || []).forEach(function (folder) {
    if (state.boards.length + result.length >= BOOKMARK_IMPORT_MAX_BOARDS) return;
    appendBookmarkBoards(result, folder.title, folder.links, folder.folders, usedTitles);
  });

  return result;
}

export function appendBookmarkBoards(result, title, directLinks, childFolders, usedTitles) {
  const tabSpecs = buildBookmarkTabSpecs(directLinks, childFolders);
  let draft = createBookmarkBoardDraft();

  function flushDraft() {
    if (!draft.items.length || state.boards.length + result.length >= BOOKMARK_IMPORT_MAX_BOARDS) return;
    result.push(materializeBookmarkBoard(title, draft, usedTitles, result.length));
    draft = createBookmarkBoardDraft();
  }

  tabSpecs.forEach(function (spec) {
    if (state.boards.length + result.length >= BOOKMARK_IMPORT_MAX_BOARDS) return;
    if (!canAddBookmarkTabSpec(draft, spec)) {
      flushDraft();
    }
    if (!canAddBookmarkTabSpec(draft, spec)) return;
    addBookmarkTabSpec(draft, spec);
  });

  flushDraft();
}

export function buildBookmarkTabSpecs(directLinks, childFolders) {
  const specs = [];
  chunkBookmarkLinks(directLinks || []).forEach(function (chunk) {
    specs.push({ name: DEFAULT_TAB_NAME, links: chunk, isDefault: true });
  });
  (childFolders || []).forEach(function (folder, folderIndex) {
    const links = collectBookmarkLinks(folder);
    if (!links.length) return;
    chunkBookmarkLinks(links).forEach(function (chunk) {
      specs.push({ name: folder.title, links: chunk, isDefault: false, key: "folder-" + folderIndex });
    });
  });
  return specs;
}

export function chunkBookmarkLinks(links) {
  const chunks = [];
  for (let index = 0; index < links.length; index += BOOKMARK_IMPORT_MAX_ITEMS_PER_TAB) {
    chunks.push(links.slice(index, index + BOOKMARK_IMPORT_MAX_ITEMS_PER_TAB));
  }
  return chunks;
}

export function createBookmarkBoardDraft() {
  return {
    tabs: [{ id: DEFAULT_TAB_ID, name: DEFAULT_TAB_NAME }],
    items: [],
    defaultUsed: false,
    usedTabKeys: new Set(),
    usedTabNames: new Set([DEFAULT_TAB_NAME.toLowerCase()])
  };
}

export function canAddBookmarkTabSpec(draft, spec) {
  if (!spec || !spec.links || !spec.links.length) return false;
  if (spec.isDefault) return !draft.defaultUsed;
  if (draft.usedTabKeys.has(spec.key)) return false;
  return draft.tabs.length < BOOKMARK_IMPORT_MAX_TABS_PER_BOARD;
}

export function addBookmarkTabSpec(draft, spec) {
  if (spec.isDefault) {
    appendBookmarkItems(draft.items, spec.links, DEFAULT_TAB_ID);
    draft.defaultUsed = true;
    return;
  }
  const tab = {
    id: uid("tab"),
    name: uniqueBookmarkName(spec.name, draft.usedTabNames, BOARD_TAB_NAME_MAX_LENGTH)
  };
  draft.tabs.push(tab);
  draft.usedTabKeys.add(spec.key);
  appendBookmarkItems(draft.items, spec.links, tab.id);
}

export function materializeBookmarkBoard(title, draft, usedTitles, importIndex) {
  return {
    id: uid("board"),
    title: uniqueBookmarkName(title || "书签", usedTitles, 80),
    accent: BOARD_ACCENTS[(state.boards.length + importIndex) % BOARD_ACCENTS.length],
    icon: "bookmark",
    height: DEFAULT_NEW_BOARD_HEIGHT,
    collapsed: false,
    column: getImportBoardColumn(importIndex),
    displayMode: "list",
    tabs: draft.tabs,
    activeTabId: draft.defaultUsed ? DEFAULT_TAB_ID : draft.tabs[1].id,
    items: draft.items
  };
}

export function createBookmarkItem(link, tabId) {
  return {
    id: uid("item"),
    name: normalizeItemName(link.title) || displayName(link.url, ""),
    url: link.url,
    tabId: tabId
  };
}

export function appendBookmarkItems(items, links, tabId) {
  for (let index = 0; index < links.length; index += 1) {
    items.push(createBookmarkItem(links[index], tabId));
  }
}

export function collectBookmarkLinks(folder) {
  let links = (folder && folder.links) ? folder.links.slice() : [];
  (folder && folder.folders ? folder.folders : []).forEach(function (child) {
    links = links.concat(collectBookmarkLinks(child));
  });
  return links;
}

export function countBookmarkBranchLinks(branch) {
  return (branch && branch.links ? branch.links.length : 0)
    + (branch && branch.folders ? branch.folders : []).reduce(function (count, folder) {
      return count + countBookmarkBranchLinks(folder);
    }, 0);
}

export function uniqueBookmarkName(rawName, usedNames, maxLength) {
  const base = normalizeBookmarkTitle(rawName).slice(0, maxLength || 80) || "未命名";
  let candidate = base;
  let index = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const suffix = " " + index;
    candidate = base.slice(0, Math.max(1, (maxLength || 80) - suffix.length)) + suffix;
    index += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

export function getImportBoardColumn(importIndex) {
  const columns = state.masonryLayout.columns;
  return columns && columns > 0 ? (state.boards.length + importIndex) % columns : null;
}

export function handleImportFile(boardId, file) {
  if (uiState.importingBoardId) return;
  const reader = new FileReader();
  reader.onerror = function () {
    alertDialog(TEXT.importFailed);
  };
  reader.onload = function () {
    const text = typeof reader.result === "string" ? reader.result : "";
    const found = extractUrlsFromText(text);
    if (found.length === 0) {
      alertDialog(TEXT.importNoUrls);
      return;
    }
    const urls = found.slice(0, IMPORT_MAX_URLS);
    if (found.length > IMPORT_MAX_URLS) {
      alertDialog(TEXT.importTooMany.replace("{found}", String(found.length)).replace("{kept}", String(urls.length)));
    }

    uiState.importingBoardId = boardId;
    rerenderBoardInPlace(boardId);

    fetchUrlTitlesInBatches(urls).then(function (list) {
      const tabId = getBoardActiveTabId(findBoard(boardId));
      const items = list.map(function (entry) {
        let normalized;
        try {
          normalized = normalizeUrl(entry && entry.url);
        } catch (e) {
          normalized = entry && entry.url;
        }
        const title = entry && typeof entry.title === "string" ? normalizeItemName(entry.title) : "";
        const description = entry && typeof entry.description === "string" ? entry.description.trim().slice(0, BOARD_ITEM_DESCRIPTION_MAX_LENGTH) : "";
        return {
          id: uid("item"),
          name: title || displayName(normalized, ""),
          url: normalized,
          description: description,
          tabId: tabId
        };
      }).filter(function (item) { return Boolean(item.url); });

      if (items.length) {
        state.boards = state.boards.map(function (board) {
          return board.id === boardId ? Object.assign({}, board, { items: board.items.concat(items) }) : board;
        });
        saveBoards();
      }
    }).catch(function () {
      alertDialog(TEXT.importFailed);
    }).finally(function () {
      uiState.importingBoardId = null;
      rerenderBoardInPlace(boardId);
    });
  };
  reader.readAsText(file, "utf-8");
}

export function fetchUrlTitlesInBatches(urls) {
  const batches = [];
  for (let i = 0; i < urls.length; i += URL_TITLE_BATCH_SIZE) {
    batches.push(urls.slice(i, i + URL_TITLE_BATCH_SIZE));
  }
  return batches.reduce(function (chain, batch) {
    return chain.then(function (all) {
      return apiSend("/url-titles", "POST", { urls: batch }).then(function (results) {
        return all.concat(Array.isArray(results) ? results : []);
      });
    });
  }, Promise.resolve([]));
}

export function csvEscape(value) {
  const v = String(value == null ? "" : value);
  if (/[",\r\n]/.test(v)) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

export function exportBoardToCsv(board) {
  if (!board || !Array.isArray(board.items) || board.items.length === 0) {
    alertDialog(TEXT.exportEmpty);
    return;
  }
  const lines = board.items.map(function (item) {
    return csvEscape(item.name) + "," + csvEscape(item.url);
  });
  const text = lines.join("\r\n") + "\r\n";
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const objUrl = URL.createObjectURL(blob);
  const safeName = String(board.title || "board").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim() || "board";
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = safeName + ".csv";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    a.remove();
    URL.revokeObjectURL(objUrl);
  }, 0);
}
