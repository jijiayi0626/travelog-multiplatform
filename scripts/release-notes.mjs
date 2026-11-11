/**
 * 从 CHANGELOG.md 提取指定版本的说明，生成 release-notes.md。
 * 用法：node scripts/release-notes.mjs 1.5.0
 */
import fs from 'node:fs'

const version = (process.argv[2] || '').replace(/^v/, '').trim()
if (!version) {
  console.error('usage: node scripts/release-notes.mjs <version>')
  process.exit(1)
}

let body = ''
try {
  const lines = fs.readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/)
  const start = lines.findIndex((line) => /^##\s+\[?v?/.test(line) && line.includes(version))
  if (start >= 0) {
    const rest = lines.slice(start + 1)
    const end = rest.findIndex((line) => /^##\s+/.test(line))
    body = (end >= 0 ? rest.slice(0, end) : rest).join('\n').trim()
  }
} catch {
  /* 没有 CHANGELOG 时走兜底 */
}

if (!body) {
  body = `v${version} 构建。完整变更见提交历史。`
}

const footer = `
---

### 安装

- \`travelog-${version}-debug.apk\`：可直接安装调试
- \`travelog-${version}-release.apk\`：CI 临时签名，正式发布请换成自己的 keystore

应用为 WebView + Java 实现，**不含 native 库**，单个 APK 兼容 \`arm64-v8a\` / \`armeabi-v7a\` / \`x86_64\`。

包名 \`com.travellog.app\`，minSdk 23 / targetSdk 35。`

fs.writeFileSync('release-notes.md', `${body}\n${footer}\n`)
console.log(`release-notes.md written for v${version} (${body.length} chars)`)