// 整体渲染与局部更新
import { MIN_BOARD_HEIGHT } from "../../shared/limits";
import { renderBackupsModal } from "./backup.js";
import { hydrateBoardDragRuntime, renderDragGhost, updateDragGhostPosition } from "./boardDrag.js";
import { findBoard, getBoardItemsForActiveTab, shouldShowBoardTabs } from "./boards.js";
import {
  BOARD_ADD_FORM_HEIGHT,
  BOARD_CHROME_HEIGHT,
  BOARD_COLLAPSED_HEIGHT,
  BOARD_DETAIL_ROW_GAP,
  BOARD_DETAIL_ROW_HEIGHT,
  BOARD_HEADER_HEIGHT,
  BOARD_ICON_TILE_GAP,
  BOARD_ICON_TILE_SIZE,
  BOARD_ITEM_EDIT_FORM_EXTRA_HEIGHT,
  BOARD_LIST_MIN_HEIGHT,
  BOARD_META_FORM_HEIGHT,
  BOARD_ROW_GAP,
  BOARD_ROW_HEIGHT,
  BOARD_TABS_HEIGHT,
  TEXT
} from "./constants.js";
import { actionButton, clampHeight, cssEscape, staticIconNode } from "./dom.js";
import { buildMasonryLayout, renderBoardLayer } from "./layout.js";
import { getBoardIconTileSize, saveBoards } from "./model.js";
import { renderCreateBoardModal, renderLoginModal, renderMoveBoardModal, renderNavbar } from "./navbar.js";
import { animateBoardFlip, bindIconPickers, captureBoardRects, renderBoard } from "./renderBoard.js";
import { app, auth, state, uiState } from "./state.js";
import { applyBoardWallLayoutStyles, syncBoardWallLayout } from "./wall.js";

export function scheduleRowDragLayoutSync() {
  if (uiState.rowDragLayoutFrame) {
    return;
  }

  uiState.rowDragLayoutFrame = window.requestAnimationFrame(function () {
    uiState.rowDragLayoutFrame = null;
    if (uiState.draggingRow && !uiState.boardDragging && !uiState.resizing) {
      syncBoardWallLayout();
    }
  });
}

export function rerenderBoardWall(useFlip) {
  const previousRects = useFlip ? captureBoardRects() : new Map();
  const scrollState = captureScrollState();
  state.masonryLayout = buildMasonryLayout();

  const wall = app.querySelector(".board-wall");
  if (wall) {
    applyBoardWallLayoutStyles(wall);
    wall.replaceChildren(renderBoardLayer());
    syncBoardWallLayout();
  }

  updateBoardOverflowIndicators();
  restoreScrollState(scrollState);
  if (useFlip) {
    animateBoardFlip(previousRects);
  }
}

export function rerenderBoardInPlace(boardId) {
  const board = findBoard(boardId);
  const slot = app.querySelector('.board-slot[data-board-id="' + cssEscape(boardId) + '"]');
  if (!board || !slot) {
    rerenderBoardWall(false);
    return;
  }

  const scrollState = captureScrollState();
  slot.className = "board-slot" + (uiState.openBoardMenuId === boardId ? " has-open-menu" : "");
  slot.replaceChildren(renderBoard(board));
  bindIconPickers(slot);
  ensureItemEditorFits(boardId, slot);
  syncBoardWallLayout();
  updateBoardOverflowIndicators(slot);
  restoreScrollState(scrollState);
}

export function render() {
  const previousRects = captureBoardRects();
  const scrollState = captureScrollState();

  const main = document.createElement("main");
  main.className = "workspace";
  main.appendChild(renderNavbar());
  if (uiState.loginOpen && !auth.isAdmin) main.appendChild(renderLoginModal());
  if (uiState.createBoardOpen && auth.isAdmin) main.appendChild(renderCreateBoardModal());
  if (uiState.moveBoardId && auth.isAdmin) main.appendChild(renderMoveBoardModal());
  const backupsModal = renderBackupsModal();
  if (backupsModal) main.appendChild(backupsModal);

  const content = document.createElement("section");
  content.className = "workspace__content";
  const scroll = document.createElement("div");
  scroll.className = "board-wall-scroll";
  const wall = document.createElement("div");
  wall.className = "board-wall";
  scroll.appendChild(wall);
  if (!state.boards.length) scroll.appendChild(renderEmptyPage());
  content.appendChild(scroll);
  main.appendChild(content);

  const ghost = renderDragGhost();
  if (ghost) main.appendChild(ghost);

  app.replaceChildren(main);

  rerenderBoardWall(false);
  if (uiState.boardDragging) {
    hydrateBoardDragRuntime();
  }
  updateDragGhostPosition();
  bindIconPickers(app);
  ensureOpenItemEditorFits();
  if (!uiState.boardDragging) {
    syncBoardWallLayout();
  }
  updateBoardOverflowIndicators();
  animateBoardFlip(previousRects);
  restoreScrollState(scrollState);
}

