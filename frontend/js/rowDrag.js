// 条目拖拽排序
import { findBoard, getBoardActiveTabId, getBoardItemsForTab, getBoardTabs } from "./boards.js";
import { DEFAULT_TAB_ID } from "./constants.js";
import { cssEscape } from "./dom.js";
import { normalizeActiveTabId, saveBoards } from "./model.js";
import { rerenderBoardInPlace, scheduleRowDragLayoutSync } from "./render.js";
import { app, state, uiState } from "./state.js";
import { syncBoardWallLayout } from "./wall.js";

export function clearRowDropIndicators() {
  app.querySelectorAll(".is-drop-target, .is-drop-before, .is-dragging, .is-drag-collapsed").forEach(function (node) {
    node.classList.remove("is-drop-target", "is-drop-before", "is-dragging", "is-drag-collapsed");
  });
  app.querySelectorAll(".link-row-placeholder").forEach(function (node) {
    node.remove();
  });

  if (uiState.draggingRow) {
    if (uiState.draggingRow.dragImageNode) {
      uiState.draggingRow.dragImageNode.remove();
      uiState.draggingRow.dragImageNode = null;
    }
    uiState.draggingRow.targetBoardId = null;
    uiState.draggingRow.targetItemId = null;
    uiState.draggingRow.targetTabId = null;
  }
}

export function finishRowDrag() {
  clearRowDropIndicators();
  if (uiState.rowDragLayoutFrame) {
    window.cancelAnimationFrame(uiState.rowDragLayoutFrame);
    uiState.rowDragLayoutFrame = null;
  }
  syncBoardWallLayout();
}

export function getNextItemIdAfter(boardId, itemId) {
  const board = findBoard(boardId);
  if (!board) {
    return null;
  }

  const item = board.items.find(function (entry) {
    return entry.id === itemId;
  });
  if (!item) {
    return null;
  }

  const tabId = item.tabId || DEFAULT_TAB_ID;
  const tabItems = getBoardItemsForTab(board, tabId);
  const index = tabItems.findIndex(function (entry) {
    return entry.id === itemId;
  });
  const nextItem = index >= 0 ? tabItems[index + 1] : null;
  return nextItem ? nextItem.id : null;
}

export function createRowPlaceholder(list) {
  const placeholder = document.createElement("div");
  placeholder.className = "link-row-placeholder";
  if (list.classList.contains("board-list--icons")) {
    placeholder.classList.add("link-row-placeholder--icon");
    return placeholder;
  }

  if (uiState.draggingRow && uiState.draggingRow.sourceHeight) {
    placeholder.style.height = uiState.draggingRow.sourceHeight + "px";
    placeholder.style.minHeight = uiState.draggingRow.sourceHeight + "px";
  }
  return placeholder;
}

export function isOriginalRowDropTarget(boardId, itemId, tabId) {
  return uiState.draggingRow &&
    boardId === uiState.draggingRow.boardId &&
    tabId === uiState.draggingRow.sourceTabId &&
    itemId === uiState.draggingRow.sourceNextItemId;
}

export function getItemInsertIndex(items, beforeItemId, tabId) {
  if (beforeItemId) {
    const beforeIndex = items.findIndex(function (entry) { return entry.id === beforeItemId; });
    if (beforeIndex >= 0) return beforeIndex;
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    if ((items[index].tabId || DEFAULT_TAB_ID) === tabId) {
      return index + 1;
    }
  }

  return items.length;
}

export function moveItem(fromBoardId, itemId, toBoardId, beforeItemId, toTabId) {
  if (!fromBoardId || !itemId || !toBoardId) {
    return;
  }

  const sourceBoard = findBoard(fromBoardId);
  const item = sourceBoard && sourceBoard.items.find(function (entry) {
    return entry.id === itemId;
  });
  if (!item) {
    return;
  }
  const sourceTabId = item.tabId || DEFAULT_TAB_ID;
  const targetBoard = findBoard(toBoardId);
  const targetTabId = normalizeActiveTabId(toTabId || getBoardActiveTabId(targetBoard), getBoardTabs(targetBoard));
  const itemForTarget = Object.assign({}, item, { tabId: targetTabId });

  if (fromBoardId === toBoardId && sourceTabId === targetTabId && (beforeItemId === itemId || isOriginalRowDropTarget(toBoardId, beforeItemId, targetTabId))) {
    return;
  }

  if (fromBoardId === toBoardId) {
    state.boards = state.boards.map(function (board) {
      if (board.id !== fromBoardId) {
        return board;
      }

      const items = board.items.filter(function (entry) {
        return entry.id !== itemId;
      });
      const index = getItemInsertIndex(items, beforeItemId, targetTabId);
      items.splice(index, 0, itemForTarget);
      return Object.assign({}, board, { items: items });
    });

    saveBoards();
    rerenderBoardInPlace(fromBoardId);
    return;
  }

  state.boards = state.boards.map(function (board) {
    if (board.id === fromBoardId) {
      return Object.assign({}, board, {
        items: board.items.filter(function (entry) {
          return entry.id !== itemId;
        })
      });
    }

    if (board.id === toBoardId) {
      const items = board.items.slice();
      const index = getItemInsertIndex(items, beforeItemId, targetTabId);
      items.splice(index, 0, itemForTarget);
      return Object.assign({}, board, { items: items });
    }

    return board;
  });

  saveBoards();
  rerenderBoardInPlace(fromBoardId);
  rerenderBoardInPlace(toBoardId);
}

