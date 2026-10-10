interface SecretEnv {
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
}

/** .dev.vars.example 里的示例值是公开的，部署时没改就等于没设密码。 */
function isPlaceholder(value: string): boolean {
  return value === "change-me-now" || /^replace-with-/i.test(value.trim());
}

export function getConfigError(env: SecretEnv): string | null {
  if (typeof env.ADMIN_PASSWORD !== "string" || env.ADMIN_PASSWORD.trim().length === 0) {
    return "ADMIN_PASSWORD is not configured";
  }
  if (isPlaceholder(env.ADMIN_PASSWORD) || env.ADMIN_PASSWORD.length < 12) {
    return "ADMIN_PASSWORD is too weak";
  }
  // SESSION_SECRET 可选：没设置时会自动生成；设置了就必须足够长且不是示例值。
  if (typeof env.SESSION_SECRET === "string" && env.SESSION_SECRET.trim().length > 0) {
    if (isPlaceholder(env.SESSION_SECRET) || env.SESSION_SECRET.length < 32) {
      return "SESSION_SECRET must be at least 32 characters";
    }
  }
  return null;
}
