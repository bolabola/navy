interface SecretEnv {
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
}

export function getConfigError(env: SecretEnv): string | null {
  if (typeof env.ADMIN_PASSWORD !== "string" || env.ADMIN_PASSWORD.trim().length === 0) {
    return "ADMIN_PASSWORD is not configured";
  }
  if (env.ADMIN_PASSWORD === "change-me-now" || env.ADMIN_PASSWORD.length < 12) {
    return "ADMIN_PASSWORD is too weak";
  }
  if (typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.trim().length === 0) {
    return "SESSION_SECRET is not configured";
  }
  if (env.SESSION_SECRET.length < 32) {
    return "SESSION_SECRET must be at least 32 characters";
  }
  return null;
}
