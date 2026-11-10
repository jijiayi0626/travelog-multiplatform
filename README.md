# 旅记 Travelog · Web / Android / iOS

一套 TypeScript + React 代码，同时运行在浏览器、可安装 PWA、Android（Capacitor）与 iOS（Capacitor）。功能与 HarmonyOS 版「旅记」一致，UI 按移动端与桌面端重新设计。

## 功能

| 模块 | 能力 |
| --- | --- |
| 行程 | 旅行列表、封面、状态（计划中 / 进行中 / 已结束）、新建与编辑、日期区间与天数 |
| 时间线 | 按天归组的图文记录，文字 + 最多 9 张照片（本地压缩后保存） |
| 足迹 | 地点打卡、浏览器定位、城市统计、点击跳转地图查看坐标、删除 |
| 账本 | 金额 / 分类 / 备注 / 日期，总额与分类占比，旅行内与全局两种视图 |
| 清单 | 行前待办，勾选、进度、增删 |
| 旅伴 | 成员列表、添加与移除、邀请码复制 |
| 我的 | 本地账号昵称、数据统计、深色模式、同步状态、恢复示例数据 |
| 云同步 | 本地优先；提供接口契约与替换注入点，后端接入后即可多端同步 |

## 技术栈

- **构建**：Vite 8 + TypeScript 7
- **UI**：React 19、Tailwind CSS v4（自定义设计令牌）、Phosphor Icons
- **状态**：React Hooks + Context（刷新信号 / Toast / 导航）
- **存储**：IndexedDB（8 个 object store），无后端依赖
- **原生容器**：Capacitor 7（Android 工程已生成）
- **PWA**：manifest + service worker，离线打开壳层

## 目录

```
src/
├── App.tsx                 # hash 路由 + 全局上下文
├── index.css               # 设计令牌、暗色覆盖、组件类、动效
├── components/             # 壳层、卡片、基础 UI、编辑页框架
├── pages/                  # 行程 / 详情 / 足迹 / 账本 / 我的 / 编辑页
└── lib/
    ├── types.ts            # 领域模型（与 HarmonyOS 版字段一致）
    ├── db.ts               # IndexedDB 封装
    ├── repo.ts             # 领域数据操作
    ├── seed.ts             # 首次启动示例数据
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