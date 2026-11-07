/// <reference types="vite/client" />

import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solidPlugin()],
  build: {
    cssTarget: 'chrome61',
    sourcemap: true,
    // The vendored core is a UMD file reached through a symlink — give the
    // CommonJS transform an explicit path filter or rollup parses it as ESM
    // and finds no named exports.
    commonjsOptions: { include: [/node_modules/, /vendor/] },
    rollupOptions: {
      // The vendored patched KLineChart core is bundled in: the published
      // package is self-contained and a registry-installed stock klinecharts
      // would silently miss every fork patch.
      output: {
        assetFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'style.css') {
            return 'klinecharts-pro.css'
          }
        }
      },
    },
    lib: {
      entry: './src/index.ts',
      name: 'klinechartspro',
      fileName: (format) => {
        if (format === 'es') {
          return 'klinecharts-pro.js'
        }
        if (format === 'umd') {
          return 'klinecharts-pro.umd.js'
        }
      }
    }
  }
})
