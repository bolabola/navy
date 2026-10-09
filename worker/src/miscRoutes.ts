import { URL_TITLES_MAX } from "../../shared/limits";
import { getSession, requireAdmin } from "./auth";
import { json, readJsonBody, text, type Env } from "./shared";
import { isFaviconDomainAllowed, isUrlSafe } from "./urlSafety";

const URL_TITLES_CONCURRENCY = 6;
const UPSTREAM_TIMEOUT_MS = 5000;
const URL_TITLES_BYTE_CAP = 64 * 1024;
const FAVICON_CACHE_SECONDS = 7 * 24 * 3600;
const FAVICON_FALLBACK_CACHE_SECONDS = 60 * 60;
const FAVICON_HTML_BYTE_CAP = 64 * 1024;
/** 单个图标的最大字节数，超过视为无效来源。 */
const FAVICON_MAX_BYTES = 256 * 1024;
const FAVICON_SIZE = 64;
const REDIRECT_LIMIT = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** SVG 图标即使被直接打开也不能执行脚本或加载外部资源。 */
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

// ---------------- favicon ----------------

export async function handleFavicon(request: Request, url: URL, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const domain = url.searchParams.get("d");
  if (!domain || !isFaviconDomainAllowed(domain)) {
    return text("Bad domain", 400);
  }

  // 强制刷新会绕过边缘缓存并重新抓取上游，只对管理员开放，防止被匿名请求刷流量。
  const forceRefresh = url.searchParams.get("refresh") === "1" && (await getSession(request, env)) !== null;
  const cacheUrl = new URL(request.url);
  cacheUrl.search = "";
  cacheUrl.searchParams.set("d", domain.toLowerCase());
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  const cache = caches.default;
  if (!forceRefresh) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const icon = await fetchFaviconUpstream(domain);
  const response = icon ? imageResponse(icon) : fallbackFaviconResponse();
  const put = cache.put(cacheKey, response.clone());
  if (ctx) ctx.waitUntil(put.catch(() => {}));
  else await put;
  return response;
}

interface FaviconImage {
  body: ArrayBuffer;
  contentType: string;
}

function imageResponse(icon: FaviconImage): Response {
  const headers: Record<string, string> = {
    "Content-Type": icon.contentType,
    "Cache-Control": "public, max-age=" + FAVICON_CACHE_SECONDS,
    "Access-Control-Allow-Origin": "*"
  };
  if (icon.contentType.startsWith("image/svg")) headers["Content-Security-Policy"] = SVG_CSP;
  return new Response(icon.body, { status: 200, headers });
}

/**
 * 先找页面里声明的图标，同时并行请求聚合服务作为后备；
 * 声明的图标优先，拿不到时再用聚合服务的结果，避免串行等待多个超时。
 */
async function fetchFaviconUpstream(domain: string): Promise<FaviconImage | null> {
  const aggregator = fetchFromAggregators(domain);
  const declared = await fetchDeclaredFavicon(domain).catch(() => null);
  if (declared) return declared;
  return aggregator;
}

async function fetchFromAggregators(domain: string): Promise<FaviconImage | null> {
  const encoded = encodeURIComponent(domain);
  const sources = [
    `https://www.google.com/s2/favicons?sz=${FAVICON_SIZE}&domain_url=https://${encoded}`,
    `https://www.google.com/s2/favicons?sz=${FAVICON_SIZE}&domain=${encoded}`,
    `https://icons.duckduckgo.com/ip3/${encoded}.ico`
  ];
  for (const source of sources) {
    const icon = await fetchFaviconImage(source).catch(() => null);
    if (icon) return icon;
  }
  return null;
}

async function fetchDeclaredFavicon(domain: string): Promise<FaviconImage | null> {
  const page = await fetchFollowingSafeRedirects("https://" + domain + "/", "text/html,application/xhtml+xml,*/*;q=0.8");
  if (!page.ok || !page.body) return null;

  const contentType = (page.headers.get("Content-Type") || "").toLowerCase();
  if (contentType && !contentType.includes("html") && !contentType.includes("xml") && !contentType.includes("text")) {
    await page.body.cancel();
    return null;
  }

  const html = await readTextBody(page, FAVICON_HTML_BYTE_CAP);
  for (const href of getDeclaredFaviconHrefs(html)) {
    const resolved = resolveFaviconHref(href, page.url || "https://" + domain + "/");
    if (!resolved) continue;
    const icon = await fetchFaviconImage(resolved).catch(() => null);
    if (icon) return icon;
  }
  return null;
}

