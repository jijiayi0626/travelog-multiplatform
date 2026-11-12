# 同步与账号接口契约

本文件描述 **当前实际实现** 的客户端与后端契约，代码位置：

- 客户端：`src/lib/repo.ts`（IndexedDB 本地仓库）、`src/lib/cloud.ts`（鉴权与 HTTP）、`src/lib/sync-engine.ts`（推送/拉取）
- 服务端：`server/src/index.js`（Cloudflare Worker + D1）

## 1. 设计原则

1. **本地优先**：读写先落 IndexedDB，网络失败不影响使用。
2. **增量同步**：服务端按 `updated_at` 游标分页拉取，客户端推送全部待同步实体。
3. **软冲突策略**：同一实体以 `updatedAt` 较新者为准（LWW），以逻辑删除墓碑避免“删了又被拉回”。
4. **账号昵称**：本地 `profile` 实体参与同步；同时服务端 `users.nickname` 通过 `/api/account` 维护，用于旅伴、共享行程的展示名。

## 2. 实体

本地对象仓库与远端 `entities` 表一一对应，`kind` 取值见 `SYNC_KINDS`：

```ts
'trips' | 'moments' | 'expenses' | 'checklist' | 'footprints' | 'members' | 'plans' | 'profile'
```

同步载荷统一为：

```jsonc
{
  "kind": "trips",
  "id": "uuid",
  "data": { /* 实体本身，时间均为毫秒时间戳 */ },
  "updatedAt": 1760000000000,
  "deleted": false
}
```

客户端实体字段（摘要）：

```jsonc
// Trip
{ "id": "uuid", "title": "北海道夏日之旅", "destination": "日本 · 北海道",
  "startDate": 0, "endDate": 0, "note": "", "cover": "", "coverImage": "",
  "budget": 0, "createdAt": 0, "updatedAt": 0 }

// TripMember
{ "id": "uuid", "tripId": "uuid", "userId": "uuid", "name": "小陈",
  "role": "owner|member", "joinedAt": 0, "contact": "", "note": "" }

// Moment
{ "id": "uuid", "tripId": "uuid", "dayIndex": 2, "content": "函馆山的夜景",
  "locationName": "函馆山", "latitude": 41.7597, "longitude": 140.7288,
  "createdAt": 0, "updatedAt": 0, "media": [] }

// Expense / ChecklistItem / Footprint / Plan / Profile
// 分别见 src/lib/types.ts 中 Expense、ChecklistItem、Footprint、Plan、Profile
{ "id": "local-user", "nickname": "我", "avatar": "", "createdAt": 0 }
```

## 3. 鉴权

- `POST /api/auth/register` `{ "nickname": "旅人" }` → `{ "userId", "syncCode", "token", "nickname" }`
- `POST /api/auth/login` `{ "syncCode": "ABCD2345" }` → `{ "userId", "token", "syncCode", "nickname" }`（登录会轮换 token）
- 其余用户接口携带 `Authorization: Bearer <token>`。
- 客户端保存位置：`localStorage` 的 `travelog.cloud`（`src/lib/cloud.ts`）。本应用为纯前端 + WebView，无系统安全存储；请勿把同步码/口令写进代码。

## 4. 接口

### 4.1 账号昵称

```
PATCH /api/account
{ "nickname": "新昵称" }          // 1–24 个字符
200 { "userId": "uuid", "nickname": "新昵称" }
```

- 需要登录；只修改当前账号的 `users.nickname`。
- 旅伴列表、共享行程的 `owner` 展示名会立即生效。
- 客户端封装：`updateAccountNickname()`（`src/lib/cloud.ts`）。

### 4.2 拉取

```
GET /api/sync/pull?cursor=<updatedAt>&limit=500
200 {
  "cursor": 1760000000000,
  "entities": [ { "kind", "id", "data", "updatedAt", "deleted" } ],
  "hasMore": false
}
```

- 首次 `cursor=0`；之后带上次返回的 `cursor`。
- 返回自己 + 已加入共享旅程（`trip_shares`）的实体；删除记录 `data = null`。

### 4.3 推送

```
POST /api/sync/push
{ "entities": [ { "kind", "id", "data", "updatedAt" } ] }
200 { "applied": 12, "skipped": 1, "cursor": 0 }
```

- 单次最多 500 条，客户端按 150 条分批（`src/lib/sync-engine.ts`）。
- 服务端按 `updatedAt` 做 LWW；已加入共享旅程的写入会重定向到 owner 的实体空间。
- 客户端 `profile` 实体参与同步，昵称与头像随账号到其他设备。

### 4.4 换机恢复

- 客户端 `pullOverwrite()`：分页拉取全部实体，**以云端为准覆盖本机**，云端为空时保留本地。
- 入口在「云同步」页：`从云端恢复本机数据`（两步确认）。

### 4.5 共享

```
POST   /api/trips/join                   { "inviteCode": "HK2026" }
GET    /api/trips/shares
DELETE /api/trips/shares/{tripId}
```

### 4.6 其他

```
GET  /api/health
POST /api/ai/complete      { "prompt", "system", "temperature" }
GET  /api/weather?lat=&lon=&days=
GET  /api/geocode?q=
GET  /api/poi?q=&lat=&lon=
```

## 5. 同步流程

1. 写操作落 IndexedDB，并记为待同步（`putOne`）。
2. `scheduleAutoSync()` 在写操作后 800ms 触发 `runSync()`（需登录且开启自动同步）。
3. `runSync()`：全量分批推送 → 从当前 cursor 起分页拉取 → 应用远端实体。
4. 登录/注册成功后，客户端把账号昵称写回本地 `profile`，保持本地与云端一致。

## 6. 错误格式

非 2xx 返回 `{ "error": "人类可读信息" }`。客户端 `api()` 会转成 `ApiError`（含 HTTP 状态码）：

| HTTP | 含义 |
| --- | --- |
| 401 | token 缺失或失效 |
| 403 | 账号停用或无权限 |
| 404 | 资源不存在 |
| 413 | 单次推送超过 500 条 |
| 5xx | 服务器错误，可重试 |
