import { defineConfig } from 'vite';

export default defineConfig({
  base: '/apex-formula/',
  server: { port: 5200, open: false },
  build: {
    outDir: '..',
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
});
