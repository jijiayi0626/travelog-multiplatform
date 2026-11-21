import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

const BUILD_ID = Date.now().toString(36)
const BUILT_AT = new Date().toISOString()

/** 生成 dist/version.json，供「关于 → 检查更新」比对线上构建 */
function versionFile(): Plugin {
  return {
    name: 'travelog-version-file',
    apply: 'build',
    closeBundle() {
      mkdirSync('dist', { recursive: true })
      writeFileSync(
        'dist/version.json',
        JSON.stringify({ version: pkg.version, buildId: BUILD_ID, builtAt: BUILT_AT }, null, 2),
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), versionFile()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __BUILD_TIME__: JSON.stringify(BUILT_AT),
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
