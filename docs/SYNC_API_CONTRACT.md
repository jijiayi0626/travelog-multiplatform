# 同步与账号接口契约

本文件定义客户端与后端之间的最小契约。客户端已按此契约抽象出 `ITravelRepository` 与 `ISyncService`，后端实现后只需替换注入点，页面代码零改动。

## 1. 设计原则

1. **本地优先**：所有读写先落本地 SQLite，网络失败不影响使用。
2. **增量同步**：以服务端游标（cursor）拉取变更，以 `updated_at` 做本地增量推送。
3. **软冲突策略**：同一实体以 `updated_at` 较新者为准（LWW）；删除用墓碑记录，避免"删了又被拉回"。
4. **媒体单独通道**：图片先上传对象存储拿到 URL，再随实体同步。

## 2. 实体与字段

客户端本地表与远端 JSON 字段一一对应（时间均为毫秒时间戳，`sync_state` 仅客户端使用）。

```jsonc
// Trip
{
  "id": "uuid",
  "title": "北海道夏日之旅",
  "destination": "日本 · 北海道",
  "startDate": 1760000000000,
  "endDate": 1760432000000,
  "note": "从札幌到函馆",
  "coverUri": "",
  "ownerId": "user-uuid",
  "inviteCode": "HK2026",
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000,
  "syncState": 0
}

// TripMember
{ "id": "uuid", "tripId": "uuid", "userId": "uuid", "name": "小陈", "role": "owner|member", "joinedAt": 0 }

// Moment
{
  "id": "uuid", "tripId": "uuid", "dayIndex": 2,
  "content": "函馆山的夜景",
  "locationName": "函馆山", "latitude": 41.7597, "longitude": 140.7288,
  "createdAt": 0, "updatedAt": 0, "syncState": 1,
  "media": [ { "id": "uuid", "uri": "https://cdn/…/a.jpg", "mediaType": "image", "sortIndex": 0 } ]
}

// Expense
{ "id": "uuid", "tripId": "uuid", "amount": 4200, "category": "food|transport|stay|ticket|shopping|other", "note": "海鲜烧烤", "spentAt": 0, "createdAt": 0, "syncState": 1 }

// ChecklistItem
{ "id": "uuid", "tripId": "uuid", "title": "护照", "done": false, "createdAt": 0 }

// Footprint
{ "id": "uuid", "tripId": "uuid", "placeName": "小樽运河", "city": "小樽", "latitude": 0, "longitude": 0, "note": "", "visitedAt": 0, "createdAt": 0 }

// UserProfile（账号）
{ "id": "uuid", "nickname": "我", "avatarUri": "", "createdAt": 0 }
```

## 3. 鉴权

- `POST /v1/auth/login` → `{ "token": "<JWT>", "user": { "id", "nickname" } }`
- 其余接口携带 `Authorization: Bearer <token>`。
- 客户端落地位置：`UserSession.accountType = 'cloud'`，token 存入安全存储（`preferences` 加密或系统 key store），**不要**写进代码或明文文件。

## 4. 接口

### 4.1 拉取

```
GET /v1/sync/pull?cursor=<cursor>&userId=<uid>&tripId=<可选>
200 {
  "cursor": "<next-cursor>",
  "trips": [...],
  "members": [...],
  "moments": [...],
  "expenses": [...],
  "checklist": [...],
  "footprints": [...],
  "deleted": [ { "entity": "moment", "id": "uuid", "updatedAt": 0 } ]
}
```

- 首次全量 `cursor=""`；之后带上次 `cursor`。
- 返回数据的 `updatedAt` 与服务端一致，客户端按 LWW 合并。

### 4.2 推送

```
POST /v1/sync/push
{ "cursor": "<last-cursor>", "changes": { "trips": [...], "moments": [...], ... } }
200 { "cursor": "<next-cursor>", "applied": { "trips": ["id"], ... }, "rejected": [ { "entity": "trip", "id": "uuid", "reason": "forbidden|conflict" } ] }
```

- 客户端只推送 `syncState = 1` 的记录，成功后置 0。
- 冲突时服务端返回 `rejected`，客户端下次 pull 覆盖本地。

### 4.3 媒体

```
POST /v1/media            // multipart/form-data
200 { "url": "https://cdn/…/a.jpg" }
```

- 客户端在推送 Moment 前，先把沙箱图片上传换 URL，再写回 `media[].uri`。

### 4.4 共享

```
POST /v1/trips/{tripId}/members   { "inviteCode": "HK2026" }  // 或 { "name": "小陈" }
GET  /v1/trips/{tripId}/members
DELETE /v1/trips/{tripId}/members/{memberId}
```

- 权限：`owner` 可增删成员；`member` 仅可读写内容。

## 5. 客户端接入步骤

1. 新建 `RemoteTravelRepository implements ITravelRepository`，内部调用上述接口并落本地缓存。
2. 新建 `RemoteSyncService implements ISyncService`，实现 `configured = true` 与 `syncNow()`。
3. 在 `EntryAbility.onCreate` 或应用启动流程中：
   ```ts
   RepositoryProvider.use(new RemoteTravelRepository());
   SyncProvider.use(new RemoteSyncService());
   ```
4. 登录成功后写入 `UserSession`（`AppStorageV2` 键 `UserSession`），并触发一次全量 pull。

## 6. 本地字段与同步状态

- `sync_state = 0`：已同步；`1`：待同步（本地有改动）。
- 任何写操作（保存旅行/记录/账目/清单/足迹/成员）都会把对应记录置为 `1`。
- `AppStats.pendingSyncCount` 即三类实体的待同步计数，用于「云同步」页展示。

## 7. 错误码约定

| HTTP | code | 含义 |
| --- | --- | --- |
| 401 | `unauthorized` | token 缺失或过期，客户端重新登录 |
| 403 | `forbidden` | 无该旅行权限 |
| 404 | `not_found` | 实体不存在（服务端已删除） |
| 409 | `conflict` | 版本冲突，交由下次 pull 收敛 |
| 5xx | `server_error` | 可重试，客户端指数退避 |