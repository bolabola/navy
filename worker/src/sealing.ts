// KV 里敏感值（云盘 Client Secret、刷新令牌）的加密。
// 密钥由网站自动生成的签名密钥经 HKDF 派生，签名密钥只存在 Durable Object 里，
// 所以只能读到 KV 的人看到的只是密文。算法为 AES-256-GCM，每次加密使用随机 IV。
import { getSigningSecret } from "./auth";
import type { Env } from "./shared";

const PREFIX = "enc:v1:";
const IV_LENGTH = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const keyCache = new Map<string, Promise<CryptoKey>>();

function deriveKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle
      .importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"])
      .then((base) => crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: encoder.encode("navy-kv-sealing"), info: encoder.encode("v1") },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      ));
    keyCache.set(secret, key);
  }
  return key;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function isSealed(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** 加密一个字符串，返回 `enc:v1:<base64url(iv + 密文)>`。 */
export async function seal(env: Env, plain: string): Promise<string> {
  const key = await deriveKey(await getSigningSecret(env));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plain)));
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv, 0);
  packed.set(cipher, iv.length);
  return PREFIX + toBase64Url(packed);
}

/**
 * 解密 seal() 的结果。旧版本保存的明文原样返回，方便平滑迁移；
 * 密文损坏或密钥已变化时返回 null，调用方按“未配置 / 未连接”处理。
 */
export async function unseal(env: Env, value: string): Promise<string | null> {
  if (!isSealed(value)) return value;
  try {
    const packed = fromBase64Url(value.slice(PREFIX.length));
    if (packed.length <= IV_LENGTH) return null;
    const key = await deriveKey(await getSigningSecret(env));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: packed.slice(0, IV_LENGTH) },
      key,
      packed.slice(IV_LENGTH)
    );
    return decoder.decode(plain);
  } catch {
    return null;
  }
}
