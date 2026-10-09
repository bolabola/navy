// 前端入口：按原有顺序初始化状态、注册事件并启动。各模块见 js/ 目录。
import { bootstrap } from "./js/bootstrap.js";
import { defaultBoards } from "./js/constants.js";
import { installClickHandlers } from "./js/events/click.js";
import { installFormsHandlers } from "./js/events/forms.js";
import { installPointerHandlers } from "./js/events/pointer.js";
import { normalizeBoards, normalizeLayoutSettings } from "./js/model.js";
import { state } from "./js/state.js";
import { normalizePages } from "./js/sync.js";
import { applyTheme, readThemePreference } from "./js/theme.js";

state.currentTheme = readThemePreference();
applyTheme(state.currentTheme);
state.pages = normalizePages(null, defaultBoards);
state.activePageId = state.pages[0].id;
state.boards = normalizeBoards(state.pages[0].boards);
state.layoutSettings = normalizeLayoutSettings(null);
installClickHandlers();
installFormsHandlers();
installPointerHandlers();
bootstrap();
