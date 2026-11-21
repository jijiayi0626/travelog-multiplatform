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

# 3. 创建 R2 桶（照片云端存储）
npx wrangler r2 bucket create travelog-photos
# wrangler.toml 默认已绑定 PHOTOS → travelog-photos；换桶名时同步修改

# 4. 建表
npx wrangler d1 execute travelog --file=./schema.sql --remote

# 5. 部署（前端 + API 一起上线）
npx wrangler deploy
```

部署完成会得到一个 `https://travelog.<你的子域>.workers.dev`，打开即是完整应用。`npm run build` 生成的 `dist/version.json` 会一起上传，供「关于 → 检查更新」判断线上构建是否更新。

## 管理面板

访问 `https://<你的域名>/#/admin`，或在应用内打开「我的 → 关于旅记」，连续点击版本号 7 次开启开发者模式，再从「开发者模式 → 管理面板」进入。

首次部署时可用环境变量引导管理员账号（不写入仓库）：

```toml
[vars]
ADMIN_USER = "admin"
ADMIN_TOKEN = "临时口令"
```

首次登录时，Worker 会把这份账号写入 D1 的 `settings` 表（口令经 PBKDF2 哈希）。
**登录后请在「站点 → 管理员口令」里改掉，然后删掉 `ADMIN_TOKEN` 变量并重新部署。**
生产库已有管理员时不要再设置这两个变量，账号完全由数据库管理。

### 能做什么

| 分区 | 能力 |
| --- | --- |
| 用户 | 搜索昵称/账号/同步码，查看会员到期、最近登录 IP / 地区 / 浏览器、云端实体数；赠送或取消会员、停用/启用、重置同步码、删除用户及其云端数据（含 R2 照片文件） |
| 会员码 / 邀请码 | 批量生成会员码（天数、次数、备注）、生成注册邀请码、查看使用次数、删除 |
| 照片 | 云端照片墙：按上传时间倒序浏览所有用户的照片、查看归属与大小、灯箱预览 |
| AI 接口 | 开关 AI、**AI 需要会员**开关、切换 OpenAI 兼容接口 / Workers AI、填写 Key 与模型、温度、在线测试连接 |
| 站点 | 站点名称、邀请注册开关、修改管理员口令 |

AI 配置保存在 D1 的 `settings` 表，改完立即生效，**不需要重新部署**，也不需要再写 `wrangler secret`。

AI 默认是会员功能（`ai.membership_required`），后台可关闭为所有登录用户可用。生成类请求会先写入 `ai_jobs` 表，再用 `ctx.waitUntil` 在后台执行，接口立即返回；客户端轮询任务状态，用户离开页面也会继续生成，完成后在右上角提醒。每个账号保留最近 30 条记录，可随时删除。

## 账号体系

- **账号密码登录**：注册时填写昵称、账号、密码；密码以 PBKDF2-SHA256 保存，登录后签发多设备令牌，同一账号可在多台设备同时在线。
- **同步码兼容**：8 位同步码继续用于老账号登录、多设备接入和多人共享；老账号用同步码登录后，页面会引导补设账号密码。
- **注册邀请码**：管理面板可开关「注册必须邀请码」，邀请码可限制使用次数。
- **会员码**：用户在「云同步 → 会员」兑换，按天累加，管理面板可直接赠送/取消会员。
- **AI 会员限制**：默认开启，非会员提交 AI 任务会返回 403（`code=membership_required`）；后台「AI 接口 → AI 需要会员」可关闭。记账自动分类使用同步接口，非会员会静默跳过。
- **登录审计**：注册、密码登录、同步码登录、改密、兑换会员都会记录 IP、User-Agent、国家/地区/城市和 Cloudflare 机房，管理员在用户列表可见。
- **定位解析**：`GET /api/geo/reverse?lat=&lon=` 代理 Nominatim 逆地理编码，返回省 / 市 / 区县 / 街道与 `areaLabel`；手动打卡会据此自动填名，自动打卡在没有已知地点时优先记录区县 / 街道。`GET /api/poi` 同时返回城市与区县，便于选择后补全。
- **同步游标**：`/api/sync/pull` 使用 `updatedAt~kind~id` 复合游标，同一毫秒的实体不会在分页边界丢失；旧版数字游标仍然兼容。`/api/sync/push` 返回 D1 实际写入条数，被 LWW 拒绝的旧数据计入 `skipped`。
- **限流**：注册、密码登录、同步码登录、管理员登录、会员码兑换、POI 搜索和逆地理编码使用 D1 固定窗口限流，超限返回 429。

## 环境变量（可选）

| 变量 | 用途 | 是否必需 |
| --- | --- | --- |
| `ADMIN_USER` / `ADMIN_TOKEN` | 仅首次初始化管理面板时使用 | 已有管理员后不需要 |
| `CORS_ORIGIN` | 允许的前端来源，同源部署保持 `*` | 可选 |
| `SITE_NAME` | 站点名 | 可选 |
| `NOMINATIM_BASE` | 自建 / 镜像 Nominatim 地址，默认 `https://nominatim.openstreetmap.org` | 可选 |

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
npx wrangler r2 bucket create travelog-photos   # 首次升级到照片云端版时执行；已存在可忽略
npx wrangler d1 execute travelog --file=./schema.sql --remote   # 幂等，补齐新表与索引
npx wrangler deploy
```

`schema.sql` 全部是 `CREATE TABLE IF NOT EXISTS`，对老库安全；`users` / `entities` 等老表结构不变，老数据不受影响。
新版本会新增 `user_credentials`、`user_tokens`、`membership_codes`、`user_membership`、`invite_codes`、`user_activity`、`rate_limits`、`photos`、`ai_jobs` 九张表。

升级后老用户仍然可以用原来的同步码登录；登录后到「云同步 → 设置账号密码」补设账号密码即可。
老设备此前保存在 `users.token` 的令牌会在下次登录时自动迁入 `user_tokens`，不会被新设备顶掉。

## 常见问题

- **打开是 404**：确认 `dist` 已构建，且 `wrangler.toml` 的 `directory` 指向正确位置。
- **接口 401**：访问令牌无效或已被注销；用账号密码（或同步码）重新登录。修改密码会让其他设备的令牌失效。
- **AI 报 503**：到管理面板确认 AI 已开启、Key 已保存，或已绑定 Workers AI。
- **AI 报 403 / 提示会员功能**：管理面板「AI 接口 → AI 需要会员」处于开启状态；让用户在「云同步 → 会员」兑换会员码，或关闭该开关。
- **AI 任务一直转圈**：后台任务依赖 Worker 运行时；超过 15 分钟未完成会在下一次查询时标为超时。让用户重新发起即可，历史记录可在「我的 → AI 任务」删除。
- **管理面板进不去**：确认已执行 `schema.sql`（需要 `settings` 表），并检查 `ADMIN_USER` / `ADMIN_TOKEN`（仅首次初始化需要）。
- **注册提示需要邀请码**：管理面板「站点 → 注册设置」已开启邀请注册；到「会员码 / 邀请码」生成邀请码，或关闭该开关。
- **操作返回 429**：触发了固定窗口限流，等待窗口结束（登录/管理员登录 15 分钟，注册与 POI 1 小时）。