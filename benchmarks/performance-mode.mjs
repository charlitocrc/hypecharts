// Performance mode (PERF-001): what the device-pixel-ratio cap buys. Charts
// rasterize every pane at DPR × CSS size; capping the ratio at 1 quarters the
// backing-store pixels of a DPR-2 screen (1/9 at DPR-3). This measures the
// two costs users feel — canvas memory and frame time under CPU throttle —
// uncapped vs capped, at DPR 1 / 2 / 3, plus the aggregation cost of UX-002
// custom intervals (aggregateBars throughput and wrapper fetch overhead).
// Run after `vite build`:
//   PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node benchmarks/performance-mode.mjs
// Uses local assets and a fixture feed. No exchange or trading requests.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE to an installed Playwright module')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE)
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const assets = {
  '/core.js': read('../vendor/klinecharts.js'),
  '/pro.js': read('../dist/klinecharts-pro.umd.js'),
  '/pro.css': read('../dist/klinecharts-pro.css')
}

// Same realistic load as display-performance: MA + VOL + RSI panes.
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/pro.css"><style>body{margin:0}#chart{width:1000px;height:700px}</style>
<div id="chart"></div>
<script src="/core.js"></script><script src="/pro.js"></script><script>
const bars = Array.from({ length: 1000 }, (_, i) => ({
  timestamp: 1700000000000 + i * 60000,
  open: 100 + Math.sin(i / 20),
  high: 103 + Math.sin(i / 20),
  low: 97 + Math.sin(i / 20),
  close: 100 + Math.sin(i / 20) + (i % 7) / 10,
  volume: 500 + (i % 13) * 20
}))
const feed = {
  getHistoryKLineData: async () => bars,
  subscribe () {}, unsubscribe () {},
  config: async () => ({ exchanges: [{ key: 'TEST', name: 'Test' }], intervals: [{ multiplier: 1, timespan: 'minute', text: '1m' }] }),
  searchSymbols: async () => [],
  resolveSymbol: async name => ({ ticker: name.split(':').pop(), exchange: 'TEST', pricePrecision: 2 })
}
window.startChart = () => {
  window.pro?.dispose()
  return new klinechartspro.KLineChartPro({
    container: 'chart', locale: 'en-US', theme: 'dark',
    symbol: { ticker: 'BTC', pricePrecision: 2 },
    period: { multiplier: 1, timespan: 'minute', text: '1m' },
    periods: [{ multiplier: 1, timespan: 'minute', text: '1m' }],
    quickPeriods: ['1m'], mainIndicators: ['MA'], subIndicators: ['VOL', 'RSI'],
    datafeed: feed
  })
}
window.pro = window.startChart()
</script>`

const browser = await chromium.launch({ headless: true })
const rows = []
const CPU_RATE = 4

const measure = async (page, label) => {
  // rAF frame timing under the CPU throttle
  await page.evaluate(() => {
    window.__raf = { frames: 0, ms: 0, max: 0 }
    const raw = window.requestAnimationFrame.bind(window)
    if (!window.__rafInstalled) {
      window.__rafInstalled = true
      window.requestAnimationFrame = cb => raw(t => {
        const stats = window.__raf
        if (stats && stats.max !== undefined) {
          const start = performance.now()
          try { cb(t) } finally {
            const dur = performance.now() - start
            stats.ms += dur
            stats.frames++
            if (dur > stats.max) stats.max = dur
          }
        } else { cb(t) }
      })
    }
  })
  // Crosshair sweep — the overlay-layer churn path.
  await page.mouse.move(450, 280)
  for (let i = 0; i <= 50; i++) { await page.mouse.move(80 + i * 16, 220 + (i % 5) * 20); await page.waitForTimeout(10) }
  await page.waitForTimeout(200)
  // Live ticks — the realtime repaint path.
  await page.evaluate(() => new Promise(resolve => {
    const chart = window.pro.getChart()
    const list = chart.getDataList()
    let n = 0
    const timer = setInterval(() => {
      const last = list[list.length - 1]
      n++
      last.close = last.close + (n % 2 === 0 ? 0.4 : -0.3)
      last.high = Math.max(last.high, last.close)
      last.low = Math.min(last.low, last.close)
      chart.updateData(last)
      if (n >= 24) { clearInterval(timer); resolve() }
    }, 125)
  }))
  await page.waitForTimeout(300)
  const stats = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll('#chart canvas')]
    return {
      canvases: canvases.length,
      backingPx: canvases.reduce((s, c) => s + c.width * c.height, 0),
      cssPx: canvases.reduce((s, c) => s + c.offsetWidth * c.offsetHeight, 0),
      frames: window.__raf.frames,
      avgFrameMs: window.__raf.frames ? Math.round(window.__raf.ms / window.__raf.frames * 10) / 10 : 0,
      maxFrameMs: Math.round(window.__raf.max * 10) / 10
    }
  })
  return { label, ...stats }
}

for (const dpr of [1, 2, 3]) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: dpr })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname
    return route.fulfill({ body: assets[path] ?? html, contentType: path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' })
  })
  await page.goto('http://perf.test/')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE })
  await page.waitForFunction(() => window.pro.getChart()?.getDataList().length === 1000)
  await page.waitForTimeout(800)

  const uncapped = await measure(page, `dpr${dpr} uncapped`)
  // Toggle Performance mode exactly as a host would: cap at 1, then resize so
  // every canvas re-scales on its next paint.
  await page.evaluate(() => {
    klinechartspro.setMaxPixelRatio(1)
    window.pro.getChart().resize()
  })
  await page.waitForTimeout(800)
  const capped = await measure(page, `dpr${dpr} capped`)

  assert.equal(errors.length, 0, `page errors at dpr${dpr}: ${errors.join('; ')}`)
  if (dpr > 1) {
    assert.ok(capped.backingPx < uncapped.backingPx * 0.6, `cap must shrink backing store at dpr${dpr}`)
    assert.equal(uncapped.backingPx, uncapped.cssPx * dpr * dpr, `uncapped must rasterize at the device ratio (dpr${dpr})`)
  } else {
    // DPR 1: the cap is a no-op for ratio; resize() may still shift sub-pane
    // layout by a few pixels, so compare against the CSS area with slack.
    assert.ok(Math.abs(uncapped.backingPx - capped.backingPx) < uncapped.cssPx * 0.02, 'cap must not change rasterization at DPR 1')
  }
  rows.push({ dpr, uncapped, capped })
  await context.close()
}

console.log(`\nPerformance mode — DPR cap (CPU throttle ${CPU_RATE}x, 1000 bars, MA+VOL+RSI)\n`)
console.log('dpr | mode     | backing px | ×css | avg frame | max frame')
for (const { dpr, uncapped, capped } of rows) {
  for (const [mode, r] of [['uncapped', uncapped], ['capped', capped]]) {
    const mult = Math.round((r.backingPx / r.cssPx) * 10) / 10
    console.log(`${dpr.toString().padEnd(3)} | ${mode.padEnd(8)} | ${String(r.backingPx).padStart(10)} | ${String(mult + 'x').padStart(4)} | ${String(r.avgFrameMs + 'ms').padStart(9)} | ${String(r.maxFrameMs + 'ms').padStart(9)}`)
  }
  const { uncapped: u, capped: c } = { uncapped: rows.find(r => r.dpr === dpr).uncapped, capped: rows.find(r => r.dpr === dpr).capped }
  const pxSaving = Math.round((1 - c.backingPx / u.backingPx) * 100)
  const frameSaving = u.avgFrameMs > 0 ? Math.round((1 - c.avgFrameMs / u.avgFrameMs) * 100) : 0
  console.log(`    → ${pxSaving}% fewer rasterized pixels${dpr > 1 ? `, avg frame ${frameSaving >= 0 ? '-' : '+'}${Math.abs(frameSaving)}%` : ' (DPR 1: cap is a no-op)'}\n`)
}

// ---- UX-002 aggregation cost: aggregateBars throughput + wrapper overhead ----
const context = await browser.newContext({ viewport: { width: 1100, height: 800 } })
const page = await context.newPage()
page.setDefaultTimeout(15000)
await page.route('**/*', route => {
  const path = new URL(route.request().url()).pathname
  return route.fulfill({ body: assets[path] ?? html, contentType: path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' })
})
await page.goto('http://perf.test/')
const agg = await page.evaluate(async () => {
  const base = Array.from({ length: 100000 }, (_, i) => ({
    timestamp: 1700000000000 + i * 60000,
    open: 100 + Math.sin(i / 20),
    high: 102 + Math.sin(i / 20),
    low: 98 + Math.sin(i / 20),
    close: 101 + Math.sin(i / 15),
    volume: 500
  }))
  const period = { multiplier: 6, timespan: 'hour', text: '6h' }
  // warmup + best of 5
  let best = Number.POSITIVE_INFINITY
  let outLen = 0
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now()
    const out = klinechartspro.aggregateBars(base, period)
    best = Math.min(best, performance.now() - t0)
    outLen = out.length
  }
  // live-cadence cost: one merge+emit is the per-tick work
  const t1 = performance.now()
  const out = klinechartspro.aggregateBars(base.slice(-2000), period)
  const smallMs = performance.now() - t1
  return { best100k: Math.round(best * 10) / 10, buckets: outLen, bars: base.length, small2kMs: Math.round(smallMs * 100) / 100 }
})
console.log(`UX-002 aggregation: ${agg.bars.toLocaleString()} 1m bars → ${agg.buckets} 6h buckets in ${agg.best100k}ms (best of 5); last-2000-bars merge ${agg.small2kMs}ms (≈ per-tick cost).`)
await context.close()

await browser.close()
console.log('\nPERF-001 benchmark OK')
