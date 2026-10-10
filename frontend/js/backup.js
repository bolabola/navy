// 备份菜单、历史备份与云备份
import { TEXT } from "./constants.js";
import { actionButton, staticIconNode } from "./dom.js";
import { render } from "./render.js";
import { auth, syncState, uiState } from "./state.js";
import { apiGet, updateBackupMenu } from "./sync.js";
import { createModalHeader } from "./theme.js";

export function loadBackupStatus() {
  if (!auth.isAdmin) return Promise.resolve(null);
  if (uiState.backupStatusRequest) return uiState.backupStatusRequest;
  uiState.backupStatusLoading = true;
  uiState.backupStatusRequest = Promise.all([
    apiGet("/cloud-backup/status"),
    apiGet("/backups").catch(function () { return { backups: [] }; })
  ]).then(function (results) {
    uiState.backupStatus = results[0] || null;
    uiState.backupStatusError = null;
    syncLocalLastBackupFromApi(results[1]);
    return uiState.backupStatus;
  }).catch(function (error) {
    uiState.backupStatus = null;
    uiState.backupStatusError = describeBackupStatusError(error);
    return null;
  }).finally(function () {
    uiState.backupStatusRequest = null;
    uiState.backupStatusLoading = false;
    updateBackupMenu();
  });
  return uiState.backupStatusRequest;
}

/** 把读取云备份状态失败的原因翻译成用户能看懂、能照着处理的话。 */
export function describeBackupStatusError(error) {
  const status = error && error.status;
  const detail = String((error && error.responseText) || "");
  if (!status) return "网络连接失败，请检查网络后重试";
  if (status === 401 || status === 403) return "登录已失效，请重新登录";
  if (/ADMIN_PASSWORD is not configured/i.test(detail)) {
    return "服务端还没有配置管理员密码，请在 Cloudflare 后台的 Runtime variables and secrets 中添加 ADMIN_PASSWORD";
  }
  if (/ADMIN_PASSWORD is too weak/i.test(detail)) {
    return "服务端的管理员密码太短或是示例值，请在 Cloudflare 后台重新设置 ADMIN_PASSWORD";
  }
  return "读取云备份状态失败（HTTP " + status + "）" + (detail ? "：" + detail.slice(0, 120) : "");
}

export function renderBackupMenu() {
  const wrapper = document.createElement("div");
  wrapper.className = "workspace__menu";

  const regularEntry = getRegularBackupEntry();
  const statusError = !uiState.backupStatusLoading && uiState.backupStatusError;
  const errorEntry = statusError
    ? { id: "cloud-status", label: "云备份", status: "failed", detail: statusError, connected: true }
    : null;
  const cloudEntries = errorEntry ? [errorEntry] : getCloudBackupEntries();
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
  } else if (errorEntry) {
    const row = renderBackupStatusRow(errorEntry, { action: "retry-backup-status", label: "重试" });
    row.classList.add("backup-menu__row--error");
    menu.appendChild(row);
  } else {
    cloudEntries.forEach(function (entry) {
      if (!entry.configured && !entry.connected) {
        menu.appendChild(renderBackupStatusRow(entry, { action: "configure-cloud-backup", label: "配置", providerId: entry.id }));
        return;
      }
      const settings = entry.configuredBy === "app" && !entry.connected
        ? [{ action: "configure-cloud-backup", label: "设置", providerId: entry.id }]
        : [];
      menu.appendChild(renderBackupStatusRow(entry, {
        action: entry.connected ? "disconnect-cloud-backup" : "connect-cloud-backup",
        label: entry.connected ? "断开" : "连接",
        providerId: entry.id,
        extraActions: entry.connected ? [{
          action: "run-cloud-backup",
          label: "立即备份",
          providerId: entry.id,
          disabled: Boolean(uiState.cloudBackupRunning[entry.id])
        }, {
          action: "toggle-cloud-backups",
          label: "恢复",
          providerId: entry.id,
          providerLabel: entry.label
        }] : settings
      }));
    });
  }
  wrapper.appendChild(menu);
  return wrapper;
}

