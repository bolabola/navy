// board 拖拽
import { findBoard } from "./boards.js";
import { BOARD_WIDTH } from "./constants.js";
import { cssEscape } from "./dom.js";
import { createColumnBuckets, getLayoutColumnGap, getLayoutRowGap, materializeColumnBuckets } from "./layout.js";
import { saveBoards } from "./model.js";
import { render } from "./render.js";
import { collectBoardHeightMap, renderBoard } from "./renderBoard.js";
import { app, state, uiState } from "./state.js";
import { syncBoardWallLayout } from "./wall.js";

export function renderDragGhost() {
  if (!uiState.boardDragging || !uiState.boardDragging.hasMoved) {
    return null;
  }

  const ghost = document.createElement("div");
  ghost.className = "board-drag-ghost";
  ghost.style.width = uiState.boardDragging.width + "px";
  ghost.style.height = uiState.boardDragging.height + "px";

  const sourceSlot = app.querySelector('.board-slot[data-board-id="' + cssEscape(uiState.boardDragging.boardId) + '"]');
  const sourceCard = sourceSlot ? sourceSlot.querySelector(".board-card") : null;
  if (sourceCard) {
    ghost.appendChild(sourceCard.cloneNode(true));
  } else {
    const board = findBoard(uiState.boardDragging.boardId);
    if (board) ghost.appendChild(renderBoard(board, "is-board-dragging"));
  }

  return ghost;
}

export function updateDragGhostPosition() {
  if (!uiState.boardDragging) {
    return;
  }

  const ghost = uiState.boardDragging.runtime && uiState.boardDragging.runtime.ghostNode
    ? uiState.boardDragging.runtime.ghostNode
    : app.querySelector(".board-drag-ghost");
  if (!ghost) {
    return;
  }

  ghost.style.transform = "translate3d(" + uiState.boardDragging.ghostLeft + "px, " + uiState.boardDragging.ghostTop + "px, 0)";
}

export function hydrateBoardDragRuntime() {
  if (!uiState.boardDragging) {
    return;
  }

  const slotNodes = {};
  app.querySelectorAll(".board-slot[data-board-id]").forEach(function (node) {
    slotNodes[node.getAttribute("data-board-id")] = node;
  });

  const scrollNode = app.querySelector(".board-wall-scroll");
  const scrollRect = scrollNode ? scrollNode.getBoundingClientRect() : { left: 0, top: 0 };
  uiState.boardDragging.runtime = {
    wallNode: app.querySelector(".board-wall"),
    ghostNode: app.querySelector(".board-drag-ghost"),
    placeholderNode: app.querySelector(".board-card--placeholder"),
    slotNodes: slotNodes,
    scrollNode: scrollNode,
    scrollRectLeft: scrollRect.left,
    scrollRectTop: scrollRect.top,
    wallHeight: state.masonryLayout.height
  };

  uiState.boardDragging.metrics = {
    contentWidth: scrollNode ? scrollNode.clientWidth : window.innerWidth - 20,
    columns: state.masonryLayout.columns,
    columnWidth: state.masonryLayout.positions[0] ? state.masonryLayout.positions[0].width : BOARD_WIDTH,
    columnGap: state.masonryLayout.columnGap != null ? state.masonryLayout.columnGap : getLayoutColumnGap(),
    rowGap: state.masonryLayout.rowGap != null ? state.masonryLayout.rowGap : getLayoutRowGap(),
    sideGutter: state.masonryLayout.sideGutter != null ? state.masonryLayout.sideGutter : 0
  };
}

export function beginBoardDragPreview() {
  if (!uiState.boardDragging || !uiState.boardDragging.hasMoved) {
    return;
  }

  const wall = app.querySelector(".board-wall");
  const sourceSlot = app.querySelector('.board-slot[data-board-id="' + cssEscape(uiState.boardDragging.boardId) + '"]');
  const ghost = renderDragGhost();
  if (!wall || !sourceSlot || !ghost) {
    render();
    return;
  }

  const placeholder = document.createElement("div");
  placeholder.className = "board-card board-card--placeholder";
  placeholder.style.width = sourceSlot.style.width || uiState.boardDragging.width + "px";
  placeholder.style.height = uiState.boardDragging.height + "px";
  placeholder.style.transform = sourceSlot.style.transform || "";
  ghost.style.transform = "translate3d(" + uiState.boardDragging.ghostLeft + "px, " + uiState.boardDragging.ghostTop + "px, 0)";
  wall.appendChild(placeholder);
  app.appendChild(ghost);
  sourceSlot.classList.add("is-board-drag-source");

  hydrateBoardDragRuntime();
  syncBoardWallLayout();
  updateDragGhostPosition();
}

