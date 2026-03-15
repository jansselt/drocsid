import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import pkg from './package.json' with { type: 'json' }

const changelog = readFileSync(resolve(__dirname, '..', 'CHANGELOG.md'), 'utf-8')

const isElectron = !!process.env.ELECTRON

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Always load PWA plugin so virtual:pwa-register resolves in all builds.
    // Service workers are disabled in Electron (no SW support in desktop).
    VitePWA({
      registerType: 'prompt',
      selfDestroying: isElectron,
      strategies: isElectron ? undefined : 'injectManifest',
      srcDir: isElectron ? undefined : 'src',
      filename: isElectron ? undefined : 'sw.ts',
      manifest: isElectron ? false : {
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
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: ['admin/**'],
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __CHANGELOG__: JSON.stringify(changelog),
  },
  server: {
    port: 5174,
    strictPort: true,
  },
})
