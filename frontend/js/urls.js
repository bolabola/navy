// 网址处理与网站图标
import { URL_EXTRACT_RE, URL_TRAILING_PUNCT_RE, failedFaviconDomains } from "./constants.js";
import { staticIconNode } from "./dom.js";
import { normalizeItemName } from "./importExport.js";

export function normalizeUrl(input) {
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

export function toExternalUrl(input) {
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

export function displayName(url, customName) {
  const name = normalizeItemName(customName);
  if (name) {
    return name;
  }

  try {
    const hostname = new URL(toExternalUrl(url)).hostname.replace(/^www\./i, "");
    const firstPart = hostname.split(".")[0];
    return normalizeItemName(firstPart ? firstPart.charAt(0).toUpperCase() + firstPart.slice(1) : hostname);
  } catch (error) {
    return normalizeItemName(url);
  }
}

export function displayUrlWithoutProtocol(url) {
  return String(url || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

export function extractUrlsFromText(text) {
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

export function faviconDomain(url) {
  try {
    return new URL(toExternalUrl(url)).hostname;
  } catch (_) {
    return "example.com";
  }
}

export function previewFaviconDomain(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  try {
    return new URL(toExternalUrl(value)).hostname;
  } catch (_) {
    return "";
  }
}

export function isGithubDomain(domain) {
  const normalized = String(domain || "").toLowerCase();
  return normalized === "github.com" || normalized.endsWith(".github.com");
}

export function defaultFaviconPreviewNode() {
  const node = document.createElement("span");
  node.className = "icon-picker-trigger__default";
  node.appendChild(staticIconNode("icon-globe"));
  const label = document.createElement("span");
  label.textContent = "默认";
  node.appendChild(label);
  return node;
}

export function githubIconNode() {
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

export function faviconUrlForDomain(domain) {
  return "/api/favicon?d=" + encodeURIComponent(domain || "example.com");
}

export /**
 * 直接用 <img src> 加载图标：走浏览器 HTTP 缓存，并且 loading="lazy" 真正生效
 * （折叠的 board、被裁掉的行、其他标签页的图标不会提前请求）。
 * 服务端找不到图标时返回 1×1 占位图，这里识别出来后显示主题化的首字母。
 */
function hydrateFaviconImage(img, icon, url) {
  const domain = faviconDomain(url);
  if (failedFaviconDomains.has(domain)) {
    icon.classList.add("is-fallback");
    return;
  }
  img.addEventListener("load", function () {
    if (img.naturalWidth <= 1) {
      failedFaviconDomains.add(domain);
      icon.classList.add("is-fallback");
    }
  }, { once: true });
  img.src = faviconUrlForDomain(domain);
}

export function faviconPreviewNode(url) {
  const domain = previewFaviconDomain(url);
  if (!domain) {
    return defaultFaviconPreviewNode();
  }
  if (isGithubDomain(domain)) {
    return githubIconNode();
  }
  const img = document.createElement("img");
  img.className = "icon-picker-trigger__favicon";
  img.alt = "";
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.dataset.faviconDomain = domain;
  img.src = faviconUrlForDomain(domain);
  img.addEventListener("error", function () {
    img.replaceWith(defaultFaviconPreviewNode());
  }, { once: true });
  img.addEventListener("load", function () {
    if (img.naturalWidth <= 1) img.replaceWith(defaultFaviconPreviewNode());
  }, { once: true });
  return img;
}

export function resetItemFormIconToFavicon(form, url) {
  if (!form) return;
  const mode = form.querySelector('input[name="itemIconMode"]');
  const icon = form.querySelector('input[name="icon"]');
  const current = form.querySelector('[data-role="icon-picker-current"]');
  if (mode) mode.value = "favicon";
  if (icon) icon.value = "";
  if (current) current.replaceChildren(faviconPreviewNode(url));
}
