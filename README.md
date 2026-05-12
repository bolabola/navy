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

Windows PowerShell：

```powershell
.\scripts\cloudflare.ps1
```

只使用这个向导部署。它会按顺序完成：

- 检查或保存 Cloudflare deploy token
- 创建或复用 `BOARD_KV`
- 生成本地 `.wrangler.deploy.toml`，写入真实 KV namespace id
- 提示是否设置生产 `ADMIN_PASSWORD` 和 `SESSION_SECRET`
- 调用 Wrangler 部署 Worker 和静态资源

一路按回车会走推荐流程。如果本机没有部署 token，向导会让你选择粘贴已有 Cloudflare deploy token，或使用 Dashboard 里 **Create additional tokens** 模板生成的 bootstrap token，再由脚本创建低权限 deploy token。

脚本可以把 deploy token 保存到 `.cloudflare-token.local` 供本项目复用。这个文件已加入 `.gitignore`，但它仍然是明文密钥文件，只应保存在自己的机器上。

`wrangler.toml` 在仓库中保留 `REPLACE_WITH_KV_ID` 占位符。向导准备 KV 时会生成本地 `.wrangler.deploy.toml` 并写入真实 namespace id；这个文件已加入 `.gitignore`，不会提交到公开仓库。

部署完成后，输出会显示访问地址，形如 `https://board-trello.<你的子域>.workers.dev`。

### （可选）绑定自定义域

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

## 云端外部备份

应用每次覆盖 `state` 前都会先写入 KV 备份 `state_backup:*`。连接云端备份后，同一份备份也会异步上传到已连接的 Google Drive 或 Dropbox；每个云端目录只保留最近 100 份自动备份，某个云端上传或清理失败不会阻断正常保存。

### OAuth App 准备

每个服务都需要先创建自己的 OAuth App。创建完成后，把对应的 Client ID 和 Client Secret 设置为 Cloudflare Worker secrets。

#### Google Drive

| 配置项 | 值 |
|---|---|
| 创建入口 | <https://console.cloud.google.com/> |
| 回调地址 | `https://你的域名/api/cloud-backup/google/callback` |
| Secrets | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` |
| 权限范围 | `https://www.googleapis.com/auth/drive.file` |

步骤：

1. Google Cloud Console → **APIs & Services** → **Credentials**。
2. **Create credentials** → **OAuth client ID**。
3. Application type 选择 **Web application**，不要选 Service Account。
4. **Authorized JavaScript origins** 填域名来源，不带路径：

```text
https://你的域名
```

5. **Authorized redirect URIs** 填完整回调地址：

```text
https://你的域名/api/cloud-backup/google/callback
```

6. 保存后复制 Client ID 和 Client Secret，用下面的 Wrangler secret 命令写入 Cloudflare。

如果 OAuth consent screen 还在 Testing，需要到 **APIs & Services** → **OAuth consent screen** → **Audience / Test users**，把正在授权时使用的 Google 邮箱加入 Test users。

#### Dropbox

| 配置项 | 值 |
|---|---|
| 创建入口 | <https://www.dropbox.com/developers/apps> |
| 回调地址 | `https://你的域名/api/cloud-backup/dropbox/callback` |
| Secrets | `DROPBOX_CLIENT_ID` / `DROPBOX_CLIENT_SECRET` |
| 权限范围 | `files.content.write`、`files.metadata.read`、`files.metadata.write` |

步骤：

1. 打开 Dropbox App Console：<https://www.dropbox.com/developers/apps>。
2. 点击 **Create app**。
3. API 选择 **Scoped access**。
4. Access type 选择 **App folder**。应用只会访问自己的 app 文件夹，备份会写入 `board-trello-backups`。
5. App name 填一个唯一名称，例如 `board-trello-backup-你的名字`。
6. 创建后进入 app 详情页，在 **Permissions** 中勾选：

```text
files.content.write
files.metadata.read
files.metadata.write
```

7. 保存权限后，回到 **Settings**，在 **OAuth 2 Redirect URIs** 添加完整回调地址：

```text
https://你的域名/api/cloud-backup/dropbox/callback
```

8. 在同一页复制 **App key** 和 **App secret**。这里的 App key 对应 `DROPBOX_CLIENT_ID`，App secret 对应 `DROPBOX_CLIENT_SECRET`，用下面的 Wrangler secret 命令写入 Cloudflare。

如果已有 Dropbox 连接是在加入 `files.metadata.read` 前授权的，需要在看板里先 `Disconnect`，再重新 `Connect`，让新的权限生效。

### 设置 Cloudflare secrets

只配置你要用的服务即可：

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET

npx wrangler secret put DROPBOX_CLIENT_ID
npx wrangler secret put DROPBOX_CLIENT_SECRET
```

设置 secrets 后重新部署。

### 后台连接和断开

1. 登录看板后台。
2. 点击顶栏的 `Backup` 下拉按钮。
3. 在 Google Drive、Dropbox 中选择已配置的服务，点击 `Connect`。
4. 跳转到对应授权页后确认授权。
5. 回到看板后，该服务会显示 `Connected`。
6. 需要取消时，在同一个下拉列表点击 `Disconnect`。

授权成功后，Worker 会自动在对应云盘创建或使用 `board-trello-backups` 文件夹，并把 refresh token 和必要的文件夹信息存到 `BOARD_KV`。后续每次自动备份都会上传类似下面的文件，并在上传成功后删除第 101 份及更旧的自动备份：

```text
state_backup_2026-05-11T08-30-00-000Z.json
```

## 故障排查

**部署后访问 `/api/board` 返回 500**
检查 KV namespace id 是否填对，secrets 是否设置。

**登录后仍显示只读**
浏览器 cookie 被拦截。生产环境 cookie 带 `Secure` 标志，只在 HTTPS 下生效。本地 `wrangler dev` 走 HTTP 也能用是因为 localhost 例外。

**连接 Google Drive 时报 `403: access_denied`，提示应用正在测试中**
这是 Google OAuth consent screen 还处于 Testing 状态。打开 Google Cloud Console → **APIs & Services** → **OAuth consent screen** → **Audience / Test users**，把正在授权时使用的 Google 邮箱加入 Test users 后再重新连接。

如果希望任意 Google 账号都能连接，需要把 OAuth app 发布到 Production，并按 Google 要求完成验证。自用场景保持 Testing，然后只添加自己的邮箱最简单。

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
