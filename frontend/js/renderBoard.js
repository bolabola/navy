// board 卡片渲染与图标选择器
import { BOARD_ITEM_DESCRIPTION_MAX_LENGTH, BOARD_ITEM_NAME_MAX_LENGTH, BOARD_TAB_NAME_MAX_LENGTH, MIN_BOARD_HEIGHT } from "../../shared/limits";
import {
  getBoardActiveTab,
  getBoardActiveTabId,
  getBoardItemsForTab,
  getBoardTabs,
  shouldShowBoardTabs
} from "./boards.js";
import { CURATED_LUCIDE_ICONS, DEFAULT_TAB_ID, ICON_PICKER_OVERFLOW_LIMIT, TEXT } from "./constants.js";
import { actionButton, iconNode, staticIconNode } from "./dom.js";
import {
  displayModeButtonIcon,
  iconSizeButtonIcon,
  iconSizeTooltip,
  normalizeIconName,
  normalizeIconSize
} from "./model.js";
import { getBoardMinimumListHeight } from "./render.js";
import { app, auth, state, uiState } from "./state.js";
import { applyIconPickerTheme } from "./theme.js";
import {
  displayName,
  displayUrlWithoutProtocol,
  faviconDomain,
  faviconPreviewNode,
  githubIconNode,
  hydrateFaviconImage,
  isGithubDomain,
  resetItemFormIconToFavicon,
  toExternalUrl
} from "./urls.js";

export function captureBoardRects() {
  const rects = new Map();
  app.querySelectorAll(".board-card[data-board-id]").forEach(function (node) {
    rects.set(node.getAttribute("data-board-id"), node.getBoundingClientRect());
  });
  return rects;
}

export function collectBoardHeightMap() {
  const heightMap = {};
  app.querySelectorAll(".board-card[data-board-id]").forEach(function (node) {
    const boardId = node.getAttribute("data-board-id");
    heightMap[boardId] = node.offsetHeight;
  });
  return heightMap;
}

export function animateBoardFlip(previousRects) {
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

export function renderDefaultFaviconPickerItem(isSelected) {
  const button = document.createElement("button");
  button.className = "icon-picker-grid__item icon-picker-grid__item--default" + (isSelected ? " is-selected" : "");
  button.type = "button";
  button.dataset.role = "icon-picker-default";
  button.dataset.name = "";
  button.title = TEXT.iconPickerDefaultFavicon;
  button.setAttribute("aria-label", TEXT.iconPickerDefaultFavicon);
  button.appendChild(staticIconNode("icon-globe"));
  const label = document.createElement("span");
  label.textContent = "默认";
  button.appendChild(label);
  return button;
}

export function renderIconPickerGridItems(icons, selected, options = {}) {
  const fragment = document.createDocumentFragment();
  if (options.includeFaviconOption) {
    fragment.appendChild(renderDefaultFaviconPickerItem(!selected));
  }
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

export function renderIconPickerWidget(name, selected, options = {}) {
  const current = normalizeIconName(selected);
  const picker = document.createElement("div");
  picker.className = "icon-picker";
  picker.dataset.role = "icon-picker";
  if (options.includeFaviconOption) picker.dataset.includeFaviconOption = "1";
  applyIconPickerTheme(picker);

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
  grid.appendChild(renderIconPickerGridItems(CURATED_LUCIDE_ICONS, options.includeFaviconOption && !selected ? "" : current, options));
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

export function bindIconPickers(scope) {
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
      const gridOptions = { includeFaviconOption: picker.dataset.includeFaviconOption === "1" };
      grid.replaceChildren(renderIconPickerGridItems(CURATED_LUCIDE_ICONS, valueInput.value, gridOptions));
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
      const gridOptions = { includeFaviconOption: picker.dataset.includeFaviconOption === "1" };
      if (!q) {
        grid.replaceChildren(renderIconPickerGridItems(CURATED_LUCIDE_ICONS, valueInput.value, gridOptions));
        hint.hidden = true;
        return;
      }
      const pool = state.allLucideIcons.length ? state.allLucideIcons : CURATED_LUCIDE_ICONS;
      const matches = pool.filter(function (n) { return n.indexOf(q) >= 0; });
      const overflow = matches.length > ICON_PICKER_OVERFLOW_LIMIT;
      const display = overflow ? matches.slice(0, ICON_PICKER_OVERFLOW_LIMIT) : matches;
      grid.replaceChildren(renderIconPickerGridItems(display, valueInput.value, gridOptions));
      hint.hidden = !overflow;
    });

    grid.addEventListener("click", function (event) {
      const defaultItem = event.target.closest('[data-role="icon-picker-default"]');
      if (defaultItem) {
        event.preventDefault();
        const form = picker.closest('[data-role="item-edit-form"]');
        const urlInput = form?.querySelector('input[name="url"]');
        resetItemFormIconToFavicon(form, urlInput ? urlInput.value : "");
        grid.querySelectorAll(".icon-picker-grid__item.is-selected").forEach(function (el) {
          el.classList.remove("is-selected");
        });
        defaultItem.classList.add("is-selected");
        close();
        return;
      }
      const item = event.target.closest('[data-role="icon-picker-item"]');
      if (!item) return;
      event.preventDefault();
      const safe = normalizeIconName(item.getAttribute("data-name"));
      valueInput.value = safe;
      const itemIconMode = picker.closest('[data-role="item-edit-form"]')?.querySelector('input[name="itemIconMode"]');
      if (itemIconMode) itemIconMode.value = "custom";
      currentSpan.replaceChildren(iconNode(safe));
      grid.querySelectorAll(".icon-picker-grid__item.is-selected").forEach(function (el) {
        el.classList.remove("is-selected");
      });
      item.classList.add("is-selected");
      close();
    });
  });
}

