import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Unit tests for pure logic run in Node via vitest (fast, headless-friendly).
// Cypress (*.cy.tsx) stays reserved for real-DOM component/visual specs.
// Loading the real dictionaries through the Cypress proxy on a headless host is
// pathologically slow (~275s), so dictionary-dependent logic is unit-tested here
// with injected fakes / fixtures instead.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
