import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import pkg from './package.json' with { type: 'json' }

const changelog = readFileSync(resolve(__dirname, '..', 'CHANGELOG.md'), 'utf-8')

const isTauri = !!process.env.TAURI_ENV_PLATFORM

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Always load PWA plugin so virtual:pwa-register resolves in all builds.
    // Service workers are a no-op in Tauri webviews; the hook guards at runtime.
    VitePWA({
      registerType: 'prompt',
      // Disable SW generation for Tauri — no service worker support in webviews
      selfDestroying: isTauri,
      manifest: isTauri ? false : {
        name: 'Drocsid',
        short_name: 'Drocsid',
        description: 'Voice, video, and text chat',
        theme_color: '#7c3aed',
        background_color: '#1a1a2e',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __CHANGELOG__: JSON.stringify(changelog),
  },
  // Tauri expects clearScreen: false so it can manage its own terminal output
  clearScreen: false,
  server: {
    port: 5174,
    // Allow Tauri's webview to connect
    strictPort: true,
  },
})
