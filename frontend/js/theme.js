// 主题切换
import { THEME_DARK, THEME_LIGHT, THEME_STORAGE_KEY } from "./constants.js";
import { actionButton, staticIconNode } from "./dom.js";
import { app, state } from "./state.js";

export function readThemePreference() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === THEME_DARK || stored === THEME_LIGHT) return stored;
  } catch (error) {
    // localStorage may be unavailable in private mode.
  }
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? THEME_DARK : THEME_LIGHT;
  } catch (error) {
    return THEME_LIGHT;
  }
}

export function saveThemePreference(theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    // localStorage may be unavailable in private mode.
  }
}

export function applyTheme(theme) {
  document.documentElement.classList.toggle("is-dark-theme", theme === THEME_DARK);
  document.body.classList.toggle("is-dark-theme", theme === THEME_DARK);
  syncIconPickerTheme();
}

export function iconPickerTheme() {
  return document.body.classList.contains("is-dark-theme") ? THEME_DARK : THEME_LIGHT;
}

export function applyIconPickerTheme(picker) {
  if (!picker) return;
  picker.dataset.theme = iconPickerTheme();
}

export function syncIconPickerTheme(scope) {
  (scope || app).querySelectorAll('[data-role="icon-picker"]').forEach(applyIconPickerTheme);
}

export function getThemeToggleLabel() {
  return state.currentTheme === THEME_DARK ? "切换浅色主题" : "切换暗色主题";
}

export function syncThemeToggleButton(button) {
  if (!button) return;
  const isDark = state.currentTheme === THEME_DARK;
  const label = getThemeToggleLabel();
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", isDark ? "true" : "false");
  button.replaceChildren(staticIconNode(isDark ? "icon-sun" : "icon-moon"));
}

export function renderThemeToggleButton() {
  const button = actionButton("workspace__theme-button", "toggle-theme", null, getThemeToggleLabel(), []);
  syncThemeToggleButton(button);
  return button;
}

export function createModalHeader(title, closeAction) {
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
