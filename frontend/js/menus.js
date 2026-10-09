// 数据菜单与布局菜单
import { MAX_LAYOUT_COLUMN_WIDTH, MAX_LAYOUT_GAP, MAX_MANUAL_COLUMNS, MIN_LAYOUT_COLUMN_WIDTH, MIN_LAYOUT_GAP } from "../../shared/limits";
import { TEXT } from "./constants.js";
import { actionButton, staticIconNode } from "./dom.js";
import { state, uiState } from "./state.js";

export function renderDataMenu() {
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
  menu.appendChild(workspaceMenuItem("import-bookmarks-html", "icon-bookmark", "导入收藏 HTML", "从浏览器导出的书签文件创建 boards"));
  wrapper.appendChild(menu);
  return wrapper;
}

export function workspaceMenuItem(action, iconClass, title, description) {
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

export function renderLayoutMenu() {
  const wrapper = document.createElement("div");
  wrapper.className = "workspace__menu";
  wrapper.appendChild(actionButton("workspace__create-button", "toggle-layout-menu", null, TEXT.layout, [
    staticIconNode("icon-sliders"),
    " " + TEXT.layout
  ]));

  if (!uiState.layoutMenuOpen) return wrapper;

  const menu = document.createElement("form");
  menu.className = "layout-menu";
  menu.dataset.role = "layout-settings-form";

  const header = document.createElement("header");
  header.className = "layout-menu__header";
  const heading = document.createElement("div");
  heading.className = "layout-menu__heading";
  const title = document.createElement("div");
  title.className = "layout-menu__title";
  title.textContent = "布局设置";
  const subtitle = document.createElement("div");
  subtitle.className = "layout-menu__subtitle";
  subtitle.textContent = "调整看板网格、间距和显示项";
  heading.appendChild(title);
  heading.appendChild(subtitle);
  header.appendChild(heading);
  header.appendChild(actionButton("layout-menu__close", "toggle-layout-menu", null, "关闭", [
    staticIconNode("icon-x")
  ]));
  menu.appendChild(header);

  const layoutSection = document.createElement("section");
  layoutSection.className = "layout-menu__section";
  layoutSection.appendChild(layoutMenuSectionTitle(TEXT.layoutSectionLayout));

  const columnOptions = [{ value: "auto", label: TEXT.layoutAuto }];
  for (let i = 1; i <= MAX_MANUAL_COLUMNS; i += 1) {
    columnOptions.push({ value: String(i), label: String(i) });
  }
  const selectedColumns = state.layoutSettings.columnMode === "manual" ? String(state.layoutSettings.columns) : "auto";
  layoutSection.appendChild(layoutMenuSegmentedField("columns", TEXT.layoutColumns, columnOptions, selectedColumns));

  layoutSection.appendChild(layoutMenuRangeField(
    "columnWidth",
    TEXT.layoutColumnWidth,
    state.layoutSettings.columnWidth,
    MIN_LAYOUT_COLUMN_WIDTH,
    MAX_LAYOUT_COLUMN_WIDTH,
    10,
    "px"
  ));
  layoutSection.appendChild(layoutMenuRangeField(
    "columnGap",
    TEXT.layoutColumnGap,
    state.layoutSettings.columnGap,
    MIN_LAYOUT_GAP,
    MAX_LAYOUT_GAP,
    2,
    "px"
  ));
  layoutSection.appendChild(layoutMenuRangeField(
    "rowGap",
    TEXT.layoutRowGap,
    state.layoutSettings.rowGap,
    MIN_LAYOUT_GAP,
    MAX_LAYOUT_GAP,
    2,
    "px"
  ));

  layoutSection.appendChild(layoutMenuSegmentedField("align", TEXT.layoutAlign, [
    { value: "left", label: TEXT.layoutLeft },
    { value: "center", label: TEXT.layoutCenter }
  ], state.layoutSettings.align));
  menu.appendChild(layoutSection);

  const displaySection = document.createElement("section");
  displaySection.className = "layout-menu__section";
  displaySection.appendChild(layoutMenuSectionTitle(TEXT.layoutSectionDisplay));
  const toggles = document.createElement("div");
  toggles.className = "layout-menu__toggles";
  toggles.appendChild(layoutMenuToggle("showBoardIcon", TEXT.layoutShowBoardIcon, TEXT.layoutShowBoardIconDesc, state.layoutSettings.showBoardIcon !== false));
  toggles.appendChild(layoutMenuToggle("showBoardCount", TEXT.layoutShowBoardCount, TEXT.layoutShowBoardCountDesc, state.layoutSettings.showBoardCount !== false));
  toggles.appendChild(layoutMenuToggle("showItemDragHandle", TEXT.layoutShowItemDragHandle, TEXT.layoutShowItemDragHandleDesc, state.layoutSettings.showItemDragHandle !== false));
  displaySection.appendChild(toggles);
  menu.appendChild(displaySection);

  const footer = document.createElement("footer");
  footer.className = "layout-menu__footer";
  footer.appendChild(actionButton("layout-menu__reset", "reset-layout-settings", null, TEXT.layoutReset, [
    staticIconNode("icon-rotate-ccw"),
    " " + TEXT.layoutReset
  ]));
  const hint = document.createElement("span");
  hint.className = "layout-menu__hint";
  hint.textContent = "调整会立即应用";
  footer.appendChild(hint);
  menu.appendChild(footer);

  wrapper.appendChild(menu);
  return wrapper;
}

export function layoutMenuSectionTitle(text) {
  const title = document.createElement("div");
  title.className = "layout-menu__section-title";
  title.textContent = text;
  return title;
}

export function layoutMenuField(labelText, control, valueText) {
  const field = document.createElement("div");
  field.className = "layout-menu__field";

  const meta = document.createElement("div");
  meta.className = "layout-menu__field-meta";
  const label = document.createElement("span");
  label.className = "layout-menu__label";
  label.textContent = labelText;
  meta.appendChild(label);
  if (valueText != null) {
    const value = document.createElement("span");
    value.className = "layout-menu__value";
    value.textContent = valueText;
    meta.appendChild(value);
  }
  field.appendChild(meta);
  field.appendChild(control);
  return field;
}

export function layoutMenuSegmentedField(name, labelText, options, selectedValue) {
  const controls = document.createElement("div");
  controls.className = "layout-menu__segmented layout-menu__segmented--" + name;
  options.forEach(function (option) {
    const label = document.createElement("label");
    label.className = "layout-menu__segment" + (String(option.value) === String(selectedValue) ? " is-active" : "");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = String(option.value);
    input.checked = String(option.value) === String(selectedValue);
    label.appendChild(input);
    label.appendChild(document.createTextNode(option.label));
    controls.appendChild(label);
  });
  return layoutMenuField(labelText, controls);
}

export function layoutMenuRangeField(name, labelText, value, min, max, step, suffix) {
  const input = document.createElement("input");
  input.type = "range";
  input.className = "layout-menu__range";
  input.name = name;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.dataset.suffix = suffix || "";
  return layoutMenuField(labelText, input, String(value) + (suffix || ""));
}

export function layoutMenuToggle(name, title, description, checked) {
  const label = document.createElement("label");
  label.className = "layout-menu__toggle" + (checked ? " is-on" : "");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = name;
  input.checked = checked;
  label.appendChild(input);

  const text = document.createElement("span");
  text.className = "layout-menu__toggle-text";
  const nameNode = document.createElement("span");
  nameNode.className = "layout-menu__toggle-name";
  nameNode.textContent = title;
  const descNode = document.createElement("span");
  descNode.className = "layout-menu__toggle-desc";
  descNode.textContent = description;
  text.appendChild(nameNode);
  text.appendChild(descNode);
  label.appendChild(text);

  const switchNode = document.createElement("span");
  switchNode.className = "layout-menu__switch";
  switchNode.setAttribute("aria-hidden", "true");
  label.appendChild(switchNode);
  return label;
}
