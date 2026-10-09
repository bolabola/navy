// 看板墙布局同步
import { DEFAULT_LAYOUT_SETTINGS } from "./constants.js";
import { cssEscape } from "./dom.js";
import { buildMasonryLayout, reflowBoardColumns } from "./layout.js";
import { normalizeLayoutSettings, saveBoards } from "./model.js";
import { render } from "./render.js";
import { app, auth, state, uiState } from "./state.js";
import { cacheBoardsLocally } from "./sync.js";

export function syncBoardWallLayout() {
  const previousPositions = new Map(
    (state.masonryLayout.positions || []).map(function (entry) {
      return [entry.type + ":" + entry.boardId, entry];
    })
  );
  const nextLayout = buildMasonryLayout();
  state.masonryLayout = nextLayout;

  const runtime = uiState.boardDragging && uiState.boardDragging.runtime;
  const wall = runtime && runtime.wallNode ? runtime.wallNode : app.querySelector(".board-wall");
  if (!wall) {
    return;
  }

  applyBoardWallLayoutStyles(wall);

  state.masonryLayout.positions.forEach(function (entry) {
    const previous = previousPositions.get(entry.type + ":" + entry.boardId);
    if (previous
      && previous.x === entry.x
      && previous.y === entry.y
      && previous.width === entry.width
      && previous.height === entry.height) {
      return;
    }

    if (entry.type === "placeholder") {
      const placeholder = runtime && runtime.placeholderNode ? runtime.placeholderNode : wall.querySelector(".board-card--placeholder");
      if (!placeholder) {
        return;
      }

      placeholder.style.width = entry.width + "px";
      placeholder.style.height = entry.height + "px";
      placeholder.style.transform = "translate3d(" + entry.x + "px, " + entry.y + "px, 0)";
      return;
    }

    const slot = runtime && runtime.slotNodes ? runtime.slotNodes[entry.boardId] : wall.querySelector('.board-slot[data-board-id="' + cssEscape(entry.boardId) + '"]');
    if (!slot) {
      return;
    }

    slot.style.width = entry.width + "px";
    slot.style.transform = "translate3d(" + entry.x + "px, " + entry.y + "px, 0)";
  });
}

export function applyBoardWallLayoutStyles(wall) {
  const sideGutter = state.masonryLayout.sideGutter || 0;
  const dragging = uiState.boardDragging;
  const initialWallHeight = dragging && dragging.runtime ? dragging.runtime.wallHeight : null;
  wall.style.width = state.masonryLayout.width + "px";
  wall.style.height = (initialWallHeight != null ? Math.max(initialWallHeight, state.masonryLayout.height) : state.masonryLayout.height) + "px";
  wall.style.marginLeft = sideGutter ? sideGutter + "px" : "";
  wall.style.marginRight = sideGutter ? sideGutter + "px" : "";
}

export function applyLayoutSettingsFromForm(form) {
  if (!form || !auth.isAdmin) return;
  const formData = new FormData(form);
  const columnsValue = String(formData.get("columns") || "auto");
  const previousManualColumns = state.layoutSettings.columnMode === "manual" ? state.layoutSettings.columns : null;
  const next = normalizeLayoutSettings({
    columnMode: columnsValue === "auto" ? "auto" : "manual",
    columns: columnsValue === "auto" ? state.layoutSettings.columns : Number(columnsValue),
    columnWidth: Number(formData.get("columnWidth")),
    columnGap: Number(formData.get("columnGap")),
    rowGap: Number(formData.get("rowGap")),
    align: String(formData.get("align") || state.layoutSettings.align),
    showBoardIcon: formData.has("showBoardIcon"),
    showBoardCount: formData.has("showBoardCount"),
    showItemDragHandle: formData.has("showItemDragHandle")
  });
  state.layoutSettings = next;
  const nextManualColumns = next.columnMode === "manual" ? next.columns : null;
  if (nextManualColumns && nextManualColumns !== previousManualColumns) {
    reflowBoardColumns(nextManualColumns);
  }
  cacheBoardsLocally();
  saveBoards();
  syncBoardWallLayout();
}

export function resetLayoutSettings() {
  if (!auth.isAdmin) return;
  state.layoutSettings = normalizeLayoutSettings(DEFAULT_LAYOUT_SETTINGS);
  cacheBoardsLocally();
  saveBoards();
  syncBoardWallLayout();
  render();
}
