import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // Build-time pre-render (src/entry-server.jsx): bundle this CommonJS
  // package into the SSR build so Node can import its named exports.
  ssr: { noExternal: ['react-helmet-async'] },
  build: {
    rollupOptions: {
      output: {
        // Keep the icons pages share in one small chunk instead of ~80 tiny files.
        manualChunks(id) {
          if (id.includes('node_modules/lucide-react')) return 'icons';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
