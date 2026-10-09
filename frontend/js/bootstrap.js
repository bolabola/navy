// 启动流程
import { loadBackupStatus } from "./backup.js";
import { discoverLucideIcons, normalizeLayoutSettings } from "./model.js";
import { playIntro, render } from "./render.js";
import { auth, serverState, state } from "./state.js";
import {
  apiGet,
  applyBoardEnvelope,
  cacheBoardsLocally,
  loadActivePageBoards,
  loadBoardsFromLocal,
  normalizeActivePageId,
  normalizePages,
  pushToBackend,
  readBoardEnvelope
} from "./sync.js";

export function bootstrap() {
  const local = loadBoardsFromLocal();

  discoverLucideIcons();

  Promise.allSettled([apiGet("/auth"), apiGet("/board")]).then(function (results) {
    const authResult = results[0].status === "fulfilled" ? results[0].value : { isAdmin: false };
    auth.isAdmin = Boolean(authResult && authResult.isAdmin);
    auth.csrfToken = auth.isAdmin && typeof authResult.csrfToken === "string" ? authResult.csrfToken : null;
    auth.ready = true;

    if (results[1].status === "fulfilled") {
      const boardData = readBoardEnvelope(results[1].value);
      if (boardData && Array.isArray(boardData.boards)) {
        serverState.version = boardData.version;
        serverState.updatedAt = boardData.updatedAt;
        applyBoardEnvelope(boardData);
        cacheBoardsLocally();
      } else if (results[1].value === null) {
        serverState.version = null;
        serverState.updatedAt = "";
        state.pages = local.pages || normalizePages(null, local.boards);
        state.activePageId = normalizeActivePageId(local.activePageId, state.pages);
        loadActivePageBoards();
        state.layoutSettings = normalizeLayoutSettings(local.layout);
        if (auth.isAdmin && local.hadData) {
          pushToBackend();
        }
      } else {
        state.pages = local.pages || normalizePages(null, local.boards);
        state.activePageId = normalizeActivePageId(local.activePageId, state.pages);
        loadActivePageBoards();
        state.layoutSettings = normalizeLayoutSettings(local.layout);
      }
    } else {
      state.pages = local.pages || normalizePages(null, local.boards);
      state.activePageId = normalizeActivePageId(local.activePageId, state.pages);
      loadActivePageBoards();
      state.layoutSettings = normalizeLayoutSettings(local.layout);
    }
    // 每次打开都从第一个页面开始，而不是上次保存时所在的页面。
    if (state.pages.length && state.activePageId !== state.pages[0].id) {
      state.activePageId = state.pages[0].id;
      loadActivePageBoards();
    }
    playIntro("is-boot");
    render();
    if (auth.isAdmin) {
      loadBackupStatus();
    }
  });
}
