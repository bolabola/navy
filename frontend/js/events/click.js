// 点击事件代理
import { BOARD_ITEM_DESCRIPTION_MAX_LENGTH, MIN_BOARD_HEIGHT } from "../../../shared/limits";
import { openPalette } from "../search.js";
import { loadBackupStatus, openCloudBackupsModal, openKvBackupsModal } from "../backup.js";
import { findBoard, getBoardTabs } from "../boards.js";
import { TEXT, THEME_DARK, THEME_LIGHT } from "../constants.js";
import { cssEscape } from "../dom.js";
import {
  exportBoardToCsv,
  exportFullBackup,
  normalizeItemName,
  openLinkInBackground,
  pickBookmarksHtmlFile,
  pickFileForBoard,
  pickFullBackupFile
} from "../importExport.js";
import { nextDisplayMode, nextIconSize, normalizeActiveTabId, saveBoards } from "../model.js";
import {
  addBoardTab,
  collapseAllBoards,
  deleteActiveBoardTab,
  mutateBoardSessionState,
  mutateBoardUiPreference,
  renameActiveBoardTab,
  restoreAllCollapseSnapshot
} from "../mutations.js";
import { rerenderNavbarInPlace } from "../navbar.js";
import { addPage, deleteActivePage, moveBoardToPage, renameActivePage, switchPage } from "../pages.js";
import {
  expandBoardToFit,
  focusField,
  removeBoardItemInPlace,
  render,
  rerenderBoardInPlace,
  updateBoardHeightInPlace
} from "../render.js";
import { closeAllIconPickers } from "../renderBoard.js";
import { app, auth, serverState, state, uiState } from "../state.js";
import { applyViewPrefs } from "../viewPrefs.js";
import {
  apiSend,
  handleAuthExpired,
  loadServerBoardState,
  noteBackupFromCommit,
  setSyncState,
  updateBackupMenu
} from "../sync.js";
import { applyTheme, saveThemePreference, syncThemeToggleButton } from "../theme.js";
import { normalizeUrl, resetItemFormIconToFavicon } from "../urls.js";
import { resetLayoutSettings } from "../wall.js";

