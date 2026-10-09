// DOM 小工具
import { MAX_BOARD_HEIGHT, MIN_BOARD_HEIGHT } from "../../shared/limits";
import { TEXT } from "./constants.js";
import { normalizeIconName } from "./model.js";
import { app, state, uiState } from "./state.js";

export function uid(prefix) {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return prefix + "-" + window.crypto.randomUUID();
  }
  return prefix + "-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

export function clampHeight(height) {
  return Math.min(MAX_BOARD_HEIGHT, Math.max(MIN_BOARD_HEIGHT, Number(height) || 280));
}

export function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(String(value));
  }
  return String(value).replace(/["\\]/g, "\\$&");
}

export function appendChildren(parent, children) {
  children.forEach(function (child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) {
      appendChildren(parent, child);
      return;
    }
    parent.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  });
  return parent;
}

export function iconNode(name, className) {
  const i = document.createElement("i");
  i.className = "icon-" + normalizeIconName(name) + (className ? " " + className : "");
  return i;
}

export function staticIconNode(className) {
  const i = document.createElement("i");
  i.className = className;
  return i;
}

export function actionButton(className, action, boardId, title, children) {
  const button = document.createElement("button");
  button.className = className;
  button.type = "button";
  button.dataset.action = action;
  if (boardId != null) button.dataset.boardId = boardId;
  if (title) button.title = title;
  appendChildren(button, children || []);
  return button;
}

export function shouldCollapseAllBoards() {
  if (uiState.allCollapseSnapshot) {
    return false;
  }

  return state.boards.some(function (board) {
    return !board.collapsed;
  });
}

export function getAllCollapseButtonLabel() {
  return shouldCollapseAllBoards() ? TEXT.collapseAll : TEXT.expandAll;
}

export function getAllCollapseButtonIcon() {
  return shouldCollapseAllBoards() ? "icon-chevrons-up" : "icon-chevrons-down";
}

export function syncAllCollapseButton() {
  const button = app.querySelector('[data-action="toggle-all-collapse"]');
  if (!button) {
    return;
  }

  const label = getAllCollapseButtonLabel();
  button.title = label;
  button.setAttribute("aria-label", label);
  button.disabled = state.boards.length === 0;
  button.replaceChildren(staticIconNode(getAllCollapseButtonIcon()), document.createTextNode(label));
}
