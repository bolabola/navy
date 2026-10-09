// 全局搜索面板（⌘K / Ctrl+K / "/"）：跨页面、跨看板查找链接，键盘直达。
// 面板挂在 body 上而不是 #app 里，render() 整体替换 #app 时不会把它冲掉。
import { iconNode, staticIconNode } from "./dom.js";
import { displayName, displayUrlWithoutProtocol, faviconDomain, githubIconNode, hydrateFaviconImage, isGithubDomain, toExternalUrl } from "./urls.js";
import { state } from "./state.js";

const MAX_RESULTS = 60;
const EMPTY_QUERY_RESULTS = 8;

const palette = {
  root: null,
  input: null,
  list: null,
  footer: null,
  entries: [],
  results: [],
  active: 0,
  lastFocus: null
};

function collectEntries() {
  const entries = [];
  (state.pages || []).forEach(function (page) {
    const boards = page.id === state.activePageId ? state.boards : page.boards;
    (boards || []).forEach(function (board) {
      (board.items || []).forEach(function (item) {
        const url = String(item.url || "");
        if (!url) return;
        const title = item.name || displayName(url, "");
        entries.push({
          key: page.id + ":" + board.id + ":" + item.id,
          title: title,
          url: url,
          href: toExternalUrl(url),
          shortUrl: displayUrlWithoutProtocol(url),
          description: item.description || "",
          icon: item.icon || "",
          board: board.title || "",
          page: page.name || "",
          isCurrentPage: page.id === state.activePageId,
          haystackTitle: title.toLowerCase(),
          haystackRest: (displayUrlWithoutProtocol(url) + " " + (item.description || "") + " " + (board.title || "")).toLowerCase()
        });
      });
    });
  });
  return entries;
}

/** 越像“用户想找的那个”分数越高：标题开头 > 标题词首 > 标题包含 > 网址/描述/看板包含。 */
function scoreEntry(entry, query) {
  const title = entry.haystackTitle;
  const index = title.indexOf(query);
  let score = 0;
  if (index === 0) score = 100;
  else if (index > 0 && /[\s\-_./·]/.test(title.charAt(index - 1))) score = 80;
  else if (index > 0) score = 60;
  else if (entry.haystackRest.indexOf(query) !== -1) score = 30;
  else return 0;
  if (entry.isCurrentPage) score += 5;
  return score - Math.min(title.length, 40) / 40;
}

function search(query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    return palette.entries.filter(function (entry) { return entry.isCurrentPage; }).slice(0, EMPTY_QUERY_RESULTS);
  }
  return palette.entries
    .map(function (entry) { return { entry: entry, score: scoreEntry(entry, q) }; })
    .filter(function (row) { return row.score > 0; })
    .sort(function (a, b) { return b.score - a.score; })
    .slice(0, MAX_RESULTS)
    .map(function (row) { return row.entry; });
}

function highlight(text, query) {
  const fragment = document.createDocumentFragment();
  const q = query.trim().toLowerCase();
  const index = q ? text.toLowerCase().indexOf(q) : -1;
  if (index === -1) {
    fragment.append(text);
    return fragment;
  }
  const mark = document.createElement("mark");
  mark.textContent = text.slice(index, index + q.length);
  fragment.append(text.slice(0, index), mark, text.slice(index + q.length));
  return fragment;
}

function renderIcon(entry) {
  const icon = document.createElement("span");
  icon.className = "command-palette__icon";
  if (entry.icon) {
    icon.classList.add("is-custom");
    icon.appendChild(iconNode(entry.icon));
    return icon;
  }
  const domain = faviconDomain(entry.url);
  if (isGithubDomain(domain)) {
    icon.classList.add("is-github");
    icon.appendChild(githubIconNode());
    return icon;
  }
  // 复用看板里的图标加载逻辑：加载失败时显示首字母。
  icon.classList.add("link-row__icon");
  const img = document.createElement("img");
  img.alt = "";
  img.referrerPolicy = "no-referrer";
  icon.appendChild(img);
  const fallback = document.createElement("span");
  fallback.className = "link-row__fallback";
  fallback.textContent = entry.title.trim().charAt(0).toUpperCase() || "?";
  icon.appendChild(fallback);
  img.addEventListener("error", function () { icon.classList.add("is-fallback"); }, { once: true });
  hydrateFaviconImage(img, icon, entry.url);
  return icon;
}

function renderResults() {
  const query = palette.input.value;
  palette.results = search(query);
  palette.active = Math.min(palette.active, Math.max(0, palette.results.length - 1));
  palette.list.replaceChildren();

  if (!palette.results.length) {
    const empty = document.createElement("li");
    empty.className = "command-palette__empty";
    empty.textContent = query.trim() ? "没有找到“" + query.trim() + "”" : "这一页还没有链接";
    palette.list.appendChild(empty);
    palette.footer.querySelector("[data-role=count]").textContent = "";
    return;
  }

  if (!query.trim()) {
    const label = document.createElement("li");
    label.className = "command-palette__section";
    label.textContent = "当前页面";
    label.setAttribute("role", "presentation");
    palette.list.appendChild(label);
  }

  palette.results.forEach(function (entry, index) {
    const item = document.createElement("li");
    item.className = "command-palette__item" + (index === palette.active ? " is-active" : "");
    item.id = "command-palette-item-" + index;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", index === palette.active ? "true" : "false");
    item.dataset.index = String(index);

    item.appendChild(renderIcon(entry));

    const text = document.createElement("span");
    text.className = "command-palette__text";
    const title = document.createElement("span");
    title.className = "command-palette__title";
    title.appendChild(highlight(entry.title, query));
    text.appendChild(title);
    const meta = document.createElement("span");
    meta.className = "command-palette__meta";
    meta.appendChild(highlight(entry.shortUrl, query));
    text.appendChild(meta);
    item.appendChild(text);

    const where = document.createElement("span");
    where.className = "command-palette__where";
    where.textContent = entry.isCurrentPage ? entry.board : entry.page + " / " + entry.board;
    item.appendChild(where);

    const enter = document.createElement("span");
    enter.className = "command-palette__enter";
    enter.setAttribute("aria-hidden", "true");
    enter.textContent = "↵";
    item.appendChild(enter);

    palette.list.appendChild(item);
  });

  palette.input.setAttribute("aria-activedescendant", "command-palette-item-" + palette.active);
  palette.footer.querySelector("[data-role=count]").textContent = query.trim()
    ? palette.results.length + (palette.results.length >= MAX_RESULTS ? "+" : "") + " 个结果"
    : palette.entries.length + " 个链接";
}

