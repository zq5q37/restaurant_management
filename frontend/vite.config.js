import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    watch: { usePolling: true },
    proxy: {
      // 'backend' is the compose service name; use localhost when running dev outside Docker
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://backend:3000',
        changeOrigin: true,
      },
    },
  },
})
