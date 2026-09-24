import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// /mockv1/* proxies to the local mock AI provider (scripts/mock-ai-provider.cjs)
// so the same-origin browser can exercise the full pipeline in end-to-end tests.
const mockProxy = {
  '/mockv1': {
    target: 'http://localhost:9999',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/mockv1/, ''),
  },
}

export default defineConfig({
  plugins: [react()],
  server: { proxy: mockProxy },
  preview: { port: 4173, proxy: mockProxy },
})