export function installClickHandlers() {
  app.addEventListener("click", function (event) {
    const anchor = event.target.closest(".link-row__anchor");
    if (anchor && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      openLinkInBackground(anchor.href);
      return;
    }

    const button = event.target.closest("[data-action]");
    if (!button) {
      if (!event.target.closest(".icon-picker")) {
        closeAllIconPickers(app);
      }
      if (uiState.openBoardMenuId && !event.target.closest(".board-actions-menu")) {
        const previousBoardMenuId = uiState.openBoardMenuId;
        uiState.openBoardMenuId = null;
        rerenderBoardInPlace(previousBoardMenuId);
      }
      if ((uiState.dataMenuOpen || uiState.backupMenuOpen || uiState.layoutMenuOpen) && !event.target.closest(".workspace__menu")) {
        uiState.dataMenuOpen = false;
        uiState.backupMenuOpen = false;
        uiState.layoutMenuOpen = false;
        render();
      }
      return;
    }

    const action = button.getAttribute("data-action");
    const boardId = button.getAttribute("data-board-id");

    if (action === "open-search") {
      openPalette();
      return;
    }

    if (action === "toggle-theme") {
      state.currentTheme = state.currentTheme === THEME_DARK ? THEME_LIGHT : THEME_DARK;
      if (document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        document.startViewTransition(function () {
          applyTheme(state.currentTheme);
        });
      } else {
        applyTheme(state.currentTheme);
      }
      saveThemePreference(state.currentTheme);
      syncThemeToggleButton(button);
      return;
    }

    if (action === "toggle-auth") {
      if (auth.isAdmin) {
        apiSend("/logout", "POST").catch(function () {}).finally(function () {
          auth.isAdmin = false;
          auth.csrfToken = null;
          uiState.openBoardMenuId = null;
          uiState.openAddBoardId = null;
          uiState.editBoardId = null;
          uiState.createBoardOpen = false;
          // 切回访客视图：叠加本机记住的显示模式等偏好
          state.boards = applyViewPrefs(state.boards, true);
          render();
        });
      } else {
        uiState.loginOpen = !uiState.loginOpen;
        uiState.loginError = null;
        render();
        if (uiState.loginOpen) {
          const input = app.querySelector('[data-role="login-form"] input[name="password"]');
          focusField(input, false);
        }
      }
      return;
    }

    if (action === "cancel-auth") {
      if (button.classList.contains("modal-backdrop") && event.target.closest("[data-role='modal-panel']")) {
        return;
      }
      uiState.loginOpen = false;
      uiState.loginError = null;
      render();
      return;
    }

    if (action === "toggle-create-board") {
      uiState.openBoardMenuId = null;
      uiState.dataMenuOpen = false;
      uiState.backupMenuOpen = false;
      uiState.layoutMenuOpen = false;
      uiState.createBoardOpen = !uiState.createBoardOpen;
      render();
      if (uiState.createBoardOpen) {
        const input = app.querySelector('[data-role="create-board-form"] input[name="title"]');
        focusField(input, false);
      }
      return;
    }

    if (action === "switch-page") {
      switchPage(button.getAttribute("data-page-id"));
      return;
    }

    if (action === "add-page") {
      addPage();
      return;
    }

    if (action === "rename-page") {
      renameActivePage();
      return;
    }

    if (action === "delete-page") {
      deleteActivePage();
      return;
    }

    if (action === "toggle-backups") {
      openKvBackupsModal();
      return;
    }

    if (action === "toggle-cloud-backups") {
      if (!auth.isAdmin) {
        return;
      }
      const providerId = button.getAttribute("data-provider-id");
      if (!providerId) return;
      openCloudBackupsModal(providerId, button.getAttribute("data-provider-label"));
      return;
    }

    if (action === "cancel-backups") {
      if (button.classList.contains("modal-backdrop") && event.target.closest("[data-role='modal-panel']")) {
        return;
      }
      uiState.backupsOpen = false;
      uiState.backupsError = null;
      uiState.backupsProviderId = null;
      uiState.backupsProviderLabel = "";
      render();
      return;
    }

    if (action === "restore-backup") {
      if (!auth.isAdmin) {
        return;
      }
      const key = button.getAttribute("data-backup-key");
      const providerId = button.getAttribute("data-provider-id");
      const backupId = button.getAttribute("data-backup-id");
      if ((!providerId && !key) || (providerId && !backupId) || !window.confirm(TEXT.backupRestoreConfirm)) {
        return;
      }
      button.disabled = true;
      const restorePath = providerId
        ? "/cloud-backup/" + encodeURIComponent(providerId) + "/restore"
        : "/backups/restore";
      const restorePayload = providerId ? { id: backupId } : { key: key };
      apiSend(restorePath, "POST", restorePayload).then(function (result) {
        if (result && Number.isInteger(result.version)) {
          serverState.version = result.version;
          serverState.updatedAt = typeof result.updatedAt === "string" ? result.updatedAt : serverState.updatedAt;
        }
        noteBackupFromCommit(result);
        return loadServerBoardState();
      }).then(function () {
        uiState.backupsOpen = false;
        uiState.backupsProviderId = null;
        uiState.backupsProviderLabel = "";
        setSyncState("saved", TEXT.syncSaved);
        render();
      }).catch(function (error) {
        const detail = error && error.responseText ? "\n\n" + error.responseText : "";
        window.alert(TEXT.backupRestoreFailed + detail);
        render();
      });
      return;
    }

    if (action === "export-full-backup") {
      if (!auth.isAdmin) {
        return;
      }
      uiState.openBoardMenuId = null;
      uiState.dataMenuOpen = false;
      uiState.layoutMenuOpen = false;
      exportFullBackup();
      render();
      return;
    }

    if (action === "import-full-backup") {
      if (!auth.isAdmin) {
        return;
      }
      uiState.openBoardMenuId = null;
      uiState.dataMenuOpen = false;
      uiState.layoutMenuOpen = false;
      pickFullBackupFile();
      render();
      return;
    }

    if (action === "import-bookmarks-html") {
      if (!auth.isAdmin) {
        return;
      }
      uiState.openBoardMenuId = null;
      uiState.dataMenuOpen = false;
      uiState.layoutMenuOpen = false;
      pickBookmarksHtmlFile();
      render();
      return;
    }

    if (action === "toggle-data-menu") {
      if (!auth.isAdmin) {
        return;
      }
      uiState.openBoardMenuId = null;
      uiState.backupMenuOpen = false;
      uiState.layoutMenuOpen = false;
      uiState.dataMenuOpen = !uiState.dataMenuOpen;
      render();
      return;
    }

    if (action === "toggle-layout-menu") {
      if (!auth.isAdmin) {
        return;
      }
      uiState.openBoardMenuId = null;
      uiState.dataMenuOpen = false;
      uiState.backupMenuOpen = false;
      uiState.layoutMenuOpen = !uiState.layoutMenuOpen;
      rerenderNavbarInPlace();
      return;
    }

    if (action === "reset-layout-settings") {
      resetLayoutSettings();
      return;
    }

    if (action === "toggle-backup-menu") {
      if (!auth.isAdmin) {
        return;
      }
      uiState.openBoardMenuId = null;
      uiState.dataMenuOpen = false;
      uiState.layoutMenuOpen = false;
      uiState.backupMenuOpen = !uiState.backupMenuOpen;
      render();
      if (uiState.backupMenuOpen) {
        loadBackupStatus();
      }
      return;
    }

    if (action === "toggle-all-collapse") {
      if (uiState.allCollapseSnapshot) {
        restoreAllCollapseSnapshot();
      } else {
        collapseAllBoards();
      }
      return;
    }

    if (action === "connect-cloud-backup") {
      if (!auth.isAdmin) {
        return;
      }
      const providerId = button.getAttribute("data-provider-id");
      if (!providerId) return;
      button.disabled = true;
      apiSend("/cloud-backup/" + encodeURIComponent(providerId) + "/connect", "POST", {}).then(function (result) {
        if (result && typeof result.url === "string") {
          window.location.href = result.url;
          return;
        }
        throw new Error("Missing authorization URL");
      }).catch(function () {
        button.disabled = false;
        window.alert("Cloud backup authorization failed to start.");
      });
      return;
    }

    if (action === "run-cloud-backup") {
      if (!auth.isAdmin) {
        return;
      }
      const providerId = button.getAttribute("data-provider-id");
      if (!providerId || uiState.cloudBackupRunning[providerId]) return;
      uiState.cloudBackupRunning[providerId] = true;
      updateBackupMenu();
      const finish = function () {
        delete uiState.cloudBackupRunning[providerId];
        loadBackupStatus();
      };
      apiSend("/cloud-backup/" + encodeURIComponent(providerId) + "/run", "POST", {}).then(finish).catch(function (error) {
        finish();
        const detail = error && error.responseText ? "\n\n" + error.responseText.slice(0, 300) : "";
        window.alert("云备份失败。" + detail);
      });
      return;
    }

    if (action === "disconnect-cloud-backup") {
      if (!auth.isAdmin) {
        return;
      }
      const providerId = button.getAttribute("data-provider-id");
      if (!providerId || !window.confirm("断开这个云备份服务？云盘里已有的备份文件会保留。")) {
        return;
      }
      button.disabled = true;
      apiSend("/cloud-backup/" + encodeURIComponent(providerId) + "/disconnect", "POST", {}).then(function () {
        loadBackupStatus();
      }).catch(function () {
        button.disabled = false;
        window.alert("Cloud backup disconnect failed.");
      });
      return;
    }

    if (action === "cancel-create-board") {
      if (button.classList.contains("modal-backdrop") && event.target.closest("[data-role='modal-panel']")) {
        return;
      }
      uiState.createBoardOpen = false;
      render();
      return;
    }

    if (action === "toggle-board-menu") {
      const previousBoardMenuId = uiState.openBoardMenuId;
      uiState.openBoardMenuId = uiState.openBoardMenuId === boardId ? null : boardId;
      if (previousBoardMenuId && previousBoardMenuId !== boardId) {
        rerenderBoardInPlace(previousBoardMenuId);
      }
      rerenderBoardInPlace(boardId);
      return;
    }

    if (action === "move-board") {
      if (!auth.isAdmin || !boardId) return;
      uiState.openBoardMenuId = null;
      uiState.openAddBoardId = null;
      uiState.editBoardId = null;
      uiState.editItemId = null;
      uiState.moveBoardId = boardId;
      render();
      return;
    }

    if (action === "cancel-move-board") {
      if (button.classList.contains("modal-backdrop") && event.target.closest("[data-role='modal-panel']")) {
        return;
      }
      uiState.moveBoardId = null;
      render();
      return;
    }

    if (action === "move-board-to-page") {
      if (!auth.isAdmin) return;
      const targetPageId = button.getAttribute("data-page-id");
      if (!boardId || !targetPageId) return;
      moveBoardToPage(boardId, targetPageId);
      return;
    }

    if (action === "select-board-tab") {
      const tabId = button.getAttribute("data-tab-id");
      if (!boardId || !tabId) return;
      uiState.openBoardMenuId = null;
      uiState.openAddBoardId = null;
      uiState.editItemId = null;
      mutateBoardUiPreference(boardId, function (board) {
        return Object.assign({}, board, {
          activeTabId: normalizeActiveTabId(tabId, getBoardTabs(board))
        });
      });
      return;
    }

    if (action === "add-board-tab") {
      if (!auth.isAdmin || !boardId) return;
      uiState.openBoardMenuId = null;
      uiState.openAddBoardId = null;
      uiState.editItemId = null;
      const input = app.querySelector('.board-meta-form[data-board-id="' + cssEscape(boardId) + '"] input[name="newTabName"]');
      addBoardTab(boardId, input ? input.value : "");
      return;
    }

    if (action === "rename-board-tab") {
      if (!auth.isAdmin || !boardId) return;
      uiState.openBoardMenuId = null;
      uiState.editItemId = null;
      const input = app.querySelector('.board-meta-form[data-board-id="' + cssEscape(boardId) + '"] input[name="activeTabName"]');
      renameActiveBoardTab(boardId, input ? input.value : "");
      return;
    }

    if (action === "delete-board-tab") {
      if (!auth.isAdmin || !boardId) return;
      uiState.openBoardMenuId = null;
      uiState.openAddBoardId = null;
      uiState.editItemId = null;
      deleteActiveBoardTab(boardId);
      return;
    }

    if (action === "toggle-edit-board") {
      uiState.openBoardMenuId = null;
      if (uiState.openAddBoardId === boardId) {
        uiState.openAddBoardId = null;
      }
      uiState.editItemId = null;
      uiState.editBoardId = uiState.editBoardId === boardId ? null : boardId;
      rerenderBoardInPlace(boardId);
      if (uiState.editBoardId === boardId) {
        const input = app.querySelector('.board-meta-form[data-board-id="' + cssEscape(boardId) + '"] input[name="title"]');
        focusField(input, true);
      }
      return;
    }

    if (action === "cancel-edit-board") {
      uiState.editBoardId = null;
      uiState.editItemId = null;
      rerenderBoardInPlace(boardId);
      return;
    }

    if (action === "toggle-view-mode") {
      uiState.openBoardMenuId = null;
      mutateBoardUiPreference(boardId, function (board) {
        return Object.assign({}, board, {
          displayMode: nextDisplayMode(board.displayMode)
        });
      });
      return;
    }

    if (action === "cycle-icon-size") {
      uiState.openBoardMenuId = null;
      mutateBoardUiPreference(boardId, function (board) {
        return Object.assign({}, board, {
          iconSize: nextIconSize(board.iconSize)
        });
      });
      return;
    }

    if (action === "toggle-collapse") {
      uiState.openBoardMenuId = null;
      if (uiState.openAddBoardId === boardId) {
        uiState.openAddBoardId = null;
      }
      mutateBoardSessionState(boardId, function (board) {
        return Object.assign({}, board, { collapsed: !board.collapsed });
      });
      return;
    }

    if (action === "expand-board-to-fit") {
      expandBoardToFit(boardId);
      return;
    }

    if (action === "shrink-board-to-min") {
      if (boardId) {
        updateBoardHeightInPlace(boardId, MIN_BOARD_HEIGHT);
      }
      return;
    }

    if (action === "toggle-add") {
      if (!auth.isAdmin) {
        uiState.openAddBoardId = null;
        rerenderBoardInPlace(boardId);
        return;
      }
      uiState.openBoardMenuId = null;
      uiState.editItemId = null;
      if (uiState.editBoardId === boardId) {
        uiState.editBoardId = null;
      }
      const board = findBoard(boardId);
      if (board && board.collapsed) {
        state.boards = state.boards.map(function (entry) {
          return entry.id === boardId ? Object.assign({}, entry, { collapsed: false }) : entry;
        });
      }
      uiState.openAddBoardId = uiState.openAddBoardId === boardId ? null : boardId;
      rerenderBoardInPlace(boardId);
      const input = app.querySelector('.board-add-form--floating[data-board-id="' + cssEscape(boardId) + '"] input[name="url"]');
      focusField(input, false);
      return;
    }

    if (action === "import-board") {
      if (!auth.isAdmin || uiState.importingBoardId) {
        return;
      }
      uiState.openBoardMenuId = null;
      rerenderBoardInPlace(boardId);
      pickFileForBoard(boardId);
      return;
    }

    if (action === "export-board") {
      const board = findBoard(boardId);
      uiState.openBoardMenuId = null;
      rerenderBoardInPlace(boardId);
      if (board) {
        exportBoardToCsv(board);
      }
      return;
    }

    if (action === "delete-board") {
      uiState.openBoardMenuId = null;
      const board = findBoard(boardId);
      if (!board) {
        return;
      }

      if (board.items.length > 0) {
        const confirmed = window.confirm(TEXT.deleteBoardConfirm.replace("{count}", String(board.items.length)));
        if (!confirmed) {
          return;
        }
      }

      state.boards = state.boards.filter(function (entry) {
        return entry.id !== boardId;
      });
      if (uiState.openAddBoardId === boardId) {
        uiState.openAddBoardId = null;
      }
      if (uiState.editBoardId === boardId) {
        uiState.editBoardId = null;
      }
      saveBoards();
      render();
      return;
    }

    if (action === "cancel-add") {
      uiState.openAddBoardId = null;
      rerenderBoardInPlace(boardId);
      return;
    }

    if (action === "delete-item") {
      if (!auth.isAdmin) {
        return;
      }
      const itemId = button.getAttribute("data-item-id");
      if (!boardId || !itemId) {
        return;
      }
      if (uiState.editItemId === itemId) {
        uiState.editItemId = null;
      }
      removeBoardItemInPlace(boardId, itemId);
      return;
    }

    if (action === "edit-item") {
      if (!auth.isAdmin) {
        return;
      }
      const itemId = button.getAttribute("data-item-id");
      if (!boardId || !itemId) {
        return;
      }
      uiState.openBoardMenuId = null;
      uiState.openAddBoardId = null;
      uiState.editBoardId = boardId;
      uiState.editItemId = itemId;
      rerenderBoardInPlace(boardId);
      const input = app.querySelector('.item-edit-form[data-item-id="' + cssEscape(itemId) + '"] input[name="name"]');
      focusField(input, true);
      return;
    }

    if (action === "cancel-edit-item") {
      uiState.editItemId = null;
      rerenderBoardInPlace(boardId);
      return;
    }

    if (action === "autofill-item-meta") {
      if (!auth.isAdmin) return;
      const form = button.closest('[data-role="item-edit-form"]');
      if (!form) return;
      const urlInput = form.querySelector('input[name="url"]');
      const nameInput = form.querySelector('input[name="name"]');
      const descInput = form.querySelector('textarea[name="description"]');
      let url;
      try {
        url = normalizeUrl(urlInput && urlInput.value);
      } catch (error) {
        window.alert(TEXT.invalidUrl);
        return;
      }
      if (urlInput) urlInput.value = url;
      button.disabled = true;
      apiSend("/url-titles", "POST", { urls: [url] }).then(function (results) {
        const meta = Array.isArray(results) ? results[0] : null;
        resetItemFormIconToFavicon(form, url);
        if (nameInput && meta && typeof meta.title === "string" && meta.title.trim()) {
          nameInput.value = normalizeItemName(meta.title);
        }
        if (descInput && meta && typeof meta.description === "string" && meta.description.trim()) {
          descInput.value = meta.description.trim().slice(0, BOARD_ITEM_DESCRIPTION_MAX_LENGTH);
        }
      }).catch(function (error) {
        if (error && (error.status === 401 || error.status === 403)) {
          handleAuthExpired();
          window.alert(TEXT.autofillLoginExpired);
          return;
        }
        window.alert(TEXT.autofillFailed);
      }).finally(function () {
        button.disabled = false;
      });
      return;
    }
  });
}
