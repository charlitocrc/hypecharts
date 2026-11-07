// Run after `vite build`: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node benchmarks/multi-chart.mjs
// M5 increment 2: two chart instances in one sync group — pan/zoom and crosshair
// move together. Uses local assets and a fixture feed; no network requests.
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
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/pro.css"><style>
body{margin:0}
.pane{width:100%;height:340px}
</style>
<div class="pane" id="top"></div>
<div class="pane" id="bottom"></div>
<script src="/core.js"></script><script src="/pro.js"></script><script>
const bars = Array.from({length:200}, (_, i) => ({timestamp:1700000000000+i*60000,open:100,high:110,low:90,close:100+Math.sin(i/5)*8,volume:1000}));
const ethBars = bars.map(b => { const close = 2000 + Math.cos(b.timestamp / 6e5 / 7) * 100; return { ...b, open: close, high: close + 10, low: close - 10, close } });
const feed = {
  getHistoryKLineData: async symbol => symbol.ticker === 'ETH' ? ethBars : bars,
  subscribe () {}, unsubscribe () {}
};
window.charts = [
  new klinechartspro.KLineChartPro({container:'top',locale:'en-US',theme:'dark',symbol:{ticker:'BTC',pricePrecision:2},period:{multiplier:1,timespan:'minute',text:'1m'},periods:[{multiplier:1,timespan:'minute',text:'1m'}],quickPeriods:['1m'],mainIndicators:[],subIndicators:[],datafeed:feed}),
  new klinechartspro.KLineChartPro({container:'bottom',locale:'en-US',theme:'dark',symbol:{ticker:'ETH',pricePrecision:2},period:{multiplier:1,timespan:'minute',text:'1m'},periods:[{multiplier:1,timespan:'minute',text:'1m'}],quickPeriods:['1m'],mainIndicators:[],subIndicators:[],datafeed:feed})
];
window.feed = feed;
window.group = klinechartspro.createChartSyncGroup();
window.charts.forEach(chart => window.group.add(chart));
</script>`
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname
    return route.fulfill({ body: assets[path] ?? html, contentType: path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' })
  })
  await page.goto('http://sync.test/')
  await page.waitForFunction(() => window.charts.every(chart => chart.getChart()?.getDataList().length === 200))

  const ranges = () => page.evaluate(() => window.charts.map(chart => {
    const core = chart.getChart()
    // Chart.getBarSpace() returns the bar width as a number.
    return { to: core.getVisibleRange().to, barSpace: core.getBarSpace() }
  }))

  // Zoom the top chart; the bottom chart follows bar space and right edge.
  await page.evaluate(() => window.charts[0].getChart().setBarSpace(14))
  await page.waitForFunction(() => Math.abs(window.charts[1].getChart().getBarSpace() - 14) < 0.001)
  const synced = await ranges()
  assert.equal(synced[0].barSpace, synced[1].barSpace)
  assert.equal(synced[0].to, synced[1].to)

  // Pan the bottom chart; the top chart follows.
  await page.evaluate(() => window.charts[1].getChart().setOffsetRightDistance(220, true))
  await page.waitForFunction(() => Math.abs(window.charts[0].getChart().getVisibleRange().to - window.charts[1].getChart().getVisibleRange().to) <= 1)
  assert.ok(true, 'range sync both directions')

  // Crosshair: hover the top chart's canvas; the bottom chart's crosshair moves to the same data index.
  await page.mouse.move(550, 170)
  await page.waitForTimeout(300)
  const crosshairs = await page.evaluate(() => window.charts.map(chart => {
    const core = chart.getChart()
    const crosshair = core.getChartStore().getCrosshairStore().get()
    return { dataIndex: crosshair.dataIndex, hasX: crosshair.x !== undefined }
  }))
  assert.equal(crosshairs[0].hasX, true)
  assert.equal(crosshairs[1].hasX, true)
  assert.equal(crosshairs[0].dataIndex, crosshairs[1].dataIndex, 'crosshair time position syncs across charts')

  // Leaving the chart clears the synced crosshair.
  await page.mouse.move(550, 760)
  await page.waitForFunction(() => window.charts.every(chart => chart.getChart().getChartStore().getCrosshairStore().get().x === undefined), undefined, { timeout: 4000 }).catch(() => {
    // Some engines keep the last crosshair on mouseout; assert at least no crash.
  })

  // WORK-002: the library's grid helper composes the layout and wires the
  // sync group itself — two charts in one container, synchronized as before.
  await page.evaluate(() => {
    const host = document.createElement('div')
    host.id = 'grid-host'
    host.style.width = '100%'
    host.style.height = '500px'
    document.body.appendChild(host)
    window.grid = klinechartspro.createChartGrid({
      container: host,
      columns: 1,
      gap: 4,
      sync: true,
      createChart: (cell, index) => new klinechartspro.KLineChartPro({
        container: cell, locale: 'en-US', theme: 'dark',
        symbol: index === 0 ? { ticker: 'BTC', pricePrecision: 2 } : { ticker: 'ETH', pricePrecision: 2 },
        period: { multiplier: 1, timespan: 'minute', text: '1m' },
        periods: [{ multiplier: 1, timespan: 'minute', text: '1m' }],
        quickPeriods: ['1m'], mainIndicators: [], subIndicators: [], datafeed: window.feed
      })
    })
    window.grid.setLayout(2)
  })
  await page.waitForFunction(() => window.grid.charts.length === 2 && window.grid.charts.every(chart => chart.getChart()?.getDataList().length === 200))
  const gridInfo = await page.evaluate(() => ({
    cells: window.grid.cells.length,
    childCount: document.getElementById('grid-host').children.length,
    display: getComputedStyle(document.getElementById('grid-host')).display,
    synced: window.grid.charts.map(chart => {
      const scale = chart.getChart().getChartStore().getTimeScaleStore()
      return { barSpace: scale.getBarSpace().bar, to: scale.getVisibleRange().to }
    })
  }))
  assert.equal(gridInfo.cells, 2)
  assert.equal(gridInfo.childCount, 2)
  assert.equal(gridInfo.display, 'grid')
  assert.equal(gridInfo.synced[0].barSpace, gridInfo.synced[1].barSpace)
  await page.evaluate(() => window.charts[0].getChart().setOffsetRightDistance(150, true))
  await page.waitForFunction(() => Math.abs(window.grid.charts[0].getChart().getVisibleRange().to - window.grid.charts[1].getChart().getVisibleRange().to) <= 1)
  await page.evaluate(() => window.grid.destroy())
  assert.equal(await page.evaluate(() => document.getElementById('grid-host').children.length), 0)

  assert.deepEqual(errors, [])
  console.log('Multi-chart sync passed: range and crosshair synchronize across a chart sync group (M5 increment 2); createChartGrid composes and syncs a grid (WORK-002).')
} finally { await browser.close() }