async function fetchFaviconImage(rawUrl: string): Promise<FaviconImage | null> {
  const res = await fetchFollowingSafeRedirects(rawUrl, "image/*,*/*;q=0.8");
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    return null;
  }
  const bytes = await readBytesCapped(res, FAVICON_MAX_BYTES);
  if (!bytes || bytes.byteLength === 0) return null;
  const contentType = sniffImageType(bytes, res.headers.get("Content-Type") || "");
  if (!contentType) return null;
  return { body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, contentType };
}

/**
 * 根据文件头判断真实图片类型，只接受常见图标格式。
 * 很多站点用 application/octet-stream 或 text/plain 返回 .ico，所以不能只看响应头。
 */
export function sniffImageType(bytes: Uint8Array, declared: string): string | null {
  const b = bytes;
  const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0x00, 0x00, 0x01, 0x00) || starts(0x00, 0x00, 0x02, 0x00)) return "image/x-icon";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length > 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "image/avif";
  if (starts(0x42, 0x4d)) return "image/bmp";

  const head = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 1024))).trimStart().toLowerCase();
  const declaredLower = declared.toLowerCase();
  if ((head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) &&
    (declaredLower.includes("svg") || declaredLower.includes("xml") || declaredLower === "")) {
    return "image/svg+xml";
  }
  return null;
}

function getDeclaredFaviconHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const linkRe = /<link\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html)) !== null) {
    const tag = match[0];
    const rel = readHtmlAttribute(tag, "rel").toLowerCase();
    if (!/\b(?:icon|apple-touch-icon|shortcut icon)\b/i.test(rel)) continue;
    const href = readHtmlAttribute(tag, "href");
    if (href) hrefs.push(href);
  }
  return hrefs;
}

