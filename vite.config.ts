import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { viteSingleFile } from 'vite-plugin-singlefile'

// 3つのビルドモード（env で切替）:
//   既定          : GitHub Pages 用（base=/kotenocr-web/、PWA あり）
//   TAURI=1       : Tauri デスクトップ用（base 相対、PWA なし）        → npm run build:app
//   OFFLINE_HTML=1: オフラインHTML(no-exe, file:// 直開き)用            → npm run build:html
//     - 単一HTMLに JS/CSS/wasm を内包（vite-plugin-singlefile）
//     - Worker は inline(blob) classic（@spawn → spawn.offline）
//     - モデル/charset は別途 base64 で埋め込む（pack-offline.mjs）
const isTauri = !!process.env.TAURI
const isOffline = !!process.env.OFFLINE_HTML

const spawnImpl = isOffline ? './src/ocr/spawn.offline.ts' : './src/ocr/spawn.ts'

// オフライン/Tauri 成果物からは外部URL(OGP/Twitterカード/canonical)を除去する。
// 実通信は起きないが、エアギャップ監査では成果物の <head> に生きたインターネットURLが
// 残っていること自体がレッドフラグ＝「外部参照ゼロ」を主張できなくなるため。GitHub Pages版だけ残す。
function stripExternalMetaPlugin() {
  return {
    name: 'strip-external-meta',
    transformIndexHtml(html: string) {
      return html
        .replace(/\s*<meta\s+property="og:[^"]*"[^>]*>/g, '')
        .replace(/\s*<meta\s+name="twitter:[^"]*"[^>]*>/g, '')
        .replace(/\s*<!--[^>]*Open Graph[^>]*-->/g, '')
    },
  }
}

export default defineConfig({
  base: isTauri || isOffline ? './' : '/kotenocr-web/',
  worker: { format: isOffline ? 'iife' : 'es' },
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  resolve: {
    alias: { '@spawn': fileURLToPath(new URL(spawnImpl, import.meta.url)) },
  },
  build: isOffline
    ? {
        outDir: 'dist-html',
        // wasm はインライン化せず別ファイルのまま保持（spawn.offline が wasmBinary で供給）。
        // HTML を巨大化させないため assetsInlineLimit=0。JS/CSS は singlefile が index.html に内包。
        assetsInlineLimit: 0,
        cssCodeSplit: false,
        chunkSizeWarningLimit: 100000,
        rollupOptions: { output: { inlineDynamicImports: true } },
      }
    : isTauri
      ? { outDir: 'dist-app' } // Pages用 dist/ と物理分離（stale な非PWA dist を誤公開する事故を防ぐ）
      : {},
  plugins: [
    react(),
    ...(isTauri || isOffline ? [stripExternalMetaPlugin()] : []),
    ...(isOffline ? [viteSingleFile({ useRecommendedBuildConfig: false, removeViteModuleLoader: true })] : []),
    ...(isTauri || isOffline
      ? []
      : [
          VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['icon.svg'],
            manifest: {
              name: 'セキュアOCR (ブラウザ完結)',
              short_name: 'セキュアOCR',
              description: 'ブラウザ内で完結する日本語OCR。インストール不要・画像はPC外に出ません。',
              lang: 'ja',
              theme_color: '#f1f3f4',
              background_color: '#ffffff',
              display: 'standalone',
              start_url: '.',
              scope: '.',
              icons: [
                { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
              ],
            },
            workbox: {
              // アプリシェルはプリキャッシュ。巨大なモデル/wasmはランタイムキャッシュへ。
              globPatterns: ['**/*.{js,css,html,svg,mjs}'],
              maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
              runtimeCaching: [
                {
                  urlPattern: /(\.onnx$|\.wasm$|charset\.json$)/,
                  handler: 'CacheFirst',
                  options: {
                    cacheName: 'ocr-models',
                    expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 90 },
                    cacheableResponse: { statuses: [0, 200] },
                  },
                },
              ],
            },
          }),
        ]),
  ],
})
