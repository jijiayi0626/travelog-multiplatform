# 旅记 Travelog · Web / Android / iOS

一套 TypeScript + React 代码，同时运行在浏览器、可安装 PWA、Android（Capacitor）与 iOS（Capacitor）。功能与 HarmonyOS 版「旅记」一致，UI 按移动端与桌面端重新设计。

## 功能

| 模块 | 能力 |
| --- | --- |
| 行程 | 旅行列表、**列表 / 日历双视图**、封面、状态（计划中 / 进行中 / 已结束）、筛选与排序、模板新建、日期区间与天数、预算与多币种 |
| 日程 | 按天排程：时间、类型（交通 / 游玩 / 用餐 / 住宿 / 购物）、地点、备注；勾选完成、上下移动、每日密度条、下一步提示、4 套模板 |
| 回忆 | 首页「往年今日」横滑卡片，不足时用最近 30 天记录补齐 |
| 时间线 | 按天归组的图文记录，文字 + 最多 9 张照片（本地压缩后保存）、标签、灯箱翻页 |
| 相册 | 跨旅程照片聚合，按旅程 / 按时间分组，灯箱左右翻页与单张下载 |
| 足迹 | 地点打卡、浏览器定位、城市统计、星图可视化、**中国地图三层下钻**（全国 → 省 → 市 → 区县，右下角含南海诸岛小图）、**照片 EXIF 自动定位**、**自动打卡**（进入半径内自动补足迹）、点击跳转地图查看坐标、删除 |
| 云同步 | 同步码注册 / 登录、游标增量拉取、LWW 冲突合并、墓碑删除、写操作后自动同步 |
| 部署 | **前后端同一个 Cloudflare Worker**：`[assets]` 托管 `dist`，`/api/*` 走 Worker，一条 `wrangler deploy` 同时上线前端与接口（见 [`server/README.md`](server/README.md)） |
| 管理面板 | `#/admin`：用户管理（停用/启用、重置同步码、删除）、**AI 接口在线配置**（存 D1，改完即时生效）、站点名称与管理员口令 |
| AI | 游记润色、按目的地生成逐日行程、记账自动分类；走服务端代理，支持 Workers AI 或 OpenAI |
| 提醒 | 日程开始前 5 / 15 / 30 / 60 分钟本地通知（Capacitor Local Notifications，Web 降级） |
| 多语言 | 中文 / English 一键切换，覆盖导航、页面、空态、表单与提示 |
| 账本 | 金额 / 分类 / 备注 / 日期 / 币种，分类占比环形图、近 6 个月柱状图、CSV 导出、**「再来一笔」快捷填充** |
| 清单 | 行前待办、勾选与进度、5 套模板 |
| 旅伴 | 成员列表、添加与移除、邀请码复制 |
| 我的 | 昵称、年度统计、日程完成度、深色模式、5 套主题色、JSON 备份导入导出 |
| 年度回顾 | 按年份汇总：旅行天数、城市、照片、全年花费柱状图、分类占比、最长旅程 |
| 导出 | 单个旅程导出 Markdown（日程 / 记录 / 账本 / 清单）、账本导出 CSV、全量备份 JSON |
| 全局 | `⌘K` / `/` 搜索、`?` 快捷键面板、`N` 新建旅程、离线提示、PWA 安装 |
| 云同步 | 本地优先；提供接口契约与替换注入点，后端接入后即可多端同步 |

## 省份地图说明

足迹页的「中国」视图使用**本地内置**的省级矢量边界，运行时**不请求任何外部地图服务**：

- 边界数据经 Albers 等积圆锥投影（φ1=25°、φ2=47°、λ0=105°）简化后打包为 `src/lib/chinaGeo.ts`（34 个省级行政区，约 6.5k 个坐标点、77 KB）
- 省份归属优先用坐标做点在多边形内判定，没有坐标时用城市名兜底（`src/lib/province.ts`）
- 未收录的境外坐标会单独提示，不计入中国地图
- 由于是简化边界，极少数紧贴省界的地点可能归错省份，可在足迹编辑里补上城市名纠正

## 技术栈

- **构建**：Vite 8 + TypeScript 7
- **UI**：React 19、Tailwind CSS v4（自定义设计令牌）、Phosphor Icons
- **状态**：React Hooks + Context（刷新信号 / Toast / 导航）
- **存储**：IndexedDB（9 个 object store，含 `plans`），无后端依赖
- **原生容器**：Capacitor 7（Android 工程已生成）
- **PWA**：manifest + service worker，离线打开壳层

## 目录

```
src/
├── App.tsx                 # hash 路由 + 全局上下文（Toast / 导航 / 搜索 / 快捷键）
├── index.css               # 设计令牌、暗色与主题色覆盖、组件类、动效
├── components/
│   ├── AppShell.tsx        # 桌面侧栏 + 移动端 5 项底部导航
│   ├── cards.tsx           # 旅行卡、记录卡、账目行、清单行、足迹行
│   ├── charts.tsx          # 环形图、月度柱状图、预算条、每日密度条
│   ├── ui.tsx              # 基础组件（Sheet / Dialog / Tabs / Field…）
│   ├── SearchPalette.tsx   # ⌘K 全局搜索
│   ├── ShortcutsSheet.tsx  # 快捷键面板
│   ├── Lightbox.tsx        # 图片灯箱（翻页 / 滑动 / 下载）
│   ├── WorldMap.tsx        # 足迹星图
│   ├── ChinaMap.tsx        # 中国省份足迹地图
│   ├── EmptyArt.tsx        # 空态插画
│   └── InstallBanner.tsx   # PWA 安装提示
├── pages/                  # 行程 / 详情（日程·时间线·账本·清单·旅伴）/ 相册 / 足迹 / 账本 / 我的 / 各编辑器
└── lib/
    ├── types.ts            # 领域模型（与 HarmonyOS 版字段一致）
    ├── db.ts               # IndexedDB 封装
    ├── repo.ts             # 领域数据操作、搜索、备份、模板
    ├── seed.ts             # 首次启动示例数据
    ├── chinaGeo.ts         # 内置中国省级矢量边界 + 投影函数
    ├── province.ts         # 坐标 → 省份判定、城市兜底、足迹聚合
    ├── theme.ts / hooks.ts / utils.ts
android/                    # Capacitor 生成的 Android 工程（可直接用 Android Studio 打开）
public/                     # 图标、manifest、service worker、示例插画
docs/                       # 同步接口契约
```

