import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  plugins: [vue(), tailwindcss()],
  define: {
    // vue-i18n: Composition API only, no legacy API, no devtools. Messages are compiled with the
    // JIT (AST) compiler, which never uses eval or new Function, so the strict CSP holds.
    __VUE_I18N_FULL_INSTALL__: false,
    __VUE_I18N_LEGACY_API__: false,
    __INTLIFY_PROD_DEVTOOLS__: false,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_OPTIONS_API__: false,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    sourcemap: false,
    // Inline assets would become data: URLs in CSS/JS; keep everything as same-origin files.
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/hosted/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
});
