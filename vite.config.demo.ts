import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

// Marketing/demo page. `npm run demo` serves demo/index.html and imports the
// library straight from ./src so every change hot-reloads. klinecharts is the
// vendored patched core installed via file:vendor; preserveSymlinks keeps the
// dep "inside node_modules" so vite prebundles the UMD with named exports
// (without it, the symlink resolves outside root and the raw UMD is served,
// which has no ESM exports).
export default defineConfig({
  root: 'demo',
  plugins: [solidPlugin()],
  resolve: { preserveSymlinks: true },
  optimizeDeps: { include: ['klinecharts'] },
  server: { port: 5180 },
  build: { outDir: '../dist-demo', emptyOutDir: true }
})
