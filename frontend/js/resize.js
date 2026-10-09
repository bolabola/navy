// board 高度调整
import { findBoard } from "./boards.js";
import { clampHeight, cssEscape } from "./dom.js";
import { buildMasonryLayout } from "./layout.js";
import {
  getBoardMinimumListHeight,
  updateBoardHeightInPlace,
  updateBoardOverflowIndicators,
  updateBoardResizeControls
} from "./render.js";
import { collectBoardHeightMap } from "./renderBoard.js";
import { app, state, uiState } from "./state.js";
import { applyBoardWallLayoutStyles } from "./wall.js";

export function beginResize(boardId, handle, event) {
  const board = findBoard(boardId);
  if (!board) {
    return;
  }

  event.preventDefault();
  if (handle && handle.setPointerCapture && event.pointerId !== undefined) {
    handle.setPointerCapture(event.pointerId);
  }
  const card = app.querySelector('.board-slot[data-board-id="' + cssEscape(boardId) + '"] .board-card');
  const list = card ? card.querySelector('[data-role="board-list"]') : null;
  const visibleListHeight = list ? list.getBoundingClientRect().height : board.height;
  const startHeight = Math.min(board.height, visibleListHeight);
  uiState.resizing = {
    boardId: boardId,
    pointerId: event.pointerId,
    handle: handle,
    startY: event.clientY,
    startHeight: startHeight,
    nextHeight: startHeight,
    heightMap: collectBoardHeightMap()
  };
  document.body.classList.add("is-resizing");
}

export function updateResize(event) {
  if (!uiState.resizing) {
    return;
  }
  if (uiState.resizing.pointerId !== undefined && event.pointerId !== uiState.resizing.pointerId) {
    return;
  }

  uiState.resizing.nextHeight = clampHeight(uiState.resizing.startHeight + (event.clientY - uiState.resizing.startY));
  const card = app.querySelector('.board-slot[data-board-id="' + cssEscape(uiState.resizing.boardId) + '"] .board-card');
  if (card) {
    const board = findBoard(uiState.resizing.boardId);
    card.style.setProperty("--list-height", Math.max(uiState.resizing.nextHeight, getBoardMinimumListHeight(board)) + "px");
    updateBoardResizeControls(card.closest(".board-slot"), uiState.resizing.nextHeight);
    uiState.resizing.heightMap[uiState.resizing.boardId] = card.getBoundingClientRect().height;
    updateBoardOverflowIndicators(card.closest(".board-slot") || card);
  }
  scheduleResizeLayoutSync();
}

export function scheduleResizeLayoutSync() {
  if (!uiState.resizing || uiState.resizeFrame) {
    return;
  }

  uiState.resizeFrame = window.requestAnimationFrame(function () {
    uiState.resizeFrame = null;
    if (uiState.resizing) {
      syncResizeBoardWallLayout();
    }
  });
}

export function syncResizeBoardWallLayout() {
  const resizing = uiState.resizing;
  if (!resizing) {
    return;
  }

  state.masonryLayout = buildMasonryLayout();

  const wall = app.querySelector(".board-wall");
  if (!wall) {
    return;
  }

  applyBoardWallLayoutStyles(wall);

  state.masonryLayout.positions.forEach(function (entry) {
    if (entry.type !== "board" || entry.boardId === resizing.boardId) {
      return;
    }

    const slot = wall.querySelector('.board-slot[data-board-id="' + cssEscape(entry.boardId) + '"]');
    if (slot) {
      slot.style.width = entry.width + "px";
      slot.style.transform = "translate(" + entry.x + "px, " + entry.y + "px)";
    }
  });
}

export function endResize(event) {
  if (!uiState.resizing) {
    return;
  }
  if (event && uiState.resizing.pointerId !== undefined && event.pointerId !== uiState.resizing.pointerId) {
    return;
  }

  const payload = uiState.resizing;
  uiState.resizing = null;
  if (uiState.resizeFrame) {
    window.cancelAnimationFrame(uiState.resizeFrame);
    uiState.resizeFrame = null;
  }
  document.body.classList.remove("is-resizing");
  if (payload.handle && payload.handle.releasePointerCapture && payload.pointerId !== undefined) {
    try {
      payload.handle.releasePointerCapture(payload.pointerId);
    } catch (error) {
      // Pointer capture may already be released by the browser.
    }
  }

  updateBoardHeightInPlace(payload.boardId, payload.nextHeight);
}
