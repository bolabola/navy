<div align="center">

<img src="./frontend/favicon.svg" width="76" alt="navy logo">

# navy.

**A calm, fast, fully self-hosted bookmark dashboard**

Runs on Cloudflare Workers · no servers to manage · the free tier is enough for everyday use

[![CI](https://github.com/bolabola/navy/actions/workflows/ci.yml/badge.svg)](https://github.com/bolabola/navy/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-101b2d.svg)](./LICENSE)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020?logo=cloudflare&logoColor=white)
![Vanilla JS](https://img.shields.io/badge/frontend-Vanilla%20JS-ff4f1a)
![No CDN](https://img.shields.io/badge/no%20tracking-no%20CDN-12805c)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bolabola/navy)

[简体中文](./README.md) · **English**

[Features](#-features) · [Quick start](#-quick-start) · [Deploy](#-deploy-to-cloudflare) · [Backups](#-backup--restore) · [API](#-api) · [Troubleshooting](#-troubleshooting)

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/screenshot-dark.png">
  <img src="./docs/screenshot-light.png" alt="navy dashboard preview" width="100%">
</picture>

<sub>The interface follows your system's light / dark setting. The image above also matches your current GitHub theme.</sub>

</div>

<br>

> [!NOTE]
> The interface is currently in Simplified Chinese. Your own page names, board titles and links can be in any language, and the code is commented in Chinese. An English interface is planned.

## ✨ Features

<table>
<tr>
<td width="50%" valign="top">

**⌘K global search**<br>
Find any link across all pages and boards by title, URL or description. Arrow keys to pick, Enter to open.

</td>
<td width="50%" valign="top">

**Pages · boards · groups**<br>
Use pages for different contexts, boards to organize links, and groups inside a board. Masonry layout with drag-to-reorder and drag-to-resize.

</td>
</tr>
<tr>
<td valign="top">

**Three display modes**<br>
List, icon grid, and a detail view that shows the URL. Three icon sizes, configurable per board.

</td>
<td valign="top">

**Light / dark theme**<br>
Follows your system by default, can be toggled and remembered, and never flashes the wrong theme on load.

</td>
</tr>
<tr>
<td valign="top">

**Read-only for visitors, editable for the admin**<br>
Anyone can browse and open links; their collapsed boards and view choices stay in their own browser. Only the admin can change and save the dashboard.

</td>
<td valign="top">

**Safe data**<br>
Strongly consistent storage in a Durable Object, so concurrent saves never overwrite each other. Automatic history backups, plus scheduled backups to Google Drive / Dropbox.

</td>
</tr>
<tr>
<td valign="top">

**Fast**<br>
No framework, no CDN. Only a ~20 KB subset of the icon font is loaded up front, and anonymous visitors read data from KV at the edge.

</td>
<td valign="top">

**Import / export**<br>
Import browser bookmark HTML files, export / import the full dashboard as JSON, and bulk-import URLs or export CSV per board.

</td>
</tr>
</table>

<div align="center">
<table>
<tr>
<td align="center"><img src="./docs/search.png" width="420" alt="⌘K search"><br><sub>⌘K search</sub></td>
<td align="center"><img src="./docs/mobile-light.png" width="180" alt="Mobile, light"><br><sub>Mobile · light</sub></td>
<td align="center"><img src="./docs/mobile-dark.png" width="180" alt="Mobile, dark"><br><sub>Mobile · dark</sub></td>
</tr>
</table>
</div>

### Keyboard shortcuts

| Keys | Action |
|---|---|
| <kbd>⌘</kbd> <kbd>K</kbd> / <kbd>Ctrl</kbd> <kbd>K</kbd> | Open or close search |
| <kbd>/</kbd> | Open search (when not typing in a field) |
| <kbd>↑</kbd> <kbd>↓</kbd> | Move through search results |
| <kbd>Enter</kbd> | Open the selected link in a new tab |
| <kbd>Esc</kbd> | Close search or the icon picker |

<br>

## 🚀 Quick start

Requires **Node.js 20+**.

```bash
git clone git@github.com:bolabola/navy.git
cd navy
npm install
cp .dev.vars.example .dev.vars      # Windows: copy .dev.vars.example .dev.vars
npm run dev
```

Open <http://127.0.0.1:8787>. `wrangler dev` builds the frontend automatically (`scripts/build.mjs`) and rebuilds when `frontend/` changes.

> [!IMPORTANT]
> Change `ADMIN_PASSWORD` in `.dev.vars` to your own local value first. The backend rejects empty values, the example placeholder and passwords shorter than 12 characters. `.dev.vars` is never committed.

<br>

## 🚢 Deploy to Cloudflare

### Option 1: one-click deploy (recommended)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bolabola/navy)

Click the button and sign in to Cloudflare. It will:

1. Copy the repository to your GitHub account
2. Create the Worker, the KV namespace and the Durable Object (named `navy` by default; you can change it in the form)
3. Ask for the admin password `ADMIN_PASSWORD` (the example value is rejected; use your own)
4. Build and deploy; every later push to your copy deploys automatically

The button creates a new copy of the repository in your GitHub account. To use a repository you already have (for example your own fork), import it instead:

<details>
<summary><b>Import an existing Git repository (add the admin password manually)</b></summary>

<br>

1. In the Cloudflare dashboard open **Workers & Pages → Create → Import a repository**, pick your repository, name the project `navy` (or anything you like) and deploy with the default settings.
2. When the deployment finishes, open the Worker's **Settings**, find the **Runtime variables and secrets** section and click **Add**. Not **Build variables and secrets** — the site cannot read build variables at runtime:

   | Field | Value |
   |---|---|
   | Type | **Secret** — not plain text, which would show the password in the dashboard |
   | Variable name | `ADMIN_PASSWORD` |
   | Value | Your admin password, at least 12 characters (16+ recommended) |

3. Click **Deploy** to save. It takes effect immediately; no rebuild needed.

</details>

> [!IMPORTANT]
> Importing a repository does **not** ask for the admin password. If you skip step 2, or add the password as a build variable, every API call returns 500 and signing in fails with a server configuration error.

### Option 2: command line

```bash
npm install
npm run deploy
```

The same command works on macOS, Linux and Windows; only Node.js is required. The script:

1. Opens your browser for `wrangler login` if you are not signed in (or uses `CLOUDFLARE_API_TOKEN` when set)
2. Deploys the Worker and the frontend; the KV namespace and the Durable Object are created on the first deploy and reused afterwards
3. Asks for the admin password on the first deploy

```text
npm run deploy -- --set-password     Change the admin password
npm run deploy -- --name my-navy     Deploy under a different Worker name
npm run deploy -- --skip-secrets     Deploy only, skip the secret check
```

The Worker is called `navy` by default and its KV namespace `navy-board-kv`.

### Option 3: deploy on push (GitHub Actions)

The included CI deploys after the tests pass on `master`.

> [!WARNING]
> The one-click deploy and importing a repository both enable Cloudflare's own builds, which already deploy on every push. If you use either of them, do **not** also add `CLOUDFLARE_API_TOKEN` to GitHub Actions, or every push will deploy twice. Option 3 is only for people who deploy from the command line and want pushes to go live automatically.

Add these under **Settings → Secrets and variables → Actions** in your GitHub repository:

| Secret | Description |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Deploy token with at least **Workers Scripts: Edit**, **Workers KV Storage: Edit** and **Account Settings: Read** |
| `CLOUDFLARE_ACCOUNT_ID` | Optional; set it when the token can access more than one account |

Without `CLOUDFLARE_API_TOKEN` the deploy job is skipped, so forks are not affected.

<details>
<summary><b>Creating a deploy token</b></summary>

<br>

1. Open Cloudflare **My Profile → [API Tokens](https://dash.cloudflare.com/profile/api-tokens)** and click **Create Token**.
2. Use the **Edit Cloudflare Workers** template, or a custom token with only the three permissions above.
3. Under **Account Resources** pick the account to deploy to, then copy the token (it is shown only once).

</details>

You can attach a custom domain under **Workers & Pages** in the Cloudflare dashboard.

### Environment variables and secrets

| Name | Required | Description |
|---|:---:|---|
| `ADMIN_PASSWORD` | ✅ | Admin password; a random string of 16+ characters is recommended. Changing it needs no redeploy |

Use `.dev.vars` for local development. In production the deploy script sets it, or you can set it yourself:

```bash
npx wrangler secret put ADMIN_PASSWORD
```

<br>

## 🛟 Backup & restore

| | When | Where | Kept |
|---|---|---|---|
| **History backups** | On save, at most once every 10 minutes; always before restoring a backup | Durable Object | Latest 20 |
| **Cloud backups** | A cron job checks every hour and uploads only when the dashboard changed; you can also click “back up now” | Google Drive / Dropbox | Latest 100 (the restore list shows the latest 10) |

Both kinds can restore the whole dashboard from the backup menu in the top bar. A failed cloud upload never blocks normal saving; the next scheduled run retries. Cloud backup files are named like `state_backup_2026-05-11T08-30-00-000Z.json`.

### Setting up cloud backups

Everything happens inside the app; no Cloudflare variables needed:

1. Sign in as the admin and open the backup menu in the top bar.
2. Click **配置** (configure) next to Google Drive or Dropbox and follow the wizard. It shows **the callback URL for your own site** (with a copy button) and direct links to the Google Cloud / Dropbox consoles.
3. Paste the Client ID and Client secret (App key and App secret for Dropbox) and save.
4. Click **连接** (connect) to authorize. From then on it backs up every hour, and you can back up on demand at any time.

Credentials saved in the app can only be changed by the admin, and the secret is never shown again. To switch to another app, open the settings and enter new credentials or remove them (this also disconnects). Disconnecting only removes the authorization; existing backup files in your cloud drive are kept.

Client secrets and refresh tokens are encrypted (AES-256-GCM) before they are written to KV. The key is derived from a random signing secret that the app generates itself and keeps in the Durable Object, so someone who can read KV only sees ciphertext.

<br>

## 🏗 Architecture

```text
Browser
  ├─ dist/                      Built frontend (Workers Static Assets; security headers from frontend/_headers)
  └─ fetch /api/*
       └─ Cloudflare Worker  ·  worker/src/index.ts
            ├─ boardRoutes      Dashboard reads and writes, history backups
            │    └─ BoardStateObject (Durable Object)   Source of truth, strongly consistent
            │         └─ Mirrored to KV on every commit for fast anonymous reads at the edge
            ├─ cloudBackup      Google Drive / Dropbox; scheduled() runs the hourly backup
            ├─ authRoutes       Sign in, sign out, session status
            ├─ miscRoutes       Favicon and page-title proxy
            └─ Cloudflare KV    Sessions, login rate limiting, cloud backup settings, dashboard mirror
```

The dashboard is saved as one versioned document. The version check and the write run serially inside a single Durable Object, so when two saves race only one succeeds and the other gets `409`; local changes stay in the browser cache. Data stored in KV by older versions is migrated automatically on first access.

**Stack**: vanilla JavaScript (ES modules, bundled with esbuild) · hand-written CSS design system (design tokens, light and dark themes) · TypeScript Worker · Durable Objects · KV · Vitest running in workerd · self-hosted [Lucide](https://lucide.dev) icon font.

<details>
<summary><b>Project structure</b></summary>

<br>

```text
.
├── frontend/              Frontend source (built into dist/)
│   ├── index.html
│   ├── main.js            Entry: initial state, event handlers, boot
│   ├── theme-init.js      Picks the theme before first paint to avoid flashing
│   ├── js/                Modules by responsibility (render, layout, search, sync, backup, events/ …)
│   ├── style.css          Design system and all component styles
│   ├── styles.css         Stylesheet entry (icon font + style.css)
│   ├── _headers           Static asset headers (security headers, long-term caching)
│   └── fonts/
├── shared/limits.ts       Data limits shared by frontend and backend
├── worker/src/            Worker source
│   ├── index.ts           Routes and the scheduled entry point
│   ├── boardRepo.ts       Durable Object and dashboard repository
│   ├── boardStore.ts      State reads/writes, history backup throttling and pruning
│   ├── cloudBackup.ts     Cloud backups (scheduled job, status, restore)
│   ├── cloudProviders.ts  Google Drive / Dropbox APIs
│   ├── sealing.ts         Encryption for secrets stored in KV
│   ├── auth.ts · authRoutes.ts · boardRoutes.ts · miscRoutes.ts
│   ├── validation.ts      Validation and allow-list sanitizing
│   └── shared.ts · urlSafety.ts · config.ts
├── worker/test/           Vitest tests (run in workerd)
├── scripts/               Build and deploy scripts
└── wrangler.toml
```

</details>

### Common commands

| Command | Description |
|---|---|
| `npm run dev` | Start the local dev server and build the frontend |
| `npm run build` | Build the frontend into `dist/` |
| `npm run typecheck` | TypeScript type check |
| `npm test` | Build the frontend and run the tests in workerd |
| `npm run deploy` | Deploy to Cloudflare (all platforms) |

<br>

## 📡 API

All write endpoints require same-origin requests and, once signed in, the CSRF token returned by `GET /api/auth`.

<details>
<summary><b>Endpoints</b></summary>

<br>

| Path | Method | Auth | Description |
|---|---|:---:|---|
| `/api/board` | GET |  | Returns `{version, updatedAt, pages, activePageId, layout, boards}` (`boards` is the current page); `null` before the first save |
| `/api/board` | PUT | 🔒 | Replaces the dashboard when the version matches; send only `pages`; returns `lastBackupAt` |
| `/api/backups` | GET | 🔒 | Lists recent history backups |
| `/api/backups/restore` | POST | 🔒 | Restores a history backup |
| `/api/cloud-backup/status` | GET | 🔒 | Configuration source, callback URL, connection and last backup per provider (never returns secrets) |
| `/api/cloud-backup/:provider/client` | PUT | 🔒 | Saves OAuth client credentials (`clientId`, `clientSecret`) in the app; changing them disconnects the old authorization |
| `/api/cloud-backup/:provider/client` | DELETE | 🔒 | Removes the saved credentials and disconnects |
| `/api/cloud-backup/:provider/connect` | POST | 🔒 | Returns the OAuth authorization URL |
| `/api/cloud-backup/:provider/callback` | GET |  | OAuth callback |
| `/api/cloud-backup/:provider/run` | POST | 🔒 | Backs up to that provider now |
| `/api/cloud-backup/:provider/disconnect` | POST | 🔒 | Disconnects the provider |
| `/api/cloud-backup/:provider/backups` | GET | 🔒 | Lists the latest 10 cloud backups |
| `/api/cloud-backup/:provider/restore` | POST | 🔒 | Restores a cloud backup |
| `/api/favicon` | GET |  | Fetches and caches a site icon (`refresh=1` only for the admin; returns a 1×1 placeholder when none is found) |
| `/api/url-titles` | POST | 🔒 | Fetches page titles and descriptions |
| `/api/login` | POST |  | Admin sign-in |
| `/api/logout` | POST | 🔒 | Sign out |
| `/api/auth` | GET |  | Session status and CSRF token |

</details>

<br>

## 🔐 Security notes

- Use a random `ADMIN_PASSWORD` of at least 16 characters.
- Serve production over HTTPS only. On a custom domain, consider Bot Fight Mode, an edge rate limit on `/api/login`, Always Use HTTPS and HSTS.
- Never commit `.dev.vars`, `.cloudflare-token.local` or other local secret files (they are all in `.gitignore`).
- The frontend ships a strict CSP: same-origin scripts only, and site icons are proxied through your own Worker instead of loaded from third parties.

<br>

## 🧰 Troubleshooting

<details>
<summary><b><code>/api/board</code> returns 500</b></summary>

<br>

Usually `ADMIN_PASSWORD` is missing, too short, or still the example placeholder. Run `npm run deploy -- --set-password` to set it.

</details>

<details>
<summary><b>Still read-only after signing in</b></summary>

<br>

Check whether the browser blocks cookies. In production the session cookie has the `Secure` flag and only works over HTTPS.

</details>

<details>
<summary><b>Google Drive authorization returns <code>403: access_denied</code></b></summary>

<br>

While the OAuth consent screen is in Testing, add your Google account to **Test users**.

</details>

<details>
<summary><b>Dropbox restore says <code>files.content.read</code> is missing</b></summary>

<br>

Enable `files.content.read` under **Permissions** in the Dropbox App Console, save, then disconnect and reconnect Dropbox in the app.

</details>

<details>
<summary><b>Dropbox says <code>Invalid redirect_uri</code></b></summary>

<br>

Add the full callback URL under **Settings** in the Dropbox App Console. It must match the `redirect_uri` exactly, including the path and without a trailing `/`:

```text
https://your-domain/api/cloud-backup/dropbox/callback
```

</details>

<details>
<summary><b>Clearing the dashboard data</b></summary>

<br>

```bash
npx wrangler kv key delete --binding BOARD_KV state --local    # local
npx wrangler kv key delete --binding BOARD_KV state --remote   # production
```

</details>

<details>
<summary><b>Pre-launch checklist</b></summary>

<br>

- [ ] `GET /api/auth` returns `{"isAdmin":false}` when signed out
- [ ] Repeated wrong passwords return `429` after the limit
- [ ] A weak `ADMIN_PASSWORD` returns `500`
- [ ] Signed out, you can browse, open links, switch display modes and collapse boards, and a reload restores the saved state
- [ ] The theme button switches light / dark and the choice survives a reload
- [ ] ⌘K finds links on other pages and Enter opens them in a new tab
- [ ] The admin can add, edit, delete, reorder, save and restore backups
- [ ] Several saves within 10 minutes create only one history backup
- [ ] With a cloud drive connected, “back up now” or the hourly job creates a cloud backup
- [ ] The Google Drive and Dropbox callback URLs match the console settings exactly

</details>

<br>

---

<div align="center">
<sub>
<a href="./LICENSE">MIT License</a> © 2026 bolabola · Icons from <a href="https://lucide.dev">Lucide</a> · Third-party notices in <a href="./THIRD_PARTY_NOTICES.md">THIRD_PARTY_NOTICES.md</a>
</sub>
</div>
