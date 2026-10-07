import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Live-Zugriff auf die lokale AUDiOWERK/SAMPLE-CORE-API (nur Dev)
      '/audiowerk': {
        target: process.env.AUDIOWERK_API || 'http://127.0.0.1:9096',
        changeOrigin: false,
        rewrite: (p) => p.replace(/^\/audiowerk/, ''),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
