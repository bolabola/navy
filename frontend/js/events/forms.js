// 表单事件代理
import { BOARD_ITEM_DESCRIPTION_MAX_LENGTH, BOARD_TAB_NAME_MAX_LENGTH } from "../../../shared/limits";
import { loadBackupStatus } from "../backup.js";
import { findBoard, getBoardActiveTabId, getBoardTabs, nextBoardAccent, nextBoardIcon } from "../boards.js";
import { DEFAULT_NEW_BOARD_HEIGHT, DEFAULT_TAB_ID, DEFAULT_TAB_NAME, ICON_NAME_RE, TEXT } from "../constants.js";
import { uid } from "../dom.js";
import { getNextBoardColumn } from "../layout.js";
import { normalizeIconName, saveBoards } from "../model.js";
import { mutateBoard } from "../mutations.js";
import { focusField, render, rerenderBoardInPlace } from "../render.js";
import { app, auth, state, uiState } from "../state.js";
import { apiSend, loadServerBoardState } from "../sync.js";
import { displayName, normalizeUrl } from "../urls.js";
import { applyLayoutSettingsFromForm } from "../wall.js";

export function installFormsHandlers() {
  app.addEventListener("change", function (event) {
    const form = event.target.closest('[data-role="layout-settings-form"]');
    if (!form) return;
    applyLayoutSettingsFromForm(form);
    render();
  });

  app.addEventListener("input", function (event) {
    const range = event.target.closest(".layout-menu__range");
    if (!range) return;
    const field = range.closest(".layout-menu__field");
    const value = field ? field.querySelector(".layout-menu__value") : null;
    if (value) {
      value.textContent = range.value + (range.dataset.suffix || "");
    }
  });

  app.addEventListener("submit", function (event) {
    const layoutForm = event.target.closest('[data-role="layout-settings-form"]');
    if (layoutForm) {
      event.preventDefault();
      applyLayoutSettingsFromForm(layoutForm);
      render();
      return;
    }

    const loginForm = event.target.closest('[data-role="login-form"]');
    if (loginForm) {
      event.preventDefault();
      const formData = new FormData(loginForm);
      const password = String(formData.get("password") || "");
      apiSend("/login", "POST", { password: password }).then(function (result) {
        auth.isAdmin = true;
        auth.csrfToken = result && typeof result.csrfToken === "string" ? result.csrfToken : null;
        uiState.backupStatus = null;
        uiState.localLastBackup = null;
        uiState.loginOpen = false;
        uiState.loginError = null;
        loadServerBoardState().catch(function () {}).finally(function () {
          render();
          loadBackupStatus();
        });
      }).catch(function (error) {
        uiState.loginError = error && error.status === 429
          ? TEXT.loginRateLimited
          : (error && error.status === 500 ? TEXT.loginConfigError : TEXT.loginFailed);
        render();
        const input = app.querySelector('[data-role="login-form"] input[name="password"]');
        focusField(input, true);
      });
      return;
    }

    const createBoardForm = event.target.closest('[data-role="create-board-form"]');
    if (createBoardForm) {
      event.preventDefault();

      const formData = new FormData(createBoardForm);
      const title = String(formData.get("title") || "").trim();
      const icon = String(formData.get("icon") || "").trim() || nextBoardIcon();
      if (!title) {
        return;
      }

      state.boards = state.boards.concat({
        id: uid("board"),
        title: title,
        accent: nextBoardAccent(),
        icon: normalizeIconName(icon),
        height: DEFAULT_NEW_BOARD_HEIGHT,
        collapsed: false,
        column: getNextBoardColumn(state.masonryLayout.columns),
        displayMode: "list",
        tabs: [{ id: DEFAULT_TAB_ID, name: DEFAULT_TAB_NAME }],
        activeTabId: DEFAULT_TAB_ID,
        items: []
      });

      uiState.createBoardOpen = false;
      saveBoards();
      render();
      return;
    }

    const editBoardForm = event.target.closest('[data-role="edit-board-form"]');
    if (editBoardForm) {
      event.preventDefault();

      const boardId = editBoardForm.getAttribute("data-board-id");
      const formData = new FormData(editBoardForm);
      const title = String(formData.get("title") || "").trim();
      const icon = String(formData.get("icon") || "").trim();
      const activeTabName = String(formData.get("activeTabName") || "").trim().slice(0, BOARD_TAB_NAME_MAX_LENGTH);
      if (!boardId || !title) {
        return;
      }

      uiState.editBoardId = null;
      state.boards = state.boards.map(function (board) {
        return board.id === boardId
          ? Object.assign({}, board, {
          title: title,
          icon: ICON_NAME_RE.test(icon) ? normalizeIconName(icon) : board.icon,
          tabs: activeTabName ? getBoardTabs(board).map(function (tab) {
            return tab.id === getBoardActiveTabId(board) ? Object.assign({}, tab, { name: activeTabName }) : tab;
          }) : getBoardTabs(board)
            })
          : board;
      });
      saveBoards();
      rerenderBoardInPlace(boardId);
      return;
    }

    const itemEditForm = event.target.closest('[data-role="item-edit-form"]');
      if (itemEditForm) {
        event.preventDefault();

        const boardId = itemEditForm.getAttribute("data-board-id");
        const itemId = itemEditForm.getAttribute("data-item-id");
        const formData = new FormData(itemEditForm);
        const rawUrl = formData.get("url");
        const rawName = formData.get("name");
        const rawIcon = String(formData.get("icon") || "").trim();
        const iconMode = String(formData.get("itemIconMode") || "custom");
        const description = String(formData.get("description") || "").trim().slice(0, BOARD_ITEM_DESCRIPTION_MAX_LENGTH);
        if (!boardId) {
          return;
        }

        let url;
        try {
          url = normalizeUrl(rawUrl);
        } catch (error) {
          window.alert(TEXT.invalidUrl);
          return;
        }

        if (itemId) {
          uiState.editItemId = null;
          mutateBoard(boardId, function (board) {
            return Object.assign({}, board, {
              items: board.items.map(function (item) {
                return item.id === itemId
                  ? Object.assign({}, item, {
                      name: displayName(url, rawName),
                      url: url,
                      icon: iconMode === "favicon" ? "" : (ICON_NAME_RE.test(rawIcon) ? normalizeIconName(rawIcon) : item.icon),
                      description: description
                    })
                  : item;
              })
            });
          });
        } else {
          const item = {
            id: uid("item"),
            name: displayName(url, rawName),
            url: url,
            icon: iconMode === "favicon" ? "" : (ICON_NAME_RE.test(rawIcon) ? normalizeIconName(rawIcon) : ""),
            description: description,
            tabId: getBoardActiveTabId(findBoard(boardId))
          };

          uiState.openAddBoardId = null;

          mutateBoard(boardId, function (board) {
            return Object.assign({}, board, { items: board.items.concat(item) });
          });
        }
        return;
      }
  });
}
