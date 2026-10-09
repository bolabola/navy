// 顶栏与弹窗
import { renderBackupMenu } from "./backup.js";
import { findBoard, nextBoardIcon } from "./boards.js";
import { GITHUB_URL, TEXT } from "./constants.js";
import { actionButton, getAllCollapseButtonIcon, getAllCollapseButtonLabel, staticIconNode } from "./dom.js";
import { renderDataMenu, renderLayoutMenu } from "./menus.js";
import { renderIconPickerWidget } from "./renderBoard.js";
import { app, auth, state, uiState } from "./state.js";
import { createModalHeader, renderThemeToggleButton } from "./theme.js";
import { githubIconNode } from "./urls.js";

export function renderNavbar() {
  const nav = document.createElement("nav");
  nav.className = "workspace__navbar";

  const left = document.createElement("div");
  left.className = "workspace__navbar-left";
  left.appendChild(renderPageBar());
  if (!auth.isAdmin) {
    const notice = document.createElement("span");
    notice.className = "workspace__guest-notice";
    notice.textContent = TEXT.guestUnsavedNotice;
    left.appendChild(notice);
  }
  nav.appendChild(left);

  const right = document.createElement("div");
  right.className = "workspace__navbar-right";
  const collapseAll = actionButton("workspace__collapse-all-button", "toggle-all-collapse", null, getAllCollapseButtonLabel(), [
    staticIconNode(getAllCollapseButtonIcon()),
    getAllCollapseButtonLabel()
  ]);
  collapseAll.setAttribute("aria-label", getAllCollapseButtonLabel());
  collapseAll.disabled = state.boards.length === 0;
  right.appendChild(collapseAll);
  const github = document.createElement("a");
  github.className = "workspace__github-link";
  github.href = GITHUB_URL;
  github.target = "_blank";
  github.rel = "noreferrer";
  github.title = "GitHub";
  github.setAttribute("aria-label", "GitHub");
  github.appendChild(githubIconNode());
  right.appendChild(github);
  right.appendChild(renderThemeToggleButton());
  if (auth.isAdmin) {
    right.appendChild(renderLayoutMenu());
    right.appendChild(renderDataMenu());
    right.appendChild(renderBackupMenu());
    right.appendChild(actionButton("workspace__create-button", "toggle-create-board", null, "", [
      staticIconNode("icon-plus"),
      " " + TEXT.createBoard
    ]));
  }

  right.appendChild(actionButton("workspace__auth-button", "toggle-auth", null, "", [auth.isAdmin ? TEXT.logout : TEXT.login]));
  nav.appendChild(right);
  return nav;
}

export function rerenderNavbarInPlace() {
  const current = app.querySelector(".workspace__navbar");
  const next = renderNavbar();
  if (current) {
    current.replaceWith(next);
  } else {
    app.appendChild(next);
  }
}

export function renderPageBar() {
  const bar = document.createElement("div");
  bar.className = "page-bar";

  const list = document.createElement("div");
  list.className = "page-bar__list";
  state.pages.forEach(function (page) {
    const tab = actionButton("page-tab" + (page.id === state.activePageId ? " is-active" : ""), "switch-page", null, page.name, [
      page.name
    ]);
    tab.dataset.pageId = page.id;
    tab.setAttribute("aria-label", page.name);
    list.appendChild(tab);
  });
  bar.appendChild(list);

  if (auth.isAdmin) {
    const actions = document.createElement("div");
    actions.className = "page-bar__actions";
    actions.appendChild(actionButton("page-bar__button", "add-page", null, TEXT.addPage, [
      staticIconNode("icon-plus")
    ]));
    actions.appendChild(actionButton("page-bar__button", "rename-page", null, TEXT.renamePage, [
      staticIconNode("icon-pencil")
    ]));
    const del = actionButton("page-bar__button page-bar__button--danger", "delete-page", null, TEXT.deletePage, [
      staticIconNode("icon-trash-2")
    ]);
    del.disabled = state.pages.length <= 1;
    actions.appendChild(del);
    bar.appendChild(actions);
  }

  return bar;
}