function readHtmlAttribute(tag: string, name: string): string {
  const attrRe = new RegExp("\\s" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i");
  const match = tag.match(attrRe);
  return decodeHtmlEntities((match && (match[1] || match[2] || match[3])) || "").trim();
}

function resolveFaviconHref(href: string, baseUrl: string): string | null {
  let normalized = href.trim();
  if (!normalized || normalized.startsWith("#")) return null;
  if (/^data:/i.test(normalized)) return null;
  if (normalized.startsWith("@/")) normalized = normalized.slice(1);

  try {
    const resolved = new URL(normalized, baseUrl).toString();
    return isUrlSafe(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * 找不到图标时返回 1×1 透明占位图。前端据 naturalWidth <= 1 识别后显示主题化的首字母，
 * 用 <img> 直接加载也能区分“真实图标”和“占位”，不需要读取响应头。
 */
function fallbackFaviconResponse(): Response {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>`;
  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=" + FAVICON_FALLBACK_CACHE_SECONDS,
      "Access-Control-Allow-Origin": "*",
      "Content-Security-Policy": SVG_CSP,
      "X-Favicon-Fallback": "1"
    }
  });
}

// ---------------- url titles ----------------

export async function handleUrlTitles(request: Request, env: Env): Promise<Response> {
  const auth = await requireAdmin(request, env, { csrf: true });
  if (auth instanceof Response) return auth;

  const payload = await readJsonBody<{ urls?: unknown }>(request);
  const urls = payload && typeof payload === "object" ? payload.urls : undefined;
  if (!Array.isArray(urls) || urls.length === 0) {
    return text("Expected non-empty urls array", 400);
  }
  if (urls.length > URL_TITLES_MAX) {
    return text("Too many URLs (max " + URL_TITLES_MAX + ")", 400);
  }

  const safeUrls: string[] = [];
  for (const u of urls) {
    const normalizedUrl = typeof u === "string" ? normalizeMetadataUrl(u) : null;
    if (!normalizedUrl || !isUrlSafe(normalizedUrl)) {
      return text("URL not allowed", 400);
    }
    safeUrls.push(normalizedUrl);
  }

  const metadata = await runWithConcurrency(safeUrls, URL_TITLES_CONCURRENCY, fetchMetadata);
  return json(safeUrls.map((url, i) => ({
    url,
    title: metadata[i]?.title || null,
    description: metadata[i]?.description || null
  })));
}

function normalizeMetadataUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\/\//.test(trimmed)) return "https:" + trimmed;
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return trimmed;
  return "https://" + trimmed;
}

const TITLE_DONE_RE = /(?:<\/title>|<meta\b[^>]+(?:name|property)\s*=\s*["'](?:og:title|twitter:title)["'])/i;
const DESCRIPTION_DONE_RE = /<meta\b[^>]+(?:name|property)\s*=\s*["'](?:description|og:description|twitter:description)["']/i;

async function fetchMetadata(rawUrl: string): Promise<{ title: string | null; description: string | null }> {
  const empty = { title: null, description: null };
  try {
    const res = await fetchFollowingSafeRedirects(rawUrl, "text/html,application/xhtml+xml,*/*;q=0.8");
    if (!res.ok || !res.body) return empty;
    const ctype = (res.headers.get("Content-Type") || "").toLowerCase();
    if (ctype && !ctype.includes("html") && !ctype.includes("xml") && !ctype.includes("text")) {
      await res.body.cancel();
      return empty;
    }

    const buf = await readTextBody(res, URL_TITLES_BYTE_CAP, (html) => TITLE_DONE_RE.test(html) && DESCRIPTION_DONE_RE.test(html));
    const m = buf.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = (m ? decodeHtmlEntities(m[1]).replace(/\s+/g, " ").trim() : "") || extractMetaValue(buf, ["og:title", "twitter:title"]);
    const description = extractMetaValue(buf, ["description", "og:description", "twitter:description"]);
    return { title: title || null, description: description || null };
  } catch {
    return empty;
  }
}

function extractMetaValue(html: string, names: string[]): string | null {
  const metaRe = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  const normalizedNames = new Set(names.map((name) => name.toLowerCase()));
  while ((match = metaRe.exec(html))) {
    const tag = match[0];
    const name = readHtmlAttribute(tag, "name") || readHtmlAttribute(tag, "property");
    if (!name || !normalizedNames.has(name.trim().toLowerCase())) continue;
    const content = readHtmlAttribute(tag, "content");
    if (!content) continue;
    const value = decodeHtmlEntities(content).replace(/\s+/g, " ").trim();
    if (value) return value;
  }
  return null;
}

// ---------------- 通用抓取工具 ----------------

/** 读取响应体文本，最多 byteCap 字节；done 返回 true 时提前停止。 */
async function readTextBody(res: Response, byteCap: number, done?: (text: string) => boolean): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false });
  let buf = "";
  let total = 0;
  try {
    while (total < byteCap) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!chunk.value) continue;
      total += chunk.value.byteLength;
      buf += decoder.decode(chunk.value, { stream: true });
      if (done && done(buf)) break;
    }
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }
  return buf + decoder.decode();
}

/** 读取二进制响应体；超过 maxBytes 返回 null。 */
async function readBytesCapped(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!chunk.value) continue;
      total += chunk.value.byteLength;
      if (total > maxBytes) return null;
      chunks.push(chunk.value);
    }
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** 手动跟随重定向，每一跳都做 SSRF 检查。 */
async function fetchFollowingSafeRedirects(rawUrl: string, accept: string): Promise<Response> {
  let currentUrl = rawUrl;
  for (let redirects = 0; redirects <= REDIRECT_LIMIT; redirects += 1) {
    if (!isUrlSafe(currentUrl)) throw new Error("Unsafe URL");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; BoardTrelloBot/1.0)",
          Accept: accept
        }
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!REDIRECT_STATUSES.has(res.status)) return res;
    const location = res.headers.get("Location");
    if (!location) return res;
    await res.body?.cancel();
    currentUrl = new URL(location, currentUrl).toString();
  }
  throw new Error("Too many redirects");
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try { return String.fromCodePoint(code); } catch { return ""; }
}

async function runWithConcurrency<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
