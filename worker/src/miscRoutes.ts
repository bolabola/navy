import { isAuthenticated, isCsrfTokenValid } from "./auth";
import { jsonResponse, type Env } from "./shared";
import { isFaviconDomainAllowed, isUrlSafe } from "./urlSafety";

const URL_TITLES_MAX = 30;
const URL_TITLES_CONCURRENCY = 6;
const URL_TITLES_TIMEOUT_MS = 5000;
const URL_TITLES_BYTE_CAP = 64 * 1024;
const FAVICON_CACHE_SECONDS = 7 * 24 * 3600;
const FAVICON_FALLBACK_CACHE_SECONDS = 60 * 60;
const FAVICON_HTML_BYTE_CAP = 64 * 1024;
const FAVICON_SIZE = 64;
const URL_TITLE_REDIRECT_LIMIT = 5;

export async function handleFavicon(request: Request, url: URL): Promise<Response> {
  const domain = url.searchParams.get("d");
  if (!domain || !isFaviconDomainAllowed(domain)) {
    return new Response("Bad domain", { status: 400 });
  }

  const forceRefresh = url.searchParams.get("refresh") === "1";
  const cacheUrl = new URL(request.url);
  cacheUrl.searchParams.delete("refresh");
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  const cache = caches.default;
  if (!forceRefresh) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const upstream = await fetchFaviconUpstream(domain);
  if (!upstream) {
    const fallback = fallbackFaviconResponse(domain);
    if (!forceRefresh) {
      await cache.put(cacheKey, fallback.clone());
    }
    return fallback;
  }

  const body = await upstream.arrayBuffer();
  const contentType = upstream.headers.get("Content-Type") || "image/png";
  const response = new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=" + FAVICON_CACHE_SECONDS,
      "Access-Control-Allow-Origin": "*"
    }
  });

  await cache.put(cacheKey, response.clone());
  return response;
}

async function fetchFaviconUpstream(domain: string): Promise<Response | null> {
  const declared = await fetchDeclaredFavicon(domain);
  if (declared) return declared;

  const urls = [
    "https://www.google.com/s2/favicons?sz=" + FAVICON_SIZE + "&domain_url=https://" + encodeURIComponent(domain),
    "https://www.google.com/s2/favicons?sz=" + FAVICON_SIZE + "&domain=" + encodeURIComponent(domain),
    "https://icons.duckduckgo.com/ip3/" + encodeURIComponent(domain) + ".ico"
  ];

  for (const upstream of urls) {
    const res = await fetchSafeFaviconUrl(upstream);
    if (res) return res;
  }
  return null;
}

async function fetchDeclaredFavicon(domain: string): Promise<Response | null> {
  let page: Response;
  try {
    page = await fetchFollowingSafeRedirects("https://" + domain + "/");
  } catch {
    return null;
  }
  if (!page.ok || !page.body) return null;

  const contentType = (page.headers.get("Content-Type") || "").toLowerCase();
  if (contentType && !contentType.includes("html") && !contentType.includes("xml") && !contentType.includes("text")) {
    return null;
  }

  const html = await readTextBody(page, FAVICON_HTML_BYTE_CAP);
  const hrefs = getDeclaredFaviconHrefs(html);
  for (const href of hrefs) {
    const resolved = resolveFaviconHref(href, page.url || "https://" + domain + "/");
    if (!resolved) continue;
    const res = await fetchSafeFaviconUrl(resolved);
    if (res) return res;
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
  if (normalized.startsWith("@/")) {
    normalized = normalized.slice(1);
  }

  try {
    const resolved = new URL(normalized, baseUrl).toString();
    return isUrlSafe(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

async function fetchSafeFaviconUrl(rawUrl: string): Promise<Response | null> {
  let currentUrl = rawUrl;
  for (let redirects = 0; redirects <= URL_TITLE_REDIRECT_LIMIT; redirects += 1) {
    if (!isUrlSafe(currentUrl)) return null;
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
        headers: { Accept: "image/*,*/*;q=0.8" }
      });
    } catch {
      return null;
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("Location");
      if (!location) return null;
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!res.ok) return null;
    const contentType = (res.headers.get("Content-Type") || "").toLowerCase();
    if (contentType.includes("text/html")) return null;
    return res;
  }

  return null;
}

function fallbackFaviconResponse(domain: string): Response {
  const match = domain.replace(/^www\./i, "").match(/[a-z0-9]/i);
  const label = escapeSvgText((match ? match[0] : "?").toUpperCase());
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${FAVICON_SIZE}" height="${FAVICON_SIZE}" viewBox="0 0 ${FAVICON_SIZE} ${FAVICON_SIZE}"><rect width="${FAVICON_SIZE}" height="${FAVICON_SIZE}" rx="12" fill="#f1f2f4"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#6b778c">${label}</text></svg>`;
  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=" + FAVICON_FALLBACK_CACHE_SECONDS,
      "Access-Control-Allow-Origin": "*",
      "X-Favicon-Fallback": "1"
    }
  });
}

