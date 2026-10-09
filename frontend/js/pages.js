// 页面管理
import { PAGE_MAX_COUNT, PAGE_NAME_MAX_LENGTH } from "../../shared/limits";
import { TEXT } from "./constants.js";
import { confirmDialog, promptDialog } from "./dialog.js";
import { uid } from "./dom.js";
import { saveBoards } from "./model.js";
import { playIntro, render } from "./render.js";
import { auth, state, uiState } from "./state.js";
import { cacheBoardsLocally, loadActivePageBoards, normalizePageName, syncActivePageBoards } from "./sync.js";

export function switchPage(pageId) {
  if (!pageId || pageId === state.activePageId || !state.pages.some(function (page) { return page.id === pageId; })) return;
  syncActivePageBoards();
  state.activePageId = pageId;
  loadActivePageBoards();
  closeTransientUi();
  cacheBoardsLocally();
  playIntro();
  render();
}

export function closeTransientUi() {
  uiState.openBoardMenuId = null;
  uiState.openAddBoardId = null;
  uiState.editBoardId = null;
  uiState.editItemId = null;
  uiState.moveBoardId = null;
  uiState.createBoardOpen = false;
  uiState.dataMenuOpen = false;
  uiState.backupMenuOpen = false;
  uiState.layoutMenuOpen = false;
  uiState.allCollapseSnapshot = null;
}

export function addPage() {
  if (!auth.isAdmin || state.pages.length >= PAGE_MAX_COUNT) return;
  promptDialog({
    title: "新建页面",
    message: "用页面区分不同场景，比如工作、学习、娱乐。",
    value: "页面 " + (state.pages.length + 1),
    placeholder: "页面名称",
    maxLength: PAGE_NAME_MAX_LENGTH,
    confirmText: "创建"
  }).then(function (value) {
    const name = normalizePageName(value, "");
    if (name) createPage(name);
  });
}

function createPage(name) {
  syncActivePageBoards();
  const page = { id: uid("page"), name: name, boards: [] };
  state.pages = state.pages.concat(page);
  state.activePageId = page.id;
  state.boards = [];
  closeTransientUi();
  saveBoards();
  render();
}

export function renameActivePage() {
  if (!auth.isAdmin) return;
  const current = state.pages.find(function (page) { return page.id === state.activePageId; });
  if (!current) return;
  promptDialog({
    title: "重命名页面",
    value: current.name,
    placeholder: "页面名称",
    maxLength: PAGE_NAME_MAX_LENGTH,
    confirmText: "保存"
  }).then(function (value) {
    const name = normalizePageName(value, "");
    if (!name || name === current.name) return;
    state.pages = state.pages.map(function (page) {
      return page.id === current.id ? Object.assign({}, page, { name: name }) : page;
    });
    saveBoards();
    render();
  });
}

export function deleteActivePage() {
  if (!auth.isAdmin || state.pages.length <= 1) return;
  const current = state.pages.find(function (page) { return page.id === state.activePageId; });
  confirmDialog({
    title: "删除页面“" + (current ? current.name : "") + "”？",
    message: TEXT.deletePageConfirm,
    confirmText: "删除",
    danger: true
  }).then(function (ok) {
    if (ok) removeActivePage();
  });
}

function removeActivePage() {
  const index = Math.max(0, state.pages.findIndex(function (page) { return page.id === state.activePageId; }));
  state.pages = state.pages.filter(function (page) { return page.id !== state.activePageId; });
  state.activePageId = state.pages[Math.min(index, state.pages.length - 1)].id;
  loadActivePageBoards();
  closeTransientUi();
  saveBoards();
  render();
}

export function moveBoardToPage(boardId, targetPageId) {
  if (!auth.isAdmin || !boardId || !targetPageId) return;
  const sourceIndex = state.pages.findIndex(function (page) {
    return page.id === state.activePageId;
  });
  const targetIndex = state.pages.findIndex(function (page) {
    return page.id === targetPageId;
  });
  if (sourceIndex === -1 || targetIndex === -1) return;

  syncActivePageBoards();
  const source = state.pages[sourceIndex];
  const board = source.boards.find(function (entry) {
    return entry.id === boardId;
  });
  if (!board) return;

  state.pages = state.pages.map(function (page) {
    if (page.id === source.id) {
      return Object.assign({}, page, {
        boards: page.boards.filter(function (entry) {
          return entry.id !== boardId;
        })
      });
    }
    if (page.id === targetPageId) {
      return Object.assign({}, page, {
        boards: page.boards.concat(board)
      });
    }
    return page;
  });

  state.activePageId = targetPageId;
  loadActivePageBoards();
  closeTransientUi();
  saveBoards();
  render();
}
