import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true, // expose on LAN so phones can connect later
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