function escapeSvgText(value: string): string {
  return value.replace(/[&<>]/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      default: return "&gt;";
    }
  });
}

export async function handleUrlTitles(request: Request, env: Env): Promise<Response> {
  if (!(await isAuthenticated(request, env.SESSION_SECRET, env.ADMIN_PASSWORD, env.BOARD_KV))) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!(await isCsrfTokenValid(request, env.SESSION_SECRET, env.ADMIN_PASSWORD, env.BOARD_KV))) {
    return new Response("Invalid CSRF token", { status: 403 });
  }
  let payload: { urls?: unknown };
  try {
    payload = (await request.json()) as { urls?: unknown };
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const urls = payload.urls;
  if (!Array.isArray(urls) || urls.length === 0) {
    return new Response("Expected non-empty urls array", { status: 400 });
  }
  if (urls.length > URL_TITLES_MAX) {
    return new Response("Too many URLs (max " + URL_TITLES_MAX + ")", { status: 400 });
  }

  const safeUrls: string[] = [];
  for (const u of urls) {
    if (typeof u !== "string" || !isUrlSafe(u)) {
      return new Response("URL not allowed", { status: 400 });
    }
    safeUrls.push(u);
  }

  const titles = await runWithConcurrency(safeUrls, URL_TITLES_CONCURRENCY, fetchTitle);
  const result = safeUrls.map((url, i) => ({ url, title: titles[i] }));
  return jsonResponse(JSON.stringify(result), 200, { "Cache-Control": "no-store" });
}

async function fetchTitle(rawUrl: string): Promise<string | null> {
  try {
    const res = await fetchFollowingSafeRedirects(rawUrl);
    if (!res.ok || !res.body) return null;
    const ctype = (res.headers.get("Content-Type") || "").toLowerCase();
    if (ctype && !ctype.includes("html") && !ctype.includes("xml") && !ctype.includes("text")) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false });
    let buf = "";
    let total = 0;
    try {
      while (total < URL_TITLES_BYTE_CAP) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        buf += decoder.decode(value, { stream: true });
        if (/<\/title>/i.test(buf)) break;
      }
    } finally {
      try { await reader.cancel(); } catch {}
    }
    buf += decoder.decode();

    const m = buf.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!m) return null;
    const title = decodeHtmlEntities(m[1]).replace(/\s+/g, " ").trim();
    return title || null;
  } catch {
    return null;
  }
}

async function readTextBody(res: Response, byteCap: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false });
  let buf = "";
  let total = 0;
  try {
    while (total < byteCap) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      buf += decoder.decode(value, { stream: true });
    }
  } finally {
    try { await reader.cancel(); } catch {}
  }
  return buf + decoder.decode();
}

async function fetchFollowingSafeRedirects(rawUrl: string): Promise<Response> {
  let currentUrl = rawUrl;
  for (let redirects = 0; redirects <= URL_TITLE_REDIRECT_LIMIT; redirects += 1) {
    if (!isUrlSafe(currentUrl)) {
      throw new Error("Unsafe URL");
    }

    const res = await fetch(currentUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(URL_TITLES_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BoardTrelloBot/1.0)",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8"
      }
    });

    if (![301, 302, 303, 307, 308].includes(res.status)) {
      return res;
    }

    const location = res.headers.get("Location");
    if (!location) return res;
    const nextUrl = new URL(location, currentUrl).toString();
    if (!isUrlSafe(nextUrl)) {
      throw new Error("Unsafe redirect");
    }
    currentUrl = nextUrl;
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
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) break;
      out[i] = await fn(items[i]);
    }
  };
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(n, items.length); w += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return out;
}
