// Build first: npm run build-core
// Run: node benchmarks/initial-load.mjs
// Optional: LOAD_BENCH_RUNS=5 LOAD_BENCH_RATES=1,4 LOAD_BENCH_FEED_MS=100
// Network shaping: LOAD_BENCH_KBPS=1600 LOAD_BENCH_LATENCY_MS=80
// Local, gzip-served production bundle and fixture history; no exchange requests.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { cpus } from 'node:os'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const positive = (name, fallback, allowZero = false) => {
  const value = Number(process.env[name] ?? fallback)
  assert.ok(Number.isFinite(value) && (allowZero ? value >= 0 : value > 0), `Invalid ${name}`)
  return value
}
const runs = positive('LOAD_BENCH_RUNS', 5)
assert.ok(Number.isInteger(runs))
const rates = (process.env.LOAD_BENCH_RATES ?? '1,4').split(',').map(Number)
assert.ok(rates.length > 0 && rates.every(rate => Number.isFinite(rate) && rate >= 1))
const feedMs = positive('LOAD_BENCH_FEED_MS', 100, true)
const kbps = positive('LOAD_BENCH_KBPS', 0, true)
const latency = positive('LOAD_BENCH_LATENCY_MS', 0, true)
const profileDir = process.env.LOAD_BENCH_PROFILE_DIR
if (profileDir) mkdirSync(profileDir, { recursive: true })
const distDir = process.env.LOAD_BENCH_DIST_DIR ? resolve(process.env.LOAD_BENCH_DIST_DIR) : fileURLToPath(new URL('../dist/', import.meta.url))
const bars = Array.from({ length: 1000 }, (_, i) => ({
  timestamp: 1700000000000 + i * 60000, open: 100 + Math.sin(i / 20),
  high: 103 + Math.sin(i / 20), low: 97 + Math.sin(i / 20),
  close: 100 + Math.sin(i / 20) + (i % 7) / 10, volume: 500 + (i % 13) * 20
}))
const assets = new Map([
  ['/pro.js', { body: readFileSync(join(distDir, 'klinecharts-pro.umd.js')), type: 'application/javascript' }],
  ['/pro.css', { body: readFileSync(join(distDir, 'klinecharts-pro.css')), type: 'text/css' }],
  ['/history', { body: Buffer.from(JSON.stringify(bars)), type: 'application/json' }]
])
for (const asset of assets.values()) asset.gzip = gzipSync(asset.body)

