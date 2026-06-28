import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages: https://<user>.github.io/kotenocr-web/
export default defineConfig({
  base: '/kotenocr-web/',
  worker: { format: 'es' },
  plugins: [
    react(),
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
  ],
})
