import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Tauri expects clearScreen: false so it can manage its own terminal output
  clearScreen: false,
  server: {
    port: 5174,
    // Allow Tauri's webview to connect
    strictPort: true,
  },
})
