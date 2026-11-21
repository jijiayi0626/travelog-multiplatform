# 部署到 Cloudflare（单 Worker）

> 完整逐步说明见 [`server/README.md`](../server/README.md)。本文只保留要点。

前端构建产物和 `/api` 由**同一个 Worker**托管，不再使用 Pages + Worker 分开部署。

## 一、关键配置

`server/wrangler.toml`：

```toml
[assets]
directory = "../dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*"]

[[d1_databases]]
binding = "DB"
database_name = "travelog"
database_id = "REPLACE_WITH_YOUR_DATABASE_ID"

[ai]
binding = "AI"
```

- `/api/*` 先进入 Worker 函数
- 其余路径由静态资源处理，找不到文件回退 `index.html`（适配 `#/...` 路由）
- 不需要单独建 Pages 项目，也不需要配置 `/api` 转发规则
- `npm run build` 会同时生成 `dist/version.json`（版本、构建 ID、构建时间），「我的 → 关于旅记 → 检查更新」靠它判断线上是否有新构建；部署时请连同该文件一起上传

## 二、首次部署

```bash
# 1. 构建前端（仓库根）
npm ci
npm run build

# 2. 创建数据库与照片桶并建表
cd server
npx wrangler d1 create travelog          # 把 database_id 填进 wrangler.toml
npx wrangler r2 bucket create travelog-photos   # wrangler.toml 已绑定 PHOTOS
npx wrangler d1 execute travelog --file=./schema.sql --remote

# 3. 一条命令上线前端 + API
npx wrangler deploy
```

部署后访问 `https://travelog.<你的子域>.workers.dev` 即为完整应用。

## 三、管理面板

地址：`https://<你的域名>/#/admin`；也可在应用内「我的 → 关于旅记」连续点击版本号 7 次开启开发者模式，再从「开发者模式 → 管理面板」进入。

首次部署时可用环境变量引导管理员账号（不要提交真实口令）：

```toml
[vars]
ADMIN_USER = "admin"
ADMIN_TOKEN = "临时口令"
```

首次登录时会把账号写入 D1 的 `settings` 表（口令经 PBKDF2 哈希），**登录后请立即在「站点 → 管理员口令」里修改，然后删除 `ADMIN_TOKEN` 变量重新部署**。已有管理员的库不要再设置这两个变量。

面板能力：

| 分区 | 内容 |
| --- | --- |
| 用户 | 搜索昵称/账号/同步码，会员到期、最近登录 IP / 地区 / 浏览器、云端实体数，赠送/取消会员、停用/启用、重置同步码、删除 |
| 会员码 / 邀请码 | 批量生成会员码（天数、次数、备注）、注册邀请码，查看使用次数、删除 |
| AI 接口 | 开关、**AI 需要会员**开关、OpenAI 兼容 / Workers AI、Key、Base URL、模型、温度、测试连接 |
| 站点 | 站点名称、邀请注册开关、管理员口令 |

**AI 配置保存在 D1 的 `settings` 表，改完立即生效，不需要重新部署，也不再依赖环境变量。**

AI 默认仅会员可用；后台「AI 接口 → AI 需要会员」可以关闭。生成类 AI 会作为后台任务执行（`ai_jobs` 表 + `ctx.waitUntil`），提交后可以离开页面，完成后右上角提醒，也可以在「我的 → AI 任务」查看或删除。

## 四、账号、会员与风控

- **账号密码登录**：PBKDF2-SHA256 存储密码；登录签发多设备令牌，不会互相顶掉。
- **同步码兼容**：老用户仍可用 8 位同步码登录、多设备接入与多人共享；登录后可在「云同步」补设账号密码。
- **注册邀请码**：「站点 → 注册设置」可开关注册必须邀请码；邀请码在「会员码 / 邀请码」生成，支持使用次数。
- **会员码**：用户在「云同步 → 会员」兑换，按天累加；管理面板也可直接赠送/取消。
- **AI 会员限制**：默认开启；非会员调用生成接口返回 403，管理员可在「AI 接口」中关闭限制。
- **云端照片**：照片压缩后上传到 R2（桶绑定 `PHOTOS`），同步只保存带访问密钥的地址；管理面板「照片」分区可浏览所有用户照片。删除用户会一并清理其 R2 文件。
- **定位解析**：打卡定位会通过 Worker 代理的 Nominatim 反查到区县 / 街道，自动填入地点名称和城市；识别不准可点候选、搜索周边地点或手动修改。自动打卡在附近没有已知地点时也优先使用区县 / 街道名称。默认请求 `https://nominatim.openstreetmap.org`，如需自建服务可设置可选变量 `NOMINATIM_BASE`。
- **登录审计**：注册、密码登录、同步码登录、改密、兑换会员都会记录 IP、User-Agent、国家/地区/城市、Cloudflare 机房。
- **限流**：注册、登录、管理员登录、会员码兑换、POI 搜索、逆地理编码均有 D1 固定窗口限流，超限返回 429。

## 五、升级已有部署

```bash
git pull
npm ci && npm run build
cd server
npx wrangler r2 bucket create travelog-photos   # 首次升级时执行；已存在可忽略
npx wrangler d1 execute travelog --file=./schema.sql --remote   # 幂等
npx wrangler deploy
```

本次升级新增表：`user_credentials`、`user_tokens`、`membership_codes`、`user_membership`、`invite_codes`、`user_activity`、`rate_limits`、`photos`、`ai_jobs`。
老表结构不变，老用户数据不受影响；老设备令牌会在下次登录时自动迁入 `user_tokens`。

## 六、本地调试

```bash
npm run build
cd server
npx wrangler dev      # 默认 http://127.0.0.1:8787，同时提供前端与 API
npx wrangler d1 execute travelog --file=./schema.sql --local
```

前端「我的 → 云同步 → 服务器」填 `http://127.0.0.1:8787`；同域部署时留空即可。