export function renderLoginModal() {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.dataset.action = "cancel-auth";
  const panel = document.createElement("div");
  panel.className = "modal-panel";
  panel.dataset.role = "modal-panel";
  panel.appendChild(createModalHeader(TEXT.login, "cancel-auth"));

  const form = document.createElement("form");
  form.className = "login-form";
  form.dataset.role = "login-form";
  const input = document.createElement("input");
  input.type = "password";
  input.name = "password";
  input.placeholder = TEXT.loginPlaceholder;
  input.required = true;
  input.autofocus = true;
  form.appendChild(input);
  if (uiState.loginError) {
    const error = document.createElement("span");
    error.className = "login-form__error";
    error.textContent = uiState.loginError;
    form.appendChild(error);
  }
  const actions = document.createElement("div");
  actions.className = "login-form__actions";
  const submit = document.createElement("button");
  submit.className = "board-save-button";
  submit.type = "submit";
  submit.textContent = TEXT.login;
  actions.appendChild(submit);
  actions.appendChild(actionButton("board-cancel-button", "cancel-auth", null, "", [TEXT.cancel]));
  form.appendChild(actions);
  panel.appendChild(form);
  backdrop.appendChild(panel);
  return backdrop;
}

export function renderCreateBoardModal() {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.dataset.action = "cancel-create-board";
  const panel = document.createElement("div");
  panel.className = "modal-panel";
  panel.dataset.role = "modal-panel";
  panel.appendChild(createModalHeader(TEXT.createBoard, "cancel-create-board"));

  const form = document.createElement("form");
  form.className = "create-board-form";
  form.dataset.role = "create-board-form";
  const row = document.createElement("div");
  row.className = "board-meta-form__row";
  row.appendChild(renderIconPickerWidget("icon", nextBoardIcon()));
  const title = document.createElement("input");
  title.className = "board-meta-form__title-input";
  title.type = "text";
  title.name = "title";
  title.placeholder = TEXT.createBoardPlaceholder;
  title.required = true;
  row.appendChild(title);
  form.appendChild(row);

  const actions = document.createElement("div");
  actions.className = "create-board-form__actions";
  const submit = document.createElement("button");
  submit.className = "board-save-button";
  submit.type = "submit";
  submit.textContent = TEXT.createBoard;
  actions.appendChild(submit);
  actions.appendChild(actionButton("board-cancel-button", "cancel-create-board", null, "", [TEXT.cancel]));
  form.appendChild(actions);
  panel.appendChild(form);
  backdrop.appendChild(panel);
  return backdrop;
}

export function renderMoveBoardModal() {
  if (!uiState.moveBoardId || !auth.isAdmin) return null;
  const board = findBoard(uiState.moveBoardId);
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.dataset.action = "cancel-move-board";

  const panel = document.createElement("div");
  panel.className = "modal-panel modal-panel--wide";
  panel.dataset.role = "modal-panel";
  panel.appendChild(createModalHeader(TEXT.moveBoardTitle, "cancel-move-board"));

  if (board) {
    const hint = document.createElement("p");
    hint.className = "move-page-hint";
    hint.textContent = TEXT.moveBoardHint.replace("{board}", board.title);
    panel.appendChild(hint);
  }

  const targets = state.pages.filter(function (page) {
    return page.id !== state.activePageId;
  });
  if (!targets.length) {
    const empty = document.createElement("p");
    empty.className = "backup-list__message";
    empty.textContent = TEXT.moveBoardNoTargets;
    panel.appendChild(empty);
  } else {
    const list = document.createElement("div");
    list.className = "move-page-list";
    targets.forEach(function (page) {
      const button = actionButton("move-page-option", "move-board-to-page", uiState.moveBoardId, page.name, [
        staticIconNode("icon-corner-up-right"),
        document.createElement("span")
      ]);
      button.lastChild.textContent = page.name;
      button.dataset.pageId = page.id;
      list.appendChild(button);
    });
    panel.appendChild(list);
  }

  backdrop.appendChild(panel);
  return backdrop;
}
