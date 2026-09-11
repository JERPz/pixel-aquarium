import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5180, open: false },
  build: { outDir: 'dist', assetsInlineLimit: 0 },
});
