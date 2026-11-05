import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

const FIXTURE_SERVER = 'http://127.0.0.1:47390'

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: { target: 'es2022', cssMinify: true, chunkSizeWarningLimit: 1000 },
  // For `npm run dev` beside `node server/web.mjs serve 47390 --fixture tests/fixtures/snapshot.json`.
  server: { proxy: { '/events': FIXTURE_SERVER, '/fonts': FIXTURE_SERVER } },
})
