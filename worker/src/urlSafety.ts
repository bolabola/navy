export function isUrlSafe(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (!host) return false;
  if (host.includes(":")) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return false;
  if (host === "metadata.google.internal") return false;
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return false;
  if (/^(\d+\.){1,3}\d+$/.test(host) && !/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return false;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const c = parseInt(m[3], 10);
    const d = parseInt(m[4], 10);
    if (a > 255 || b > 255 || c > 255 || d > 255) return false;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 运营商级 NAT
    if (a === 198 && (b === 18 || b === 19)) return false; // 198.18.0.0/15 基准测试网段
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // 192.0.0.0/24、192.0.2.0/24
    if (a >= 224) return false;
  }
  return true;
}

export function isFaviconDomainAllowed(domain: string): boolean {
  return /^[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/.test(domain);
}
