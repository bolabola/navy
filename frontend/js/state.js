// 共享的界面状态

/** 会被重新赋值的共享变量（原 IIFE 中的顶层 let）。 */
export const state = {
  allLucideIcons: [],
  currentTheme: null,
  pages: null,
  activePageId: null,
  boards: null,
  layoutSettings: null,
  saveTimer: null,
  saveInFlight: false,
  savePending: false,
  masonryLayout: { positions: [], height: 0, columns: 1 },
  resizeTimer: undefined
};

export const app = document.getElementById("app");

export const uiState = {
  openAddBoardId: null,
  createBoardOpen: false,
  editBoardId: null,
  openBoardMenuId: null,
  moveBoardId: null,
  draggingRow: null,
  resizing: null,
  boardDragging: null,
  boardDragFrame: null,
  resizeFrame: null,
  rowDragLayoutFrame: null,
  editItemId: null,
  loginOpen: false,
  loginError: null,
  importingBoardId: null,
  dataMenuOpen: false,
  backupMenuOpen: false,
  layoutMenuOpen: false,
  backupStatus: null,
  localLastBackup: null,
  backupStatusLoading: false,
  backupStatusRequest: null,
  cloudBackupRunning: {},
  backupsOpen: false,
  backupsLoading: false,
  backupsError: null,
  backups: [],
  backupsProviderId: null,
  backupsProviderLabel: "",
  allCollapseSnapshot: null
};

export const auth = {
  isAdmin: false,
  ready: false,
  csrfToken: null
};

export const syncState = {
  status: "idle",
  message: ""
};

export const serverState = {
  version: null,
  updatedAt: ""
};
