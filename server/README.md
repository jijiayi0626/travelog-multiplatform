# 旅记 · Cloudflare 部署（前后端同一个 Worker）

前端构建产物和 `/api` 由**同一个 Worker**提供，不再需要 Pages + Worker 分开部署。

## 目录关系

```
travelog-web/
├── dist/                 # npm run build 生成的前端产物
└── server/
    ├── src/index.js      # Worker：/api/* + 静态资源兜底
    ├── schema.sql        # D1 表结构
    └── wrangler.toml     # [assets] 指向 ../dist
```

`wrangler.toml` 里已经配置：

```toml
[assets]
directory = "../dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*"]
```

含义：`/api/*` 先进入 Worker 函数，其余路径由静态资源处理；找不到文件时回退到 `index.html`（适配 `#/...` 路由）。

## 首次部署

```bash
# 1. 构建前端（在仓库根）
npm ci
npm run build

# 2. 创建 D1 数据库
cd server
npx wrangler d1 create travelog
# 把输出的 database_id 填进 wrangler.toml 的 [[d1_databases]]

# 3. 建表
npx wrangler d1 execute travelog --file=./schema.sql --remote

# 4. 部署（前端 + API 一起上线）
npx wrangler deploy
```

部署完成会得到一个 `https://travelog.<你的子域>.workers.dev`，打开即是完整应用。

## 管理面板

访问 `https://<你的域名>/#/admin`，或「我的 → 管理面板」。

首次登录使用 `wrangler.toml` 里的引导账号：

```toml
[vars]
ADMIN_USER = "admin"
ADMIN_TOKEN = "change-me-now"
```

首次登录时，Worker 会把这份账号写入 D1 的 `settings` 表（口令经 PBKDF2 哈希）。

**登录后请在「站点 → 管理员口令」里改掉，然后删掉 `ADMIN_TOKEN` 变量并重新部署。** 之后账号完全由数据库管理，不再依赖环境变量。

### 能做什么

| 分区 | 能力 |
| --- | --- |
| 用户 | 搜索昵称/同步码、查看注册时间与最近活跃、云端实体数、停用/启用、重置同步码、删除用户及其云端数据 |
| AI 接口 | 开关 AI、切换 OpenAI 兼容接口 / Workers AI、填写 Key 与模型、温度、在线测试连接 |
| 站点 | 站点名称、修改管理员口令 |

AI 配置保存在 D1 的 `settings` 表，改完立即生效，**不需要重新部署**，也不需要再写 `wrangler secret`。

## 环境变量（只剩引导用）

| 变量 | 用途 | 是否必需 |
| --- | --- | --- |
| `ADMIN_USER` / `ADMIN_TOKEN` | 管理面板首次登录的引导账号 | 首次需要，之后可删 |
| `CORS_ORIGIN` | 允许的前端来源，同源部署保持 `*` | 可选 |
| `SITE_NAME` | 站点名 | 可选 |

AI 的 Key 不再放环境变量。如果确实想用 secret 兜底，仍会读取 `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`，但面板里的配置优先级更高。

## 本地调试

```bash
npm run build            # 先生成 dist
cd server
npx wrangler dev         # 默认 http://127.0.0.1:8787，同时提供前端与 API
```

D1 本地会生成 `.wrangler/state`：

```bash
npx wrangler d1 execute travelog --file=./schema.sql --local
```

前端如果要连本地 Worker，在「我的 → 云同步 → 服务器」填 `http://127.0.0.1:8787`；同域部署时留空即可。

## 升级已有部署

```bash
git pull
npm ci && npm run build
cd server
npx wrangler d1 execute travelog --file=./schema.sql --remote   # 幂等，新增 settings / user_meta
npx wrangler deploy
```

`schema.sql` 全部是 `CREATE TABLE IF NOT EXISTS`，对老库安全；`users` 表结构未改动，老数据不受影响。

## 常见问题

- **打开是 404**：确认 `dist` 已构建，且 `wrangler.toml` 的 `directory` 指向正确位置。
- **接口 401**：同步令牌会随登录轮换，换设备后需要重新用同步码登录。
- **AI 报 503**：到管理面板确认 AI 已开启、Key 已保存，或已绑定 Workers AI。
- **管理面板进不去**：确认已执行 `schema.sql`（需要 `settings` 表），并检查 `ADMIN_USER` / `ADMIN_TOKEN`。