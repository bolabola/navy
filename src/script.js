(function () {
  const STORAGE_KEY = "trello-nav-board-state-v4";
  const API_BASE = "/api";
  const GITHUB_URL = "https://github.com/bolabola/navy";
  const SAVE_DEBOUNCE_MS = 500;
  const MIN_BOARD_HEIGHT = 160;
  const MAX_BOARD_HEIGHT = 640;
  const DEFAULT_NEW_BOARD_HEIGHT = 240;
  const BOARD_WIDTH = 250;
  const BOARD_GAP = 10;
  const MIN_TWO_COLUMN_WIDTH = BOARD_WIDTH * 2 + BOARD_GAP;
  const SINGLE_COLUMN_SIDE_GUTTER = 16;
  const BOARD_HEADER_HEIGHT = 34;
  const BOARD_CHROME_HEIGHT = 36;
  const BOARD_LIST_MIN_HEIGHT = 64;
  const BOARD_ROW_HEIGHT = 24;
  const BOARD_ROW_GAP = 3;
  const BOARD_COLLAPSED_HEIGHT = 34;
  const BOARD_META_FORM_HEIGHT = 96;
  const BOARD_ADD_FORM_HEIGHT = 104;
  const BOARD_ICON_TILE_SIZE = 26;
  const BOARD_ICON_TILE_GAP = 4;
  const FAVICON_RETRY_DELAYS_MS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000, 60 * 60 * 1000];
  const BOARD_ACCENTS = ["#0079bf", "#42526e", "#00a3bf", "#5aac44", "#eb5a46", "#89609e", "#ff9f1a"];
  const DEFAULT_BOARD_ICONS = ["layout-grid", "zap", "code", "sparkles", "wrench", "file-text"];
  const LEGACY_ICON_MAP = { grid: "layout-grid", bolt: "zap", code: "code", spark: "sparkles", tool: "wrench", note: "file-text" };
  const ICON_NAME_RE = /^[a-z0-9-]+$/;
  const ICON_PICKER_OVERFLOW_LIMIT = 200;
  const IMPORT_MAX_URLS = 100;
  const URL_TITLE_BATCH_SIZE = 30;
  const FULL_BACKUP_SCHEMA = "board-trello-v1";
  const URL_EXTRACT_RE = /https?:\/\/[^\s<>"'`]+/gi;
  const URL_TRAILING_PUNCT_RE = /[.,;:!?)\]"'`]+$/;
  const CURATED_LUCIDE_ICONS = [
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
  let allLucideIcons = [];
  const faviconCache = new Map();
  const app = document.getElementById("app");

  const TEXT = {
    common: "常用",
    dev: "开发",
    design: "设计",
    tools: "工具",
    news: "资讯",
    title: "网址导航看板",
    subtitle: "所有 board 按列堆叠，纵向和横向间距都是固定值。",
    addRow: "+ Add 新行",
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
    resize: "拖动调整高度",
    invalidUrl: "请输入有效的网址。",
    login: "登录",
    logout: "退出",
    guestUnsavedNotice: "未登录操作不会保存，刷新后会恢复原始状态",
    loginPlaceholder: "管理员密码",
    loginFailed: "密码错误",
    loginConfigError: "服务端密码配置无效，请检查 .dev.vars 或 Cloudflare secrets",
    loginRateLimited: "尝试次数过多，请稍后再试",
    iconPickerSearch: "搜索图标（英文）",
    iconPickerOverflow: "结果太多，请输入更精确的关键词。",
    importBoard: "导入",
    importNoUrls: "文件里没找到网址。",
    importTooMany: "文件里发现 {found} 个网址，仅导入前 {kept} 个。",
    importFailed: "导入失败，请稍后再试。",
    exportBoard: "导出",
    exportEmpty: "这个 board 是空的，没有可导出的内容。",
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
    backupRestoreFailed: "恢复失败，请稍后再试。"
  };

  const defaultBoards = [];

  const uiState = {
    openAddBoardId: null,
    createBoardOpen: false,
    editBoardId: null,
    openBoardMenuId: null,
    draggingRow: null,
    resizing: null,
    boardDragging: null,
    boardDragFrame: null,
    resizeFrame: null,
    rowDragLayoutFrame: null,
    loginOpen: false,
    loginError: null,
    importingBoardId: null,
    dataMenuOpen: false,
    backupMenuOpen: false,
    backupStatus: null,
    localLastBackup: null,
    backupStatusLoading: false,
    backupStatusRequest: null,
    pendingBackupKey: null,
    backupStatusPollTimer: null,
    backupsOpen: false,
    backupsLoading: false,
    backupsError: null,
    backups: [],
    backupsProviderId: null,
    backupsProviderLabel: "",
    allCollapseSnapshot: null
  };

  const auth = {
    isAdmin: false,
    ready: false,
    csrfToken: null
  };

  const syncState = {
    status: "idle",
    message: ""
  };

  const serverState = {
    version: null,
    updatedAt: ""
  };

  let boards = normalizeBoards(defaultBoards);
  let saveTimer = null;
  let saveInFlight = false;
  let savePending = false;
  let masonryLayout = { positions: [], height: 0, columns: 1 };

  function loadBoardsFromLocal() {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        return { boards: normalizeBoards(defaultBoards), hadData: false };
      }
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) {
        return { boards: normalizeBoards(defaultBoards), hadData: false };
      }
      return { boards: normalizeBoards(parsed), hadData: parsed.length > 0 };
    } catch (error) {
      return { boards: normalizeBoards(defaultBoards), hadData: false };
    }
  }

  function cacheBoardsLocally() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(boards));
    } catch (error) {
      // localStorage 满或隐私模式 - 忽略
    }
  }

  function apiGet(path) {
    return fetch(API_BASE + path, { credentials: "same-origin", cache: "no-store" }).then(function (res) {
      if (!res.ok) {
        const err = new Error("API " + path + " " + res.status);
        err.status = res.status;
        throw err;
      }
      return res.json();
    });
  }

  function apiSend(path, method, body) {
    const headers = { "Content-Type": "application/json" };
    if (auth.csrfToken) {
      headers["X-CSRF-Token"] = auth.csrfToken;
    }
    return fetch(API_BASE + path, {
      method: method,
      credentials: "same-origin",
      headers: headers,
      body: body == null ? null : JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (text) {
          const err = new Error("API " + path + " " + res.status);
          err.status = res.status;
          err.responseText = text;
          throw err;
        });
      }
      return res.json();
    });
  }

  function loadServerBoardState() {
    return apiGet("/board").then(function (value) {
      const boardData = readBoardEnvelope(value);
      if (boardData && Array.isArray(boardData.boards)) {
        serverState.version = boardData.version;
        serverState.updatedAt = boardData.updatedAt;
        boards = normalizeBoards(boardData.boards);
        cacheBoardsLocally();
        return true;
      }
      if (value === null) {
        serverState.version = null;
        serverState.updatedAt = "";
        return false;
      }
      return false;
    });
  }

  function readBoardEnvelope(value) {
    if (Array.isArray(value)) {
      return { boards: value, version: null, updatedAt: "" };
    }
    if (value && typeof value === "object" && Array.isArray(value.boards)) {
      return {
        boards: value.boards,
        version: Number.isInteger(value.version) ? value.version : null,
        updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : ""
      };
    }
    return null;
  }

  function pushToBackend() {
    if (!auth.isAdmin) {
      return;
    }
    savePending = true;
    if (saveTimer) {
      window.clearTimeout(saveTimer);
    }
    setSyncState("saving", TEXT.syncSaving);
    startPendingCloudBackup(null);
    saveTimer = window.setTimeout(function () {
      saveTimer = null;
      flushPendingSave();
    }, SAVE_DEBOUNCE_MS);
  }

  function flushPendingSave() {
    if (!auth.isAdmin || saveInFlight || !savePending) {
      return;
    }

    savePending = false;
    saveInFlight = true;
    const payloadVersion = serverState.version;
    const payloadBoards = boards;

    apiSend("/board", "PUT", {
      version: payloadVersion,
      boards: payloadBoards
    }).then(function (result) {
      if (result && Number.isInteger(result.version)) {
        serverState.version = result.version;
        serverState.updatedAt = typeof result.updatedAt === "string" ? result.updatedAt : serverState.updatedAt;
      }
      if (result && typeof result.backupKey === "string") {
        startPendingCloudBackup(result.backupKey);
        setLocalLastBackupFromKey(result.backupKey);
      } else {
        clearPendingCloudBackup();
      }
      setSyncState("saved", TEXT.syncSaved);
      refreshBackupStatusAfterSave(result && typeof result.backupKey === "string" ? result.backupKey : null);
    }).catch(function (error) {
        if (error && error.status === 401) {
          auth.isAdmin = false;
          auth.csrfToken = null;
          savePending = false;
          if (saveTimer) {
            window.clearTimeout(saveTimer);
            saveTimer = null;
          }
          uiState.dataMenuOpen = false;
          uiState.backupMenuOpen = false;
          uiState.backupStatus = null;
          uiState.localLastBackup = null;
          clearPendingCloudBackup();
          uiState.openBoardMenuId = null;
          uiState.openAddBoardId = null;
          uiState.editBoardId = null;
          uiState.createBoardOpen = false;
          setSyncState("failed", TEXT.syncLoginExpired);
          render();
          return;
        }
        if (error && error.status === 409) {
          savePending = false;
          setSyncState("failed", TEXT.syncConflict);
          handleSaveConflict();
          return;
        }
        setSyncState("failed", TEXT.syncFailed);
        clearPendingCloudBackup();
        console.warn("Sync to backend failed:", error);
    }).finally(function () {
      saveInFlight = false;
      if (savePending && auth.isAdmin) {
        setSyncState("saving", TEXT.syncSaving);
        if (saveTimer) {
          window.clearTimeout(saveTimer);
        }
        saveTimer = window.setTimeout(function () {
          saveTimer = null;
          flushPendingSave();
        }, SAVE_DEBOUNCE_MS);
      }
    });
  }

  function setSyncState(status, message) {
    syncState.status = status;
    syncState.message = message || "";
    updateSyncIndicator();
  }

  function startPendingCloudBackup(backupKey) {
    uiState.pendingBackupKey = backupKey || "__pending__";
    updateBackupMenu();
  }

  function clearPendingCloudBackup() {
    uiState.pendingBackupKey = null;
    if (uiState.backupStatusPollTimer) {
      window.clearTimeout(uiState.backupStatusPollTimer);
      uiState.backupStatusPollTimer = null;
    }
    updateBackupMenu();
  }

  function handleSaveConflict() {
    cacheBoardsLocally();
    if (window.confirm(TEXT.syncConflictConfirm)) {
      loadServerBoardState().then(function () {
        render();
      }).catch(function (error) {
        console.warn("Reload remote board failed:", error);
      });
    }
  }

  function updateSyncIndicator() {
    updateBackupMenu();
  }

  function updateBackupMenu() {
    const trigger = app.querySelector(".workspace__save-status");
    const wrapper = trigger ? trigger.closest(".workspace__menu") : null;
    if (!wrapper) {
      return;
    }
    wrapper.replaceWith(renderBackupMenu());
  }

  function loadBackupStatus() {
    if (!auth.isAdmin) return Promise.resolve(null);
    if (uiState.backupStatusRequest) return uiState.backupStatusRequest;
    uiState.backupStatusLoading = true;
    uiState.backupStatusRequest = Promise.all([
      apiGet("/cloud-backup/status"),
      apiGet("/backups").catch(function () { return { backups: [] }; })
    ]).then(function (results) {
      uiState.backupStatus = results[0] || null;
      syncLocalLastBackupFromApi(results[1]);
      return uiState.backupStatus;
    }).catch(function () {
      uiState.backupStatus = null;
      return null;
    }).finally(function () {
      uiState.backupStatusRequest = null;
      uiState.backupStatusLoading = false;
      updatePendingCloudBackupState();
      updateBackupMenu();
    });
    return uiState.backupStatusRequest;
  }

  function refreshBackupStatusAfterSave(backupKey) {
    if (!auth.isAdmin) return;
    if (backupKey) {
      pollCloudBackupStatus(backupKey, 0);
      return;
    }
    window.setTimeout(function () {
      loadBackupStatus();
    }, 1200);
  }

  function pollCloudBackupStatus(backupKey, attempt) {
    if (!auth.isAdmin || uiState.pendingBackupKey !== backupKey) return;
    if (uiState.backupStatusPollTimer) {
      window.clearTimeout(uiState.backupStatusPollTimer);
    }
    uiState.backupStatusPollTimer = window.setTimeout(function () {
      uiState.backupStatusPollTimer = null;
      loadBackupStatus().finally(function () {
        if (!uiState.pendingBackupKey || uiState.pendingBackupKey !== backupKey || isPendingCloudBackupResolved()) {
          updatePendingCloudBackupState();
          updateBackupMenu();
          return;
        }
        if (attempt < 8) {
          pollCloudBackupStatus(backupKey, attempt + 1);
        }
      });
    }, attempt === 0 ? 1200 : 1800);
  }

  function updatePendingCloudBackupState() {
    if (!uiState.pendingBackupKey || uiState.pendingBackupKey === "__pending__") return;
    if (isPendingCloudBackupResolved()) {
      uiState.pendingBackupKey = null;
      if (uiState.backupStatusPollTimer) {
        window.clearTimeout(uiState.backupStatusPollTimer);
        uiState.backupStatusPollTimer = null;
      }
    }
  }

  function isPendingCloudBackupResolved() {
    const pendingKey = uiState.pendingBackupKey;
    if (!pendingKey || pendingKey === "__pending__") return false;
    const providers = uiState.backupStatus && Array.isArray(uiState.backupStatus.providers)
      ? uiState.backupStatus.providers.filter(function (provider) { return provider.connected; })
      : [];
    if (!providers.length) return true;
    return providers.every(function (provider) {
      return provider.lastBackup && provider.lastBackup.key === pendingKey;
    });
  }

  function renderBackupMenu() {
    const wrapper = document.createElement("div");
    wrapper.className = "workspace__menu";

    const regularEntry = getRegularBackupEntry();
    const cloudEntries = getCloudBackupEntries();
    const summary = getBackupSummary(regularEntry, cloudEntries);
    const trigger = actionButton("workspace__save-status workspace__save-status--" + summary.status, "toggle-backup-menu", null, "Backup status", [
      staticIconNode(statusIcon(summary.status)),
      " ",
      (function () {
        const span = document.createElement("span");
        span.textContent = summary.label;
        return span;
      })()
    ]);
    wrapper.appendChild(trigger);

    if (!uiState.backupMenuOpen) return wrapper;

    const menu = document.createElement("div");
    menu.className = "backup-menu";
    menu.appendChild(renderBackupStatusRow(regularEntry, { action: "toggle-backups", label: "恢复" }));
    if (uiState.backupStatusLoading) {
      const loading = document.createElement("div");
      loading.className = "backup-menu__message";
      loading.textContent = "正在读取云备份状态...";
      menu.appendChild(loading);
    } else {
      cloudEntries.forEach(function (entry) {
        menu.appendChild(renderBackupStatusRow(entry, {
          action: entry.connected ? "disconnect-cloud-backup" : "connect-cloud-backup",
          label: entry.connected ? "断开" : "连接",
          providerId: entry.id,
          disabled: !entry.configured && !entry.connected,
          extraActions: entry.connected ? [{
            action: "toggle-cloud-backups",
            label: "恢复",
            providerId: entry.id,
            providerLabel: entry.label
          }] : []
        }));
      });
    }
    wrapper.appendChild(menu);
    return wrapper;
  }

  function getRegularBackupEntry() {
    const last = resolveLocalLastBackup();
    if (syncState.status === "failed") {
      return {
        id: "kv-history",
        label: "常规备份",
        status: "failed",
        detail: syncState.message || "保存失败，未生成新备份"
      };
    }
    if (syncState.status === "saving") {
      return {
        id: "kv-history",
        label: "常规备份",
        status: "saving",
        detail: "正在保存并写入历史备份"
      };
    }
    if (last) {
      return {
        id: "kv-history",
        label: "常规备份",
        status: last.status === "success" ? "saved" : "failed",
        detail: formatCloudBackupLastBackup(last)
      };
    }
    return {
      id: "kv-history",
      label: "常规备份",
      status: "idle",
      detail: "保存时自动保留最近 10 份"
    };
  }

  function getCloudBackupEntries() {
    const providers = uiState.backupStatus && Array.isArray(uiState.backupStatus.providers)
      ? uiState.backupStatus.providers
      : [];
    return providers.map(getCloudBackupEntry);
  }

  function getCloudBackupEntry(provider) {
    const last = provider.lastBackup || null;
    const pendingKey = uiState.pendingBackupKey;
    const pendingKnown = pendingKey && pendingKey !== "__pending__";
    const matchesPending = pendingKnown && last && last.key === pendingKey;
    let status = "idle";
    let detail = provider.configured ? "未连接" : "未配置 OAuth";
    if (provider.connected) {
      status = "pending";
      detail = "尚无云备份结果";
      if (pendingKey && (!pendingKnown || !matchesPending)) {
        status = "saving";
        detail = "正在备份本次修改";
      } else if (last) {
        status = last.status === "success" ? "saved" : "failed";
        detail = formatCloudBackupLastBackup(last);
      }
    }
    return {
      id: provider.id,
      label: provider.label || provider.id,
      status: status,
      detail: detail,
      connected: Boolean(provider.connected),
      configured: Boolean(provider.configured)
    };
  }

  function getBackupSummary(regularEntry, cloudEntries) {
    const entries = [regularEntry].concat(cloudEntries.filter(function (entry) { return entry.connected; }));
    if (entries.some(function (entry) { return entry.status === "failed"; })) return { status: "failed", label: "备份异常" };
    if (entries.some(function (entry) { return entry.status === "saving"; })) return { status: "saving", label: "备份中" };
    if (entries.some(function (entry) { return entry.status === "pending"; })) return { status: "pending", label: "待备份" };
    if (entries.some(function (entry) { return entry.status === "saved"; })) return { status: "saved", label: "备份正常" };
    return { status: "idle", label: "备份" };
  }

  function statusIcon(status) {
    if (status === "failed") return "icon-alert-circle";
    if (status === "saved") return "icon-check-circle";
    if (status === "saving") return "icon-refresh-cw";
    return "icon-clock";
  }

  function renderBackupStatusRow(entry, actionConfig) {
    const row = document.createElement("div");
    row.className = "backup-menu__row backup-menu__row--" + entry.status;
    row.appendChild(staticIconNode(entry.status === "failed" ? "icon-x-circle" : statusIcon(entry.status)));

    const meta = document.createElement("div");
    meta.className = "backup-menu__meta";
    const name = document.createElement("span");
    name.className = "backup-menu__name";
    name.textContent = entry.label;
    const detail = document.createElement("span");
    detail.className = "backup-menu__last backup-menu__last--" + entry.status;
    detail.textContent = entry.detail;
    meta.appendChild(name);
    meta.appendChild(detail);
    row.appendChild(meta);

    if (actionConfig) {
      const actions = document.createElement("div");
      actions.className = "backup-menu__actions";
      (actionConfig.extraActions || []).forEach(function (extra) {
        actions.appendChild(createBackupRowAction(extra, "board-save-button"));
      });
      actions.appendChild(createBackupRowAction(actionConfig, actionConfig.action === "disconnect-cloud-backup" ? "board-cancel-button" : "board-save-button"));
      row.appendChild(actions);
    }
    return row;
  }

  function createBackupRowAction(actionConfig, className) {
    const action = actionButton(
      className,
      actionConfig.action,
      null,
      "",
      [actionConfig.label]
    );
    if (actionConfig.providerId) action.dataset.providerId = actionConfig.providerId;
    if (actionConfig.providerLabel) action.dataset.providerLabel = actionConfig.providerLabel;
    if (actionConfig.disabled) action.disabled = true;
    return action;
  }

  function formatCloudBackupLastBackup(lastBackup) {
    const at = (lastBackup && lastBackup.key ? backupKeyToCreatedAt(lastBackup.key) : "") || (lastBackup && lastBackup.at ? lastBackup.at : "");
    const time = at ? formatDateTime(at) : "";
    if (lastBackup.status === "success") return time ? "最近成功 " + time : "最近成功";
    const error = lastBackup && lastBackup.error ? ": " + lastBackup.error : "";
    return (time ? "最近失败 " + time : "最近失败") + error;
  }

  function backupKeyToCreatedAt(key) {
    const raw = String(key || "").replace(/^state_backup:/, "");
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
    if (!match) return "";
    return match[1] + "T" + match[2] + ":" + match[3] + ":" + match[4] + "." + match[5] + "Z";
  }

  function localLastBackupFromKey(backupKey, status) {
    if (typeof backupKey !== "string" || !backupKey.startsWith("state_backup:")) return null;
    const at = backupKeyToCreatedAt(backupKey);
    if (!at) return null;
    return {
      status: status || "success",
      at: at,
      key: backupKey
    };
  }

  function pickNewerLocalLastBackup(current, candidate) {
    if (!candidate) return current || null;
    if (!current) return candidate;
    return candidate.key.localeCompare(current.key) > 0 ? candidate : current;
  }

  function resolveLocalLastBackup() {
    let last = uiState.localLastBackup || null;
    const pendingKey = uiState.pendingBackupKey;
    if (pendingKey && pendingKey !== "__pending__") {
      last = pickNewerLocalLastBackup(last, localLastBackupFromKey(pendingKey, "success"));
    }
    return last;
  }

  function deriveLocalLastBackup(backupsResult) {
    const backups = backupsResult && Array.isArray(backupsResult.backups) ? backupsResult.backups : [];
    if (!backups.length) return null;
    const newest = backups.reduce(function (best, backup) {
      if (!backup || typeof backup.key !== "string") return best;
      if (!best) return backup;
      return backup.key.localeCompare(best.key) > 0 ? backup : best;
    }, null);
    if (!newest) return null;
    const at = newest.createdAt || backupKeyToCreatedAt(newest.key);
    if (!newest.key || !at) return null;
    return {
      status: "success",
      at: at,
      key: newest.key
    };
  }

  function setLocalLastBackupFromKey(backupKey) {
    const next = localLastBackupFromKey(backupKey, "success");
    if (!next) return;
    uiState.localLastBackup = pickNewerLocalLastBackup(uiState.localLastBackup, next);
  }

  function syncLocalLastBackupFromApi(backupsResult) {
    uiState.localLastBackup = pickNewerLocalLastBackup(
      uiState.localLastBackup,
      deriveLocalLastBackup(backupsResult)
    );
    const pendingKey = uiState.pendingBackupKey;
    if (pendingKey && pendingKey !== "__pending__") {
      uiState.localLastBackup = pickNewerLocalLastBackup(
        uiState.localLastBackup,
        localLastBackupFromKey(pendingKey, "success")
      );
    }
  }

  function openKvBackupsModal() {
    if (!auth.isAdmin) return;
    uiState.openBoardMenuId = null;
    uiState.dataMenuOpen = false;
    uiState.backupMenuOpen = false;
    uiState.createBoardOpen = false;
    uiState.backupsOpen = true;
    uiState.backupsLoading = true;
    uiState.backupsError = null;
    uiState.backups = [];
    uiState.backupsProviderId = null;
    uiState.backupsProviderLabel = TEXT.backups;
    render();
    apiGet("/backups").then(function (result) {
      uiState.backups = result && Array.isArray(result.backups) ? result.backups : [];
      uiState.backupsLoading = false;
      render();
    }).catch(function () {
      uiState.backupsLoading = false;
      uiState.backupsError = TEXT.backupLoadFailed;
      render();
    });
  }

  function openCloudBackupsModal(providerId, providerLabel) {
    if (!auth.isAdmin) return;
    uiState.openBoardMenuId = null;
    uiState.dataMenuOpen = false;
    uiState.backupMenuOpen = false;
    uiState.createBoardOpen = false;
    uiState.backupsOpen = true;
    uiState.backupsLoading = true;
    uiState.backupsError = null;
    uiState.backups = [];
    uiState.backupsProviderId = providerId;
    uiState.backupsProviderLabel = (providerLabel || providerId) + " 备份";
    render();
    apiGet("/cloud-backup/" + encodeURIComponent(providerId) + "/backups").then(function (result) {
      uiState.backups = result && Array.isArray(result.backups) ? result.backups : [];
      uiState.backupsLoading = false;
      render();
    }).catch(function () {
      uiState.backupsLoading = false;
      uiState.backupsError = TEXT.backupLoadFailed;
      render();
    });
  }

  function renderDataMenu() {
    const wrapper = document.createElement("div");
    wrapper.className = "workspace__menu";
    wrapper.appendChild(actionButton("workspace__create-button", "toggle-data-menu", null, "Data tools", [
      staticIconNode("icon-database"),
      " ",
      (function () {
        const span = document.createElement("span");
        span.textContent = "数据";
        return span;
      })()
    ]));

    if (!uiState.dataMenuOpen) return wrapper;

    const menu = document.createElement("div");
    menu.className = "workspace-menu";
    menu.appendChild(workspaceMenuItem("export-full-backup", "icon-upload", "导出完整 JSON", "保存一份可恢复的本地文件"));
    menu.appendChild(workspaceMenuItem("import-full-backup", "icon-download", "导入完整 JSON", "用本地文件恢复整个看板"));
    wrapper.appendChild(menu);
    return wrapper;
  }

  function workspaceMenuItem(action, iconClass, title, description) {
    const button = document.createElement("button");
    button.className = "workspace-menu__item";
    button.type = "button";
    button.dataset.action = action;
    button.appendChild(staticIconNode(iconClass));

    const text = document.createElement("span");
    text.className = "workspace-menu__text";
    const name = document.createElement("span");
    name.className = "workspace-menu__name";
    name.textContent = title;
    const desc = document.createElement("span");
    desc.className = "workspace-menu__desc";
    desc.textContent = description;
    text.appendChild(name);
    text.appendChild(desc);
    button.appendChild(text);
    return button;
  }

  function renderBackupsModal() {
    if (!uiState.backupsOpen || !auth.isAdmin) return null;
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.dataset.action = "cancel-backups";

    const panel = document.createElement("div");
    panel.className = "modal-panel modal-panel--wide";
    panel.dataset.role = "modal-panel";
    backdrop.appendChild(panel);

    panel.appendChild(createModalHeader(uiState.backupsProviderLabel || TEXT.backups, "cancel-backups"));

    if (uiState.backupsLoading) {
      const loading = document.createElement("p");
      loading.className = "backup-list__message";
      loading.textContent = "加载中...";
      panel.appendChild(loading);
    } else if (uiState.backupsError) {
      const error = document.createElement("p");
      error.className = "backup-list__message backup-list__message--error";
      error.textContent = uiState.backupsError;
      panel.appendChild(error);
    } else {
      panel.appendChild(renderBackupList());
    }

    return backdrop;
  }

  function renderBackupList() {
    if (!uiState.backups.length) {
      const empty = document.createElement("p");
      empty.className = "backup-list__message";
      empty.textContent = TEXT.backupEmpty;
      return empty;
    }
    const list = document.createElement("div");
    list.className = "backup-list";
    uiState.backups.forEach(function (backup) {
      const label = backup.createdAt
        ? formatDateTime(backup.createdAt)
        : (backup.key ? backup.key.replace(/^state_backup:/, "") : (backup.name || backup.id || ""));
      const row = document.createElement("div");
      row.className = "backup-list__row";

      const time = document.createElement("span");
      time.className = "backup-list__time";
      time.textContent = label;
      row.appendChild(time);

      const restore = document.createElement("button");
      restore.className = "board-save-button";
      restore.type = "button";
      restore.dataset.action = "restore-backup";
      if (backup.key) restore.dataset.backupKey = backup.key;
      if (uiState.backupsProviderId) {
        restore.dataset.providerId = uiState.backupsProviderId;
        restore.dataset.backupId = backup.id;
      }
      restore.textContent = TEXT.backupRestore;
      row.appendChild(restore);

      list.appendChild(row);
    });
    return list;
  }

  function formatDateTime(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString("zh-CN", { hour12: false });
  }

  function bootstrap() {
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
          boards = normalizeBoards(boardData.boards);
          cacheBoardsLocally();
        } else if (results[1].value === null) {
          serverState.version = null;
          serverState.updatedAt = "";
          boards = local.boards;
          if (auth.isAdmin && local.hadData) {
            pushToBackend();
          }
        } else {
          boards = local.boards;
        }
      } else {
        boards = local.boards;
      }
      render();
      if (auth.isAdmin) {
        loadBackupStatus();
      }
    });
  }

  function normalizeIconName(raw) {
    const v = typeof raw === "string" ? raw.trim() : "";
    if (LEGACY_ICON_MAP[v]) return LEGACY_ICON_MAP[v];
    if (ICON_NAME_RE.test(v)) return v;
    return DEFAULT_BOARD_ICONS[0];
  }

  function discoverLucideIcons() {
    const out = new Set();
    Array.from(document.styleSheets).forEach(function (sheet) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch (_) {
        return;
      }
      if (!rules) return;
      Array.from(rules).forEach(function (rule) {
        if (!rule.selectorText) return;
        const m = rule.selectorText.match(/\.icon-([a-z0-9-]+)/g);
        if (!m) return;
        m.forEach(function (sel) { out.add(sel.slice(6)); });
      });
    });
    if (out.size > 50) {
      allLucideIcons = Array.from(out).sort();
      return;
    }
    const link = document.querySelector('link[href*="lucide"]');
    if (!link) return;
    fetch(link.href).then(function (r) {
      return r.ok ? r.text() : "";
    }).then(function (text) {
      const matches = text.match(/\.icon-([a-z0-9-]+)/g);
      if (matches) {
        matches.forEach(function (sel) { out.add(sel.slice(6)); });
      }
      allLucideIcons = Array.from(out).sort();
    }).catch(function () {});
  }

  function normalizeBoards(sourceBoards) {
    return sourceBoards.map(function (board) {
      return {
        id: board.id,
        title: board.title,
        accent: board.accent || BOARD_ACCENTS[0],
        icon: normalizeIconName(board.icon),
        height: clampHeight(board.height),
        collapsed: Boolean(board.collapsed),
        column: Number.isInteger(board.column) ? board.column : null,
        displayMode: normalizeDisplayMode(board.displayMode),
        items: normalizeBoardItems(board.items)
      };
    });
  }

  function normalizeDisplayMode(mode) {
    return mode === "icons" || mode === "urls" ? mode : "list";
  }

  function nextDisplayMode(mode) {
    if (mode === "list") return "icons";
    if (mode === "icons") return "urls";
    return "list";
  }

  function displayModeButtonIcon(mode) {
    if (mode === "icons") return "icon-link";
    if (mode === "urls") return "icon-list";
    return "icon-layout-grid";
  }

  function normalizeBoardItems(sourceItems) {
    if (!Array.isArray(sourceItems)) return [];
    return sourceItems.map(function (item) {
      return {
        id: typeof item.id === "string" && item.id.trim() ? item.id : uid("item"),
        name: typeof item.name === "string" ? item.name : "",
        url: typeof item.url === "string" ? item.url : ""
      };
    });
  }

  function saveBoards() {
    if (!auth.isAdmin) {
      return;
    }
    cacheBoardsLocally();
    pushToBackend();
  }

  function uid(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return prefix + "-" + window.crypto.randomUUID();
    }
    return prefix + "-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function clampHeight(height) {
    return Math.min(MAX_BOARD_HEIGHT, Math.max(MIN_BOARD_HEIGHT, Number(height) || 280));
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(String(value));
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function appendChildren(parent, children) {
    children.forEach(function (child) {
      if (child == null || child === false) return;
      if (Array.isArray(child)) {
        appendChildren(parent, child);
        return;
      }
      parent.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return parent;
  }

  function iconNode(name, className) {
    const i = document.createElement("i");
    i.className = "icon-" + normalizeIconName(name) + (className ? " " + className : "");
    return i;
  }

  function staticIconNode(className) {
    const i = document.createElement("i");
    i.className = className;
    return i;
  }

  function actionButton(className, action, boardId, title, children) {
    const button = document.createElement("button");
    button.className = className;
    button.type = "button";
    button.dataset.action = action;
    if (boardId != null) button.dataset.boardId = boardId;
    if (title) button.title = title;
    appendChildren(button, children || []);
    return button;
  }

  function shouldCollapseAllBoards() {
    if (uiState.allCollapseSnapshot) {
      return false;
    }

    return boards.some(function (board) {
      return !board.collapsed;
    });
  }

  function getAllCollapseButtonLabel() {
    return shouldCollapseAllBoards() ? TEXT.collapseAll : TEXT.expandAll;
  }

  function getAllCollapseButtonIcon() {
    return shouldCollapseAllBoards() ? "icon-chevrons-up" : "icon-chevrons-down";
  }

  function syncAllCollapseButton() {
    const button = app.querySelector('[data-action="toggle-all-collapse"]');
    if (!button) {
      return;
    }

    const label = getAllCollapseButtonLabel();
    button.title = label;
    button.setAttribute("aria-label", label);
    button.disabled = boards.length === 0;
    button.replaceChildren(staticIconNode(getAllCollapseButtonIcon()), document.createTextNode(label));
  }

  function createModalHeader(title, closeAction) {
    const header = document.createElement("div");
    header.className = "modal-panel__header";

    const titleNode = document.createElement("span");
    titleNode.className = "modal-panel__title";
    titleNode.textContent = title;
    header.appendChild(titleNode);

    const close = actionButton("modal-panel__close", closeAction, null, "", [staticIconNode("icon-x")]);
    header.appendChild(close);
    return header;
  }

  function normalizeUrl(input) {
    const trimmed = String(input || "").trim();
    if (!trimmed || /\s/.test(trimmed)) {
      throw new Error("Invalid URL");
    }

    if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
      if (!/^https?:/i.test(trimmed)) {
        throw new Error("Invalid URL");
      }
      return new URL(trimmed).toString();
    }

    return trimmed;
  }

  function toExternalUrl(input) {
    const trimmed = String(input || "").trim();
    if (!trimmed) {
      return trimmed;
    }

    if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
      if (!/^https?:/i.test(trimmed)) {
        return "#";
      }
      return trimmed;
    }

    if (/^\/\//.test(trimmed)) {
      return "https:" + trimmed;
    }

    return "https://" + trimmed;
  }

  function displayName(url, customName) {
    const name = String(customName || "").trim();
    if (name) {
      return name;
    }

    try {
      const hostname = new URL(toExternalUrl(url)).hostname.replace(/^www\./i, "");
      const firstPart = hostname.split(".")[0];
      return firstPart ? firstPart.charAt(0).toUpperCase() + firstPart.slice(1) : hostname;
    } catch (error) {
      return url;
    }
  }

  function displayUrlWithoutProtocol(url) {
    return String(url || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  }

  function extractUrlsFromText(text) {
    const found = String(text || "").match(URL_EXTRACT_RE) || [];
    const seen = new Set();
    const out = [];
    for (let i = 0; i < found.length; i += 1) {
      const cleaned = found[i].replace(URL_TRAILING_PUNCT_RE, "");
      if (!cleaned || cleaned.length > 2048) continue;
      try {
        const u = new URL(cleaned);
        if (u.protocol !== "http:" && u.protocol !== "https:") continue;
        const canonical = u.toString();
        if (seen.has(canonical)) continue;
        seen.add(canonical);
        out.push(canonical);
      } catch (e) {
        // skip invalid
      }
    }
    return out;
  }

  function faviconDomain(url) {
    try {
      return new URL(toExternalUrl(url)).hostname;
    } catch (_) {
      return "example.com";
    }
  }

  function isGithubDomain(domain) {
    const normalized = String(domain || "").toLowerCase();
    return normalized === "github.com" || normalized.endsWith(".github.com");
  }

  function githubIconNode() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add("link-row__github-icon");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 3.86c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z");
    svg.appendChild(path);
    return svg;
  }

  function faviconUrlForDomain(domain, forceRefresh) {
    const url = "/api/favicon?d=" + encodeURIComponent(domain || "example.com");
    return forceRefresh ? url + "&refresh=1" : url;
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(reader.error || new Error("Failed to read favicon")); };
      reader.readAsDataURL(blob);
    });
  }

  function setFaviconFallback(domain) {
    app.querySelectorAll('img[data-favicon-domain="' + cssEscape(domain) + '"]').forEach(function (node) {
      const wrapper = node.closest(".link-row__icon");
      if (wrapper) wrapper.classList.add("is-fallback");
    });
  }

  function applyFaviconDataUrl(domain, dataUrl) {
    app.querySelectorAll('img[data-favicon-domain="' + cssEscape(domain) + '"]').forEach(function (node) {
      node.src = dataUrl;
      const wrapper = node.closest(".link-row__icon");
      if (wrapper) wrapper.classList.remove("is-fallback");
    });
  }

  function scheduleFaviconRetry(domain, attempts) {
    const delay = FAVICON_RETRY_DELAYS_MS[Math.min(attempts, FAVICON_RETRY_DELAYS_MS.length - 1)];
    const retryAt = Date.now() + delay;
    const timer = setTimeout(function () {
      const cached = faviconCache.get(domain);
      if (cached && cached.status === "failed" && cached.retryAt <= Date.now()) {
        loadFaviconDomain(domain, true, attempts + 1);
      }
    }, delay);
    faviconCache.set(domain, { status: "failed", retryAt: retryAt, attempts: attempts, timer: timer });
  }

  function loadFaviconDomain(domain, forceRefresh, attempts) {
    setFaviconFallback(domain);
    const pending = fetch(faviconUrlForDomain(domain, forceRefresh), { cache: forceRefresh ? "reload" : "force-cache" }).then(function (res) {
      if (!res.ok) throw new Error("Favicon request failed");
      if (res.headers.get("X-Favicon-Fallback") === "1") throw new Error("Favicon fallback");
      return res.blob();
    }).then(blobToDataUrl);
    faviconCache.set(domain, { status: "pending", promise: pending });

    pending.then(function (dataUrl) {
      if (!dataUrl) throw new Error("Empty favicon");
      faviconCache.set(domain, dataUrl);
      applyFaviconDataUrl(domain, dataUrl);
    }).catch(function () {
      scheduleFaviconRetry(domain, attempts);
      setFaviconFallback(domain);
    });
  }

  function hydrateFaviconImage(img, icon, url) {
    const domain = faviconDomain(url);
    const cached = faviconCache.get(domain);
    if (cached && cached.status === "failed") {
      icon.classList.add("is-fallback");
      return;
    }
    if (typeof cached === "string") {
      img.src = cached;
      return;
    }
    if (cached && cached.status === "pending") return;

    icon.classList.add("is-fallback");
    loadFaviconDomain(domain, false, 0);
  }

  function nextBoardAccent() {
    return BOARD_ACCENTS[boards.length % BOARD_ACCENTS.length];
  }

  function nextBoardIcon() {
    return DEFAULT_BOARD_ICONS[boards.length % DEFAULT_BOARD_ICONS.length];
  }

  function findBoard(boardId) {
    return boards.find(function (board) {
      return board.id === boardId;
    });
  }

  function captureBoardRects() {
    const rects = new Map();
    app.querySelectorAll(".board-card[data-board-id]").forEach(function (node) {
      rects.set(node.getAttribute("data-board-id"), node.getBoundingClientRect());
    });
    return rects;
  }

  function collectBoardHeightMap() {
    const heightMap = {};
    app.querySelectorAll(".board-card[data-board-id]").forEach(function (node) {
      const boardId = node.getAttribute("data-board-id");
      heightMap[boardId] = node.getBoundingClientRect().height;
    });
    return heightMap;
  }

  function animateBoardFlip(previousRects) {
    app.querySelectorAll(".board-card[data-board-id]").forEach(function (node) {
      const id = node.getAttribute("data-board-id");
      const previous = previousRects.get(id);
      if (!previous) {
        return;
      }

      const next = node.getBoundingClientRect();
      const deltaX = previous.left - next.left;
      const deltaY = previous.top - next.top;
      if (!deltaX && !deltaY) {
        return;
      }

      node.style.transition = "none";
      node.style.transform = "translate(" + deltaX + "px, " + deltaY + "px)";
      node.offsetWidth;
      requestAnimationFrame(function () {
        node.style.transition = "transform 180ms ease";
        node.style.transform = "";
      });
      node.addEventListener("transitionend", function cleanup() {
        node.style.transition = "";
        node.removeEventListener("transitionend", cleanup);
      });
    });
  }

  function renderIconPickerGridItems(icons, selected) {
    const fragment = document.createDocumentFragment();
    icons.forEach(function (name) {
      const safe = normalizeIconName(name);
      const button = document.createElement("button");
      button.className = "icon-picker-grid__item" + (safe === selected ? " is-selected" : "");
      button.type = "button";
      button.dataset.role = "icon-picker-item";
      button.dataset.name = safe;
      button.title = safe;
      button.setAttribute("aria-label", safe);
      button.appendChild(iconNode(safe));
      fragment.appendChild(button);
    });
    return fragment;
  }

  function renderIconPickerWidget(name, selected) {
    const current = normalizeIconName(selected);
    const picker = document.createElement("div");
    picker.className = "icon-picker";
    picker.dataset.role = "icon-picker";

    const trigger = document.createElement("button");
    trigger.className = "icon-picker-trigger";
    trigger.type = "button";
    trigger.dataset.role = "icon-picker-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const currentSpan = document.createElement("span");
    currentSpan.className = "icon-picker-trigger__icon";
    currentSpan.dataset.role = "icon-picker-current";
    currentSpan.appendChild(iconNode(current));
    trigger.appendChild(currentSpan);
    trigger.appendChild(staticIconNode("icon-chevron-down icon-picker-trigger__caret"));
    picker.appendChild(trigger);

    const valueInput = document.createElement("input");
    valueInput.type = "hidden";
    valueInput.name = name;
    valueInput.value = current;
    valueInput.dataset.role = "icon-picker-value";
    picker.appendChild(valueInput);

    const popover = document.createElement("div");
    popover.className = "icon-picker-popover";
    popover.dataset.role = "icon-picker-popover";
    popover.hidden = true;

    const search = document.createElement("input");
    search.className = "icon-picker-search";
    search.type = "search";
    search.placeholder = TEXT.iconPickerSearch;
    search.autocomplete = "off";
    search.dataset.role = "icon-picker-search";
    popover.appendChild(search);

    const grid = document.createElement("div");
    grid.className = "icon-picker-grid";
    grid.dataset.role = "icon-picker-grid";
    grid.appendChild(renderIconPickerGridItems(CURATED_LUCIDE_ICONS, current));
    popover.appendChild(grid);

    const hint = document.createElement("p");
    hint.className = "icon-picker-overflow-hint";
    hint.dataset.role = "icon-picker-hint";
    hint.hidden = true;
    hint.textContent = TEXT.iconPickerOverflow;
    popover.appendChild(hint);

    picker.appendChild(popover);
    return picker;
  }

  function bindIconPickers(scope) {
    const pickers = scope.querySelectorAll('[data-role="icon-picker"]');
    pickers.forEach(function (picker) {
      if (picker.dataset.bound === "1") return;
      picker.dataset.bound = "1";

      const trigger = picker.querySelector('[data-role="icon-picker-trigger"]');
      const popover = picker.querySelector('[data-role="icon-picker-popover"]');
      const search = picker.querySelector('[data-role="icon-picker-search"]');
      const grid = picker.querySelector('[data-role="icon-picker-grid"]');
      const hint = picker.querySelector('[data-role="icon-picker-hint"]');
      const valueInput = picker.querySelector('[data-role="icon-picker-value"]');
      const currentSpan = picker.querySelector('[data-role="icon-picker-current"]');

      if (!trigger || !popover || !search || !grid || !hint || !valueInput || !currentSpan) return;

      function open() {
        popover.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        search.value = "";
        grid.replaceChildren(renderIconPickerGridItems(CURATED_LUCIDE_ICONS, valueInput.value));
        hint.hidden = true;
        const slot = picker.closest(".board-slot");
        if (slot) slot.classList.add("is-icon-picking");
        requestAnimationFrame(function () { search.focus(); });
      }

      function close() {
        popover.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
        const slot = picker.closest(".board-slot");
        if (slot) slot.classList.remove("is-icon-picking");
      }

      trigger.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (popover.hidden) open(); else close();
      });

      search.addEventListener("input", function () {
        const q = search.value.trim().toLowerCase();
        if (!q) {
          grid.replaceChildren(renderIconPickerGridItems(CURATED_LUCIDE_ICONS, valueInput.value));
          hint.hidden = true;
          return;
        }
        const pool = allLucideIcons.length ? allLucideIcons : CURATED_LUCIDE_ICONS;
        const matches = pool.filter(function (n) { return n.indexOf(q) >= 0; });
        const overflow = matches.length > ICON_PICKER_OVERFLOW_LIMIT;
        const display = overflow ? matches.slice(0, ICON_PICKER_OVERFLOW_LIMIT) : matches;
        grid.replaceChildren(renderIconPickerGridItems(display, valueInput.value));
        hint.hidden = !overflow;
      });

      grid.addEventListener("click", function (event) {
        const item = event.target.closest('[data-role="icon-picker-item"]');
        if (!item) return;
        event.preventDefault();
        const safe = normalizeIconName(item.getAttribute("data-name"));
        valueInput.value = safe;
        currentSpan.replaceChildren(iconNode(safe));
        grid.querySelectorAll(".icon-picker-grid__item.is-selected").forEach(function (el) {
          el.classList.remove("is-selected");
        });
        item.classList.add("is-selected");
        close();
      });
    });
  }

  function closeAllIconPickers(scope) {
    (scope || app).querySelectorAll('[data-role="icon-picker-popover"]').forEach(function (pop) {
      if (!pop.hidden) {
        pop.hidden = true;
        const trigger = pop.parentElement && pop.parentElement.querySelector('[data-role="icon-picker-trigger"]');
        if (trigger) trigger.setAttribute("aria-expanded", "false");
        const slot = pop.closest && pop.closest(".board-slot");
        if (slot) slot.classList.remove("is-icon-picking");
      }
    });
  }

  function renderLinkRow(boardId, item, displayMode, editing) {
    const title = item.name || displayName(item.url, "");
    const url = String(item.url || "");
    const href = toExternalUrl(item.url);
    const initial = (item.name || title).trim().charAt(0).toUpperCase() || "?";
    const iconOnly = displayMode === "icons";
    const urlOnly = displayMode === "urls";
    const showDelete = editing && auth.isAdmin;

    const row = document.createElement("div");
    row.className = "link-row" + (iconOnly ? " link-row--icon-only" : "") + (urlOnly ? " link-row--url-only" : "") + (showDelete ? " link-row--editing" : "");
    row.dataset.role = "link-row";
    row.dataset.boardId = boardId;
    row.dataset.itemId = item.id;
    if (auth.isAdmin) row.draggable = true;

    if (!iconOnly && auth.isAdmin) {
      const grab = document.createElement("span");
      grab.className = "link-row__grab";
      grab.setAttribute("aria-hidden", "true");
      row.appendChild(grab);
    }

    const anchor = document.createElement("a");
    anchor.className = "link-row__anchor";
    anchor.href = href;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.title = urlOnly ? title : (iconOnly ? title + " - " + url : url);

    if (!urlOnly) {
      const icon = document.createElement("span");
      icon.className = "link-row__icon";
      const domain = faviconDomain(item.url);
      if (isGithubDomain(domain)) {
        icon.classList.add("link-row__icon--github");
        icon.appendChild(githubIconNode());
      } else {
        const img = document.createElement("img");
        img.alt = "";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        img.dataset.faviconDomain = domain;
        icon.appendChild(img);
        const fallback = document.createElement("span");
        fallback.className = "link-row__fallback";
        fallback.textContent = initial;
        icon.appendChild(fallback);
        hydrateFaviconImage(img, icon, item.url);
      }
      anchor.appendChild(icon);
    }

    const name = document.createElement("span");
    name.className = "link-row__name";
    name.textContent = urlOnly ? displayUrlWithoutProtocol(url) : title;
    anchor.appendChild(name);
    row.appendChild(anchor);

    if (showDelete) {
      const del = actionButton("link-row__delete", "delete-item", boardId, "删除", [staticIconNode("icon-x")]);
      del.dataset.itemId = item.id;
      del.setAttribute("aria-label", "删除");
      row.appendChild(del);
    }

    return row;
  }

  function renderBoardActionsMenu(board) {
    const menu = document.createElement("div");
    menu.className = "board-actions-menu";

    function menuItem(action, icon, label, danger) {
      const button = actionButton("board-actions-menu__item" + (danger ? " board-actions-menu__item--danger" : ""), action, board.id, "", [
        staticIconNode(icon),
        document.createElement("span")
      ]);
      button.lastChild.textContent = label;
      return button;
    }

    menu.appendChild(menuItem("toggle-edit-board", "icon-pencil", TEXT.editBoard));
    menu.appendChild(menuItem("import-board", "icon-download", "导入网址"));
    menu.appendChild(menuItem("export-board", "icon-upload", "导出 CSV"));
    menu.appendChild(menuItem("delete-board", "icon-trash-2", TEXT.deleteBoard, true));
    return menu;
  }

  function renderEditBoardForm(board) {
    const form = document.createElement("form");
    form.className = "board-meta-form board-meta-form--inline";
    form.dataset.role = "edit-board-form";
    form.dataset.boardId = board.id;

    const row = document.createElement("div");
    row.className = "board-meta-form__row";
    row.appendChild(renderIconPickerWidget("icon", board.icon));
    const title = document.createElement("input");
    title.className = "board-meta-form__title-input";
    title.type = "text";
    title.name = "title";
    title.value = board.title;
    title.placeholder = TEXT.createBoardTitle;
    title.required = true;
    row.appendChild(title);
    form.appendChild(row);

    const actions = document.createElement("div");
    actions.className = "board-meta-form__actions";
    const save = document.createElement("button");
    save.className = "board-save-button";
    save.type = "submit";
    save.textContent = TEXT.save;
    actions.appendChild(save);
    actions.appendChild(actionButton("board-cancel-button", "cancel-edit-board", board.id, "", [TEXT.cancel]));
    form.appendChild(actions);
    return form;
  }

  function renderAddForm(boardId) {
    const form = document.createElement("form");
    form.className = "board-add-form board-add-form--floating";
    form.dataset.role = "add-form";
    form.dataset.boardId = boardId;

    const url = document.createElement("input");
    url.type = "text";
    url.name = "url";
    url.inputMode = "url";
    url.autocapitalize = "off";
    url.autocomplete = "off";
    url.spellcheck = false;
    url.placeholder = TEXT.enterUrl;
    url.required = true;
    form.appendChild(url);

    const name = document.createElement("input");
    name.type = "text";
    name.name = "name";
    name.placeholder = TEXT.enterName;
    form.appendChild(name);

    const actions = document.createElement("div");
    actions.className = "board-add-form__actions";
    const save = document.createElement("button");
    save.className = "board-save-button";
    save.type = "submit";
    save.textContent = TEXT.save;
    actions.appendChild(save);
    actions.appendChild(actionButton("board-cancel-button", "cancel-add", boardId, "", [TEXT.cancel]));
    form.appendChild(actions);
    return form;
  }

  function renderBoard(board, extraClass) {
    const addOpen = uiState.openAddBoardId === board.id;
    const editOpen = uiState.editBoardId === board.id;
    const menuOpen = uiState.openBoardMenuId === board.id;
    const iconMode = board.displayMode === "icons";
    const urlMode = board.displayMode === "urls";
    const card = document.createElement("article");
    card.className = "board-card" + (board.collapsed ? " is-collapsed" : "") + (menuOpen ? " has-open-menu" : "") + (extraClass ? " " + extraClass : "");
    card.dataset.boardId = board.id;
    card.style.setProperty("--board-accent", board.accent);
    card.style.setProperty("--list-height", Number(board.height) + "px");

    const header = document.createElement("header");
    header.className = "board-card__header";
    const titleWrap = document.createElement("div");
    titleWrap.className = "board-card__title-wrap";
    titleWrap.dataset.role = "board-drag-handle";
    titleWrap.dataset.boardId = board.id;
    titleWrap.title = TEXT.moveBoard;
    const glyph = document.createElement("span");
    glyph.className = "board-card__glyph";
    glyph.appendChild(iconNode(board.icon));
    titleWrap.appendChild(glyph);
    const title = document.createElement("h2");
    title.className = "board-card__title";
    title.textContent = board.title;
    titleWrap.appendChild(title);
    header.appendChild(titleWrap);

    const actions = document.createElement("div");
    actions.className = "board-card__actions";
    actions.appendChild(actionButton("board-icon-button", "toggle-view-mode", board.id, TEXT.toggleView, [
      staticIconNode(displayModeButtonIcon(board.displayMode))
    ]));
    actions.appendChild(actionButton("board-icon-button", "toggle-collapse", board.id, board.collapsed ? TEXT.expand : TEXT.collapse, [
      staticIconNode(board.collapsed ? "icon-chevron-down" : "icon-chevron-up")
    ]));
    if (auth.isAdmin) {
      actions.appendChild(actionButton("board-icon-button", "toggle-add", board.id, TEXT.addRow, [staticIconNode("icon-plus")]));

      const menuButton = actionButton("board-icon-button" + (uiState.importingBoardId === board.id ? " is-loading" : ""), "toggle-board-menu", board.id, "More", [
        staticIconNode("icon-ellipsis")
      ]);
      if (uiState.importingBoardId === board.id) menuButton.disabled = true;
      actions.appendChild(menuButton);

      if (menuOpen) actions.appendChild(renderBoardActionsMenu(board));
    }
    header.appendChild(actions);
    card.appendChild(header);

    if (editOpen) card.appendChild(renderEditBoardForm(board));

    if (!board.collapsed) {
      if (addOpen) card.appendChild(renderAddForm(board.id));

      const body = document.createElement("div");
      body.className = "board-card__body";
      const list = document.createElement("div");
      list.className = "board-list" + (iconMode ? " board-list--icons" : "") + (urlMode ? " board-list--urls" : "");
      list.dataset.role = "board-list";
      list.dataset.boardId = board.id;
      if (board.items.length) {
        board.items.forEach(function (item) {
          list.appendChild(renderLinkRow(board.id, item, board.displayMode, editOpen));
        });
      } else {
        const empty = document.createElement("div");
        empty.className = "board-empty";
        empty.textContent = TEXT.empty;
        list.appendChild(empty);
      }
      body.appendChild(list);
      card.appendChild(body);

      const resize = document.createElement("div");
      resize.className = "board-resize-handle";
      resize.dataset.role = "resize-handle";
      resize.dataset.boardId = board.id;
      resize.title = TEXT.resize;
      card.appendChild(resize);
    }

    return card;
  }

  function getColumnCount(containerWidth) {
    if (containerWidth < MIN_TWO_COLUMN_WIDTH) {
      return 1;
    }

    return Math.max(2, Math.floor((containerWidth + BOARD_GAP) / (BOARD_WIDTH + BOARD_GAP)));
  }

  function getColumnWidth(columns, contentWidth, sideGutter) {
    if (columns === 1) {
      return Math.max(0, contentWidth - sideGutter * 2);
    }

    return BOARD_WIDTH;
  }

  function getLayoutSideGutter(columns, contentWidth) {
    if (columns !== 1) {
      return 0;
    }

    return Math.min(SINGLE_COLUMN_SIDE_GUTTER, Math.floor(contentWidth / 2));
  }

  function shouldUseStoredColumns(entries, columns) {
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

  function createColumnBuckets(entries, columns) {
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

  function getNextBoardColumn(columns) {
    if (!columns || columns < 1) {
      return null;
    }

    const buckets = createColumnBuckets(boards.slice(), columns);
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

  function materializeColumnBuckets(columnBuckets) {
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

  function getPreviewColumnBuckets(columns) {
    const buckets = createColumnBuckets(boards.slice(), columns);
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

  function buildMasonryLayout() {
    const dragging = uiState.boardDragging;
    const scroll = dragging && dragging.runtime ? dragging.runtime.scrollNode : app.querySelector(".board-wall-scroll");
    const contentWidth = dragging && dragging.metrics
      ? dragging.metrics.contentWidth
      : (scroll ? scroll.clientWidth : window.innerWidth - 20);
    const columns = dragging && dragging.metrics
      ? dragging.metrics.columns
      : getColumnCount(contentWidth);
    const sideGutter = getLayoutSideGutter(columns, contentWidth);
    const columnWidth = dragging && dragging.metrics
      ? dragging.metrics.columnWidth
      : getColumnWidth(columns, contentWidth, sideGutter);
    const actualWidth = columns * columnWidth + Math.max(0, columns - 1) * BOARD_GAP;
    const heights = Array(columns).fill(0);
    const positions = [];
    const buckets = getPreviewColumnBuckets(columns);

    buckets.forEach(function (bucket, columnIndex) {
      bucket.forEach(function (entry, rowIndex) {
        const x = columnIndex * (columnWidth + BOARD_GAP);
        const y = heights[columnIndex];
        const height = entry.placeholder
          ? entry.height
          : getBoardRenderedHeight(entry.id);

        positions.push({
          type: entry.placeholder ? "placeholder" : "board",
          boardId: entry.id,
          board: entry.placeholder ? null : entry,
          x: x,
          y: y,
          width: columnWidth,
          height: height,
          column: columnIndex,
          row: rowIndex
        });

        heights[columnIndex] += height + BOARD_GAP;
      });
    });

    return {
      positions: positions,
      width: actualWidth,
      height: Math.max(0, Math.max.apply(null, heights) - BOARD_GAP),
      columns: columns,
      sideGutter: sideGutter
    };
  }

  function renderBoardLayer() {
    const fragment = document.createDocumentFragment();
    masonryLayout.positions.forEach(function (entry) {
      if (entry.type === "placeholder") {
        const placeholder = document.createElement("div");
        placeholder.className = "board-card board-card--placeholder";
        placeholder.style.width = entry.width + "px";
        placeholder.style.height = entry.height + "px";
        placeholder.style.transform = "translate(" + entry.x + "px," + entry.y + "px)";
        fragment.appendChild(placeholder);
        return;
      }

      const slot = document.createElement("div");
      slot.className = "board-slot" + (uiState.openBoardMenuId === entry.boardId ? " has-open-menu" : "");
      slot.dataset.boardId = entry.boardId;
      slot.style.width = entry.width + "px";
      slot.style.transform = "translate(" + entry.x + "px," + entry.y + "px)";
      slot.appendChild(renderBoard(entry.board));
      fragment.appendChild(slot);
    });
    return fragment;
  }

  function renderNavbar() {
    const nav = document.createElement("nav");
    nav.className = "workspace__navbar";

    const left = document.createElement("div");
    left.className = "workspace__navbar-left";
    left.appendChild(staticIconNode("icon-layout-grid workspace__navbar-logo"));
    const title = document.createElement("span");
    title.className = "workspace__navbar-title";
    title.textContent = TEXT.title;
    left.appendChild(title);
    if (!auth.isAdmin) {
      const notice = document.createElement("span");
      notice.className = "workspace__guest-notice";
      notice.textContent = TEXT.guestUnsavedNotice;
      left.appendChild(notice);
    }
    nav.appendChild(left);

    const right = document.createElement("div");
    right.className = "workspace__navbar-right";
    const collapseAll = actionButton("workspace__collapse-all-button", "toggle-all-collapse", null, getAllCollapseButtonLabel(), [
      staticIconNode(getAllCollapseButtonIcon()),
      getAllCollapseButtonLabel()
    ]);
    collapseAll.setAttribute("aria-label", getAllCollapseButtonLabel());
    collapseAll.disabled = boards.length === 0;
    right.appendChild(collapseAll);
    const github = document.createElement("a");
    github.className = "workspace__github-link";
    github.href = GITHUB_URL;
    github.target = "_blank";
    github.rel = "noreferrer";
    github.title = "GitHub";
    github.setAttribute("aria-label", "GitHub");
    github.appendChild(githubIconNode());
    right.appendChild(github);
    if (auth.isAdmin) {
      right.appendChild(renderDataMenu());
      right.appendChild(renderBackupMenu());
      right.appendChild(actionButton("workspace__create-button", "toggle-create-board", null, "", [
        staticIconNode("icon-plus"),
        " " + TEXT.createBoard
      ]));
    }

    right.appendChild(actionButton("workspace__auth-button", "toggle-auth", null, "", [auth.isAdmin ? TEXT.logout : TEXT.login]));
    nav.appendChild(right);
    return nav;
  }

  function renderLoginModal() {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.dataset.action = "cancel-auth";
    const panel = document.createElement("div");
    panel.className = "modal-panel";
    panel.dataset.role = "modal-panel";
    panel.appendChild(createModalHeader(TEXT.login, "cancel-auth"));

    const form = document.createElement("form");
    form.className = "login-form";
    form.dataset.role = "login-form";
    const input = document.createElement("input");
    input.type = "password";
    input.name = "password";
    input.placeholder = TEXT.loginPlaceholder;
    input.required = true;
    input.autofocus = true;
    form.appendChild(input);
    if (uiState.loginError) {
      const error = document.createElement("span");
      error.className = "login-form__error";
      error.textContent = uiState.loginError;
      form.appendChild(error);
    }
    const actions = document.createElement("div");
    actions.className = "login-form__actions";
    const submit = document.createElement("button");
    submit.className = "board-save-button";
    submit.type = "submit";
    submit.textContent = TEXT.login;
    actions.appendChild(submit);
    actions.appendChild(actionButton("board-cancel-button", "cancel-auth", null, "", [TEXT.cancel]));
    form.appendChild(actions);
    panel.appendChild(form);
    backdrop.appendChild(panel);
    return backdrop;
  }

  function renderCreateBoardModal() {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.dataset.action = "cancel-create-board";
    const panel = document.createElement("div");
    panel.className = "modal-panel";
    panel.dataset.role = "modal-panel";
    panel.appendChild(createModalHeader(TEXT.createBoard, "cancel-create-board"));

    const form = document.createElement("form");
    form.className = "create-board-form";
    form.dataset.role = "create-board-form";
    const row = document.createElement("div");
    row.className = "board-meta-form__row";
    row.appendChild(renderIconPickerWidget("icon", nextBoardIcon()));
    const title = document.createElement("input");
    title.className = "board-meta-form__title-input";
    title.type = "text";
    title.name = "title";
    title.placeholder = TEXT.createBoardPlaceholder;
    title.required = true;
    row.appendChild(title);
    form.appendChild(row);

    const actions = document.createElement("div");
    actions.className = "create-board-form__actions";
    const submit = document.createElement("button");
    submit.className = "board-save-button";
    submit.type = "submit";
    submit.textContent = TEXT.createBoard;
    actions.appendChild(submit);
    actions.appendChild(actionButton("board-cancel-button", "cancel-create-board", null, "", [TEXT.cancel]));
    form.appendChild(actions);
    panel.appendChild(form);
    backdrop.appendChild(panel);
    return backdrop;
  }

  function renderDragGhost() {
    if (!uiState.boardDragging || !uiState.boardDragging.hasMoved) {
      return null;
    }

    const board = findBoard(uiState.boardDragging.boardId);
    if (!board) {
      return null;
    }

    const ghost = document.createElement("div");
    ghost.className = "board-drag-ghost";
    ghost.style.width = uiState.boardDragging.width + "px";
    ghost.style.height = uiState.boardDragging.height + "px";
    ghost.appendChild(renderBoard(board, "is-board-dragging"));
    return ghost;
  }

  function updateDragGhostPosition() {
    if (!uiState.boardDragging) {
      return;
    }

    const ghost = uiState.boardDragging.runtime && uiState.boardDragging.runtime.ghostNode
      ? uiState.boardDragging.runtime.ghostNode
      : app.querySelector(".board-drag-ghost");
    if (!ghost) {
      return;
    }

    ghost.style.transform = "translate(" + uiState.boardDragging.ghostLeft + "px, " + uiState.boardDragging.ghostTop + "px)";
  }

  function hydrateBoardDragRuntime() {
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
      scrollRectTop: scrollRect.top
    };

    uiState.boardDragging.metrics = {
      contentWidth: scrollNode ? scrollNode.clientWidth : window.innerWidth - 20,
      columns: masonryLayout.columns,
      columnWidth: masonryLayout.positions[0] ? masonryLayout.positions[0].width : BOARD_WIDTH
    };
  }

  function syncBoardWallLayout() {
    masonryLayout = buildMasonryLayout();

    const runtime = uiState.boardDragging && uiState.boardDragging.runtime;
    const wall = runtime && runtime.wallNode ? runtime.wallNode : app.querySelector(".board-wall");
    if (!wall) {
      return;
    }

    applyBoardWallLayoutStyles(wall);

    masonryLayout.positions.forEach(function (entry) {
      if (entry.type === "placeholder") {
        const placeholder = runtime && runtime.placeholderNode ? runtime.placeholderNode : wall.querySelector(".board-card--placeholder");
        if (!placeholder) {
          return;
        }

        placeholder.style.width = entry.width + "px";
        placeholder.style.height = entry.height + "px";
        placeholder.style.transform = "translate(" + entry.x + "px, " + entry.y + "px)";
        return;
      }

      const slot = runtime && runtime.slotNodes ? runtime.slotNodes[entry.boardId] : wall.querySelector('.board-slot[data-board-id="' + cssEscape(entry.boardId) + '"]');
      if (!slot) {
        return;
      }

      slot.style.width = entry.width + "px";
      slot.style.transform = "translate(" + entry.x + "px, " + entry.y + "px)";
    });
  }

  function applyBoardWallLayoutStyles(wall) {
    const sideGutter = masonryLayout.sideGutter || 0;
    wall.style.width = masonryLayout.width + "px";
    wall.style.height = masonryLayout.height + "px";
    wall.style.marginLeft = sideGutter ? sideGutter + "px" : "";
    wall.style.marginRight = sideGutter ? sideGutter + "px" : "";
  }

  function scheduleRowDragLayoutSync() {
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

  function rerenderBoardWall(useFlip) {
    const previousRects = useFlip ? captureBoardRects() : new Map();
    const scrollState = captureScrollState();
    masonryLayout = buildMasonryLayout();

    const wall = app.querySelector(".board-wall");
    if (wall) {
      applyBoardWallLayoutStyles(wall);
      wall.replaceChildren(renderBoardLayer());
      syncBoardWallLayout();
    }

    restoreScrollState(scrollState);
    if (useFlip) {
      animateBoardFlip(previousRects);
    }
  }

  function rerenderBoardInPlace(boardId) {
    const board = findBoard(boardId);
    const slot = app.querySelector('.board-slot[data-board-id="' + cssEscape(boardId) + '"]');
    if (!board || !slot) {
      rerenderBoardWall(false);
      return;
    }

    const scrollState = captureScrollState();
    slot.className = "board-slot" + (uiState.openBoardMenuId === boardId ? " has-open-menu" : "");
    slot.replaceChildren(renderBoard(board));
    syncBoardWallLayout();
    restoreScrollState(scrollState);
  }

  function render() {
    const previousRects = captureBoardRects();
    const scrollState = captureScrollState();

    const main = document.createElement("main");
    main.className = "workspace";
    main.appendChild(renderNavbar());
    if (uiState.loginOpen && !auth.isAdmin) main.appendChild(renderLoginModal());
    if (uiState.createBoardOpen && auth.isAdmin) main.appendChild(renderCreateBoardModal());
    const backupsModal = renderBackupsModal();
    if (backupsModal) main.appendChild(backupsModal);

    const content = document.createElement("section");
    content.className = "workspace__content";
    const scroll = document.createElement("div");
    scroll.className = "board-wall-scroll";
    const wall = document.createElement("div");
    wall.className = "board-wall";
    scroll.appendChild(wall);
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
    if (!uiState.boardDragging) {
      syncBoardWallLayout();
    }
    animateBoardFlip(previousRects);
    bindIconPickers(app);
    restoreScrollState(scrollState);
  }

  function captureScrollState() {
    const state = {
      page: {
        left: window.scrollX || window.pageXOffset || 0,
        top: window.scrollY || window.pageYOffset || 0
      },
      wall: null,
      lists: {}
    };
    const wall = app.querySelector(".board-wall-scroll");
    if (wall) {
      state.wall = {
        left: wall.scrollLeft,
        top: wall.scrollTop
      };
    }
    app.querySelectorAll('.board-list[data-board-id]').forEach(function (list) {
      state.lists[list.getAttribute("data-board-id")] = {
        left: list.scrollLeft,
        top: list.scrollTop
      };
    });
    return state;
  }

  function restoreScrollState(state) {
    if (!state) return;
    const wall = app.querySelector(".board-wall-scroll");
    if (wall && state.wall) {
      wall.scrollLeft = state.wall.left;
      wall.scrollTop = state.wall.top;
    }
    Object.keys(state.lists || {}).forEach(function (boardId) {
      const list = app.querySelector('.board-list[data-board-id="' + cssEscape(boardId) + '"]');
      const saved = state.lists[boardId];
      if (list && saved) {
        list.scrollLeft = saved.left;
        list.scrollTop = saved.top;
      }
    });
    if (state.page) {
      window.scrollTo(state.page.left, state.page.top);
    }
  }

  function estimateBoardHeight(board) {
    if (!board) {
      return 180;
    }

    if (board.collapsed) {
      return BOARD_COLLAPSED_HEIGHT;
    }

    const contentHeight = board.displayMode === "icons"
      ? estimateIconGridHeight(board.items.length)
      : (board.items.length
          ? board.items.length * BOARD_ROW_HEIGHT + Math.max(0, board.items.length - 1) * BOARD_ROW_GAP
          : BOARD_LIST_MIN_HEIGHT);
    const listHeight = Math.max(BOARD_LIST_MIN_HEIGHT, Math.min(clampHeight(board.height), contentHeight));
    const metaHeight = uiState.editBoardId === board.id ? BOARD_META_FORM_HEIGHT : 0;
    const addHeight = uiState.openAddBoardId === board.id ? BOARD_ADD_FORM_HEIGHT : 0;
    return BOARD_HEADER_HEIGHT + BOARD_CHROME_HEIGHT + listHeight + metaHeight + addHeight;
  }

  function estimateIconGridHeight(itemCount) {
    if (!itemCount) {
      return BOARD_LIST_MIN_HEIGHT;
    }

    const itemsPerRow = 5;
    const rows = Math.ceil(itemCount / itemsPerRow);
    return rows * BOARD_ICON_TILE_SIZE + Math.max(0, rows - 1) * BOARD_ICON_TILE_GAP;
  }

  function getBoardRenderedHeight(boardId) {
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

  function mutateBoard(boardId, updater) {
    boards = boards.map(function (board) {
      return board.id === boardId ? updater(board) : board;
    });
    saveBoards();
    render();
  }

  function mutateBoardUiPreference(boardId, updater) {
    boards = boards.map(function (board) {
      return board.id === boardId ? updater(board) : board;
    });
    if (auth.isAdmin) {
      saveBoards();
    }
    rerenderBoardInPlace(boardId);
  }

  function rememberAllCollapseSnapshot() {
    uiState.allCollapseSnapshot = boards.map(function (board) {
      return {
        id: board.id,
        collapsed: Boolean(board.collapsed)
      };
    });
  }

  function restoreAllCollapseSnapshot() {
    const snapshot = uiState.allCollapseSnapshot;
    uiState.allCollapseSnapshot = null;
    if (!snapshot) {
      return;
    }

    const collapsedById = new Map(snapshot.map(function (entry) {
      return [entry.id, entry.collapsed];
    }));

    uiState.openBoardMenuId = null;
    uiState.openAddBoardId = null;
    uiState.editBoardId = null;

    boards = boards.map(function (board) {
      if (!collapsedById.has(board.id)) {
        return board;
      }

      return Object.assign({}, board, { collapsed: collapsedById.get(board.id) });
    });
    if (auth.isAdmin) {
      saveBoards();
    }
    rerenderBoardWall(false);
    syncAllCollapseButton();
  }

  function collapseAllBoards() {
    if (!boards.length || !shouldCollapseAllBoards()) {
      return;
    }

    rememberAllCollapseSnapshot();
    uiState.openBoardMenuId = null;
    uiState.openAddBoardId = null;
    uiState.editBoardId = null;

    boards = boards.map(function (board) {
      return Object.assign({}, board, { collapsed: true });
    });
    if (auth.isAdmin) {
      saveBoards();
    }
    rerenderBoardWall(false);
    syncAllCollapseButton();
  }

  function clearRowDropIndicators() {
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
    }
  }

  function finishRowDrag() {
    clearRowDropIndicators();
    if (uiState.rowDragLayoutFrame) {
      window.cancelAnimationFrame(uiState.rowDragLayoutFrame);
      uiState.rowDragLayoutFrame = null;
    }
    syncBoardWallLayout();
  }

  function getNextItemIdAfter(boardId, itemId) {
    const board = findBoard(boardId);
    if (!board) {
      return null;
    }

    const index = board.items.findIndex(function (entry) {
      return entry.id === itemId;
    });
    const nextItem = index >= 0 ? board.items[index + 1] : null;
    return nextItem ? nextItem.id : null;
  }

  function createRowPlaceholder(list) {
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

  function isOriginalRowDropTarget(boardId, itemId) {
    return uiState.draggingRow &&
      boardId === uiState.draggingRow.boardId &&
      itemId === uiState.draggingRow.sourceNextItemId;
  }

  function moveItem(fromBoardId, itemId, toBoardId, beforeItemId) {
    if (!fromBoardId || !itemId || !toBoardId) {
      return;
    }

    if (fromBoardId === toBoardId && (beforeItemId === itemId || isOriginalRowDropTarget(toBoardId, beforeItemId))) {
      return;
    }

    const sourceBoard = findBoard(fromBoardId);
    const item = sourceBoard && sourceBoard.items.find(function (entry) {
      return entry.id === itemId;
    });
    if (!item) {
      return;
    }

    if (fromBoardId === toBoardId) {
      boards = boards.map(function (board) {
        if (board.id !== fromBoardId) {
          return board;
        }

        const items = board.items.filter(function (entry) {
          return entry.id !== itemId;
        });
        const index = beforeItemId
          ? Math.max(items.findIndex(function (entry) { return entry.id === beforeItemId; }), 0)
          : items.length;
        items.splice(index, 0, item);
        return Object.assign({}, board, { items: items });
      });

      saveBoards();
      render();
      return;
    }

    boards = boards.map(function (board) {
      if (board.id === fromBoardId) {
        return Object.assign({}, board, {
          items: board.items.filter(function (entry) {
            return entry.id !== itemId;
          })
        });
      }

      if (board.id === toBoardId) {
        const items = board.items.slice();
        const index = beforeItemId
          ? Math.max(items.findIndex(function (entry) { return entry.id === beforeItemId; }), 0)
          : items.length;
        items.splice(index, 0, item);
        return Object.assign({}, board, { items: items });
      }

      return board;
    });

    saveBoards();
    render();
  }

  function markRowDropTarget(boardId, itemId) {
    if (!uiState.draggingRow) {
      return;
    }

    if (uiState.draggingRow.targetBoardId === boardId && uiState.draggingRow.targetItemId === itemId) {
      return;
    }

    clearRowDropIndicators();
    uiState.draggingRow.targetBoardId = boardId;
    uiState.draggingRow.targetItemId = itemId;

    const dragged = app.querySelector('[data-role="link-row"][data-item-id="' + cssEscape(uiState.draggingRow.itemId) + '"]');
    const originalTarget = isOriginalRowDropTarget(boardId, itemId);
    if (dragged) {
      dragged.classList.add(originalTarget ? "is-dragging" : "is-drag-collapsed");
    }

    if (originalTarget) {
      scheduleRowDragLayoutSync();
      return;
    }

    const list = app.querySelector('.board-list[data-board-id="' + cssEscape(boardId) + '"]');
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

  function getIconModeBeforeItemId(list, clientX, clientY) {
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

  function getListModeBeforeItemId(list, clientY) {
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

  function getRowDropTarget(event) {
    const list = event.target.closest('[data-role="board-list"]');
    if (!list) {
      return null;
    }

    if (list.classList.contains("board-list--icons")) {
      return {
        boardId: list.getAttribute("data-board-id"),
        itemId: getIconModeBeforeItemId(list, event.clientX, event.clientY)
      };
    }

    return {
      boardId: list.getAttribute("data-board-id"),
      itemId: getListModeBeforeItemId(list, event.clientY)
    };
  }

  function beginResize(boardId, handle, event) {
    const board = findBoard(boardId);
    if (!board) {
      return;
    }

    event.preventDefault();
    if (handle && handle.setPointerCapture && event.pointerId !== undefined) {
      handle.setPointerCapture(event.pointerId);
    }
    const card = app.querySelector('.board-slot[data-board-id="' + cssEscape(boardId) + '"] .board-card');
    const list = card ? card.querySelector('[data-role="board-list"]') : null;
    const visibleListHeight = list ? list.getBoundingClientRect().height : board.height;
    const startHeight = Math.min(board.height, visibleListHeight);
    uiState.resizing = {
      boardId: boardId,
      pointerId: event.pointerId,
      handle: handle,
      startY: event.clientY,
      startHeight: startHeight,
      nextHeight: startHeight,
      heightMap: collectBoardHeightMap()
    };
    document.body.classList.add("is-resizing");
  }

  function updateResize(event) {
    if (!uiState.resizing) {
      return;
    }
    if (uiState.resizing.pointerId !== undefined && event.pointerId !== uiState.resizing.pointerId) {
      return;
    }

    uiState.resizing.nextHeight = clampHeight(uiState.resizing.startHeight + (event.clientY - uiState.resizing.startY));
    const card = app.querySelector('.board-slot[data-board-id="' + cssEscape(uiState.resizing.boardId) + '"] .board-card');
    if (card) {
      card.style.setProperty("--list-height", uiState.resizing.nextHeight + "px");
      uiState.resizing.heightMap[uiState.resizing.boardId] = card.getBoundingClientRect().height;
    }
    scheduleResizeLayoutSync();
  }

  function scheduleResizeLayoutSync() {
    if (!uiState.resizing || uiState.resizeFrame) {
      return;
    }

    uiState.resizeFrame = window.requestAnimationFrame(function () {
      uiState.resizeFrame = null;
      if (uiState.resizing) {
        syncResizeBoardWallLayout();
      }
    });
  }

  function syncResizeBoardWallLayout() {
    const resizing = uiState.resizing;
    if (!resizing) {
      return;
    }

    masonryLayout = buildMasonryLayout();

    const wall = app.querySelector(".board-wall");
    if (!wall) {
      return;
    }

    applyBoardWallLayoutStyles(wall);

    masonryLayout.positions.forEach(function (entry) {
      if (entry.type !== "board" || entry.boardId === resizing.boardId) {
        return;
      }

      const slot = wall.querySelector('.board-slot[data-board-id="' + cssEscape(entry.boardId) + '"]');
      if (slot) {
        slot.style.width = entry.width + "px";
        slot.style.transform = "translate(" + entry.x + "px, " + entry.y + "px)";
      }
    });
  }

  function endResize(event) {
    if (!uiState.resizing) {
      return;
    }
    if (event && uiState.resizing.pointerId !== undefined && event.pointerId !== uiState.resizing.pointerId) {
      return;
    }

    const payload = uiState.resizing;
    uiState.resizing = null;
    if (uiState.resizeFrame) {
      window.cancelAnimationFrame(uiState.resizeFrame);
      uiState.resizeFrame = null;
    }
    document.body.classList.remove("is-resizing");
    if (payload.handle && payload.handle.releasePointerCapture && payload.pointerId !== undefined) {
      try {
        payload.handle.releasePointerCapture(payload.pointerId);
      } catch (error) {
        // Pointer capture may already be released by the browser.
      }
    }

    mutateBoard(payload.boardId, function (board) {
      return Object.assign({}, board, { height: payload.nextHeight });
    });
  }

  function getBoardDropPositionFromPoint(clientX, clientY) {
    const dragging = uiState.boardDragging;
    const runtime = dragging && dragging.runtime;
    const scroll = runtime && runtime.scrollNode ? runtime.scrollNode : app.querySelector(".board-wall-scroll");
    const relativeX = clientX - (runtime ? runtime.scrollRectLeft : scroll.getBoundingClientRect().left) + scroll.scrollLeft;
    const relativeY = clientY - (runtime ? runtime.scrollRectTop : scroll.getBoundingClientRect().top) + scroll.scrollTop;
    const columnWidth = dragging && dragging.metrics ? dragging.metrics.columnWidth : (masonryLayout.positions[0] ? masonryLayout.positions[0].width : BOARD_WIDTH);
    const laneWidth = columnWidth + BOARD_GAP;
    const maxColumn = Math.max(0, masonryLayout.columns - 1);
    const targetColumn = Math.min(Math.max(Math.floor(relativeX / laneWidth), 0), maxColumn);
    const columnEntries = masonryLayout.positions.filter(function (entry) {
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

  function beginBoardDrag(boardId, event) {
    const card = app.querySelector('.board-slot[data-board-id="' + cssEscape(boardId) + '"] .board-card');
    if (!card) {
      return;
    }

    const rect = card.getBoundingClientRect();
    const scrollNode = app.querySelector(".board-wall-scroll");
    const heightMap = collectBoardHeightMap();
    const layoutEntry = masonryLayout.positions.find(function (entry) {
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
        columns: masonryLayout.columns,
        columnWidth: layoutEntry ? layoutEntry.width : rect.width
      },
      dropColumn: layoutEntry ? layoutEntry.column : 0,
      dropRow: layoutEntry ? layoutEntry.row : 0
    };
  }

  function updateBoardDrag(event) {
    if (!uiState.boardDragging) {
      return;
    }

    uiState.boardDragging.nextClientX = event.clientX;
    uiState.boardDragging.nextClientY = event.clientY;
    if (Math.abs(event.clientX - uiState.boardDragging.startClientX) > 3 || Math.abs(event.clientY - uiState.boardDragging.startClientY) > 3) {
      if (!uiState.boardDragging.hasMoved) {
        uiState.boardDragging.hasMoved = true;
        document.body.classList.add("is-board-dragging");
        render();
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

  function endBoardDrag() {
    if (!uiState.boardDragging) {
      return;
    }

    if (uiState.boardDragFrame) {
      window.cancelAnimationFrame(uiState.boardDragFrame);
      uiState.boardDragFrame = null;
    }

    const dragging = uiState.boardDragging;
    const movingBoard = boards.find(function (board) {
      return board.id === dragging.boardId;
    });
    if (movingBoard && dragging.hasMoved) {
      const nextBuckets = createColumnBuckets(boards.slice(), masonryLayout.columns);
      for (let columnIndex = 0; columnIndex < nextBuckets.length; columnIndex += 1) {
        nextBuckets[columnIndex] = nextBuckets[columnIndex].filter(function (entry) {
          return entry.id !== dragging.boardId;
        });
      }

      const targetColumn = Math.min(Math.max(dragging.dropColumn, 0), nextBuckets.length - 1);
      const targetBucket = nextBuckets[targetColumn];
      const targetRow = Math.min(Math.max(dragging.dropRow, 0), targetBucket.length);
      targetBucket.splice(targetRow, 0, Object.assign({}, movingBoard, { column: targetColumn }));

      boards = materializeColumnBuckets(nextBuckets);
      saveBoards();
    }

    uiState.boardDragging = null;
    document.body.classList.remove("is-board-dragging");
    render();
  }

  app.addEventListener("click", function (event) {
    const anchor = event.target.closest(".link-row__anchor");
    if (anchor && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      openLinkInBackground(anchor.href);
      return;
    }

    const button = event.target.closest("[data-action]");
    if (!button) {
      if (!event.target.closest(".icon-picker")) {
        closeAllIconPickers(app);
      }
      if (uiState.openBoardMenuId && !event.target.closest(".board-actions-menu")) {
        uiState.openBoardMenuId = null;
        render();
      }
      if ((uiState.dataMenuOpen || uiState.backupMenuOpen) && !event.target.closest(".workspace__menu")) {
        uiState.dataMenuOpen = false;
        uiState.backupMenuOpen = false;
        render();
      }
      return;
    }

    const action = button.getAttribute("data-action");
    const boardId = button.getAttribute("data-board-id");

    if (action === "toggle-auth") {
      if (auth.isAdmin) {
        apiSend("/logout", "POST").catch(function () {}).finally(function () {
          auth.isAdmin = false;
          auth.csrfToken = null;
          uiState.openBoardMenuId = null;
          uiState.openAddBoardId = null;
          uiState.editBoardId = null;
          uiState.createBoardOpen = false;
          render();
        });
      } else {
        uiState.loginOpen = !uiState.loginOpen;
        uiState.loginError = null;
        render();
        if (uiState.loginOpen) {
          const input = app.querySelector('[data-role="login-form"] input[name="password"]');
          if (input) {
            input.focus();
          }
        }
      }
      return;
    }

    if (action === "cancel-auth") {
      if (button.classList.contains("modal-backdrop") && event.target.closest("[data-role='modal-panel']")) {
        return;
      }
      uiState.loginOpen = false;
      uiState.loginError = null;
      render();
      return;
    }

    if (action === "toggle-create-board") {
      uiState.openBoardMenuId = null;
      uiState.createBoardOpen = !uiState.createBoardOpen;
      render();
      if (uiState.createBoardOpen) {
        const input = app.querySelector('[data-role="create-board-form"] input[name="title"]');
        if (input) {
          input.focus();
        }
      }
      return;
    }

    if (action === "toggle-backups") {
      openKvBackupsModal();
      return;
    }

    if (action === "toggle-cloud-backups") {
      if (!auth.isAdmin) {
        return;
      }
      const providerId = button.getAttribute("data-provider-id");
      if (!providerId) return;
      openCloudBackupsModal(providerId, button.getAttribute("data-provider-label"));
      return;
    }

    if (action === "cancel-backups") {
      if (button.classList.contains("modal-backdrop") && event.target.closest("[data-role='modal-panel']")) {
        return;
      }
      uiState.backupsOpen = false;
      uiState.backupsError = null;
      uiState.backupsProviderId = null;
      uiState.backupsProviderLabel = "";
      render();
      return;
    }

    if (action === "restore-backup") {
      if (!auth.isAdmin) {
        return;
      }
      const key = button.getAttribute("data-backup-key");
      const providerId = button.getAttribute("data-provider-id");
      const backupId = button.getAttribute("data-backup-id");
      if ((!providerId && !key) || (providerId && !backupId) || !window.confirm(TEXT.backupRestoreConfirm)) {
        return;
      }
      button.disabled = true;
      const restorePath = providerId
        ? "/cloud-backup/" + encodeURIComponent(providerId) + "/restore"
        : "/backups/restore";
      const restorePayload = providerId ? { id: backupId } : { key: key };
      apiSend(restorePath, "POST", restorePayload).then(function (result) {
        if (result && Number.isInteger(result.version)) {
          serverState.version = result.version;
          serverState.updatedAt = typeof result.updatedAt === "string" ? result.updatedAt : serverState.updatedAt;
        }
        if (result && typeof result.backupKey === "string") {
          startPendingCloudBackup(result.backupKey);
        }
        return loadServerBoardState();
      }).then(function () {
        uiState.backupsOpen = false;
        uiState.backupsProviderId = null;
        uiState.backupsProviderLabel = "";
        setSyncState("saved", TEXT.syncSaved);
        refreshBackupStatusAfterSave(uiState.pendingBackupKey && uiState.pendingBackupKey !== "__pending__" ? uiState.pendingBackupKey : null);
        render();
      }).catch(function (error) {
        const detail = error && error.responseText ? "\n\n" + error.responseText : "";
        window.alert(TEXT.backupRestoreFailed + detail);
        render();
      });
      return;
    }

    if (action === "export-full-backup") {
      if (!auth.isAdmin) {
        return;
      }
      uiState.openBoardMenuId = null;
      uiState.dataMenuOpen = false;
      exportFullBackup();
      render();
      return;
    }

    if (action === "import-full-backup") {
      if (!auth.isAdmin) {
        return;
      }
      uiState.openBoardMenuId = null;
      uiState.dataMenuOpen = false;
      pickFullBackupFile();
      render();
      return;
    }

    if (action === "toggle-data-menu") {
      if (!auth.isAdmin) {
        return;
      }
      uiState.openBoardMenuId = null;
      uiState.backupMenuOpen = false;
      uiState.dataMenuOpen = !uiState.dataMenuOpen;
      render();
      return;
    }

    if (action === "toggle-backup-menu") {
      if (!auth.isAdmin) {
        return;
      }
      uiState.openBoardMenuId = null;
      uiState.dataMenuOpen = false;
      uiState.backupMenuOpen = !uiState.backupMenuOpen;
      render();
      if (uiState.backupMenuOpen) {
        loadBackupStatus();
      }
      return;
    }

    if (action === "toggle-all-collapse") {
      if (uiState.allCollapseSnapshot) {
        restoreAllCollapseSnapshot();
      } else {
        collapseAllBoards();
      }
      return;
    }

    if (action === "connect-cloud-backup") {
      if (!auth.isAdmin) {
        return;
      }
      const providerId = button.getAttribute("data-provider-id");
      if (!providerId) return;
      button.disabled = true;
      apiSend("/cloud-backup/" + encodeURIComponent(providerId) + "/connect", "POST", {}).then(function (result) {
        if (result && typeof result.url === "string") {
          window.location.href = result.url;
          return;
        }
        throw new Error("Missing authorization URL");
      }).catch(function () {
        button.disabled = false;
        window.alert("Cloud backup authorization failed to start.");
      });
      return;
    }

    if (action === "disconnect-cloud-backup") {
      if (!auth.isAdmin) {
        return;
      }
      const providerId = button.getAttribute("data-provider-id");
      if (!providerId || !window.confirm("断开这个云备份服务？云盘里已有的备份文件会保留。")) {
        return;
      }
      button.disabled = true;
      apiSend("/cloud-backup/" + encodeURIComponent(providerId) + "/disconnect", "POST", {}).then(function () {
        loadBackupStatus();
      }).catch(function () {
        button.disabled = false;
        window.alert("Cloud backup disconnect failed.");
      });
      return;
    }

    if (action === "cancel-create-board") {
      if (button.classList.contains("modal-backdrop") && event.target.closest("[data-role='modal-panel']")) {
        return;
      }
      uiState.createBoardOpen = false;
      render();
      return;
    }

    if (action === "toggle-board-menu") {
      uiState.openBoardMenuId = uiState.openBoardMenuId === boardId ? null : boardId;
      render();
      return;
    }

    if (action === "toggle-edit-board") {
      uiState.openBoardMenuId = null;
      if (uiState.openAddBoardId === boardId) {
        uiState.openAddBoardId = null;
      }
      uiState.editBoardId = uiState.editBoardId === boardId ? null : boardId;
      render();
      if (uiState.editBoardId === boardId) {
        const input = app.querySelector('.board-meta-form[data-board-id="' + cssEscape(boardId) + '"] input[name="title"]');
        if (input) {
          input.focus();
          input.select();
        }
      }
      return;
    }

    if (action === "cancel-edit-board") {
      uiState.editBoardId = null;
      render();
      return;
    }

    if (action === "toggle-view-mode") {
      uiState.openBoardMenuId = null;
      mutateBoardUiPreference(boardId, function (board) {
        return Object.assign({}, board, {
          displayMode: nextDisplayMode(board.displayMode)
        });
      });
      return;
    }

    if (action === "toggle-collapse") {
      uiState.openBoardMenuId = null;
      if (uiState.openAddBoardId === boardId) {
        uiState.openAddBoardId = null;
      }
      mutateBoardUiPreference(boardId, function (board) {
        return Object.assign({}, board, { collapsed: !board.collapsed });
      });
      return;
    }

    if (action === "toggle-add") {
      uiState.openBoardMenuId = null;
      if (uiState.editBoardId === boardId) {
        uiState.editBoardId = null;
      }
      const board = findBoard(boardId);
      if (board && board.collapsed) {
        boards = boards.map(function (entry) {
          return entry.id === boardId ? Object.assign({}, entry, { collapsed: false }) : entry;
        });
      }
      uiState.openAddBoardId = uiState.openAddBoardId === boardId ? null : boardId;
      saveBoards();
      render();
      const input = app.querySelector('.board-add-form[data-board-id="' + cssEscape(boardId) + '"] input[name="url"]');
      if (input) {
        input.focus();
      }
      return;
    }

    if (action === "import-board") {
      if (!auth.isAdmin || uiState.importingBoardId) {
        return;
      }
      uiState.openBoardMenuId = null;
      render();
      pickFileForBoard(boardId);
      return;
    }

    if (action === "export-board") {
      const board = findBoard(boardId);
      uiState.openBoardMenuId = null;
      render();
      if (board) {
        exportBoardToCsv(board);
      }
      return;
    }

    if (action === "delete-board") {
      uiState.openBoardMenuId = null;
      const board = findBoard(boardId);
      if (!board) {
        return;
      }

      if (board.items.length > 0) {
        const confirmed = window.confirm(TEXT.deleteBoardConfirm.replace("{count}", String(board.items.length)));
        if (!confirmed) {
          return;
        }
      }

      boards = boards.filter(function (entry) {
        return entry.id !== boardId;
      });
      if (uiState.openAddBoardId === boardId) {
        uiState.openAddBoardId = null;
      }
      if (uiState.editBoardId === boardId) {
        uiState.editBoardId = null;
      }
      saveBoards();
      render();
      return;
    }

    if (action === "cancel-add") {
      uiState.openAddBoardId = null;
      render();
      return;
    }

    if (action === "delete-item") {
      if (!auth.isAdmin) {
        return;
      }
      const itemId = button.getAttribute("data-item-id");
      if (!boardId || !itemId) {
        return;
      }
      mutateBoard(boardId, function (board) {
        return Object.assign({}, board, {
          items: board.items.filter(function (entry) {
            return entry.id !== itemId;
          })
        });
      });
      return;
    }
  });

  app.addEventListener("submit", function (event) {
    const loginForm = event.target.closest('[data-role="login-form"]');
    if (loginForm) {
      event.preventDefault();
      const formData = new FormData(loginForm);
      const password = String(formData.get("password") || "");
      apiSend("/login", "POST", { password: password }).then(function (result) {
        auth.isAdmin = true;
        auth.csrfToken = result && typeof result.csrfToken === "string" ? result.csrfToken : null;
        uiState.backupStatus = null;
        uiState.localLastBackup = null;
        uiState.loginOpen = false;
        uiState.loginError = null;
        loadServerBoardState().catch(function () {}).finally(function () {
          render();
          loadBackupStatus();
        });
      }).catch(function (error) {
        uiState.loginError = error && error.status === 429
          ? TEXT.loginRateLimited
          : (error && error.status === 500 ? TEXT.loginConfigError : TEXT.loginFailed);
        render();
        const input = app.querySelector('[data-role="login-form"] input[name="password"]');
        if (input) {
          input.focus();
          input.select();
        }
      });
      return;
    }

    const createBoardForm = event.target.closest('[data-role="create-board-form"]');
    if (createBoardForm) {
      event.preventDefault();

      const formData = new FormData(createBoardForm);
      const title = String(formData.get("title") || "").trim();
      const icon = String(formData.get("icon") || "").trim() || nextBoardIcon();
      if (!title) {
        return;
      }

      boards = boards.concat({
        id: uid("board"),
        title: title,
        accent: nextBoardAccent(),
        icon: normalizeIconName(icon),
        height: DEFAULT_NEW_BOARD_HEIGHT,
        collapsed: false,
        column: getNextBoardColumn(masonryLayout.columns),
        displayMode: "list",
        items: []
      });

      uiState.createBoardOpen = false;
      saveBoards();
      render();
      return;
    }

    const editBoardForm = event.target.closest('[data-role="edit-board-form"]');
    if (editBoardForm) {
      event.preventDefault();

      const boardId = editBoardForm.getAttribute("data-board-id");
      const formData = new FormData(editBoardForm);
      const title = String(formData.get("title") || "").trim();
      const icon = String(formData.get("icon") || "").trim();
      if (!boardId || !title) {
        return;
      }

      uiState.editBoardId = null;
      boards = boards.map(function (board) {
        return board.id === boardId
          ? Object.assign({}, board, {
          title: title,
          icon: ICON_NAME_RE.test(icon) ? normalizeIconName(icon) : board.icon
            })
          : board;
      });
      saveBoards();
      render();
      return;
    }

    const addForm = event.target.closest('[data-role="add-form"]');
    if (!addForm) {
      return;
    }

    event.preventDefault();
    const boardId = addForm.getAttribute("data-board-id");
    const formData = new FormData(addForm);
    const rawUrl = formData.get("url");
    const rawName = formData.get("name");

    let url;
    try {
      url = normalizeUrl(rawUrl);
    } catch (error) {
      window.alert(TEXT.invalidUrl);
      return;
    }

    const item = {
      id: uid("item"),
      name: displayName(url, rawName),
      url: url
    };

    uiState.openAddBoardId = null;

    mutateBoard(boardId, function (board) {
      return Object.assign({}, board, { items: board.items.concat(item) });
    });
  });

  function openLinkInBackground(url) {
    var w = window.open(url, "_blank", "noopener,noreferrer");
    if (w) {
      w.blur();
      window.focus();
    }
  }

  function pickFileForBoard(boardId) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,.md,.html,.csv,.json,text/*";
    input.style.display = "none";
    input.addEventListener("change", function () {
      const file = input.files && input.files[0];
      if (file) {
        handleImportFile(boardId, file);
      }
    });
    document.body.appendChild(input);
    input.click();
    setTimeout(function () { input.remove(); }, 0);
  }

  function pickFullBackupFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    input.addEventListener("change", function () {
      const file = input.files && input.files[0];
      if (file) {
        handleFullBackupImport(file);
      }
    });
    document.body.appendChild(input);
    input.click();
    setTimeout(function () { input.remove(); }, 0);
  }

  function exportFullBackup() {
    const payload = {
      schema: FULL_BACKUP_SCHEMA,
      exportedAt: new Date().toISOString(),
      serverVersion: serverState.version,
      serverUpdatedAt: serverState.updatedAt,
      boards: boards
    };
    const text = JSON.stringify(payload, null, 2) + "\n";
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const objUrl = URL.createObjectURL(blob);
    const stamp = payload.exportedAt.replace(/[:.]/g, "-");
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = "board-trello-backup-" + stamp + ".json";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      a.remove();
      URL.revokeObjectURL(objUrl);
    }, 0);
  }

  function handleFullBackupImport(file) {
    const reader = new FileReader();
    reader.onerror = function () {
      window.alert("Import failed.");
    };
    reader.onload = function () {
      try {
        const text = typeof reader.result === "string" ? reader.result : "";
        const parsed = JSON.parse(text);
        const importedBoards = parseFullBackupBoards(parsed);
        if (!window.confirm("Import this JSON backup? Current remote state will be backed up first.")) {
          return;
        }
        const previousBoards = boards;
        boards = importedBoards;
        cacheBoardsLocally();
        setSyncState("saving", TEXT.syncSaving);
        apiSend("/board", "PUT", {
          version: serverState.version,
          boards: boards
        }).then(function (result) {
          if (result && Number.isInteger(result.version)) {
            serverState.version = result.version;
            serverState.updatedAt = typeof result.updatedAt === "string" ? result.updatedAt : serverState.updatedAt;
          }
          if (result && typeof result.backupKey === "string") {
            startPendingCloudBackup(result.backupKey);
          }
          setSyncState("saved", TEXT.syncSaved);
          refreshBackupStatusAfterSave(result && typeof result.backupKey === "string" ? result.backupKey : null);
          render();
        }).catch(function (error) {
          if (error && error.status === 409) {
            setSyncState("failed", TEXT.syncConflict);
            handleSaveConflict();
            return;
          }
          boards = previousBoards;
          cacheBoardsLocally();
          setSyncState("failed", TEXT.syncFailed);
          window.alert("Import failed.");
          render();
        });
        render();
      } catch (error) {
        window.alert("Invalid JSON backup.");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function parseFullBackupBoards(value) {
    const source = Array.isArray(value)
      ? value
      : (value && typeof value === "object" && Array.isArray(value.boards) ? value.boards : null);
    if (!source) {
      throw new Error("Invalid backup");
    }
    return normalizeBoards(source);
  }

  function handleImportFile(boardId, file) {
    if (uiState.importingBoardId) return;
    const reader = new FileReader();
    reader.onerror = function () {
      window.alert(TEXT.importFailed);
    };
    reader.onload = function () {
      const text = typeof reader.result === "string" ? reader.result : "";
      const found = extractUrlsFromText(text);
      if (found.length === 0) {
        window.alert(TEXT.importNoUrls);
        return;
      }
      const urls = found.slice(0, IMPORT_MAX_URLS);
      if (found.length > IMPORT_MAX_URLS) {
        window.alert(TEXT.importTooMany.replace("{found}", String(found.length)).replace("{kept}", String(urls.length)));
      }

      uiState.importingBoardId = boardId;
      render();

      fetchUrlTitlesInBatches(urls).then(function (list) {
        const items = list.map(function (entry) {
          let normalized;
          try {
            normalized = normalizeUrl(entry && entry.url);
          } catch (e) {
            normalized = entry && entry.url;
          }
          const title = entry && typeof entry.title === "string" ? entry.title.trim() : "";
          return {
            id: uid("item"),
            name: title || displayName(normalized, ""),
            url: normalized
          };
        }).filter(function (item) { return Boolean(item.url); });

        if (items.length) {
          boards = boards.map(function (board) {
            return board.id === boardId ? Object.assign({}, board, { items: board.items.concat(items) }) : board;
          });
          saveBoards();
        }
      }).catch(function () {
        window.alert(TEXT.importFailed);
      }).finally(function () {
        uiState.importingBoardId = null;
        render();
      });
    };
    reader.readAsText(file, "utf-8");
  }

  function fetchUrlTitlesInBatches(urls) {
    const batches = [];
    for (let i = 0; i < urls.length; i += URL_TITLE_BATCH_SIZE) {
      batches.push(urls.slice(i, i + URL_TITLE_BATCH_SIZE));
    }
    return batches.reduce(function (chain, batch) {
      return chain.then(function (all) {
        return apiSend("/url-titles", "POST", { urls: batch }).then(function (results) {
          return all.concat(Array.isArray(results) ? results : []);
        });
      });
    }, Promise.resolve([]));
  }

  function csvEscape(value) {
    const v = String(value == null ? "" : value);
    if (/[",\r\n]/.test(v)) {
      return '"' + v.replace(/"/g, '""') + '"';
    }
    return v;
  }

  function exportBoardToCsv(board) {
    if (!board || !Array.isArray(board.items) || board.items.length === 0) {
      window.alert(TEXT.exportEmpty);
      return;
    }
    const lines = board.items.map(function (item) {
      return csvEscape(item.name) + "," + csvEscape(item.url);
    });
    const text = lines.join("\r\n") + "\r\n";
    const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
    const objUrl = URL.createObjectURL(blob);
    const safeName = String(board.title || "board").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim() || "board";
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = safeName + ".csv";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      a.remove();
      URL.revokeObjectURL(objUrl);
    }, 0);
  }

  app.addEventListener("dragstart", function (event) {
    if (!auth.isAdmin) {
      event.preventDefault();
      return;
    }
    const row = event.target.closest('[data-role="link-row"]');
    if (!row) {
      return;
    }

    const iconMode = row.classList.contains("link-row--icon-only");
    const boardId = row.getAttribute("data-board-id");
    const itemId = row.getAttribute("data-item-id");
    const sourceNextItemId = getNextItemIdAfter(boardId, itemId);
    const sourceRect = row.getBoundingClientRect();

    uiState.draggingRow = {
      boardId: boardId,
      itemId: itemId,
      sourceNextItemId: sourceNextItemId,
      sourceWidth: sourceRect.width,
      sourceHeight: sourceRect.height,
      targetBoardId: boardId,
      targetItemId: sourceNextItemId,
      dragImageNode: null
    };

    if (iconMode) {
      const rect = row.getBoundingClientRect();
      const dragImageNode = row.cloneNode(true);
      dragImageNode.classList.add("link-row-drag-image");
      dragImageNode.style.width = rect.width + "px";
      dragImageNode.style.height = rect.height + "px";
      dragImageNode.style.left = "-9999px";
      dragImageNode.style.top = "-9999px";
      document.body.appendChild(dragImageNode);
      uiState.draggingRow.dragImageNode = dragImageNode;
      event.dataTransfer.setDragImage(dragImageNode, rect.width / 2, rect.height / 2);
    }

    row.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", JSON.stringify(uiState.draggingRow));
  });

  app.addEventListener("dragover", function (event) {
    if (!uiState.draggingRow) {
      return;
    }

    const target = getRowDropTarget(event);
    if (target) {
      event.preventDefault();
      markRowDropTarget(target.boardId, target.itemId);
    }
  });

  app.addEventListener("drop", function (event) {
    if (!uiState.draggingRow) {
      return;
    }

    const target = getRowDropTarget(event);
    if (target) {
      event.preventDefault();
      moveItem(
        uiState.draggingRow.boardId,
        uiState.draggingRow.itemId,
        target.boardId,
        target.itemId
      );
      finishRowDrag();
      uiState.draggingRow = null;
    }
  });

  app.addEventListener("dragend", function () {
    finishRowDrag();
    uiState.draggingRow = null;
  });

  app.addEventListener("pointerdown", function (event) {
    const resizeHandle = event.target.closest('[data-role="resize-handle"]');
    if (resizeHandle) {
      beginResize(resizeHandle.getAttribute("data-board-id"), resizeHandle, event);
      return;
    }

    const boardHandle = event.target.closest('[data-role="board-drag-handle"]');
    if (boardHandle) {
      if (event.target.closest("button, a, input, textarea, select, [contenteditable], .board-card__actions")) {
        return;
      }
      beginBoardDrag(boardHandle.getAttribute("data-board-id"), event);
    }
  });

  document.addEventListener("pointermove", function (event) {
    updateResize(event);
    updateBoardDrag(event);
  });

  document.addEventListener("pointerup", function (event) {
    endResize(event);
    endBoardDrag();
  });

  document.addEventListener("pointercancel", function (event) {
    endResize(event);
    endBoardDrag();
  });

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 200);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeAllIconPickers(app);
    }
  });

  app.addEventListener("error", function (event) {
    if (event.target.tagName !== "IMG") {
      return;
    }

    const icon = event.target.closest(".link-row__icon");
    if (icon) {
      icon.classList.add("is-fallback");
    }
  }, true);

  bootstrap();
})();
