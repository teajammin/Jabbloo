import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true, // expose on LAN so phones can connect later
    port: 5173,
    proxy: {
      // The API key lives on the Express side; the browser only ever talks
      // to this proxy, so no key and no CORS config is needed in dev.
      '/api': {
        target: `http://localhost:${process.env.PORT ?? 8787}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
