// 列布局与瀑布流计算
import { MAX_LAYOUT_COLUMN_WIDTH, MAX_LAYOUT_GAP, MAX_MANUAL_COLUMNS, MIN_LAYOUT_COLUMN_WIDTH, MIN_LAYOUT_GAP } from "../../shared/limits";
import { BOARD_WIDTH, SINGLE_COLUMN_SIDE_GUTTER } from "./constants.js";
import { getBoardRenderedHeight } from "./render.js";
import { renderBoard } from "./renderBoard.js";
import { app, state, uiState } from "./state.js";

export function getColumnCount(containerWidth) {
  const columnWidth = getConfiguredColumnWidth();
  const columnGap = getLayoutColumnGap();
  if (containerWidth < columnWidth * 2 + columnGap) {
    return 1;
  }

  if (state.layoutSettings.columnMode === "manual") {
    return Math.min(MAX_MANUAL_COLUMNS, Math.max(1, state.layoutSettings.columns));
  }

  return Math.max(2, Math.floor((containerWidth + columnGap) / (columnWidth + columnGap)));
}

export function getConfiguredColumnWidth() {
  return Math.min(MAX_LAYOUT_COLUMN_WIDTH, Math.max(MIN_LAYOUT_COLUMN_WIDTH, state.layoutSettings.columnWidth || BOARD_WIDTH));
}

export function getLayoutColumnGap() {
  return Math.min(MAX_LAYOUT_GAP, Math.max(MIN_LAYOUT_GAP, Number(state.layoutSettings.columnGap)));
}

export function getLayoutRowGap() {
  return Math.min(MAX_LAYOUT_GAP, Math.max(MIN_LAYOUT_GAP, Number(state.layoutSettings.rowGap)));
}

export function getColumnWidth(columns, contentWidth, sideGutter) {
  if (columns === 1) {
    return Math.max(0, contentWidth - sideGutter * 2);
  }

  return getConfiguredColumnWidth();
}

export function getLayoutSideGutter(columns, contentWidth, actualWidth) {
  if (columns === 1) {
    return Math.min(SINGLE_COLUMN_SIDE_GUTTER, Math.floor(contentWidth / 2));
  }

  if (state.layoutSettings.align === "center" && actualWidth < contentWidth) {
    return Math.floor((contentWidth - actualWidth) / 2);
  }

  return 0;
}

export function shouldUseStoredColumns(entries, columns) {
  if (columns <= 1 || entries.length <= 1) {
    return true;
  }

  const storedColumns = entries
    .filter(function (entry) {
      return Number.isInteger(entry.column);
    })
    .map(function (entry) {
      return Math.min(Math.max(entry.column, 0), columns - 1);
    });

  if (storedColumns.length !== entries.length) {
    return false;
  }

  return new Set(storedColumns).size > 1;
}

export function createColumnBuckets(entries, columns) {
  const buckets = Array.from({ length: columns }, function () {
    return [];
  });
  const useStoredColumns = shouldUseStoredColumns(entries, columns);

  entries.forEach(function (entry, index) {
    const targetColumn = useStoredColumns && Number.isInteger(entry.column)
      ? Math.min(Math.max(entry.column, 0), columns - 1)
      : index % columns;
    buckets[targetColumn].push(entry);
  });

  return buckets;
}

export function getNextBoardColumn(columns) {
  if (!columns || columns < 1) {
    return null;
  }

  const buckets = createColumnBuckets(state.boards.slice(), columns);
  let targetColumn = 0;
  let minLength = buckets[0].length;

  for (let columnIndex = 1; columnIndex < buckets.length; columnIndex += 1) {
    if (buckets[columnIndex].length < minLength) {
      minLength = buckets[columnIndex].length;
      targetColumn = columnIndex;
    }
  }

  return targetColumn;
}

export function materializeColumnBuckets(columnBuckets) {
  const nextBoards = [];

  columnBuckets.forEach(function (bucket, columnIndex) {
    bucket.forEach(function (entry) {
      if (entry.placeholder) {
        return;
      }

      nextBoards.push(Object.assign({}, entry, { column: columnIndex }));
    });
  });

  return nextBoards;
}

export function reflowBoardColumns(columns) {
  const safeColumns = Math.min(MAX_MANUAL_COLUMNS, Math.max(1, Number(columns) || 1));
  const buckets = Array.from({ length: safeColumns }, function () {
    return [];
  });

  state.boards.forEach(function (board, index) {
    const column = index % safeColumns;
    buckets[column].push(Object.assign({}, board, { column: column }));
  });

  state.boards = materializeColumnBuckets(buckets);
}

