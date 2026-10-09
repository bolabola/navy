// 拖拽、指针与全局事件
import { beginBoardDrag, endBoardDrag, updateBoardDrag } from "../boardDrag.js";
import { DEFAULT_TAB_ID } from "../constants.js";
import { updateBoardOverflowIndicators } from "../render.js";
import { closeAllIconPickers } from "../renderBoard.js";
import { beginResize, endResize, updateResize } from "../resize.js";
import { finishRowDrag, getNextItemIdAfter, getRowDropTarget, markRowDropTarget, moveItem } from "../rowDrag.js";
import { app, auth, state, uiState } from "../state.js";
import { syncBoardWallLayout } from "../wall.js";

export function installPointerHandlers() {
  app.addEventListener("dragstart", function (event) {
    if (!auth.isAdmin) {
      event.preventDefault();
      return;
    }
    const row = event.target.closest('[data-role="link-row"]');
    if (!row) {
      return;
    }

    const iconMode = row.classList.contains("link-row--icon-only");
    const boardId = row.getAttribute("data-board-id");
    const itemId = row.getAttribute("data-item-id");
    const sourceTabId = row.getAttribute("data-tab-id") || DEFAULT_TAB_ID;
    const sourceNextItemId = getNextItemIdAfter(boardId, itemId);
    const sourceRect = row.getBoundingClientRect();

    uiState.draggingRow = {
      boardId: boardId,
      itemId: itemId,
      sourceTabId: sourceTabId,
      sourceNextItemId: sourceNextItemId,
      sourceWidth: sourceRect.width,
      sourceHeight: sourceRect.height,
      targetBoardId: boardId,
      targetItemId: sourceNextItemId,
      targetTabId: sourceTabId,
      dragImageNode: null
    };

    if (iconMode) {
      const rect = row.getBoundingClientRect();
      const dragImageNode = row.cloneNode(true);
      dragImageNode.classList.add("link-row-drag-image");
      dragImageNode.style.width = rect.width + "px";
      dragImageNode.style.height = rect.height + "px";
      dragImageNode.style.left = "-9999px";
      dragImageNode.style.top = "-9999px";
      document.body.appendChild(dragImageNode);
      uiState.draggingRow.dragImageNode = dragImageNode;
      event.dataTransfer.setDragImage(dragImageNode, rect.width / 2, rect.height / 2);
    }

    row.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", JSON.stringify(uiState.draggingRow));
  });

  app.addEventListener("dragover", function (event) {
    if (!uiState.draggingRow) {
      return;
    }

    const target = getRowDropTarget(event);
    if (target) {
      event.preventDefault();
      markRowDropTarget(target.boardId, target.itemId, target.tabId);
    }
  });

  app.addEventListener("drop", function (event) {
    if (!uiState.draggingRow) {
      return;
    }

    const target = getRowDropTarget(event);
    if (target) {
      event.preventDefault();
      moveItem(
        uiState.draggingRow.boardId,
        uiState.draggingRow.itemId,
        target.boardId,
        target.itemId,
        target.tabId
      );
      finishRowDrag();
      uiState.draggingRow = null;
    }
  });

  app.addEventListener("dragend", function () {
    finishRowDrag();
    uiState.draggingRow = null;
  });

  app.addEventListener("pointerdown", function (event) {
    if (event.target.closest("[data-action]")) {
      return;
    }
    // 拖拽排序和调整高度会修改布局，只对管理员开放。
    if (!auth.isAdmin) {
      return;
    }

    const resizeHandle = event.target.closest('[data-role="resize-handle"]');
    if (resizeHandle) {
      beginResize(resizeHandle.getAttribute("data-board-id"), resizeHandle, event);
      return;
    }

    const boardHandle = event.target.closest('[data-role="board-drag-handle"]');
    if (boardHandle) {
      if (event.target.closest("button, a, input, textarea, select, [contenteditable], .board-card__actions")) {
        return;
      }
      beginBoardDrag(boardHandle.getAttribute("data-board-id"), event);
    }
  });

  document.addEventListener("pointermove", function (event) {
    updateResize(event);
    updateBoardDrag(event);
  });

  document.addEventListener("pointerup", function (event) {
    endResize(event);
    endBoardDrag();
  });

  document.addEventListener("pointercancel", function (event) {
    endResize(event);
    endBoardDrag();
  });

  window.addEventListener("resize", function () {
    clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(function () {
      syncBoardWallLayout();
      updateBoardOverflowIndicators();
    }, 200);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeAllIconPickers(app);
    }
  });

  app.addEventListener("error", function (event) {
    if (event.target.tagName !== "IMG") {
      return;
    }

    const icon = event.target.closest(".link-row__icon");
    if (icon) {
      icon.classList.add("is-fallback");
    }
  }, true);
}
