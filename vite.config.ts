import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'
import { createManualChunks } from './src/manual-chunks'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      cy: path.resolve(__dirname, './cypress'),
    },
  },
  optimizeDeps: {
    // Pre-bundle kuromoji: reached only through a dynamic import it would be
    // served unoptimized, making the first tokenizer build pathologically slow
    // in dev and Cypress (~275s vs ~0.5s).
    include: ['@patdx/kuromoji'],
  },
  build: {
    minify: 'terser',
    rollupOptions: {
      external: ['bufferutil', 'utf-8-validate'],
      output: {
        manualChunks: createManualChunks,
      },
    },
  },
})
