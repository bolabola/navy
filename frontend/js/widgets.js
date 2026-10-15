// 小组件：一种特殊的 board，带 widget 字段，没有条目，只渲染组件自身的内容。
import { BOARD_NOTE_MAX_LENGTH } from "../../shared/limits";
import { DEFAULT_TAB_ID, DEFAULT_TAB_NAME, DEFAULT_NEW_BOARD_HEIGHT } from "./constants.js";
import { staticIconNode, uid } from "./dom.js";
import { findBoard, nextBoardAccent } from "./boards.js";
import { saveBoards } from "./model.js";
import { auth, state } from "./state.js";
import { syncBoardWallLayout } from "./wall.js";

export const WIDGET_CATALOG = [
  {
    type: "search",
    title: "Google 搜索",
    icon: "search",
    description: "在新标签页用 Google 搜索"
  },
  {
    type: "note",
    title: "便签",
    icon: "sticky-note",
    description: "随手记点文字，自动保存"
  }
];

export function findWidgetDefinition(type) {
  return WIDGET_CATALOG.find(function (entry) {
    return entry.type === type;
  }) || null;
}

export function isWidgetBoard(board) {
  return Boolean(board && board.widget);
}

export function createWidgetBoard(type, column) {
  const definition = findWidgetDefinition(type);
  if (!definition) return null;
  const board = {
    id: uid("board"),
    title: definition.title,
    accent: nextBoardAccent(),
    icon: definition.icon,
    height: DEFAULT_NEW_BOARD_HEIGHT,
    collapsed: false,
    column: column,
    displayMode: "list",
    tabs: [{ id: DEFAULT_TAB_ID, name: DEFAULT_TAB_NAME }],
    activeTabId: DEFAULT_TAB_ID,
    items: [],
    widget: definition.type
  };
  if (definition.type === "note") board.note = "";
  return board;
}

export function renderWidgetBody(board) {
  if (board.widget === "search") return renderSearchWidget(board);
  if (board.widget === "note") return renderNoteWidget(board);
  return document.createElement("div");
}

function renderSearchWidget(board) {
  // 直接提交到 Google，不经过脚本：回车或点按钮都会在新标签页打开结果。
  const form = document.createElement("form");
  form.className = "widget-search";
  form.action = "https://www.google.com/search";
  form.method = "get";
  form.target = "_blank";
  form.rel = "noreferrer";
  form.dataset.role = "widget-search-form";
  form.dataset.boardId = board.id;

  const input = document.createElement("input");
  input.className = "widget-search__input";
  input.type = "search";
  input.name = "q";
  input.placeholder = "Google 搜索";
  input.autocomplete = "off";
  input.required = true;
  input.setAttribute("aria-label", "Google 搜索");
  form.appendChild(input);

  const submit = document.createElement("button");
  submit.className = "widget-search__submit";
  submit.type = "submit";
  submit.title = "搜索";
  submit.setAttribute("aria-label", "搜索");
  submit.appendChild(staticIconNode("icon-search"));
  form.appendChild(submit);
  return form;
}

function renderNoteWidget(board) {
  const text = typeof board.note === "string" ? board.note : "";
  // 访客只读；管理员直接在卡片里编辑，输入时自动保存。
  if (!auth.isAdmin) {
    const view = document.createElement("div");
    view.className = "widget-note widget-note--readonly" + (text ? "" : " is-empty");
    view.textContent = text || "（空白便签）";
    return view;
  }

  const textarea = document.createElement("textarea");
  textarea.className = "widget-note";
  textarea.name = "note";
  textarea.placeholder = "写点什么…";
  textarea.maxLength = BOARD_NOTE_MAX_LENGTH;
  textarea.spellcheck = false;
  textarea.value = text;
  textarea.dataset.role = "widget-note-input";
  textarea.dataset.boardId = board.id;
  textarea.setAttribute("aria-label", board.title);
  return textarea;
}

/** 便签输入：只改内存并排队保存，不重新渲染，避免打断输入和丢失光标。 */
export function updateNoteFromInput(textarea) {
  const boardId = textarea.dataset.boardId;
  if (!auth.isAdmin || !findBoard(boardId)) return;
  const note = textarea.value.slice(0, BOARD_NOTE_MAX_LENGTH);
  state.boards = state.boards.map(function (board) {
    return board.id === boardId ? Object.assign({}, board, { note: note }) : board;
  });
  saveBoards();
  // 文本框随内容长高，下面的看板需要跟着让位。
  syncBoardWallLayout();
}
