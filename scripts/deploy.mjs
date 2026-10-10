#!/usr/bin/env node
// 部署到 Cloudflare Workers。跨平台（macOS / Linux / Windows），只依赖 Node。
//
//   npm run deploy                         部署；首次部署时引导设置管理员密码
//   npm run deploy -- --set-password       部署后重新设置管理员密码
//   npm run deploy -- --rotate-session     部署后重新生成 SESSION_SECRET（所有设备需重新登录）
//   npm run deploy -- --name my-navy       使用另一个 Worker 名
//   npm run deploy -- --skip-secrets       只部署，不检查密钥
//
// KV 命名空间和 Durable Object 由 Wrangler 在首次部署时自动创建，之后沿用。
// 登录方式：交互环境下没有 CLOUDFLARE_API_TOKEN 时会调用 `wrangler login`（浏览器授权）；
// CI 中请设置 CLOUDFLARE_API_TOKEN（以及多账号时的 CLOUDFLARE_ACCOUNT_ID）。
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerBin = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const MIN_PASSWORD_LENGTH = 16;

const args = process.argv.slice(2);
const options = {
  name: null,
  setPassword: false,
  rotateSession: false,
  skipSecrets: false
};
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--name") options.name = args[++index];
  else if (arg.startsWith("--name=")) options.name = arg.slice("--name=".length);
  else if (arg === "--set-password") options.setPassword = true;
  else if (arg === "--rotate-session") options.rotateSession = true;
  else if (arg === "--skip-secrets") options.skipSecrets = true;
  else if (arg === "-h" || arg === "--help") {
    printHelp();
    process.exit(0);
  } else {
    fail(`未知参数：${arg}（用 --help 查看用法）`);
  }
}
if (options.name !== null && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(options.name || "")) {
  fail("--name 只能包含小写字母、数字和连字符。");
}

const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI && !process.env.WORKERS_CI;
const nameArgs = options.name ? ["--name", options.name] : [];

main().catch((error) => fail(error.message || String(error)));

async function main() {
  if (!existsSync(wranglerBin)) fail("没有找到 Wrangler，请先运行 npm install。");

  loadLegacyToken();
  if (interactive) await ensureLoggedIn();

  step("部署 Worker 和前端");
  await wrangler(["deploy", ...nameArgs]);

  if (options.skipSecrets) return;
  await ensureSecrets();
}

/** 兼容旧版部署脚本保存的 token。 */
function loadLegacyToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return;
  const userEnv = path.join(homedir(), ".config", "board-trello", "cloudflare.env");
  if (existsSync(userEnv)) {
    const match = /CLOUDFLARE_API_TOKEN=['"]?([^'"\r\n]+)/.exec(readFileSync(userEnv, "utf8"));
    if (match) {
      process.env.CLOUDFLARE_API_TOKEN = match[1];
      return;
    }
  }
  const localToken = path.join(root, ".cloudflare-token.local");
  if (existsSync(localToken)) {
    const token = readFileSync(localToken, "utf8").trim();
    if (token) process.env.CLOUDFLARE_API_TOKEN = token;
  }
}

async function ensureLoggedIn() {
  if (process.env.CLOUDFLARE_API_TOKEN) return;
  const { stdout, stderr } = await wrangler(["whoami"], { capture: true, allowFailure: true });
  if (!/not authenticated|not logged in/i.test(stdout + stderr)) return;
  step("登录 Cloudflare（会打开浏览器授权）");
  await wrangler(["login"]);
}

async function ensureSecrets() {
  const { stdout, code } = await wrangler(["secret", "list", "--format", "json", ...nameArgs], { capture: true, allowFailure: true });
  let existing = [];
  try {
    existing = JSON.parse(stdout).map((entry) => entry.name);
  } catch {
    if (code !== 0) {
      console.warn("\n⚠ 无法读取已有密钥，跳过密钥检查。可以稍后运行 npm run deploy -- --set-password。");
      return;
    }
  }

  const updates = {};
  const missingPassword = !existing.includes("ADMIN_PASSWORD");
  const missingSession = !existing.includes("SESSION_SECRET");

  if (missingPassword || options.setPassword) {
    if (!interactive) {
      console.warn("\n⚠ 还没有设置 ADMIN_PASSWORD，网站会返回 500。请在 Cloudflare 后台或本地运行 npm run deploy -- --set-password 设置。");
    } else {
      step(missingPassword ? "首次部署：设置管理员密码" : "重新设置管理员密码");
      updates.ADMIN_PASSWORD = await askPassword();
    }
  }
  if (missingSession || options.rotateSession) {
    updates.SESSION_SECRET = randomBytes(32).toString("hex");
    if (!missingSession) console.log("将重新生成 SESSION_SECRET，所有设备需要重新登录。");
  }

  const names = Object.keys(updates);
  if (!names.length) {
    console.log("\n✓ 密钥已就绪（如需修改管理员密码：npm run deploy -- --set-password）");
    return;
  }

  step("写入密钥：" + names.join("、"));
  const dir = mkdtempSync(path.join(tmpdir(), "navy-secrets-"));
  const file = path.join(dir, "secrets.json");
  try {
    writeFileSync(file, JSON.stringify(updates), { mode: 0o600 });
    await wrangler(["secret", "bulk", file, ...nameArgs]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("\n✓ 完成");
}

async function askPassword() {
  for (;;) {
    const first = await askHidden(`管理员密码（至少 ${MIN_PASSWORD_LENGTH} 位，输入时不显示）：`);
    if (first.length < MIN_PASSWORD_LENGTH) {
      console.log(`密码太短，至少需要 ${MIN_PASSWORD_LENGTH} 位。`);
      continue;
    }
    if (/^replace-with-/i.test(first) || first === "change-me-now") {
      console.log("不能使用示例里的占位密码。");
      continue;
    }
    const second = await askHidden("再输入一次：");
    if (first === second) return first;
    console.log("两次输入不一致，请重新输入。");
  }
}

function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (text) => {
      if (!muted) rl.output.write(text);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
    muted = true;
  });
}

function wrangler(wranglerArgs, { capture = false, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerBin, ...wranglerArgs], {
      cwd: root,
      env: process.env,
      stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit"
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && !allowFailure) {
        if (capture && stderr) process.stderr.write(stderr);
        reject(new Error(`wrangler ${wranglerArgs[0]} 失败（退出码 ${code}）`));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}

function step(message) {
  console.log(`\n▸ ${message}`);
}

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function printHelp() {
  console.log(`用法：npm run deploy -- [选项]

  --set-password      部署后重新设置管理员密码
  --rotate-session    部署后重新生成 SESSION_SECRET（所有设备需重新登录）
  --name <worker>     使用另一个 Worker 名（默认读取 wrangler.toml）
  --skip-secrets      只部署，不检查密钥
  -h, --help          显示帮助

首次部署会自动创建 KV 命名空间和 Durable Object，并引导设置管理员密码。
CI 中请设置 CLOUDFLARE_API_TOKEN（多账号时再设置 CLOUDFLARE_ACCOUNT_ID）。`);
}