let introTimer = null;

/** 让接下来一次渲染的看板依次浮现（首屏和切换页面时使用）。 */
export function playIntro(extraClass) {
  const root = document.documentElement;
  if (introTimer) window.clearTimeout(introTimer);
  root.classList.add("is-intro");
  if (extraClass) root.classList.add(extraClass);
  introTimer = window.setTimeout(function () {
    root.classList.remove("is-intro");
    if (extraClass) root.classList.remove(extraClass);
    introTimer = null;
  }, 1100);
}

function renderEmptyPage() {
  const empty = document.createElement("div");
  empty.className = "board-wall-empty";
  const mark = document.createElement("div");
  mark.className = "board-wall-empty__mark";
  mark.setAttribute("aria-hidden", "true");
  mark.appendChild(staticIconNode("icon-layout-grid"));
  empty.appendChild(mark);
  const title = document.createElement("h2");
  title.className = "board-wall-empty__title";
  title.textContent = TEXT.emptyPageTitle;
  empty.appendChild(title);
  const hint = document.createElement("p");
  hint.className = "board-wall-empty__hint";
  hint.textContent = auth.isAdmin ? TEXT.emptyPageHintAdmin : TEXT.emptyPageHintGuest;
  empty.appendChild(hint);
  if (auth.isAdmin) {
    empty.appendChild(actionButton("board-save-button board-wall-empty__action", "toggle-create-board", null, "", [
      staticIconNode("icon-plus"),
      TEXT.createBoard
    ]));
  }
  return empty;
}

export function captureScrollState() {
  const state = {
    page: {
      left: window.scrollX || window.pageXOffset || 0,
      top: window.scrollY || window.pageYOffset || 0
    },
    wall: null
  };
  const wall = app.querySelector(".board-wall-scroll");
  if (wall) {
    state.wall = {
      left: wall.scrollLeft,
      top: wall.scrollTop
    };
  }
  return state;
}

export function restoreScrollState(state) {
  if (!state) return;
  const wall = app.querySelector(".board-wall-scroll");
  if (wall && state.wall) {
    wall.scrollLeft = state.wall.left;
    wall.scrollTop = state.wall.top;
  }
  if (state.page) {
    window.scrollTo(state.page.left, state.page.top);
  }
}

export function focusField(field, selectText) {
  if (!field) return;
  try {
    field.focus({ preventScroll: true });
  } catch (error) {
    field.focus();
  }
  if (selectText && typeof field.select === "function") {
    field.select();
  }
}

export function ensureOpenItemEditorFits() {
  if (!uiState.editBoardId || !uiState.editItemId) {
    return false;
  }

  return ensureItemEditorFits(uiState.editBoardId);
}

export function ensureItemEditorFits(boardId, scope) {
  const board = findBoard(boardId);
  if (!board || board.collapsed || uiState.editBoardId !== boardId || !uiState.editItemId) {
    return false;
  }

  const root = scope || app.querySelector('.board-slot[data-board-id="' + cssEscape(boardId) + '"]');
  const card = root ? root.querySelector(".board-card") : null;
  const list = root ? root.querySelector('[data-role="board-list"]') : null;
  const editor = list ? list.querySelector('[data-role="item-edit-form"][data-item-id="' + cssEscape(uiState.editItemId) + '"]') : null;
  if (!card || !list || !editor) {
    return false;
  }

  const listRect = list.getBoundingClientRect();
  const editorRect = editor.getBoundingClientRect();
  const listStyle = window.getComputedStyle(list);
  const paddingBottom = parseFloat(listStyle.paddingBottom) || 0;
  const desiredHeight = clampHeight(Math.ceil(editorRect.bottom - listRect.top + paddingBottom + BOARD_ROW_GAP));
  const nextHeight = Math.max(clampHeight(board.height), desiredHeight);
  if (nextHeight <= board.height + 1) {
    return false;
  }

  card.style.setProperty("--list-height", Math.max(nextHeight, getBoardMinimumListHeight(board)) + "px");
  return true;
}