export function getPreviewColumnBuckets(columns) {
  const buckets = createColumnBuckets(state.boards.slice(), columns);
  if (!uiState.boardDragging) {
    return buckets;
  }

  const dragging = uiState.boardDragging;
  for (let columnIndex = 0; columnIndex < buckets.length; columnIndex += 1) {
    buckets[columnIndex] = buckets[columnIndex].filter(function (entry) {
      return entry.id !== dragging.boardId;
    });
  }

  const targetColumn = Math.min(Math.max(dragging.dropColumn, 0), buckets.length - 1);
  const targetBucket = buckets[targetColumn];
  const targetRow = Math.min(Math.max(dragging.dropRow, 0), targetBucket.length);
  targetBucket.splice(targetRow, 0, {
    id: dragging.boardId,
    placeholder: true,
    height: dragging.height
  });

  return buckets;
}

export function buildMasonryLayout() {
  const dragging = uiState.boardDragging;
  const scroll = dragging && dragging.runtime ? dragging.runtime.scrollNode : app.querySelector(".board-wall-scroll");
  const contentWidth = dragging && dragging.metrics
    ? dragging.metrics.contentWidth
    : (scroll ? scroll.clientWidth : window.innerWidth - 20);

  let columns;
  let columnWidth;
  let columnGap;
  let rowGap;
  let sideGutter;

  if (dragging && dragging.metrics) {
    columns = dragging.metrics.columns;
    columnWidth = dragging.metrics.columnWidth;
    columnGap = dragging.metrics.columnGap;
    rowGap = dragging.metrics.rowGap;
    sideGutter = dragging.metrics.sideGutter != null ? dragging.metrics.sideGutter : 0;
  } else {
    columns = getColumnCount(contentWidth);
    columnGap = getLayoutColumnGap();
    rowGap = getLayoutRowGap();

    if (columns === 1) {
      sideGutter = getLayoutSideGutter(1, contentWidth, 0);
      columnWidth = getColumnWidth(1, contentWidth, sideGutter);
    } else {
      columnWidth = getColumnWidth(columns, contentWidth, 0);
      const rawWidth = columns * columnWidth + Math.max(0, columns - 1) * columnGap;
      sideGutter = getLayoutSideGutter(columns, contentWidth, rawWidth);
    }
  }

  const actualWidth = columns * columnWidth + Math.max(0, columns - 1) * columnGap;
  const heights = Array(columns).fill(0);
  const positions = [];
  const columnEntries = Array.from({ length: columns }, function () {
    return [];
  });
  const buckets = getPreviewColumnBuckets(columns);

  buckets.forEach(function (bucket, columnIndex) {
    bucket.forEach(function (entry, rowIndex) {
      const x = columnIndex * (columnWidth + columnGap);
      const y = heights[columnIndex];
      const height = entry.placeholder
        ? entry.height
        : getBoardRenderedHeight(entry.id);

      const position = {
        type: entry.placeholder ? "placeholder" : "board",
        boardId: entry.id,
        board: entry.placeholder ? null : entry,
        x: x,
        y: y,
        width: columnWidth,
        height: height,
        column: columnIndex,
        row: rowIndex
      };
      positions.push(position);
      if (!entry.placeholder) {
        columnEntries[columnIndex].push(position);
      }

      heights[columnIndex] += height + rowGap;
    });
  });

  return {
    positions: positions,
    columnEntries: columnEntries,
    width: actualWidth,
    height: Math.max(0, Math.max.apply(null, heights) - rowGap),
    columns: columns,
    sideGutter: sideGutter,
    columnGap: columnGap,
    rowGap: rowGap
  };
}

export function renderBoardLayer() {
  const fragment = document.createDocumentFragment();
  state.masonryLayout.positions.forEach(function (entry) {
    if (entry.type === "placeholder") {
      const placeholder = document.createElement("div");
      placeholder.className = "board-card board-card--placeholder";
      placeholder.style.width = entry.width + "px";
      placeholder.style.height = entry.height + "px";
      placeholder.style.transform = "translate3d(" + entry.x + "px, " + entry.y + "px, 0)";
      fragment.appendChild(placeholder);
      return;
    }

    const slot = document.createElement("div");
    slot.className = "board-slot" + (uiState.openBoardMenuId === entry.boardId ? " has-open-menu" : "");
    slot.dataset.boardId = entry.boardId;
    slot.style.width = entry.width + "px";
    slot.style.transform = "translate3d(" + entry.x + "px, " + entry.y + "px, 0)";
    slot.appendChild(renderBoard(entry.board));
    fragment.appendChild(slot);
  });
  return fragment;
}