export function getBoardDragSourceSlot(dragging) {
  const runtime = dragging && dragging.runtime;
  return runtime && runtime.slotNodes
    ? runtime.slotNodes[dragging.boardId]
    : app.querySelector('.board-slot[data-board-id="' + cssEscape(dragging.boardId) + '"]');
}

export function cleanupBoardDragPreview(dragging, keepSourceHidden) {
  const runtime = dragging && dragging.runtime;
  const wall = runtime && runtime.wallNode ? runtime.wallNode : app.querySelector(".board-wall");
  const sourceSlot = getBoardDragSourceSlot(dragging);

  if (sourceSlot && !keepSourceHidden) {
    sourceSlot.classList.remove("is-board-drag-source");
  }
  const placeholder = runtime && runtime.placeholderNode ? runtime.placeholderNode : wall && wall.querySelector(".board-card--placeholder");
  if (placeholder) {
    placeholder.remove();
  }
  const ghost = runtime && runtime.ghostNode ? runtime.ghostNode : app.querySelector(".board-drag-ghost");
  if (ghost) {
    ghost.remove();
  }
}

export function getBoardDropPositionFromPoint(clientX, clientY) {
  const dragging = uiState.boardDragging;
  const runtime = dragging && dragging.runtime;
  const scroll = runtime && runtime.scrollNode ? runtime.scrollNode : app.querySelector(".board-wall-scroll");
  const sideGutter = dragging && dragging.metrics ? dragging.metrics.sideGutter || 0 : state.masonryLayout.sideGutter || 0;
  const relativeX = clientX - (runtime ? runtime.scrollRectLeft : scroll.getBoundingClientRect().left) + scroll.scrollLeft - sideGutter;
  const relativeY = clientY - (runtime ? runtime.scrollRectTop : scroll.getBoundingClientRect().top) + scroll.scrollTop;
  const columnWidth = dragging && dragging.metrics ? dragging.metrics.columnWidth : (state.masonryLayout.positions[0] ? state.masonryLayout.positions[0].width : BOARD_WIDTH);
  const columnGap = dragging && dragging.metrics
    ? dragging.metrics.columnGap
    : (state.masonryLayout.columnGap != null ? state.masonryLayout.columnGap : getLayoutColumnGap());
  const laneWidth = columnWidth + columnGap;
  const maxColumn = Math.max(0, state.masonryLayout.columns - 1);
  const targetColumn = Math.min(Math.max(Math.floor(relativeX / laneWidth), 0), maxColumn);
  const columnEntries = (state.masonryLayout.columnEntries && state.masonryLayout.columnEntries[targetColumn])
    || state.masonryLayout.positions.filter(function (entry) {
      return entry.type === "board" && entry.column === targetColumn;
    });

  for (let rowIndex = 0; rowIndex < columnEntries.length; rowIndex += 1) {
    const entry = columnEntries[rowIndex];
    if (relativeY < entry.y + entry.height / 2) {
      return {
        column: targetColumn,
        row: rowIndex
      };
    }
  }

  return {
    column: targetColumn,
    row: columnEntries.length
  };
}

export function beginBoardDrag(boardId, event) {
  const card = app.querySelector('.board-slot[data-board-id="' + cssEscape(boardId) + '"] .board-card');
  if (!card) {
    return;
  }

  const rect = card.getBoundingClientRect();
  const scrollNode = app.querySelector(".board-wall-scroll");
  const heightMap = collectBoardHeightMap();
  const layoutEntry = state.masonryLayout.positions.find(function (entry) {
    return entry.type === "board" && entry.boardId === boardId;
  });
  uiState.boardDragging = {
    boardId: boardId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    ghostLeft: rect.left,
    ghostTop: rect.top,
    startClientX: event.clientX,
    startClientY: event.clientY,
    hasMoved: false,
    width: rect.width,
    height: rect.height,
    heightMap: heightMap,
    nextClientX: event.clientX,
    nextClientY: event.clientY,
    runtime: null,
    metrics: {
      contentWidth: scrollNode ? scrollNode.clientWidth : window.innerWidth - 20,
      columns: state.masonryLayout.columns,
      columnWidth: layoutEntry ? layoutEntry.width : rect.width,
      columnGap: state.masonryLayout.columnGap != null ? state.masonryLayout.columnGap : getLayoutColumnGap(),
      rowGap: state.masonryLayout.rowGap != null ? state.masonryLayout.rowGap : getLayoutRowGap(),
      sideGutter: state.masonryLayout.sideGutter != null ? state.masonryLayout.sideGutter : 0
    },
    dropColumn: layoutEntry ? layoutEntry.column : 0,
    dropRow: layoutEntry ? layoutEntry.row : 0
  };
}

