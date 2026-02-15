import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const isTauri = !!process.env.TAURI_ENV_PLATFORM

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Only enable PWA for web builds, not Tauri desktop
    ...(!isTauri
      ? [
          VitePWA({
            registerType: 'autoUpdate',
            manifest: {
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
        ]
      : []),
  ],
  // Tauri expects clearScreen: false so it can manage its own terminal output
  clearScreen: false,
  server: {
    port: 5174,
    // Allow Tauri's webview to connect
    strictPort: true,
  },
})
