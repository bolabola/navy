// 常量与界面文案
import { BOARD_MAX_COUNT, BOARD_MAX_ITEMS_PER_TAB, BOARD_MAX_TABS, ICON_NAME_PATTERN, URL_TITLES_MAX } from "../../shared/limits";

export const STORAGE_KEY = "trello-nav-board-state-v4";

export const THEME_STORAGE_KEY = "trello-nav-theme-v1";

export const THEME_LIGHT = "light";

export const THEME_DARK = "dark";

export const API_BASE = "/api";

export const GITHUB_URL = "https://github.com/bolabola/navy";

export const SAVE_DEBOUNCE_MS = 500;

export const DEFAULT_NEW_BOARD_HEIGHT = 240;

export const BOARD_WIDTH = 250;

export const BOARD_GAP = 10;

export const MIN_TWO_COLUMN_WIDTH = BOARD_WIDTH * 2 + BOARD_GAP;

export const SINGLE_COLUMN_SIDE_GUTTER = 16;

export const DEFAULT_LAYOUT_SETTINGS = {
  columnMode: "auto",
  columns: 3,
  columnWidth: BOARD_WIDTH,
  columnGap: BOARD_GAP,
  rowGap: BOARD_GAP,
  align: "left",
  showBoardIcon: true,
  showBoardCount: true,
  showItemDragHandle: true
};

export const BOARD_HEADER_HEIGHT = 34;

export const BOARD_CHROME_HEIGHT = 36;

export const BOARD_LIST_MIN_HEIGHT = 64;

export const BOARD_ROW_HEIGHT = 24;

export const BOARD_ROW_GAP = 3;

export const BOARD_DETAIL_ROW_HEIGHT = 48;

export const BOARD_DETAIL_ROW_GAP = 5;

export const BOARD_COLLAPSED_HEIGHT = 34;

export const BOARD_META_FORM_HEIGHT = 132;

export const BOARD_ADD_FORM_HEIGHT = 104;

export const BOARD_TABS_HEIGHT = 34;

export const BOARD_ITEM_EDIT_FORM_EXTRA_HEIGHT = 110;

export const BOARD_ICON_TILE_SIZE = 26;

export const BOARD_ICON_TILE_GAP = 4;

export const DEFAULT_TAB_ID = "default";

export const DEFAULT_TAB_NAME = "默认";

export const DEFAULT_PAGE_ID = "default";

export const DEFAULT_PAGE_NAME = "首页";

export const BOARD_ACCENTS = ["#0079bf", "#42526e", "#00a3bf", "#5aac44", "#eb5a46", "#89609e", "#ff9f1a"];

export const DEFAULT_BOARD_ICONS = ["layout-grid", "zap", "code", "sparkles", "wrench", "file-text"];

export const LEGACY_ICON_MAP = { grid: "layout-grid", bolt: "zap", code: "code", spark: "sparkles", tool: "wrench", note: "file-text" };

export const ICON_NAME_RE = new RegExp(ICON_NAME_PATTERN);

export const ICON_PICKER_OVERFLOW_LIMIT = 200;

export const IMPORT_MAX_URLS = 100;

export const BOOKMARK_IMPORT_MAX_BOARDS = BOARD_MAX_COUNT;

export const BOOKMARK_IMPORT_MAX_ITEMS_PER_TAB = BOARD_MAX_ITEMS_PER_TAB;

export const BOOKMARK_IMPORT_MAX_TABS_PER_BOARD = BOARD_MAX_TABS;

export const URL_TITLE_BATCH_SIZE = URL_TITLES_MAX;

export const FULL_BACKUP_SCHEMA = "board-trello-v1";

export const URL_EXTRACT_RE = /https?:\/\/[^\s<>"'`]+/gi;

export const URL_TRAILING_PUNCT_RE = /[.,;:!?)\]"'`]+$/;

export const CURATED_LUCIDE_ICONS = [
  "layout-grid", "list", "home", "star", "heart", "bookmark", "link", "globe", "compass", "search",
  "settings", "wrench", "hammer", "sliders", "command", "key", "shield",
  "code", "code-2", "terminal", "git-branch", "package", "server", "database", "cloud",
  "palette", "brush", "pen-tool", "image", "camera", "film", "layers", "type",
  "book", "book-open", "file-text", "newspaper", "rss", "feather",
  "music", "headphones", "video", "play", "tv", "mic",
  "shopping-cart", "shopping-bag", "credit-card", "wallet", "briefcase", "building", "store",
  "mail", "message-circle", "bell", "phone", "send",
  "calendar", "clock", "alarm-clock",
  "zap", "sparkles", "flame", "lightbulb", "rocket", "trophy", "target", "flag", "gift",
  "user", "users", "smile",
  "map-pin", "anchor", "plane", "leaf", "sun", "moon"
];