export function markRowDropTarget(boardId, itemId, tabId) {
  if (!uiState.draggingRow) {
    return;
  }

  if (uiState.draggingRow.targetBoardId === boardId && uiState.draggingRow.targetItemId === itemId && uiState.draggingRow.targetTabId === tabId) {
    return;
  }

  clearRowDropIndicators();
  uiState.draggingRow.targetBoardId = boardId;
  uiState.draggingRow.targetItemId = itemId;
  uiState.draggingRow.targetTabId = tabId;

  const dragged = app.querySelector('[data-role="link-row"][data-item-id="' + cssEscape(uiState.draggingRow.itemId) + '"]');
  const originalTarget = isOriginalRowDropTarget(boardId, itemId, tabId);
  if (dragged) {
    dragged.classList.add(originalTarget ? "is-dragging" : "is-drag-collapsed");
  }

  if (originalTarget) {
    scheduleRowDragLayoutSync();
    return;
  }

  const list = app.querySelector('.board-list[data-board-id="' + cssEscape(boardId) + '"][data-tab-id="' + cssEscape(tabId) + '"]');
  if (!list) {
    return;
  }

  const placeholder = createRowPlaceholder(list);

  if (itemId) {
    if (itemId === uiState.draggingRow.itemId && boardId === uiState.draggingRow.boardId) {
      return;
    }
    const row = app.querySelector('[data-role="link-row"][data-board-id="' + cssEscape(boardId) + '"][data-item-id="' + cssEscape(itemId) + '"]');
    if (row) {
      list.insertBefore(placeholder, row);
      scheduleRowDragLayoutSync();
      return;
    }
  }

  list.appendChild(placeholder);
  scheduleRowDragLayoutSync();
}

export function getIconModeBeforeItemId(list, clientX, clientY) {
  const nodes = Array.from(list.querySelectorAll('[data-role="link-row"]')).filter(function (node) {
    return !uiState.draggingRow || node.getAttribute("data-item-id") !== uiState.draggingRow.itemId;
  });
  if (!nodes.length) {
    return null;
  }

  const visualRows = [];
  nodes.forEach(function (node) {
    const rect = node.getBoundingClientRect();
    const lastRow = visualRows[visualRows.length - 1];
    if (!lastRow || Math.abs(lastRow.top - rect.top) > 8) {
      visualRows.push({
        top: rect.top,
        bottom: rect.bottom,
        items: [{ node: node, rect: rect }]
      });
      return;
    }

    lastRow.bottom = Math.max(lastRow.bottom, rect.bottom);
    lastRow.items.push({ node: node, rect: rect });
  });

  for (let rowIndex = 0; rowIndex < visualRows.length; rowIndex += 1) {
    const row = visualRows[rowIndex];
    const nextRow = visualRows[rowIndex + 1];
    row.items.sort(function (left, right) {
      return left.rect.left - right.rect.left;
    });

    const rowBandEnd = nextRow ? (row.bottom + nextRow.top) / 2 : Infinity;
    if (clientY <= rowBandEnd) {
      for (let itemIndex = 0; itemIndex < row.items.length; itemIndex += 1) {
        const item = row.items[itemIndex];
        if (clientX < item.rect.left + item.rect.width / 2) {
          return item.node.getAttribute("data-item-id");
        }
      }

      return nextRow ? nextRow.items[0].node.getAttribute("data-item-id") : null;
    }
  }

  return null;
}

export function getListModeBeforeItemId(list, clientY) {
  const nodes = Array.from(list.querySelectorAll('[data-role="link-row"]')).filter(function (node) {
    return !uiState.draggingRow || node.getAttribute("data-item-id") !== uiState.draggingRow.itemId;
  });

  for (let index = 0; index < nodes.length; index += 1) {
    const rect = nodes[index].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      return nodes[index].getAttribute("data-item-id");
    }
  }

  return null;
}

export function getRowDropTarget(event) {
  const list = event.target.closest('[data-role="board-list"]');
  if (!list) {
    return null;
  }

  if (list.classList.contains("board-list--icons")) {
    return {
      boardId: list.getAttribute("data-board-id"),
      tabId: list.getAttribute("data-tab-id") || DEFAULT_TAB_ID,
      itemId: getIconModeBeforeItemId(list, event.clientX, event.clientY)
    };
  }

  return {
    boardId: list.getAttribute("data-board-id"),
    tabId: list.getAttribute("data-tab-id") || DEFAULT_TAB_ID,
    itemId: getListModeBeforeItemId(list, event.clientY)
  };
}
