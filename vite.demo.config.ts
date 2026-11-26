import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  define: {
    'import.meta.env.VITE_DEMO_MODE': JSON.stringify('true')
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer/src')
    }
  },
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'dist-demo'),
    emptyOutDir: true
  }
})
