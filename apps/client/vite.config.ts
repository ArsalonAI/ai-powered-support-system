import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const API_TARGET = process.env.VITE_API_PROXY ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // The browser only ever sees one origin: Vite serves the SPA at `/` and
    // forwards `/api/*` to the API. Same-origin is what lets session cookies
    // stay SameSite=Lax with no CORS — do not replace this with an absolute
    // API URL.
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      // See the note in apps/server/vitest.config.ts — without `all`, an
      // untested component is absent from the report rather than 0%.
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        // Mounts the app into the DOM; nothing to assert that rendering a route
        // in a test does not already cover.
        'src/main.tsx',
        'src/**/*.d.ts',
      ],
    },
  },
});
