// TypeScript interprets declarations using their extension and package type.
// Both bundles expose the same API, but CommonJS needs CommonJS declarations.
import { copyFile } from 'node:fs/promises'

await copyFile(new URL('../dist/index.d.ts', import.meta.url), new URL('../dist/index.d.cts', import.meta.url))
