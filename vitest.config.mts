import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        // 测试里使用 node:assert，需要 nodejs_compat；生产配置不受影响。
        compatibilityFlags: ["nodejs_compat"],
        bindings: {
          ADMIN_PASSWORD: "strong-admin-password",
          SESSION_SECRET: "0123456789abcdef0123456789abcdef"
        }
      }
    })
  ],
  test: {
    include: ["worker/test/**/*.test.ts"]
  }
});
