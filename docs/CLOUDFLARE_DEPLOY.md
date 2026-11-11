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

## 二、首次部署

```bash
# 1. 构建前端（仓库根）
npm ci
npm run build

# 2. 创建数据库并建表
cd server
npx wrangler d1 create travelog          # 把 database_id 填进 wrangler.toml
npx wrangler d1 execute travelog --file=./schema.sql --remote

# 3. 一条命令上线前端 + API
npx wrangler deploy
```

部署后访问 `https://travelog.<你的子域>.workers.dev` 即为完整应用。

## 三、管理面板

地址：`https://<你的域名>/#/admin`，或应用内「我的 → 管理面板」。

首次登录使用 `wrangler.toml` 中的引导账号：

```toml
[vars]
ADMIN_USER = "admin"
ADMIN_TOKEN = "change-me-now"
```

首次登录时会把账号写入 D1 的 `settings` 表（口令经 PBKDF2 哈希），**登录后请立即在「站点 → 管理员口令」里修改，然后删除 `ADMIN_TOKEN` 变量重新部署**。

面板能力：

| 分区 | 内容 |
| --- | --- |
| 用户 | 搜索昵称/同步码、注册时间、最近活跃、云端实体数、停用/启用、重置同步码、删除 |
| AI 接口 | 开关、OpenAI 兼容 / Workers AI、Key、Base URL、模型、温度、测试连接 |
| 站点 | 站点名称、管理员口令 |

**AI 配置保存在 D1 的 `settings` 表，改完立即生效，不需要重新部署，也不再依赖环境变量。**

## 四、升级已有部署

```bash
git pull
npm ci && npm run build
cd server
npx wrangler d1 execute travelog --file=./schema.sql --remote   # 幂等
npx wrangler deploy
```

## 五、本地调试

```bash
npm run build
cd server
npx wrangler dev      # 默认 http://127.0.0.1:8787，同时提供前端与 API
npx wrangler d1 execute travelog --file=./schema.sql --local
```

前端「我的 → 云同步 → 服务器」填 `http://127.0.0.1:8787`；同域部署时留空即可。