# board-trello

Trello 风网址导航看板。前端 vanilla JS，后端 Cloudflare Workers + KV。

- 公开访客只读浏览，单管理员密码登录后增删改
- 数据存 Cloudflare KV，浏览器 localStorage 兜底
- 图标字体本地托管（`src/fonts/`），无 CDN 依赖
- 网站 favicon 通过 Worker 代理并缓存 7 天，刷新不重复请求

项目采用 MIT License，第三方资源声明见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。

---

## 本地开发

需要 Node 20+。

```bash
npm install
copy .dev.vars.example .dev.vars
npm run dev
```

访问 http://127.0.0.1:8787。本地管理员密码在 `.dev.vars` 中，不会进 git。请把 `.dev.vars` 里的 `ADMIN_PASSWORD` 和 `SESSION_SECRET` 换成自己的本地开发值。API 会拒绝空密码、`change-me-now`、少于 12 位的 `ADMIN_PASSWORD`，以及少于 32 位的 `SESSION_SECRET`。

---

## 部署到 Cloudflare

### 1. 一键部署向导

Windows PowerShell：

```powershell
.\scripts\cloudflare.ps1
```

直接运行脚本即可。它会自动检查部署 token、创建或复用 `BOARD_KV`、提示是否设置生产 secrets，并询问是否部署。一路按回车会走推荐流程。

如果本机没有部署 token，脚本会让你选择：

- 粘贴已有的 Cloudflare deploy token
- 使用 Dashboard 里 **Create additional tokens** 模板生成的 bootstrap token，再由脚本创建低权限 deploy token

脚本可以把 deploy token 保存到 `.cloudflare-token.local` 供本项目复用。这个文件已加入 `.gitignore`，但它仍然是明文密钥文件，只应保存在自己的机器上。

`wrangler.toml` 在仓库中保留 `REPLACE_WITH_KV_ID` 占位符。运行向导准备 KV 时，脚本会生成本地 `.wrangler.deploy.toml` 并写入你账号里的真实 namespace id；这个文件已加入 `.gitignore`，不会提交到公开仓库。

### 2. 创建生产 KV namespace

```bash
npx wrangler kv namespace create BOARD_KV
```

输出会给你一个 id，例如：

```
[[kv_namespaces]]
binding = "BOARD_KV"
id = "abc123def456..."
```

复制这个 `id`，填进 `wrangler.toml`，替换 `REPLACE_WITH_KV_ID`。

Windows PowerShell 也可以自动创建或复用 `BOARD_KV`，并生成本地部署配置 `.wrangler.deploy.toml`：

```powershell
.\scripts\cloudflare.ps1 -PrepareKv
```

### 3. 设置生产 secrets

```bash
npx wrangler secret put ADMIN_PASSWORD
# 提示后输入你的管理员密码

npx wrangler secret put SESSION_SECRET
# 提示后输入一个 32 位以上随机字符串
# 可用：openssl rand -hex 32
```

Windows PowerShell 也可以运行：

```powershell
.\scripts\cloudflare.ps1 -SetSecrets
```

### 4. 部署

```bash
npm run deploy
```

Windows PowerShell 也可以运行：

```powershell
.\scripts\cloudflare.ps1 -Deploy
```

输出会显示访问地址，形如 `https://board-trello.<你的子域>.workers.dev`。

### 5. （可选）绑定自定义域

Cloudflare Dashboard → Workers & Pages → board-trello → Settings → Triggers → Custom Domains。

---

## 部署后加固建议

代码层已经做了：登录失败 5 次/10 分钟封禁 IP、session cookie TTL 7 天、防弱密钥配置、URL 协议白名单（仅 http/https）、标题抓取逐跳校验重定向、安全响应头。下面是 Cloudflare 控制台还应该开的几项，按性价比排序。

### 1. 用强密码（最重要）

`ADMIN_PASSWORD` 至少 16 位随机字符串：

```bash
openssl rand -base64 24
```

代码层的速率限制能拖慢爆破，但弱密码（字典词、生日、8 位以下）仍然顶不住。强密码是底线。

### 2. `SESSION_SECRET` 用足够强的随机串

```bash
openssl rand -hex 32
```

不要复用其他系统的密钥。一旦泄露，攻击者可以伪造任意有效 cookie，等于密码失守。

### 3. 开 Bot Fight Mode（免费）

Cloudflare Dashboard → 你的域名 → **Security → Bots → Bot Fight Mode** → 打开。

自动拦截已知机器人 user-agent 和 headless browser，提高自动化爆破成本。

> 仅自定义域名可用。`*.workers.dev` 不支持。

### 4. 加边缘速率限制（免费版有 10K req/月）

Cloudflare Dashboard → 你的域名 → **Security → WAF → Rate limiting rules → Create rule**：

| 字段 | 值 |
|---|---|
| Field | URI Path |
| Operator | equals |
| Value | `/api/login` |
| Period | 1 minute |
| Requests | 10 |
| Action | Block |

边缘层比代码层（KV 计数）更早生效，能扛 DDoS 量级流量。

### 5. 开 HSTS（推荐）

**SSL/TLS → Edge Certificates → HTTP Strict Transport Security** → 打开。

强制浏览器仅通过 HTTPS 访问，防 SSL 降级攻击。

### 6. 确认 Always Use HTTPS 已开（默认）

**SSL/TLS → Edge Certificates → Always Use HTTPS** 应为 On。

### 7. （可选）提高 Security Level

