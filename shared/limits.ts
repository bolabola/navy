// 前后端共享的数据限制。前端通过 esbuild 打包引用，后端直接 import。
// 修改这里会同时影响前端表单校验和后端存储校验。

export const BOARD_MAX_COUNT = 100;
export const BOARD_MAX_TABS = 100;
export const BOARD_MAX_ITEMS_PER_TAB = 500;
export const BOARD_MAX_ITEMS = BOARD_MAX_TABS * BOARD_MAX_ITEMS_PER_TAB;
export const BOARD_ID_MAX_LENGTH = 128;
export const BOARD_TITLE_MAX_LENGTH = 120;
export const BOARD_ICON_MAX_LENGTH = 64;
export const BOARD_TAB_NAME_MAX_LENGTH = 40;
export const BOARD_ITEM_NAME_MAX_LENGTH = 200;
export const BOARD_ITEM_DESCRIPTION_MAX_LENGTH = 300;
export const BOARD_URL_MAX_LENGTH = 2048;
export const MIN_BOARD_HEIGHT = 160;
export const MAX_BOARD_HEIGHT = 4096;

export const PAGE_MAX_COUNT = 30;
export const PAGE_ID_MAX_LENGTH = 128;
export const PAGE_NAME_MAX_LENGTH = 40;

export const MIN_LAYOUT_COLUMN_WIDTH = 220;
export const MAX_LAYOUT_COLUMN_WIDTH = 360;
export const MIN_LAYOUT_GAP = 0;
export const MAX_LAYOUT_GAP = 32;
export const MAX_MANUAL_COLUMNS = 6;

export const BOARD_DISPLAY_MODES = ["list", "icons", "urls"] as const;
export const BOARD_ICON_SIZES = ["small", "medium", "large"] as const;

export const ICON_NAME_PATTERN = "^[a-z0-9-]+$";
export const HEX_COLOR_PATTERN = "^#[0-9a-fA-F]{6}$";

export const URL_TITLES_MAX = 30;
