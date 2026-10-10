interface SecretEnv {
  ADMIN_PASSWORD?: string;
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
  return null;
}