export function getRegularBackupEntry() {
  const last = resolveLocalLastBackup();
  if (syncState.status === "failed") {
    return {
      id: "kv-history",
      label: "常规备份",
      status: "failed",
      detail: syncState.message || "保存失败，未生成新备份"
    };
  }
  // 普通保存不一定产生备份（每 10 分钟最多一次），保存中不改变备份状态，避免顶栏每次编辑都显示“备份中”。
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
    detail: "保存时自动备份（每 10 分钟最多一次，保留最近 20 份）"
  };
}

export function getCloudBackupEntries() {
  const providers = uiState.backupStatus && Array.isArray(uiState.backupStatus.providers)
    ? uiState.backupStatus.providers
    : [];
  return providers.map(getCloudBackupEntry);
}

export function getCloudBackupEntry(provider) {
  const last = provider.lastBackup || null;
  let status = "idle";
  let detail = provider.configured ? "已配置，点“连接”授权" : "还没有配置，点“配置”按步骤设置";
  if (provider.connected) {
    status = "pending";
    detail = "每小时自动备份，尚无结果";
    if (uiState.cloudBackupRunning[provider.id]) {
      status = "saving";
      detail = "正在备份...";
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
    configured: Boolean(provider.configured),
    configuredBy: provider.configuredBy || null
  };
}

export function getBackupSummary(regularEntry, cloudEntries) {
  const entries = [regularEntry].concat(cloudEntries.filter(function (entry) { return entry.connected; }));
  if (entries.some(function (entry) { return entry.status === "failed"; })) return { status: "failed", label: "备份异常" };
  if (entries.some(function (entry) { return entry.status === "saving"; })) return { status: "saving", label: "备份中" };
  if (entries.some(function (entry) { return entry.status === "pending"; })) return { status: "pending", label: "待备份" };
  if (entries.some(function (entry) { return entry.status === "saved"; })) return { status: "saved", label: "备份正常" };
  return { status: "idle", label: "备份" };
}

export function statusIcon(status) {
  if (status === "failed") return "icon-alert-circle";
  if (status === "saved") return "icon-check-circle";
  if (status === "saving") return "icon-refresh-cw";
  return "icon-clock";
}

export function renderBackupStatusRow(entry, actionConfig) {
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

export function createBackupRowAction(actionConfig, className) {
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

export function formatCloudBackupLastBackup(lastBackup) {
  const at = (lastBackup && lastBackup.key ? backupKeyToCreatedAt(lastBackup.key) : "") || (lastBackup && lastBackup.at ? lastBackup.at : "");
  const time = at ? formatDateTime(at) : "";
  if (lastBackup.status === "success") return time ? "最近成功 " + time : "最近成功";
  const error = lastBackup && lastBackup.error ? ": " + lastBackup.error : "";
  return (time ? "最近失败 " + time : "最近失败") + error;
}

export function backupKeyToCreatedAt(key) {
  const raw = String(key || "").replace(/^state_backup:/, "");
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (!match) return "";
  return match[1] + "T" + match[2] + ":" + match[3] + ":" + match[4] + "." + match[5] + "Z";
}

export function pickNewerLocalLastBackup(current, candidate) {
  if (!candidate) return current || null;
  if (!current) return candidate;
  return candidate.key.localeCompare(current.key) > 0 ? candidate : current;
}

export function resolveLocalLastBackup() {
  return uiState.localLastBackup || null;
}

export function deriveLocalLastBackup(backupsResult) {
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

export function syncLocalLastBackupFromApi(backupsResult) {
  uiState.localLastBackup = pickNewerLocalLastBackup(
    uiState.localLastBackup,
    deriveLocalLastBackup(backupsResult)
  );
}

export function openKvBackupsModal() {
  if (!auth.isAdmin) return;
  uiState.openBoardMenuId = null;
  uiState.dataMenuOpen = false;
  uiState.backupMenuOpen = false;
  uiState.layoutMenuOpen = false;
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

export function openCloudBackupsModal(providerId, providerLabel) {
  if (!auth.isAdmin) return;
  uiState.openBoardMenuId = null;
  uiState.dataMenuOpen = false;
  uiState.backupMenuOpen = false;
  uiState.layoutMenuOpen = false;
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

export function renderBackupsModal() {
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

export function renderBackupList() {
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

export function formatDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("zh-CN", { hour12: false });
}
