import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const FIXTURE_SERVER = 'http://127.0.0.1:47390'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    cssMinify: true,
    chunkSizeWarningLimit: 1000,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        // Fixed names, the list `server/web.mjs` serves. The libraries apart, so a change to the page leaves their committed file alone.
        entryFileNames: 'app.js',
        chunkFileNames: '[name].js',
        assetFileNames: 'app[extname]',
        manualChunks: id => (id.includes('node_modules') ? 'vendor' : undefined),
      },
    },
  },
  // For `npm run dev` beside `node server/web.mjs serve 47390 --fixture tests/fixtures/snapshot.json`.
  server: { proxy: { '/events': FIXTURE_SERVER, '/fonts': FIXTURE_SERVER } },
})