export function updateBoardDrag(event) {
  if (!uiState.boardDragging) {
    return;
  }

  uiState.boardDragging.nextClientX = event.clientX;
  uiState.boardDragging.nextClientY = event.clientY;
  if (Math.abs(event.clientX - uiState.boardDragging.startClientX) > 3 || Math.abs(event.clientY - uiState.boardDragging.startClientY) > 3) {
    if (!uiState.boardDragging.hasMoved) {
      uiState.boardDragging.hasMoved = true;
      document.body.classList.add("is-board-dragging");
      beginBoardDragPreview();
    }
  }

  if (uiState.boardDragFrame) {
    return;
  }

  uiState.boardDragFrame = window.requestAnimationFrame(function () {
    if (!uiState.boardDragging) {
      uiState.boardDragFrame = null;
      return;
    }

    uiState.boardDragging.ghostLeft = uiState.boardDragging.nextClientX - uiState.boardDragging.offsetX;
    uiState.boardDragging.ghostTop = uiState.boardDragging.nextClientY - uiState.boardDragging.offsetY;
    updateDragGhostPosition();

    const nextDrop = getBoardDropPositionFromPoint(uiState.boardDragging.nextClientX, uiState.boardDragging.nextClientY);
    if (nextDrop.column !== uiState.boardDragging.dropColumn || nextDrop.row !== uiState.boardDragging.dropRow) {
      uiState.boardDragging.dropColumn = nextDrop.column;
      uiState.boardDragging.dropRow = nextDrop.row;
      syncBoardWallLayout();
    }

    uiState.boardDragFrame = null;
  });
}

export function endBoardDrag() {
  if (!uiState.boardDragging) {
    return;
  }

  if (uiState.boardDragFrame) {
    window.cancelAnimationFrame(uiState.boardDragFrame);
    uiState.boardDragFrame = null;
  }

  const dragging = uiState.boardDragging;
  const movingBoard = state.boards.find(function (board) {
    return board.id === dragging.boardId;
  });
  if (movingBoard && dragging.hasMoved) {
    const nextBuckets = createColumnBuckets(state.boards.slice(), state.masonryLayout.columns);
    for (let columnIndex = 0; columnIndex < nextBuckets.length; columnIndex += 1) {
      nextBuckets[columnIndex] = nextBuckets[columnIndex].filter(function (entry) {
        return entry.id !== dragging.boardId;
      });
    }

    const targetColumn = Math.min(Math.max(dragging.dropColumn, 0), nextBuckets.length - 1);
    const targetBucket = nextBuckets[targetColumn];
    const targetRow = Math.min(Math.max(dragging.dropRow, 0), targetBucket.length);
    targetBucket.splice(targetRow, 0, Object.assign({}, movingBoard, { column: targetColumn }));

    state.boards = materializeColumnBuckets(nextBuckets);
    saveBoards();
  }

  uiState.boardDragging = null;
  document.body.classList.remove("is-board-dragging");
  const sourceSlot = getBoardDragSourceSlot(dragging);
  const previousTransition = sourceSlot ? sourceSlot.style.transition : "";
  if (sourceSlot) {
    sourceSlot.style.transition = "none";
  }
  cleanupBoardDragPreview(dragging, true);
  syncBoardWallLayout();
  if (sourceSlot) {
    sourceSlot.getBoundingClientRect();
    sourceSlot.classList.remove("is-board-drag-source");
    window.requestAnimationFrame(function () {
      sourceSlot.style.transition = previousTransition;
    });
  }
}
