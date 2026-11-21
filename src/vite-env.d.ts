/// <reference types="vite/client" />

/** 由 vite.config.ts 的 define 注入，来源是 package.json 的 version */
declare const __APP_VERSION__: string

/** 本次构建的唯一标识，用于「关于 → 检查更新」 */
declare const __BUILD_ID__: string

/** 本次构建时间（ISO 字符串） */
declare const __BUILD_TIME__: string