export const failedFaviconDomains = new Set();

export const TEXT = {
  common: "常用",
  dev: "开发",
  design: "设计",
  tools: "工具",
  news: "资讯",
  title: "网址导航看板",
  subtitle: "所有 board 按列堆叠，纵向和横向间距都是固定值。",
  addRow: "+ Add 新行",
  addItem: "添加 item",
  addBoardTab: "新增分组",
  deleteItem: "删除 item",
  enterUrl: "输入网址，例如 https://example.com",
  enterName: "名称，可选",
  createBoard: "新建 Board",
  createBoardTitle: "Board 名称",
  createBoardIcon: "图标",
  createBoardPlaceholder: "例如：开发工具",
  editBoard: "编辑 Board",
  deleteBoard: "删除 Board",
  deleteBoardConfirm: "这个 board 里还有 {count} 条网址，确认删除？",
  save: "保存",
  cancel: "取消",
  empty: "拖一个网址到这里，或者新建。",
  urlCount: "个网址",
  expand: "展开",
  collapse: "折叠",
  expandAll: "恢复状态",
  collapseAll: "全部折叠",
  moveBoard: "拖拽 Board",
  toggleView: "显示模式",
  iconSize: "图标大小",
  iconSizeLarge: "大",
  iconSizeMedium: "中",
  iconSizeSmall: "小",
  resize: "拖动调整高度",
  shrinkBoard: "收缩到最小高度",
  hiddenItems: "还有 {count} 个未显示，点击展开",
  invalidUrl: "请输入有效的网址。",
  login: "登录",
  logout: "退出",
  guestUnsavedNotice: "折叠和显示方式只保存在本机浏览器",
  loginPlaceholder: "管理员密码",
  loginFailed: "密码错误",
  loginConfigError: "服务端密码配置无效，请检查 .dev.vars 或 Cloudflare secrets",
  loginRateLimited: "尝试次数过多，请稍后再试",
  iconPickerSearch: "搜索图标（英文）",
  iconPickerOverflow: "结果太多，请输入更精确的关键词。",
  iconPickerDefaultFavicon: "默认 favicon",
  importBoard: "导入",
  importNoUrls: "文件里没找到网址。",
  importTooMany: "文件里发现 {found} 个网址，仅导入前 {kept} 个。",
  importFailed: "导入失败，请稍后再试。",
  autofillFailed: "自动获取失败，请稍后再试。",
  autofillLoginExpired: "登录已过期，请重新登录后再自动获取。",
  exportBoard: "导出",
  exportEmpty: "这个 board 是空的，没有可导出的内容。",
  moveBoardToPage: "移动到页面",
  moveBoardTitle: "移动 Board",
  moveBoardHint: "将「{board}」移动到：",
  moveBoardNoTargets: "没有其他页面可移动。",
  syncSaving: "保存中",
  syncSaved: "已保存",
  syncFailed: "保存失败，稍后重试",
  syncLoginExpired: "登录已过期，请重新登录",
  syncConflict: "远端数据已更新，本地改动已保留",
  syncConflictConfirm: "远端数据已更新。本地改动已保留在浏览器缓存中。\n\n点击确定加载远端版本，点击取消继续保留本地版本。",
  backups: "备份",
  backupEmpty: "暂无可恢复的备份。",
  backupLoadFailed: "备份加载失败",
  backupRestore: "恢复",
  backupRestoreConfirm: "确认恢复这个备份？当前状态会先自动备份。",
  backupRestoreFailed: "恢复失败，请稍后再试。",
  layout: "布局",
  layoutColumns: "列数",
  layoutAuto: "自动",
  layoutColumnWidth: "列宽",
  layoutColumnGap: "左右间隙",
  layoutRowGap: "上下间隙",
  layoutAlign: "排列",
  layoutLeft: "左对齐",
  layoutCenter: "居中",
  layoutSectionLayout: "布局",
  layoutSectionDisplay: "显示",
  layoutShowBoardIcon: "Board 图标",
  layoutShowBoardIconDesc: "显示标题左侧的图标",
  layoutShowBoardCount: "网址数量",
  layoutShowBoardCountDesc: "显示标题右侧的数字",
  layoutShowItemDragHandle: "Item 拖拽点",
  layoutShowItemDragHandleDesc: "显示 item 左侧的三个点",
  layoutReset: "重置",
  pageDefault: DEFAULT_PAGE_NAME,
  addPage: "新建页面",
  renamePage: "重命名页面",
  deletePage: "删除页面",
  deletePageConfirm: "确认删除这个页面？页面里的 board 也会一起删除。"
};

export const defaultBoards = [];
