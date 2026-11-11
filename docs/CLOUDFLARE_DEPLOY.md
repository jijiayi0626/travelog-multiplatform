# 部署到 Cloudflare

前端静态站（Pages）+ 后端 Worker（D1 存实体、Workers AI 提供模型）。全部在一个 `wrangler` 账号下完成，免费额度足够个人使用。

## 0. 准备

```bash
npm i -g wrangler          # 或 npx wrangler
wrangler login
```

## 1. 创建 D1 数据库

```bash
cd server
wrangler d1 create travelog
```

把输出里的 `database_id` 填进 `server/wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "travelog"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

建表：

```bash
wrangler d1 execute travelog --file=./schema.sql --remote
```

## 2. 部署 API

```bash
cd server
wrangler deploy
```

部署后会得到一个地址，形如：

```
https://travelog-api.<your-subdomain>.workers.dev
```

自检：

```bash
curl https://travelog-api.<your-subdomain>.workers.dev/api/health
# {"ok":true,"ai":true,"time":...}
```

`ai:false` 表示没配置模型，见第 4 节。

## 3. 部署前端（Pages）

```bash
cd ..
npm run build
npx wrangler pages deploy dist --project-name travelog
```

首次会要求创建项目，选择默认设置即可。

### 让前端直接调用同域 `/api`

有两种做法，任选一种：

**A. Pages 自定义域名 + Worker 路由（推荐）**

在 Cloudflare 控制台 → Workers → travelog-api → Triggers → Add route：

```
travelog.example.com/api/*
```

这样 `https://travelog.example.com/api/*` 会交给 Worker，前端 `baseUrl` 留空即可。

**B. 前端填 Worker 地址**

在「我的 → 云同步 → 服务器」里填入 `https://travelog-api.<your-subdomain>.workers.dev`，点「测试连接」。

同时把 Worker 的 `CORS_ORIGIN` 改成你的 Pages 域名：

```bash
wrangler deploy --var CORS_ORIGIN:https://travelog.example.com
```

## 4. 配置 AI

**方式 A：Workers AI（无需外部密钥，推荐）**

`server/wrangler.toml` 已包含：

```toml
[ai]
binding = "AI"
```

默认模型 `@cf/meta/llama-3.1-8b-instruct`。换模型：

```bash
wrangler deploy --var AI_MODEL:@cf/qwen/qwen1.5-14b-chat
```

**方式 B：OpenAI 兼容接口**

```bash
wrangler secret put OPENAI_API_KEY
wrangler secret put OPENAI_BASE_URL    # 可选，默认 https://api.openai.com/v1
wrangler secret put OPENAI_MODEL       # 可选，默认 gpt-4o-mini
```

配置了 OpenAI 后优先走 OpenAI，忽略 Workers AI。

## 5. 验证

1. 打开站点 → 我的 → 云同步 → 测试连接，应显示「服务正常 · AI 可用」
2. 创建账号，记下 8 位同步码
3. 另一台设备用同步码登录，点「立即同步」，两边数据应一致
4. 新建一条日程，点「AI 生成」应返回逐日安排

## 6. 数据与安全

- 同步按 `updatedAt` 做 LWW（较新者胜），删除会写墓碑一起推送
- 令牌存在设备 `localStorage`，重新登录会轮换令牌，旧设备需要重新登录
- D1 只存 JSON 实体，不存图片；照片目前仅存本机
- 建议给 Worker 加 Cloudflare Access 或 IP 规则，避免同步码被枚举

## 7. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `AI 未配置` | 没绑定 Workers AI 也没设密钥 | 见第 4 节 |
| `同步码不存在` | 输错或账号在另一个环境 | 重新创建账号 |
| `无法连接服务器` | baseUrl 写错或 CORS 拦截 | 检查地址、`CORS_ORIGIN` |
| `401 访问令牌无效` | 在别处重新登录导致令牌轮换 | 用同步码重新登录 |
| 天气不显示 | 坐标缺失 | 先给足迹或旅程补坐标 |