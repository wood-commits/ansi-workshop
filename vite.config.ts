import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const productionCsp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:47831; img-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
const developmentCsp = productionCsp
  .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
  .replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:5173")

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'static-html-csp',
      apply: 'build',
      transformIndexHtml: {
        order: 'post',
        handler: () => [{
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: productionCsp.replace("; frame-ancestors 'none'", ''),
          },
          injectTo: 'head-prepend',
        }],
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    allowedHosts: ['localhost'],
    cors: false,
    headers: {
      'Content-Security-Policy': developmentCsp,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    allowedHosts: ['localhost'],
    cors: false,
    headers: {
      'Content-Security-Policy': productionCsp,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/testSetup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'mcp/**/*.test.ts'],
    restoreMocks: true,
    testTimeout: process.env.CI ? 15_000 : 5_000,
  },
})
