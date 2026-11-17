// Exercise the tarball, never a source alias or a link to this repository.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build as viteBuild } from 'vite'
import { build as esbuild } from 'esbuild'
import { chromium } from 'playwright'

const repo = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
// macOS exposes its temporary directory through a /var -> /private/var alias.
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'hypecharts-package-')))
const consumer = join(temporary, 'consumer')
let browser

function run (command, args, cwd, quiet = false) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  if (!quiet || result.status !== 0) {
    process.stdout.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
  }
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`)
  return result.stdout
}

async function write (path, contents) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
}

// Both module formats run the same deterministic integration workflow.
const workflow = `
const period = { multiplier: 1, timespan: 'minute', text: '1m' };
const listeners = new Set();
const end = Math.floor(Date.now() / 60000) * 60000;
const feed = {
  async getHistoryKLineData(symbol) {
    const base = symbol.ticker === 'BTC' ? 100 : 200;
    return Array.from({ length: 100 }, (_, i) => ({
      timestamp: end - (99 - i) * 60000,
      open: base, high: base + 2, low: base - 2, close: base + 1, volume: 10
    }));
  },
  subscribe(symbol, period, callback) { listeners.add(callback); },
  unsubscribe(symbol, period, callback) { listeners.delete(callback); }
};
window.chart = new KLineChartPro({
  container: 'chart', locale: 'en-US', timezone: 'Etc/UTC',
  symbol: { ticker: 'BTC', exchange: 'FIXTURE' }, period,
  periods: [period], quickPeriods: ['1m'], mainIndicators: [], subIndicators: [], datafeed: feed
});
window.listenerCount = () => listeners.size;
window.smokeReady = true;
`
const html = script => `<!doctype html><html><head><meta charset="utf-8">
<link rel="icon" href="data:,"><style>#chart{height:600px;width:1000px}</style></head>
<body><div id="chart"></div>${script}</body></html>`

try {
  // npm pack runs prepack: a clean checkout cannot accidentally ship stale dist.
  run('npm', ['pack', '--pack-destination', temporary, '--offline', '--cache', join(temporary, 'pack-cache')], repo)
  const manifest = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'))
  const tarball = join(temporary, `${manifest.name}-${manifest.version}.tgz`)
  const inventory = run('tar', ['-tzf', tarball], repo, true).trim().split('\n')
  for (const file of ['index.d.ts', 'index.d.cts', 'klinecharts-pro.js', 'klinecharts-pro.cjs', 'klinecharts-pro.umd.js', 'klinecharts-pro.css']) {
    assert.ok(inventory.includes(`package/dist/${file}`), `tarball missing ${file}`)
  }
  assert.ok(inventory.includes('package/LICENSE'))
  assert.ok(inventory.includes('package/README.md'))
  assert.ok(!inventory.some(path => /^package\/(src|vendor|node_modules)\//.test(path)), 'source/vendor leaked into package')
  await write(join(consumer, 'package.json'), JSON.stringify({ name: 'hypecharts-consumer', private: true, type: 'module' }))
  // A deliberately empty cache proves consumers need no registry dependencies.
  run('npm', ['install', tarball, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(temporary, 'cache')], consumer)
  const installed = join(consumer, 'node_modules/hypecharts')
  const packed = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
  assert.deepEqual(packed.dependencies ?? {}, {}, 'bundled library must not install runtime dependencies')
  assert.deepEqual(packed.exports, manifest.exports)
  const consumerRequire = createRequire(join(consumer, 'package.json'))
  assert.equal(consumerRequire.resolve('hypecharts'), join(installed, 'dist/klinecharts-pro.cjs'))
  assert.equal(consumerRequire.resolve('hypecharts/styles.css'), consumerRequire.resolve('hypecharts/dist/klinecharts-pro.css'))
  assert.equal(consumerRequire.resolve('hypecharts/package.json'), join(installed, 'package.json'))
  assert.equal(consumerRequire.resolve('hypecharts/dist/klinecharts-pro.umd.js'), join(installed, 'dist/klinecharts-pro.umd.js'))
  assert.throws(() => consumerRequire.resolve('hypecharts/src/index.ts'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })
  const esmTypes = await readFile(join(installed, 'dist/index.d.ts'), 'utf8')
  assert.equal(await readFile(join(installed, 'dist/index.d.cts'), 'utf8'), esmTypes)
  assert.ok(!/^\s*(?:import|export).*\bfrom\s+['"]/m.test(esmTypes), 'declarations must be self-contained')

  const typeFixture = await readFile(join(repo, 'tests/types/public-api.ts'), 'utf8')
  await write(join(consumer, 'esm.mts'), typeFixture)
  await write(join(consumer, 'commonjs.cts'), typeFixture)
  await write(join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2020', module: 'Node16', moduleResolution: 'Node16', strict: true, noEmit: true, skipLibCheck: false, types: [] },
    files: ['esm.mts', 'commonjs.cts']
  }))
  const trace = run(process.execPath, [require.resolve('typescript/bin/tsc'), '--project', 'tsconfig.json', '--traceResolution'], consumer, true)
  assert.ok(trace.includes('/dist/index.d.ts'), 'ESM declarations must resolve')
  assert.ok(trace.includes('/dist/index.d.cts'), 'CJS declarations must resolve')

  await write(join(consumer, 'index.html'), html('<script type="module" src="/main.js"></script>'))
  await write(join(consumer, 'main.js'), `import { KLineChartPro } from 'hypecharts';\nimport 'hypecharts/styles.css';\n${workflow}`)
  const esmOutput = join(temporary, 'esm')
  await viteBuild({ configFile: false, root: consumer, base: '/esm/', logLevel: 'warn', build: { outDir: esmOutput, emptyOutDir: true } })
  const cjsOutput = join(temporary, 'cjs')
  await write(join(consumer, 'main.cjs'), `const { KLineChartPro } = require('hypecharts');\nrequire('hypecharts/dist/klinecharts-pro.css');\n${workflow}`)
  const bundled = await esbuild({ entryPoints: [join(consumer, 'main.cjs')], bundle: true, platform: 'browser', format: 'iife', outfile: join(cjsOutput, 'main.js'), metafile: true })
  assert.ok(Object.keys(bundled.metafile.inputs).some(path => path.endsWith('/dist/klinecharts-pro.cjs')), 'CJS consumer must use require export')
  await write(join(cjsOutput, 'index.html'), html('<link rel="stylesheet" href="/cjs/main.css"><script src="/cjs/main.js"></script>'))
  const assets = new Map()
  async function collect (directory, prefix, root = directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await collect(path, prefix, root)
      else assets.set(`${prefix}/${relative(root, path).split('\\').join('/')}`, await readFile(path))
    }
  }
  await collect(esmOutput, '/esm')
  await collect(cjsOutput, '/cjs')
  assets.set('/umd/index.html', html('<link rel="stylesheet" href="/umd/styles.css"><script src="/umd/pro.js"></script><script>const { KLineChartPro } = klinechartspro;' + workflow + '</script>'))
  assets.set('/umd/pro.js', await readFile(join(installed, 'dist/klinecharts-pro.umd.js')))
  assets.set('/umd/styles.css', await readFile(join(installed, 'dist/klinecharts-pro.css')))
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
  for (const format of ['esm', 'cjs', 'umd']) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 750 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => {
      const path = new URL(route.request().url()).pathname
      const body = assets.get(path)
      return route.fulfill({ status: body ? 200 : 404, body: body ?? 'Not found',
        contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' })
    })
    await page.goto(`http://package.test/${format}/index.html`)
    await page.waitForFunction(() => window.smokeReady && window.chart.getSelection()?.dataReady)
    assert.equal(await page.evaluate(() => window.chart.getChart().getDataList().length), 100)
    assert.ok(await page.locator('#chart canvas').count() > 0, `${format}: chart must render canvases`)
    assert.equal(await page.locator('#chart').evaluate(el => getComputedStyle(el).position), 'relative', `${format}: stylesheet must apply`)
    assert.equal(await page.evaluate(() => window.listenerCount()), 1)
    assert.equal(await page.evaluate(() => {
      window.selectionEvents = []
      window.disposalEvents = 0
      window.stopSelection = window.chart.subscribeSelectionChange(selection => window.selectionEvents.push(selection))
      window.chart.subscribeDispose(() => {
        window.disposalEvents++
        window.corePresentAtDisposal = window.chart.getChart() !== null
      })
      return window.selectionEvents.length
    }), 0, `${format}: subscriptions must not replay the current state`)
    await page.evaluate(() => window.chart.setSymbol({ ticker: 'ETH', exchange: 'FIXTURE' }))
    await page.waitForFunction(() => window.chart.getSelection()?.dataReady && window.chart.getSelection().symbol.ticker === 'ETH')
    assert.equal(await page.evaluate(() => window.chart.getChart().getDataList().length), 100)
    assert.ok(await page.evaluate(() => window.chart.getChart().getDataList().every(bar => bar.close === 201)))
    assert.ok(await page.evaluate(() => window.selectionEvents.some(selection => selection.symbol.ticker === 'ETH' && selection.dataReady)))
    await page.evaluate(() => { window.chart.dispose(); window.chart.dispose() })
    assert.equal(await page.evaluate(() => window.disposalEvents), 1)
    assert.equal(await page.evaluate(() => window.corePresentAtDisposal), true)
    assert.equal(await page.evaluate(() => window.chart.getSelection()), null)
    assert.equal(await page.evaluate(() => {
      window.stopSelection()
      const stop = window.chart.subscribeDispose(() => window.disposalEvents++)
      stop()
      window.chart.subscribeSelectionChange(() => window.selectionEvents.push('unexpected'))()
      return window.disposalEvents
    }), 1)
    assert.equal(await page.evaluate(() => window.listenerCount()), 0)
    assert.equal(await page.locator('#chart canvas').count(), 0)
    assert.deepEqual(errors, [], `${format}: browser errors`)
    await page.close()
    console.log(`Packed ${format.toUpperCase()} consumer: stylesheet, chart render, symbol switch, cleanup passed`)
  }
  console.log('Package checks passed: offline tarball installation, exports, strict ESM/CJS types, production browser consumers, legacy paths')
} finally {
  await browser?.close()
  await rm(temporary, { recursive: true, force: true })
}
