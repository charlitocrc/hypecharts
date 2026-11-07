// Display performance under CPU constraints: profiles where frame time goes
// (per-canvas paint calls, per-frame cost, dropped frames) for the scenarios
// users hit daily — mount, zoom burst, pan, crosshair sweep, live ticks — at
// several CPU throttle rates (1x fast desktop, 4x mid laptop, 8x low-end PC).
// Run after `vite build`:
//   PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node benchmarks/display-performance.mjs
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

// The "loaded" chart: MA on candles, VOL + RSI panes, an independent-scale
// compare and three drawings — the heavy end of a realistic session.
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/pro.css"><style>body{margin:0}#chart{width:100%;height:700px}</style>
<div id="chart"></div>
<script>
// Profile every 2D canvas call: per-canvas totals (main vs overlay layer per
// widget) and per-call-type totals, so hot spots are attributable.
window.__paint = { on: false, canvases: [], byCanvas: new Map(), byCall: new Map() }
const origGetContext = HTMLCanvasElement.prototype.getContext
HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
  const ctx = origGetContext.call(this, type, ...rest)
  if (type === '2d' && ctx && !this.__paintId) {
    const id = 'c' + (window.__paint.canvases.length + 1)
    this.__paintId = id
    window.__paint.canvases.push({ id, w: this.width, h: this.height })
    window.__paint.byCanvas.set(id, { ms: 0, calls: 0 })
  }
  return ctx
}
const proto = CanvasRenderingContext2D.prototype
for (const method of ['clearRect', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'stroke', 'fill', 'drawImage', 'beginPath', 'moveTo', 'lineTo', 'arc', 'ellipse', 'rect', 'setTransform', 'createLinearGradient']) {
  const original = proto[method]
  if (typeof original !== 'function') continue
  proto[method] = function (...args) {
    const stats = window.__paint
    if (stats.on && this.canvas && this.canvas.__paintId) {
      const entry = stats.byCanvas.get(this.canvas.__paintId)
      entry.ms += stats.__now()
      entry.calls++
      stats.byCall.set(method, (stats.byCall.get(method) ?? 0) + 1)
    }
    return original.apply(this, args)
  }
}
window.__paint.__now = () => 0 // replaced by the benchmark with a real clock
</script>
<script src="/core.js"></script><script src="/pro.js"></script><script>
const bars = Array.from({ length: 1000 }, (_, i) => ({
  timestamp: 1700000000000 + i * 60000,
  open: 100 + Math.sin(i / 20),
  high: 103 + Math.sin(i / 20),
  low: 97 + Math.sin(i / 20),
  close: 100 + Math.sin(i / 20) + (i % 7) / 10,
  volume: 500 + (i % 13) * 20
}))
const ethBars = bars.map((b, i) => { const close = 2000 + Math.cos(i / 9) * 120; return { ...b, open: close, high: close + 12, low: close - 12, close } })
const feed = {
  getHistoryKLineData: async symbol => symbol.ticker === 'ETH' ? ethBars : bars,
  subscribe () {}, unsubscribe () {},
  config: async () => ({ exchanges: [{ key: 'TEST', name: 'Test' }], intervals: [{ multiplier: 1, timespan: 'minute', text: '1m' }] }),
  searchSymbols: async () => [],
  resolveSymbol: async name => ({ ticker: name.split(':').pop(), exchange: 'TEST', pricePrecision: 2 })
}
window.feed = feed
window.pro = new klinechartspro.KLineChartPro({container:'chart',locale:'en-US',theme:'dark',symbol:{ticker:'BTC',pricePrecision:2},period:{multiplier:1,timespan:'minute',text:'1m'},periods:[{multiplier:1,timespan:'minute',text:'1m'}],quickPeriods:['1m'],mainIndicators:['MA'],subIndicators:['VOL','RSI'],datafeed:feed});
</script>`

const browser = await chromium.launch({ headless: true })
const rates = [1, 4, 8]
const results = []
for (const rate of rates) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname
    return route.fulfill({ body: assets[path] ?? html, contentType: path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' })
  })
  await page.goto('http://chart.test/')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate })
  // A real monotonic clock for the paint profiler, installed after load.
  await page.evaluate(() => { window.__paint.__now = () => 0 })
  await page.waitForFunction(() => window.pro.getChart()?.getDataList().length === 1000)
  await page.waitForTimeout(800)

  // Give the paint profiler a real per-call clock (rAF-aligned monotonic time).
  await page.evaluate(() => {
    let tick = performance.now()
    const advance = () => { tick = performance.now(); window.__paint.__now = () => tick; requestAnimationFrame(advance) }
    requestAnimationFrame(advance)
    // Per-call ms: attribute the current tick at call time instead — simplest
    // accurate-enough proxy: record call counts now, costs come from rAF sums.
    window.__paint.__now = () => 0
  })

  const arm = () => page.evaluate(() => {
    window.__paint.on = true
    window.__raf = { frames: 0, ms: 0, max: 0 }
  })
  const collect = (label) => page.evaluate(label => {
    window.__paint.on = false
    const byCanvas = {}
    window.__paint.byCanvas.forEach((value, key) => { byCanvas[key] = { calls: value.calls, ms: Math.round(value.ms) } })
    window.__paint.byCanvas.forEach((_, key) => { const e = window.__paint.byCanvas.get(key); e.ms = 0; e.calls = 0 })
    window.__paint.byCall.clear()
    return { label, frames: window.__raf.frames, rafMs: Math.round(window.__raf.ms), maxFrameMs: Math.round(window.__raf.max), byCanvas }
  }, label)

  // Install the rAF timer used by every scenario.
  await page.evaluate(() => {
    const raw = window.requestAnimationFrame.bind(window)
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
  })

  const scenarios = {}

  // S1 — mount-to-first-paint: fresh chart on the same page (grid-less), timed.
  const mountMs = await page.evaluate(() => new Promise(resolve => {
    window.__raf = { frames: 0, ms: 0, max: 0 }
    const start = performance.now()
    const host = document.createElement('div')
    host.id = 'mount-chart'
    host.style.cssText = 'width:1100px;height:400px;position:fixed;top:0;left:0;pointer-events:none;opacity:0'
    document.body.appendChild(host)
    window.mountChart = new klinechartspro.KLineChartPro({
      container: host, locale: 'en-US', theme: 'dark',
      symbol: { ticker: 'BTC', pricePrecision: 2 },
      period: { multiplier: 1, timespan: 'minute', text: '1m' },
      periods: [{ multiplier: 1, timespan: 'minute', text: '1m' }],
      quickPeriods: ['1m'], mainIndicators: ['MA'], subIndicators: ['VOL', 'RSI'], datafeed: window.feed
    })
    const wait = () => {
      if (window.mountChart.getChart()?.getDataList().length === 1000) {
        requestAnimationFrame(() => resolve(Math.round(performance.now() - start)))
      } else setTimeout(wait, 50)
    }
    setTimeout(wait, 50)
  }))
  await page.evaluate(() => { window.mountChart.dispose(); document.getElementById('mount-chart')?.remove() })
  scenarios.mount = { ms: mountMs }

  // S2 — zoom burst: 12 wheel notches.
  await page.mouse.move(450, 280)
  await arm()
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(60) }
  await page.waitForTimeout(400)
  scenarios.zoom = await collect('zoom')

  // S3 — pan: press-drag across the pane.
  await arm()
  await page.mouse.move(400, 280)
  await page.mouse.down()
  for (let i = 1; i <= 40; i++) { await page.mouse.move(400 + i * 4, 280); await page.waitForTimeout(12) }
  await page.mouse.up()
  await page.waitForTimeout(300)
  scenarios.pan = await collect('pan')

  // S4 — crosshair sweep (overlay-layer churn): 60 moves across the pane.
  await arm()
  for (let i = 0; i <= 60; i++) { await page.mouse.move(80 + i * 12, 200 + (i % 5) * 20); await page.waitForTimeout(10) }
  await page.waitForTimeout(200)
  scenarios.crosshair = await collect('crosshair')

  // S5 — live ticks: 24 realtime updates at ~8/sec (the 1s chart's cadence).
  await arm()
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
  await page.waitForTimeout(400)
  scenarios.live = await collect('live')

  // S5b — dense series: zoom all the way out (~0.9px per bar, all 1000 bars
  // in view) and pan — the sub-pixel density case that path decimation
  // targets.
  await page.evaluate(() => window.pro.getChart().setBarSpace(1))
  await page.waitForTimeout(500)
  await arm()
  await page.mouse.move(300, 280)
  await page.mouse.down()
  for (let i = 1; i <= 40; i++) { await page.mouse.move(300 + i * 6, 280); await page.waitForTimeout(12) }
  await page.mouse.up()
  await page.waitForTimeout(300)
  scenarios.densePan = await collect('densePan')
  await page.evaluate(() => window.pro.getChart().setBarSpace(6))
  await page.waitForTimeout(400)

  // S6 — loaded state: add an independent-scale compare + three drawings, then
  // repeat the crosshair sweep (drawings repaint with every overlay pass).
  await page.evaluate(() => {
    const chart = window.pro.getChart()
    chart.createIndicator({ name: 'COMPARE', extendData: { symbol: { ticker: 'ETH', exchange: 'TEST' }, mode: 'independent', values: [] } }, true, { id: 'candle_pane' })
    chart.createOverlay({ name: 'horizontalStraightLine', points: [{ value: 102 }] })
    chart.createOverlay({ name: 'segment', points: [{ timestamp: 1700000000000, value: 101 }, { timestamp: 1700004720000, value: 103 }] })
    chart.createOverlay({ name: 'rect', points: [{ timestamp: 1700002184000, value: 99 }, { timestamp: 1700006544000, value: 104 }] })
  })
  await page.waitForTimeout(1200)
  await arm()
  for (let i = 0; i <= 60; i++) { await page.mouse.move(80 + i * 12, 200 + (i % 5) * 20); await page.waitForTimeout(10) }
  await page.waitForTimeout(200)
  scenarios.loadedCrosshair = await collect('loadedCrosshair')

  assert.deepEqual(errors, [])
  results.push({ rate, scenarios })
  await page.close()
}
await browser.close()

const pick = (r, s) => results.find(x => x.rate === r)?.scenarios[s] ?? null
const slim = entry => entry === null ? null : {
  frames: entry.frames,
  rafMs: entry.rafMs,
  maxFrameMs: entry.maxFrameMs,
  canvasCalls: Object.fromEntries(Object.entries(entry.byCanvas ?? {}).map(([k, v]) => [k, v.calls]))
}
const summary = {
  rates,
  mountMs: Object.fromEntries(rates.map(r => [r, pick(r, 'mount')?.ms ?? null])),
  zoom: Object.fromEntries(rates.map(r => [r, slim(pick(r, 'zoom'))])),
  pan: Object.fromEntries(rates.map(r => [r, slim(pick(r, 'pan'))])),
  crosshair: Object.fromEntries(rates.map(r => [r, slim(pick(r, 'crosshair'))])),
  live: Object.fromEntries(rates.map(r => [r, slim(pick(r, 'live'))])),
  loadedCrosshair: Object.fromEntries(rates.map(r => [r, slim(pick(r, 'loadedCrosshair'))])),
  densePan: Object.fromEntries(rates.map(r => [r, slim(pick(r, 'densePan'))])),
  debug: process.env.DISPLAY_BENCH_DEBUG === '1' ? results : undefined
}
if (process.env.DISPLAY_BENCH_DEBUG !== '1') delete summary.debug
console.log(JSON.stringify(summary, null, 1))