function setActive(index, scroll) {
  if (!palette.results.length) return;
  const count = palette.results.length;
  palette.active = (index + count) % count;
  palette.list.querySelectorAll(".command-palette__item").forEach(function (node) {
    const isActive = Number(node.dataset.index) === palette.active;
    node.classList.toggle("is-active", isActive);
    node.setAttribute("aria-selected", isActive ? "true" : "false");
    if (isActive && scroll) node.scrollIntoView({ block: "nearest" });
  });
  palette.input.setAttribute("aria-activedescendant", "command-palette-item-" + palette.active);
}

function openResult(index) {
  const entry = palette.results[index];
  if (!entry || !entry.href || entry.href === "#") return;
  window.open(entry.href, "_blank", "noopener,noreferrer");
  closePalette();
}

function build() {
  const root = document.createElement("div");
  root.className = "command-palette";
  root.hidden = true;

  const backdrop = document.createElement("div");
  backdrop.className = "command-palette__backdrop";
  backdrop.addEventListener("mousedown", closePalette);
  root.appendChild(backdrop);

  const panel = document.createElement("div");
  panel.className = "command-palette__panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "搜索链接");

  const field = document.createElement("label");
  field.className = "command-palette__field";
  field.appendChild(staticIconNode("icon-search"));
  const input = document.createElement("input");
  input.className = "command-palette__input";
  input.type = "text";
  input.placeholder = "搜索链接、网址或看板…";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-controls", "command-palette-list");
  field.appendChild(input);
  const esc = document.createElement("kbd");
  esc.className = "command-palette__kbd";
  esc.textContent = "esc";
  field.appendChild(esc);
  panel.appendChild(field);

  const list = document.createElement("ul");
  list.className = "command-palette__list";
  list.id = "command-palette-list";
  list.setAttribute("role", "listbox");
  panel.appendChild(list);

  const footer = document.createElement("div");
  footer.className = "command-palette__footer";
  const count = document.createElement("span");
  count.dataset.role = "count";
  footer.appendChild(count);
  const hints = document.createElement("span");
  hints.className = "command-palette__hints";
  [["↑↓", "选择"], ["↵", "打开"]].forEach(function (pair) {
    const hint = document.createElement("span");
    const key = document.createElement("kbd");
    key.className = "command-palette__kbd";
    key.textContent = pair[0];
    hint.append(key, " " + pair[1]);
    hints.appendChild(hint);
  });
  footer.appendChild(hints);
  panel.appendChild(footer);

  root.appendChild(panel);
  document.body.appendChild(root);

  input.addEventListener("input", function () {
    palette.active = 0;
    renderResults();
    list.scrollTop = 0;
  });

  input.addEventListener("keydown", function (event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(palette.active + 1, true);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(palette.active - 1, true);
    } else if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      openResult(palette.active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
    } else if (event.key === "Tab") {
      event.preventDefault();
    }
  });

  list.addEventListener("mousemove", function (event) {
    const item = event.target.closest(".command-palette__item");
    if (item && Number(item.dataset.index) !== palette.active) setActive(Number(item.dataset.index), false);
  });

  list.addEventListener("click", function (event) {
    const item = event.target.closest(".command-palette__item");
    if (item) openResult(Number(item.dataset.index));
  });

  palette.root = root;
  palette.input = input;
  palette.list = list;
  palette.footer = footer;
}

export function openPalette() {
  if (!palette.root) build();
  if (!palette.root.hidden) return;
  palette.lastFocus = document.activeElement;
  palette.entries = collectEntries();
  palette.active = 0;
  palette.input.value = "";
  renderResults();
  palette.root.hidden = false;
  document.documentElement.classList.add("has-command-palette");
  palette.input.focus();
}

export function closePalette() {
  if (!palette.root || palette.root.hidden) return;
  palette.root.hidden = true;
  document.documentElement.classList.remove("has-command-palette");
  if (palette.lastFocus && palette.lastFocus.focus && document.contains(palette.lastFocus)) {
    palette.lastFocus.focus();
  }
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function installSearchShortcuts() {
  document.addEventListener("keydown", function (event) {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (palette.root && !palette.root.hidden) closePalette();
      else openPalette();
      return;
    }
    if (event.key === "/" && !mod && !event.altKey && !isTypingTarget(event.target)) {
      event.preventDefault();
      openPalette();
    }
  });
}

export function isMacPlatform() {
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
  return /mac|iphone|ipad/i.test(platform);
}