export function updateBoardOverflowIndicators(scope) {
  const root = scope || app;
  const slots = root.matches && root.matches('.board-slot[data-board-id]')
    ? [root]
    : Array.from(root.querySelectorAll('.board-slot[data-board-id]'));

  // 先统一读取布局，再统一写 DOM。读写交错会让每个 board 都触发一次强制重排。
  const measured = slots.map(function (slot) {
    const card = slot.querySelector(".board-card");
    const list = slot.querySelector('[data-role="board-list"]');
    const badge = slot.querySelector('[data-role="hidden-count"]');
    if (!card || !list || !badge) {
      return null;
    }
    return { card: card, badge: badge, hiddenCount: countHiddenRows(list) };
  });

  measured.forEach(function (entry) {
    if (!entry) return;
    const card = entry.card;
    const badge = entry.badge;
    const hiddenCount = entry.hiddenCount;
    card.classList.toggle("has-hidden-items", hiddenCount > 0);
    badge.hidden = hiddenCount === 0;
    if (hiddenCount > 0) {
      const label = TEXT.hiddenItems.replace("{count}", String(hiddenCount));
      badge.textContent = "+" + hiddenCount;
      badge.title = label;
      badge.setAttribute("aria-label", label);
    } else {
      badge.textContent = "";
      badge.removeAttribute("title");
      badge.removeAttribute("aria-label");
    }
  });
}

export /**
 * 统计被列表底部裁掉的行数。行按文档顺序排列，底边位置单调不减（列表和图标网格都是），
 * 所以用二分查找第一个超出可视区域的行，只需 O(log n) 次布局读取。
 */
function countHiddenRows(list) {
  const rows = list.querySelectorAll('[data-role="link-row"]');
  if (!rows.length) return 0;
  const limit = list.getBoundingClientRect().bottom + 1;
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].getBoundingClientRect().bottom > limit) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return rows.length - lo;
}

export function expandBoardToFit(boardId) {
  const board = findBoard(boardId);
  if (!board || board.collapsed) {
    return;
  }

  const list = app.querySelector('.board-list[data-board-id="' + cssEscape(boardId) + '"]');
  const nextHeight = clampHeight(Math.max(BOARD_LIST_MIN_HEIGHT, Math.ceil(list ? list.scrollHeight : board.height)));
  if (Math.abs(nextHeight - board.height) < 1) {
    updateBoardOverflowIndicators(app.querySelector('.board-slot[data-board-id="' + cssEscape(boardId) + '"]'));
    return;
  }
  updateBoardHeightInPlace(boardId, nextHeight);
}

export function updateBoardHeightInPlace(boardId, height) {
  const nextHeight = clampHeight(height);
  state.boards = state.boards.map(function (board) {
    return board.id === boardId ? Object.assign({}, board, { height: nextHeight }) : board;
  });
  saveBoards();

  const board = findBoard(boardId);
  const slot = app.querySelector('.board-slot[data-board-id="' + cssEscape(boardId) + '"]');
  const card = slot ? slot.querySelector(".board-card") : null;
  if (!slot || !card) {
    render();
    return;
  }

  card.style.setProperty("--list-height", Math.max(nextHeight, getBoardMinimumListHeight(board)) + "px");
  updateBoardResizeControls(slot, nextHeight);
  syncBoardWallLayout();
  updateBoardOverflowIndicators(slot);
}

export function updateBoardResizeControls(slot, height) {
  const shrink = slot ? slot.querySelector('[data-role="shrink-height"]') : null;
  if (!shrink) {
    return;
  }
  shrink.hidden = Number(height) <= MIN_BOARD_HEIGHT + 1;
}

export function updateBoardCountInPlace(slot, board) {
  const count = slot ? slot.querySelector(".board-card__count") : null;
  if (!count || !board) {
    return;
  }
  const itemCount = Array.isArray(board.items) ? board.items.length : 0;
  count.textContent = String(itemCount);
  count.title = String(itemCount) + TEXT.urlCount;
}