## 开发

要求 **Node.js 20.19+ 或 22.12+**。

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 产物输出到 dist/
npm run preview    # 本地预览生产构建
```

## 部署 Web / PWA

`npm run build` 后把 `dist/` 丢到任意静态托管即可（Nginx、OBS、Vercel、GitHub Pages）。

- 构建使用相对路径（`base: './'`），可以部署在子目录。
- PWA 安装与 Service Worker 需要 **HTTPS**（localhost 除外）。首次访问后刷新一次即可离线打开。
- 图标与 manifest 位于 `public/`，已生成 192 / 512 / 180 三种尺寸。

## 下载 APK

由 GitHub Actions（`ubuntu-latest` / x86_64）自动构建，产物见 [Releases · v1.8.1](https://github.com/jijiayi0626/travelog-multiplatform/releases/tag/v1.8.1)：

- [Debug APK](https://github.com/jijiayi0626/travelog-multiplatform/releases/download/v1.8.1/travelog-1.8.1-debug.apk)（约 4 MB，可直接安装）
- [Release APK](https://github.com/jijiayi0626/travelog-multiplatform/releases/download/v1.8.1/travelog-1.8.1-release.apk)（约 3 MB，CI 临时签名，正式发布请换成自有 keystore）

包名 `com.travellog.app`，minSdk 23 / targetSdk 35，versionCode 24 / versionName 1.8.1。应用为 WebView + Java 实现，**不含 native 库**，单个 APK 兼容 `arm64-v8a` / `armeabi-v7a` / `x86_64`。

### 自动构建

`.github/workflows/android-apk.yml`：

| 触发 | 产物 |
| --- | --- |
| push 到 `main` | Debug APK artifact |
| 手动触发 workflow | 额外构建 Release APK |
| 推送 `v*` tag | 构建并自动发布 GitHub Release |

> 本机若为 ARM64（Apple Silicon、鲲鹏等），Android SDK 的 `aapt2` / `zipalign` 只有 x86_64 二进制，需在 x86_64 runner 或支持转译的环境构建。

## 打包 Android

工程已包含 `android/`（Capacitor 7，compileSdk 35，minSdk 23）。

前置：Android Studio（含 JDK 17）与 Android SDK 35。

```bash
# 1. 改完 Web 代码后，重新构建并同步到原生工程
npx cap sync android

# 2. 用 Android Studio 打开，Run 到设备/模拟器
npx cap open android

# 或者在已连接设备时直接运行
npx cap run android
```

如需 APK：

- 调试包：Android Studio → Build → Build APK(s)
- 正式包：Build → Generate Signed Bundle / APK，自行创建 keystore 并妥善保存。

已做好的原生适配：

- 应用名「旅记」、包名 `com.travellog.app`
- 自适应图标（背景 `#0F766E` + 白色定位针）
- Android 物理返回键优先走页面历史，栈底才退出
- edge-to-edge 安全区（`adjustMarginsForEdgeToEdge: auto`）
- `INTERNET` 权限（为后续接入同步）

## 打包 iOS

需要 macOS + Xcode：

```bash
npm run ios:add
npm run ios:open
```

在 Xcode 中配置 Team 与 Bundle Identifier 后运行或归档。

## 多端数据与同步

- 目前所有数据保存在设备本地（IndexedDB），**不会自动跨设备**。
- 数据模型与 HarmonyOS 版字段一致（`Trip / Moment / Expense / ChecklistItem / Footprint / Member / Profile`），方便共用一套后端。
- 同步契约见 [docs/SYNC_API_CONTRACT.md](docs/SYNC_API_CONTRACT.md)。接入时实现远程 Repository 与 SyncService，并替换 `src/lib/repo.ts` 的调用即可，页面无需改动。

## 设计说明

- 单一强调色（墨绿 `#0F766E`）+ 暖白纸感底色，暗色模式跟随系统，可手动切换。
- 桌面：左侧导航 + 最大 1180px 内容区；移动：底部 Tab + 安全区适配。
- 动效只使用 `transform` / `opacity`；图片懒加载；列表入场有节制的 stagger。
- 所有图标使用 Phosphor SVG，不使用 emoji。

## 已知边界

- 地图：打卡保存坐标，点击后在系统浏览器打开 OpenStreetMap；如需应用内嵌地图，可接 Map Kit、Google Maps 或 Leaflet。
- 相册：使用 `<input type="file">`，照片在本地压缩为 JPEG 后存储（单张约 100–300 KB）；Capacitor 可后续替换为原生相机插件。
- 定位：使用浏览器 Geolocation，需要 HTTPS 与用户授权；失败时可手动填写地点。