export function closeAllIconPickers(scope) {
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

export function renderLinkRow(boardId, item, displayMode, editing) {
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
  row.dataset.tabId = item.tabId || DEFAULT_TAB_ID;
  if (auth.isAdmin) row.draggable = true;

  if (!iconOnly && auth.isAdmin && state.layoutSettings.showItemDragHandle !== false) {
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

  const icon = document.createElement("span");
  icon.className = "link-row__icon" + (item.icon ? " link-row__icon--custom" : "");
  const domain = faviconDomain(item.url);
  if (item.icon) {
    icon.appendChild(iconNode(item.icon));
  } else if (isGithubDomain(domain)) {
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

  const text = document.createElement("span");
  text.className = "link-row__text";
  const name = document.createElement("span");
  name.className = "link-row__name";
  name.textContent = title;
  text.appendChild(name);
  if (urlOnly) {
    const urlLine = document.createElement("span");
    urlLine.className = "link-row__url";
    urlLine.textContent = displayUrlWithoutProtocol(url);
    text.appendChild(urlLine);
  }
  anchor.appendChild(text);
  row.appendChild(anchor);

  if (showDelete) {
    const actions = document.createElement("div");
    actions.className = "link-row__actions";
    const edit = actionButton("link-row__edit", "edit-item", boardId, "编辑", [staticIconNode("icon-pencil")]);
    edit.dataset.itemId = item.id;
    edit.setAttribute("aria-label", "编辑");
    actions.appendChild(edit);
    row.appendChild(actions);
  }

  return row;
}

export function renderItemEditForm(boardId, item) {
  item = item || {};
  const form = document.createElement("form");
  form.className = "item-edit-form";
  if (!item.id) {
    form.className = "item-edit-form board-add-form--floating";
  }
  form.dataset.role = "item-edit-form";
  form.dataset.boardId = boardId;
  if (item.id) {
    form.dataset.itemId = item.id;
  }

  const url = document.createElement("input");
  url.type = "text";
  url.name = "url";
  url.inputMode = "url";
  url.autocapitalize = "off";
  url.autocomplete = "off";
  url.spellcheck = false;
  url.placeholder = TEXT.enterUrl;
  url.value = item.url || "";
  url.required = true;
  form.appendChild(url);

  const row = document.createElement("div");
  row.className = "item-edit-form__row";
  const iconPicker = renderIconPickerWidget("icon", item.icon || "", { includeFaviconOption: true });
  if (!item.icon) {
    const current = iconPicker.querySelector('[data-role="icon-picker-current"]');
    const iconInput = iconPicker.querySelector('input[name="icon"]');
    if (iconInput) iconInput.value = "";
    if (current) current.replaceChildren(faviconPreviewNode(item.url));
  }
  row.appendChild(iconPicker);
  const iconMode = document.createElement("input");
  iconMode.type = "hidden";
  iconMode.name = "itemIconMode";
  iconMode.value = item.icon ? "custom" : "favicon";
  row.appendChild(iconMode);

  const title = document.createElement("input");
  title.type = "text";
  title.name = "name";
  title.placeholder = "标题";
  title.maxLength = BOARD_ITEM_NAME_MAX_LENGTH;
  title.value = item.name || "";
  row.appendChild(title);
  form.appendChild(row);

  const desc = document.createElement("textarea");
  desc.name = "description";
  desc.placeholder = "描述";
  desc.maxLength = BOARD_ITEM_DESCRIPTION_MAX_LENGTH;
  desc.value = item.description || "";
  form.appendChild(desc);

  const actions = document.createElement("div");
  actions.className = "item-edit-form__actions";

  const firstRow = document.createElement("div");
  firstRow.className = "item-edit-form__actions-first";
  const autofill = actionButton("board-cancel-button", "autofill-item-meta", boardId, "自动获取图标、标题和描述", [
    staticIconNode("icon-sparkles"),
    " 自动获取"
  ]);
  if (item.id) {
    autofill.dataset.itemId = item.id;
  }
  firstRow.appendChild(autofill);
  if (item.id) {
    const del = actionButton("board-cancel-button item-edit-form__delete", "delete-item", boardId, TEXT.deleteItem, [
      staticIconNode("icon-trash-2"),
      " " + TEXT.deleteItem
    ]);
    del.dataset.itemId = item.id;
    del.setAttribute("aria-label", TEXT.deleteItem);
    firstRow.appendChild(del);
  }
  actions.appendChild(firstRow);

  const secondRow = document.createElement("div");
  secondRow.className = "item-edit-form__actions-second";
  const save = document.createElement("button");
  save.className = "board-save-button";
  save.type = "submit";
  save.textContent = TEXT.save;
  secondRow.appendChild(save);
  const cancelAction = item.id ? "cancel-edit-item" : "cancel-add";
  secondRow.appendChild(actionButton("board-cancel-button", cancelAction, boardId, "", [TEXT.cancel]));
  actions.appendChild(secondRow);

  form.appendChild(actions);
  return form;
}

export function renderBoardActionsMenu(board) {
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

  menu.appendChild(menuItem("toggle-add", "icon-plus", TEXT.addItem));
  menu.appendChild(menuItem("toggle-edit-board", "icon-pencil", TEXT.editBoard));
  menu.appendChild(menuItem("import-board", "icon-download", "导入网址"));
  menu.appendChild(menuItem("export-board", "icon-upload", "导出 CSV"));
  if (state.pages.length > 1) {
    menu.appendChild(menuItem("move-board", "icon-move", TEXT.moveBoardToPage));
  }
  menu.appendChild(menuItem("delete-board", "icon-trash-2", TEXT.deleteBoard, true));
  return menu;
}

export function renderEditBoardForm(board) {
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

  const tabs = getBoardTabs(board);
  const activeTabId = getBoardActiveTabId(board);
  const tabTools = document.createElement("div");
  tabTools.className = "board-meta-form__tabs";
  const tabLabel = document.createElement("span");
  tabLabel.className = "board-meta-form__label";
  tabLabel.textContent = "分组";
  tabTools.appendChild(tabLabel);

  const tabList = document.createElement("div");
  tabList.className = "board-meta-form__tab-list";
  tabs.filter(function (tab) {
    return tab.id !== DEFAULT_TAB_ID;
  }).forEach(function (tab) {
    const tabButton = actionButton("board-meta-form__tab" + (tab.id === activeTabId ? " is-active" : ""), "select-board-tab", board.id, tab.name, [
      tab.name
    ]);
    tabButton.dataset.tabId = tab.id;
    tabList.appendChild(tabButton);
  });
  tabTools.appendChild(tabList);

  const activeTabName = document.createElement("input");
  activeTabName.className = "board-meta-form__tab-input";
  activeTabName.type = "text";
  activeTabName.name = "activeTabName";
  activeTabName.maxLength = BOARD_TAB_NAME_MAX_LENGTH;
  activeTabName.value = getBoardActiveTab(board).name;
  activeTabName.placeholder = "当前分组名称";
  tabTools.appendChild(activeTabName);

  const tabActions = document.createElement("div");
  tabActions.className = "board-meta-form__tab-actions";
  const newTab = document.createElement("input");
  newTab.className = "board-meta-form__tab-new";
  newTab.type = "text";
  newTab.name = "newTabName";
  newTab.maxLength = BOARD_TAB_NAME_MAX_LENGTH;
  newTab.placeholder = "新分组";
  tabActions.appendChild(newTab);
  tabActions.appendChild(actionButton("board-icon-button", "add-board-tab", board.id, TEXT.addBoardTab, [staticIconNode("icon-plus")]));
  const deleteTab = actionButton("board-icon-button", "delete-board-tab", board.id, "删除当前分组", [staticIconNode("icon-trash")]);
  deleteTab.disabled = activeTabId === DEFAULT_TAB_ID;
  tabActions.appendChild(deleteTab);
  tabTools.appendChild(tabActions);
  form.appendChild(tabTools);

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

export function renderBoardTabs(board) {
  const tabs = getBoardTabs(board);
  const activeTabId = getBoardActiveTabId(board);
  const wrapper = document.createElement("div");
  wrapper.className = "board-tabs";

  const list = document.createElement("div");
  list.className = "board-tabs__list";
  tabs.forEach(function (tab) {
    const button = actionButton("board-tab" + (tab.id === activeTabId ? " is-active" : ""), "select-board-tab", board.id, tab.name, [
      tab.name
    ]);
    button.dataset.tabId = tab.id;
    button.setAttribute("aria-pressed", tab.id === activeTabId ? "true" : "false");
    list.appendChild(button);
  });
  wrapper.appendChild(list);

  return wrapper;
}

export function renderBoard(board, extraClass) {
  const addOpen = uiState.openAddBoardId === board.id;
  const editOpen = uiState.editBoardId === board.id;
  const menuOpen = uiState.openBoardMenuId === board.id;
  const iconMode = board.displayMode === "icons";
  const urlMode = board.displayMode === "urls";
  const activeTabId = getBoardActiveTabId(board);
  const visibleItems = getBoardItemsForTab(board, activeTabId);
  const card = document.createElement("article");
  card.className = "board-card" + (board.collapsed ? " is-collapsed" : "") + (menuOpen ? " has-open-menu" : "") + (extraClass ? " " + extraClass : "");
  card.dataset.boardId = board.id;
  card.style.setProperty("--board-accent", board.accent);
  card.style.setProperty("--list-height", Math.max(Number(board.height), getBoardMinimumListHeight(board)) + "px");

  const header = document.createElement("header");
  header.className = "board-card__header";
  const titleWrap = document.createElement("div");
  titleWrap.className = "board-card__title-wrap";
  titleWrap.dataset.boardId = board.id;
  // 未登录时不能拖拽 board：不挂拖拽句柄，也不显示“拖拽”提示和抓手光标。
  if (auth.isAdmin) {
    titleWrap.dataset.role = "board-drag-handle";
    titleWrap.title = TEXT.moveBoard;
  }
  if (state.layoutSettings.showBoardIcon === false) {
    titleWrap.classList.add("board-card__title-wrap--no-board-icon");
  } else {
    const glyph = document.createElement("span");
    glyph.className = "board-card__glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.appendChild(iconNode(board.icon));
    titleWrap.appendChild(glyph);
  }
  const title = document.createElement("h2");
  title.className = "board-card__title";
  title.textContent = board.title;
  titleWrap.appendChild(title);
  if (state.layoutSettings.showBoardCount !== false) {
    const count = document.createElement("span");
    count.className = "board-card__count";
    count.textContent = String(Array.isArray(board.items) ? board.items.length : 0);
    count.title = String(Array.isArray(board.items) ? board.items.length : 0) + TEXT.urlCount;
    titleWrap.appendChild(count);
  }
  header.appendChild(titleWrap);

  const actions = document.createElement("div");
  actions.className = "board-card__actions";
  actions.appendChild(actionButton("board-icon-button", "toggle-view-mode", board.id, TEXT.toggleView, [
    staticIconNode(displayModeButtonIcon(board.displayMode))
  ]));
  actions.appendChild(actionButton("board-icon-button", "cycle-icon-size", board.id, iconSizeTooltip(board.iconSize), [
    staticIconNode(iconSizeButtonIcon(board.iconSize))
  ]));
  actions.appendChild(actionButton("board-icon-button", "toggle-collapse", board.id, board.collapsed ? TEXT.expand : TEXT.collapse, [
    staticIconNode(board.collapsed ? "icon-chevron-down" : "icon-chevron-up")
  ]));
  if (auth.isAdmin) {
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
    if (shouldShowBoardTabs(board)) card.appendChild(renderBoardTabs(board));
    if (addOpen) card.appendChild(renderItemEditForm(board.id));

    const body = document.createElement("div");
    body.className = "board-card__body";
    const list = document.createElement("div");
    const iconSizeClass = " board-list--icon-size-" + normalizeIconSize(board.iconSize);
    list.className = "board-list" + (iconMode ? " board-list--icons" : "") + (urlMode ? " board-list--urls" : "") + iconSizeClass;
    list.dataset.role = "board-list";
    list.dataset.boardId = board.id;
    list.dataset.tabId = activeTabId;
    if (visibleItems.length) {
      visibleItems.forEach(function (item) {
        if (editOpen && uiState.editItemId === item.id) {
          list.appendChild(renderItemEditForm(board.id, item));
        } else {
          list.appendChild(renderLinkRow(board.id, item, board.displayMode, editOpen));
        }
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
    resize.dataset.boardId = board.id;
    // 访客也可以拖动调整高度：只保存在访客自己的浏览器里（见 viewPrefs.js）。
    resize.dataset.role = "resize-handle";
    resize.title = TEXT.resize;
    const shrink = actionButton("board-shrink-button", "shrink-board-to-min", board.id, TEXT.shrinkBoard, [
      staticIconNode("icon-chevrons-up")
    ]);
    shrink.dataset.role = "shrink-height";
    shrink.hidden = Number(board.height) <= MIN_BOARD_HEIGHT + 1;
    shrink.setAttribute("aria-label", TEXT.shrinkBoard);
    resize.appendChild(shrink);
    const hiddenCount = actionButton("board-hidden-count", "expand-board-to-fit", board.id, "", []);
    hiddenCount.dataset.role = "hidden-count";
    hiddenCount.hidden = true;
    resize.appendChild(hiddenCount);
    card.appendChild(resize);
  }

  return card;
}