**Security → Settings → Security Level → Medium 或 High**。

High 会对可疑 IP 显示验证码挑战，可能影响真实用户体验，谨慎使用。

---

## 部署后验证清单

新部署的实例过一遍：

- [ ] `curl https://你的域名/api/auth` 返回 `{"isAdmin":false}`
- [ ] 用错密码连发 6 次 `/api/login`，第 6 次开始返回 `429`
- [ ] `ADMIN_PASSWORD` 或 `SESSION_SECRET` 弱配置时，API 返回 `500` 并提示具体配置错误
- [ ] 浏览器无痕窗口打开站点 → 只看到 board，没有任何写按钮
- [ ] 用强密码登录 → 出现 + / 编辑 / 删除 按钮
- [ ] 登出 → 写按钮消失
- [ ] DevTools 看 cookie `Max-Age` 是 `604800`（7 天）
- [ ] Cloudflare Dashboard：Bot Fight Mode 已开
- [ ] Cloudflare Dashboard：`/api/login` 边缘速率限制已配置

---

## 修改密码

```bash
npx wrangler secret put ADMIN_PASSWORD
```

输入新密码即可，**无需重新部署**。

修改 `SESSION_SECRET` 会让所有已登录会话立即失效。

---

## 架构

```
[浏览器]
  ├── src/                       前端（vanilla JS，无构建工具）
  └─ fetch ─▶ [Cloudflare Worker]
                ├── GET  /api/board      公开，返回 boards JSON
                ├── PUT  /api/board      鉴权，带版本号整体替换
                ├── GET  /api/backups    鉴权，列出最近备份
                ├── POST /api/backups/restore 鉴权，恢复指定备份
                ├── GET  /api/favicon    代理 Google favicon，边缘缓存 7 天
                ├── POST /api/login      密码 → 签名 cookie
                ├── POST /api/logout     清 cookie
                └── GET  /api/auth       返回 {isAdmin}
                       │
                       ▼
                  [Cloudflare KV]
                   key="state" → 整份 boards JSON
```

- 鉴权：单密码 + HMAC-SHA256 签名 cookie，7 天有效
- 配置：API 启动前检查 `ADMIN_PASSWORD` / `SESSION_SECRET` 强度，避免弱配置上线
- 数据：boards 数组带版本号整体存 KV；每次覆盖前自动写入最近 10 份备份
- 离线：localStorage 作为缓存，断网仍可浏览
- 迁移：首次部署、KV 为空、本地有数据时，admin 登录会自动上传迁移；保存冲突时会保留本地缓存并提示是否加载远端版本

---

## 项目结构

```
.
├── src/                  前端
│   ├── index.html
│   ├── script.js         应用逻辑（含 API 客户端、登录态、只读模式）
│   ├── style.css
│   └── fonts/            Lucide 图标字体（本地托管，无 CDN）
├── worker/src/
│   ├── auth.ts           HMAC cookie 签名/验证
│   ├── authRoutes.ts     登录、登出、auth API
│   ├── boardRoutes.ts    board 读写和备份恢复 API
│   ├── config.ts         secrets 强度检查
│   ├── index.ts          Worker 路由入口
│   ├── miscRoutes.ts     favicon 和 URL title API
│   ├── shared.ts         共享类型、JSON 响应、安全响应头工具
│   ├── urlSafety.ts      URL/domain 安全校验
│   └── validation.ts     board 数据校验
├── worker/test/          Node 内置测试
├── .github/workflows/    CI：typecheck + test
├── wrangler.toml         Workers 配置（KV 绑定 + 静态资源目录）
├── .dev.vars             本地密码（gitignored）
├── package.json
└── tsconfig.json
```

---

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 本地开发服务器（含 KV 模拟） |
| `npm run deploy` | 部署到 Cloudflare |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | 编译 Worker 并运行 Node 内置测试 |

---

## API 速查

| 路径 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `/api/board` | GET | 否 | 返回 `{version, updatedAt, boards}`；首次访问返回 `null` |
| `/api/board` | PUT | 是 | body: `{version, boards}`，版本一致才整体替换 |
| `/api/backups` | GET | 是 | 列出最近自动备份 |
| `/api/backups/restore` | POST | 是 | body: `{"key":"state_backup:..."}`，恢复指定备份 |
| `/api/favicon` | GET | 否 | `?d=域名`，代理 Google favicon，缓存 7 天 |
| `/api/login` | POST | 否 | body: `{"password":"..."}`，成功后 Set-Cookie |
| `/api/logout` | POST | 否 | 清除 session cookie |
| `/api/auth` | GET | 否 | 返回 `{"isAdmin":true/false}` |

---

## 故障排查

**部署后访问 `/api/board` 返回 500**
检查 KV namespace id 是否填对，secrets 是否设置。

**登录后仍显示只读**
浏览器 cookie 被拦截。生产环境 cookie 带 `Secure` 标志，只在 HTTPS 下生效。本地 `wrangler dev` 走 HTTP 也能用是因为 localhost 例外。

**改了密码后无法登录**
secrets 修改是即时生效的，但旧 cookie 仍然有效（除非也换 `SESSION_SECRET`）。强制踢出所有会话用：

```bash
npx wrangler secret put SESSION_SECRET
```

**本地清空数据**

```bash
npx wrangler kv key delete --binding BOARD_KV state --local
```

**生产清空数据**

```bash
npx wrangler kv key delete --binding BOARD_KV state --remote
```
