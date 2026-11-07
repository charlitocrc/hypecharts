// Zoom gesture benchmark: measures main-thread cost of zooming on the x
// (date) and y (price) axes — wheel bursts and axis drag-scaling — plus the
// regression that a drag gesture keeps running when the cursor leaves the
// area it started on. Run after `vite build`:
//   PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node benchmarks/zoom-performance.mjs
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
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/pro.css"><style>body{margin:0}#chart{width:100%;height:700px}</style>
<div id="chart"></div><input id="outside" aria-label="Outside chart">
<script>
// Time every animation-frame callback while a gesture is active: zoom paints
// and the eased wheel loop both run inside rAF, so this approximates the
// main-thread work a gesture costs.
window.__raf = { active: false, frames: 0, ms: 0 }
const rawRaf = window.requestAnimationFrame.bind(window)
window.requestAnimationFrame = cb => rawRaf(t => {
  const stats = window.__raf
  if (stats.active) {
    const start = performance.now()
    try { cb(t) } finally { stats.ms += performance.now() - start; stats.frames++ }
  } else {
    cb(t)
  }
})
</script>
<script src="/core.js"></script><script src="/pro.js"></script><script>
const bars = Array.from({length: 1500}, (_, i) => ({
  timestamp: 1700000000000 + i * 60000,
  open: 100 + Math.sin(i / 20),
  high: 102 + Math.sin(i / 20),
  low: 98 + Math.sin(i / 20),
  close: 100 + Math.sin(i / 20) + (i % 7) / 10,
  volume: 500 + (i % 13) * 20
}))
window.pro = new klinechartspro.KLineChartPro({container:'chart',locale:'en-US',theme:'dark',symbol:{ticker:'BTC',pricePrecision:2},period:{multiplier:1,timespan:'minute',text:'1m'},periods:[{multiplier:1,timespan:'minute',text:'1m'}],quickPeriods:['1m'],mainIndicators:['MA'],subIndicators:['VOL'],datafeed:{getHistoryKLineData:async()=>bars,subscribe(){},unsubscribe(){}}});
</script>`

const browser = await chromium.launch({ headless: true })
const runs = Number(process.env.ZOOM_BENCH_RUNS ?? '1')
const totals = []
for (let run = 0; run < runs; run++) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname
    return route.fulfill({ body: assets[path] ?? html, contentType: path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' })
  })
  await page.goto('http://chart.test/')
  await page.waitForFunction(() => window.pro.getChart()?.getDataList().length === 1500)
  // Layout may settle one frame after data; wait for the bar space to exist.
  await page.waitForFunction(() => window.pro.getChart().getBarSpace() > 0)

  const arm = () => page.evaluate(() => { window.__raf.active = true; window.__raf.frames = 0; window.__raf.ms = 0 })
  const collect = () => page.evaluate(() => { window.__raf.active = false; return { frames: window.__raf.frames, cpuMs: Math.round(window.__raf.ms * 10) / 10 } })
  const settle = () => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)))

  // Geometry of the widget areas.
  const geo = await page.evaluate(() => {
    const widget = document.querySelector('.klinecharts-pro-widget')
    const root = widget.getBoundingClientRect()
    const yAxisWidth = Math.round(root.width * 0.06)
    const xAxisHeight = 22
    return {
      root: { x: root.left, y: root.top, width: root.width, height: root.height },
      xAxis: { x: root.left + 40, y: root.top + root.height - xAxisHeight / 2 },
      yAxis: { x: root.left + root.width - yAxisWidth / 2, y: root.top + root.height * 0.4 }
    }
  })

  // G1 — wheel zoom until the bar space doubles: a fixed visual zoom, so the
  // cost and notch count compare fairly across builds (zoom-per-notch is part
  // of scroll-zoom speed).
  // The wheel listener attaches on mouseenter, so approach from outside the
  // chart (the pointer starts at 0,0, which is already inside it).
  await page.mouse.move(10, 780)
  await page.waitForTimeout(50)
  await page.mouse.move(geo.root.x + geo.root.width * 0.45, geo.root.y + geo.root.height * 0.4)
  await page.waitForTimeout(100)
  const barSpaceBefore = await page.evaluate(() => window.pro.getChart().getBarSpace())
  const readBarSpace = () => page.evaluate(() => window.pro.getChart().getBarSpace())
  await arm()
  const wheelStart = Date.now()
  let notches = 0
  let barSpaceCurrent = barSpaceBefore
  // Zoom IN (wheel up grows the bar space) until it has doubled — measured
  // AFTER the eased zoom settles, so both builds are credited with the same
  // achieved zoom and the input cost (notches) plus compute cost (cpuMs)
  // compare fairly. The default bar space (6) leaves ample headroom.
  const trace = process.env.ZOOM_BENCH_TRACE === '1'
  let doubled = false
  while (!doubled && notches < 200) {
    for (let k = 0; k < 4 && notches < 200; k++) {
      await page.mouse.wheel(0, -120)
      notches++
      await page.waitForTimeout(8)
    }
    await settle()
    barSpaceCurrent = await readBarSpace()
    if (trace) console.error(`notches ${notches}: barSpace=${barSpaceCurrent.toFixed(4)} ratio=${(barSpaceCurrent / barSpaceBefore).toFixed(4)}`)
    doubled = barSpaceCurrent >= barSpaceBefore * 2
  }
  const wheel = await collect()
  wheel.wallMs = Date.now() - wheelStart
  wheel.notches = notches
  const barSpaceAfter = await readBarSpace()
  assert.ok(barSpaceAfter >= barSpaceBefore * 2, 'wheel burst must double the bar space')

  // G2 — drag-scale on the x (date) axis.
  await arm()
  const xStart = await page.evaluate(() => window.pro.getChart().getBarSpace())
  await page.mouse.move(geo.xAxis.x, geo.xAxis.y)
  await page.mouse.down()
  for (let i = 1; i <= 100; i++) {
    await page.mouse.move(geo.xAxis.x + i * 2, geo.xAxis.y)
    await page.waitForTimeout(4)
  }
  await page.mouse.up()
  await settle()
  const xDrag = await collect()
  const xEnd = await page.evaluate(() => window.pro.getChart().getBarSpace())
  assert.ok(Math.abs(xEnd - xStart) > 0.01, 'x-axis drag must change the bar space')

  // G3 — drag-scale on the y (price) axis.
  const extremumBefore = await page.evaluate(() => {
    const axis = window.pro.getChart().getPaneById('candle_pane')?.getAxisComponent?.()
    const extremum = axis?.getExtremum?.()
    return extremum ? Math.round(extremum.range * 1000) / 1000 : null
  })
  await arm()
  await page.mouse.move(geo.yAxis.x, geo.yAxis.y)
  await page.mouse.down()
  for (let i = 1; i <= 80; i++) {
    await page.mouse.move(geo.yAxis.x, geo.yAxis.y - i * 1.5)
    await page.waitForTimeout(4)
  }
  await page.mouse.up()
  await settle()
  const yDrag = await collect()
  const extremumAfter = await page.evaluate(() => {
    const axis = window.pro.getChart().getPaneById('candle_pane')?.getAxisComponent?.()
    const extremum = axis?.getExtremum?.()
    return extremum ? Math.round(extremum.range * 1000) / 1000 : null
  })
  assert.ok(extremumBefore !== null && extremumAfter !== null && Math.abs(extremumAfter - extremumBefore) > 0.001, 'y-axis drag must change the price range')

  // R1 — a drag keeps running after the cursor leaves the area it started on.
  // Start on the y axis, finish over the MAIN pane (a different widget): the
  // scale gesture must continue instead of freezing.
  const r1 = await page.evaluate(() => {
    const widget = document.querySelector('.klinecharts-pro-widget').getBoundingClientRect()
    const yAxisX = widget.left + widget.width - Math.round(widget.width * 0.06) / 2
    return { yAxisX, mainX: widget.left + widget.width * 0.4 }
  })
  await page.mouse.move(r1.yAxisX, geo.yAxis.y)
  await page.mouse.down()
  let keptGoing = false
  const readRange = () => page.evaluate(() => {
    const axis = window.pro.getChart().getPaneById('candle_pane')?.getAxisComponent?.()
    const extremum = axis?.getExtremum?.()
    return extremum ? Math.round(extremum.range * 1000) / 1000 : null
  })
  let previous = await readRange()
  for (let i = 1; i <= 24; i++) {
    // First thirds stay on the axis, rest moves over the main pane.
    const x = i <= 8 ? r1.yAxisX : r1.mainX
    await page.mouse.move(x, geo.yAxis.y - i * 1.5)
    await page.waitForTimeout(6)
    const current = await readRange()
    if (i > 8 && current !== null && previous !== null && Math.abs(current - previous) > 0.001) {
      keptGoing = true
    }
    previous = current
  }
  await page.mouse.up()
  await settle()
  // The continuation is a behavior fix; allow a pre-fix baseline run to
  // report it instead of failing (set ZOOM_BENCH_STRICT=1 to enforce).
  if (!keptGoing && process.env.ZOOM_BENCH_STRICT === '1') {
    assert.ok(keptGoing, 'y-axis scale drag must keep zooming after the cursor leaves the axis')
  }

  totals.push({ wheel, xDrag, yDrag, dragContinues: keptGoing, pageErrors: errors })
  await page.close()
}
await browser.close()
const median = key => {
  const values = totals.map(t => key(t)).sort((a, b) => a - b)
  return values[Math.floor(values.length / 2)]
}
const result = {
  runs: totals.length,
  wheel: { cpuMs: median(t => t.wheel.cpuMs), frames: median(t => t.wheel.frames), wallMs: median(t => t.wheel.wallMs), notches: median(t => t.wheel.notches) },
  xDrag: { cpuMs: median(t => t.xDrag.cpuMs), frames: median(t => t.xDrag.frames) },
  yDrag: { cpuMs: median(t => t.yDrag.cpuMs), frames: median(t => t.yDrag.frames) },
  dragContinues: totals.every(t => t.dragContinues),
  errors: totals.flatMap(t => t.pageErrors)
}
console.log(JSON.stringify(result))
if (result.errors.length > 0) throw new Error(`Page errors: ${result.errors.join(' | ')}`)