export function removeBoardItemInPlace(boardId, itemId) {
  let nextBoard = null;
  state.boards = state.boards.map(function (board) {
    if (board.id !== boardId) return board;
    nextBoard = Object.assign({}, board, {
      items: board.items.filter(function (entry) {
        return entry.id !== itemId;
      })
    });
    return nextBoard;
  });
  saveBoards();

  const slot = app.querySelector('.board-slot[data-board-id="' + cssEscape(boardId) + '"]');
  const list = slot ? slot.querySelector('[data-role="board-list"]') : null;
  const itemNode = slot ? slot.querySelector('[data-item-id="' + cssEscape(itemId) + '"]') : null;
  if (!slot || !list || !itemNode || !nextBoard) {
    rerenderBoardInPlace(boardId);
    return;
  }

  itemNode.remove();
  updateBoardCountInPlace(slot, nextBoard);

  if (!list.querySelector('[data-role="link-row"], [data-role="item-edit-form"]')) {
    const empty = document.createElement("div");
    empty.className = "board-empty";
    empty.textContent = TEXT.empty;
    list.appendChild(empty);
  }

  syncBoardWallLayout();
  updateBoardOverflowIndicators(slot);
}

export function estimateBoardHeight(board) {
  if (!board) {
    return 180;
  }

  if (board.collapsed) {
    return BOARD_COLLAPSED_HEIGHT;
  }

  const activeItems = getBoardItemsForActiveTab(board);
  const detailMode = board.displayMode === "urls";
  const rowHeight = detailMode ? BOARD_DETAIL_ROW_HEIGHT : BOARD_ROW_HEIGHT;
  const rowGap = detailMode ? BOARD_DETAIL_ROW_GAP : BOARD_ROW_GAP;
  const contentHeight = board.displayMode === "icons"
    ? estimateIconGridHeight(activeItems.length, getBoardIconTileSize(board), BOARD_ICON_TILE_GAP)
    : (activeItems.length
        ? activeItems.length * rowHeight + Math.max(0, activeItems.length - 1) * rowGap
        : BOARD_LIST_MIN_HEIGHT);
  const editedItemHeight = uiState.editItemId && activeItems.some(function (item) {
    return item.id === uiState.editItemId;
  }) ? BOARD_ITEM_EDIT_FORM_EXTRA_HEIGHT : 0;
  const minimumListHeight = Math.max(BOARD_LIST_MIN_HEIGHT, getBoardMinimumListHeight(board));
  const listHeight = Math.max(minimumListHeight, Math.min(clampHeight(board.height), contentHeight + editedItemHeight));
  const metaHeight = uiState.editBoardId === board.id ? BOARD_META_FORM_HEIGHT : 0;
  const addHeight = uiState.openAddBoardId === board.id ? BOARD_ADD_FORM_HEIGHT : 0;
  const tabsHeight = shouldShowBoardTabs(board) ? BOARD_TABS_HEIGHT : 0;
  return BOARD_HEADER_HEIGHT + BOARD_CHROME_HEIGHT + tabsHeight + listHeight + metaHeight + addHeight;
}

export function getBoardMinimumListHeight(board) {
  if (!board) {
    return BOARD_LIST_MIN_HEIGHT;
  }

  if (board.displayMode === "icons") {
    return getBoardIconTileSize(board);
  }

  if (board.displayMode === "urls") {
    return BOARD_DETAIL_ROW_HEIGHT;
  }

  return BOARD_ROW_HEIGHT;
}

export function estimateIconGridHeight(itemCount, tileSize, tileGap) {
  if (!itemCount) {
    return BOARD_LIST_MIN_HEIGHT;
  }

  const safeTileSize = tileSize || BOARD_ICON_TILE_SIZE;
  const safeTileGap = tileGap || BOARD_ICON_TILE_GAP;
  const itemsPerRow = 5;
  const rows = Math.ceil(itemCount / itemsPerRow);
  return rows * safeTileSize + Math.max(0, rows - 1) * safeTileGap;
}

export function getBoardRenderedHeight(boardId) {
  if (uiState.resizing && uiState.resizing.heightMap && uiState.resizing.heightMap[boardId]) {
    return uiState.resizing.heightMap[boardId];
  }

  if (uiState.boardDragging && uiState.boardDragging.heightMap && uiState.boardDragging.heightMap[boardId]) {
    return uiState.boardDragging.heightMap[boardId];
  }

  const slot = app.querySelector('.board-slot[data-board-id="' + cssEscape(boardId) + '"] .board-card');
  if (slot) {
    return slot.getBoundingClientRect().height;
  }
  const board = findBoard(boardId);
  return estimateBoardHeight(board);
}