// Inline instrumentation runs before the library, including at cold navigation.
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/pro.css">
<style>body{margin:0}#chart{width:1100px;height:700px}</style><div id="chart"></div>
<script>
window.longTasks = []
new PerformanceObserver(list => window.longTasks.push(...list.getEntries().map(e => ({start:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:true})
window.firstCandle = null
for (const method of ['fillRect','fill','stroke']) {
  const original = CanvasRenderingContext2D.prototype[method]
  CanvasRenderingContext2D.prototype[method] = function(...args) {
    const result = original.apply(this,args)
    const color = method === 'stroke' ? this.strokeStyle : this.fillStyle
    if (window.firstCandle === null && color.toLowerCase() === '#01fe02') window.firstCandle = performance.now()
    return result
  }
}
window.bundleStart = performance.now()
</script><script src="/pro.js"></script><script>
window.bundleReady = performance.now()
window.start = async () => {
  window.firstCandle = null
  window.marks = {start:performance.now()}
  const feed = {
    async getHistoryKLineData() {
      window.marks.historyStart = performance.now()
      const response = await fetch('/history', {cache:'no-store'})
      if (!response.ok) throw new Error('History failed')
      const data = await response.json()
      window.marks.historyReady = performance.now()
      return data
    }, subscribe(){}, unsubscribe(){}
  }
  window.pro = new klinechartspro.KLineChartPro({
    container:'chart',locale:'en-US',theme:'dark',symbol:{ticker:'BTC',pricePrecision:2},
    period:{multiplier:1,timespan:'minute',text:'1m'},
    periods:[{multiplier:1,timespan:'minute',text:'1m'}],quickPeriods:['1m'],
    mainIndicators:[],subIndicators:[],datafeed:feed,
    styles:{candle:{bar:{upColor:'#01fe02',downColor:'#01fe02',noChangeColor:'#01fe02'}}}
  })
  window.marks.constructorEnd = performance.now()
  const restored = new URL(location.href).searchParams.has('restore')
  await new Promise((resolve,reject) => {
    const timeout = setTimeout(() => reject(new Error('Chart readiness timed out')),15000)
    const check = () => {
      const chart = window.pro.getChart()
      const indicators = []
      chart?.getIndicatorByPaneId().forEach(pane => pane.forEach(i => indicators.push(i)))
      const ready = chart?.getDataList().length === 1000 && window.firstCandle !== null &&
        !document.querySelector('.klinecharts-pro-loading') &&
        indicators.length === (restored ? 3 : 0) && indicators.every(i => i.result.length === 1000) &&
        (!restored || Array.from({length:10},(_,i) => chart.getOverlayById('load-drawing-'+i)).every(Boolean))
      if (!ready) { requestAnimationFrame(check); return }
      // Two rAF boundaries allow a paint opportunity after the completed draw.
      // This is a readiness proxy, not a compositor/presentation timestamp.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.marks.ready = performance.now()
        clearTimeout(timeout)
        resolve()
      }))
    }
    requestAnimationFrame(check)
  })
  return {...window.marks, firstCandle:window.firstCandle}
}
window.ready = window.start()
window.ready.catch(error => { window.loadError = error.message })
</script>`

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  const asset = assets.get(path)
  if (asset) {
    const send = () => {
      res.writeHead(200, { 'Content-Type': asset.type, 'Content-Encoding': 'gzip', 'Cache-Control': path === '/history' ? 'no-store' : 'public, max-age=3600' })
      res.end(asset.gzip)
    }
    if (path === '/history') setTimeout(send, feedMs)
    else send()
  } else if (path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
    res.end(html)
  } else { res.writeHead(404); res.end() }
})
let browser
let environment
const samples = []
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  browser = await chromium.launch({ headless: true })
  environment = { timestamp: new Date().toISOString(), chromium: browser.version(), node: process.version,
    platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model }
  const origin = 'http://127.0.0.1:' + server.address().port
  for (const rate of rates) for (let run = 0; run < runs; run++) {
    for (const scenario of ['cold', 'warm', 'restore']) {
      // Each sample gets its own cache/storage; warm explicitly primes the bundle.
      const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 })
      try {
        const page = await context.newPage()
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        const cdp = await context.newCDPSession(page)
        await cdp.send('Emulation.setCPUThrottlingRate', { rate })
        if (kbps || latency) await cdp.send('Network.emulateNetworkConditions', {
          offline: false, latency, downloadThroughput: kbps ? kbps * 1000 / 8 : -1,
          uploadThroughput: kbps ? kbps * 1000 / 8 : -1
        })
        if (scenario === 'restore') await context.addInitScript(() => {
          localStorage.setItem('klinecharts-pro:indicators:BTC', JSON.stringify({main:[{name:'MA'}],sub:[{name:'VOL'},{name:'RSI'}]}))
          localStorage.setItem('klinecharts-pro:drawings:BTC', JSON.stringify(Array.from({length:10},(_,i) => ({
            id:'load-drawing-'+i,name:'horizontalStraightLine',points:[{value:98+i*0.5}]
          }))))
        })
        if (profileDir && scenario !== 'warm') {
          await cdp.send('Profiler.enable')
          await cdp.send('Profiler.start')
        }
        await page.goto(origin + (scenario === 'restore' ? '/?restore' : '/'), { waitUntil: 'load' })
        await page.waitForFunction(() => window.loadError || window.marks?.ready, null, { timeout: 20000 })
        assert.equal(await page.evaluate(() => window.loadError), undefined)
        if (profileDir && scenario !== 'warm') {
          const { profile } = await cdp.send('Profiler.stop')
          writeFileSync(join(profileDir, `${scenario}-${rate}x-${run + 1}.cpuprofile`), JSON.stringify(profile))
        }
        if (scenario === 'warm') await page.evaluate(async () => { window.pro.dispose(); await window.start() })
        const sample = await page.evaluate(async scenario => {
          const m = window.marks
          const base = scenario === 'warm' ? m.start : 0
          const resources = performance.getEntriesByType('resource').filter(e => /\/pro\.(js|css)$/.test(e.name))
          // Verify a real candle-colored pixel, after timing to avoid readback cost.
          const candlePixels = [...document.querySelectorAll('canvas')].some(canvas => {
            const pixels = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data
            for(let i=0;i<pixels.length;i+=4) if(pixels[i]===1 && pixels[i+1]===254 && pixels[i+2]===2 && pixels[i+3]>0) return true
            return false
          })
          const button = document.querySelector('[role="button"][aria-label="Indicators"]')
          if (!button) throw new Error('Indicators button missing')
          const inputStart = performance.now()
          button.click()
          await new Promise((resolve,reject) => {
            const timeout = setTimeout(() => reject(new Error('Indicator interaction timed out')),5000)
            const check = () => {
              if(!document.querySelector('.klinecharts-pro-indicator-modal')) {requestAnimationFrame(check);return}
              requestAnimationFrame(() => requestAnimationFrame(() => {clearTimeout(timeout);resolve()}))
            }
            requestAnimationFrame(check)
          })
          return {
            readyMs:m.ready-base, firstCandleDrawMs:window.firstCandle-base,
            constructorMs:m.constructorEnd-m.start, historyMs:m.historyReady-m.historyStart,
            historyToReadyMs:m.ready-m.historyReady,
            bundleLoadMs:scenario==='warm'?null:window.bundleReady-window.bundleStart,
            interactionMs:performance.now()-inputStart,
            longTaskMs:window.longTasks.filter(t => t.start>=base && t.start<m.ready).reduce((sum,t)=>sum+t.ms,0),
            assetTransferBytes:scenario==='warm'?null:resources.reduce((sum,r)=>sum+r.transferSize,0), candlePixels
          }
        }, scenario)
        assert.ok(sample.candlePixels, `${scenario}: candles must render`)
        assert.deepEqual(errors, [])
        delete sample.candlePixels
        samples.push({ scenario, rate, run, ...sample })
      } finally { await context.close() }
    }
    console.error('Initial-load run ' + (run + 1) + '/' + runs + ' at ' + rate + 'x complete')
  }
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
const percentile = (values, p) => values.sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)]
const summary = []
for (const rate of rates) for (const scenario of ['cold','warm','restore']) {
  const rows = samples.filter(s => s.rate===rate && s.scenario===scenario)
  const metrics = Object.fromEntries(Object.keys(rows[0]).filter(k => !['scenario','rate','run'].includes(k)).map(key => {
    const values = rows.map(row => row[key]).filter(v => v!==null)
    return [key, values.length ? {median:+percentile([...values],0.5).toFixed(1),p95:+percentile([...values],0.95).toFixed(1)} : null]
  }))
  summary.push({scenario,rate,samples:rows.length,...metrics})
}
console.log(JSON.stringify({environment,distDir,runs,rates,feedMs,kbps,latency,assets:Object.fromEntries([...assets].map(([path,a])=>[path,{rawBytes:a.body.length,gzipBytes:a.gzip.length}])),summary,samples},null,2))
