// Run after `vite build`: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node benchmarks/candle-patterns.mjs
// Browser workflow check for the candlestick-pattern category: the new
// Patterns category renders, representative patterns add from the browser,
// markers draw on the fixture, and layouts persist. Fixture feed only.
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
<div id="chart"></div>
<script src="/core.js"></script><script src="/pro.js"></script><script>
const bars = Array.from({length:200}, (_, i) => { const c = 100 + Math.sin(i/5)*8; return {timestamp:1700000000000+i*60000,open:c,high:c+1,low:c-1,close:c,volume:1000} });
const feed = {
  getHistoryKLineData: async () => bars,
  subscribe () {}, unsubscribe () {},
  config: async () => ({ exchanges: [{ key: 'TEST', name: 'Test' }], intervals: [{ multiplier: 1, timespan: 'minute', text: '1m' }] }),
  searchSymbols: async () => [{ ticker: 'BTC', exchange: 'TEST', symbol: 'BTC', description: 'BTC fixture' }],
  resolveSymbol: async (name) => ({ ticker: name, exchange: 'TEST', pricePrecision: 2 })
};
window.pro = new klinechartspro.KLineChartPro({container:'chart',locale:'en-US',theme:'dark',symbol:{ticker:'BTC',pricePrecision:2},period:{multiplier:1,timespan:'minute',text:'1m'},periods:[{multiplier:1,timespan:'minute',text:'1m'}],quickPeriods:['1m'],mainIndicators:[],subIndicators:[],datafeed:feed});
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
  await page.goto('http://chart.test/')
  await page.waitForFunction(() => window.pro.getChart()?.getDataList().length === 200)

  const names = () => page.evaluate(() => {
    const out = []
    window.pro.getChart().getIndicatorByPaneId().forEach(pane => pane.forEach((_, name) => out.push(name)))
    return out.sort()
  })
  const add = async (search, label) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    await page.getByRole('button', { name: 'Indicators', exact: true }).click()
    await page.getByLabel('Search indicators').fill(search)
    await page.getByRole('button', { name: new RegExp(`^Add On chart: ${escaped}$`) }).click()
    await page.keyboard.press('Escape')
    await page.locator('.klinecharts-pro-indicator-modal').waitFor({ state: 'detached' })
  }

  await add('bullish engulfing', 'Bullish Engulfing')
  await add('hammer', 'Hammer')
  await add('doji', 'Doji')
  await add('morning star', 'Morning Star')
  await add('three white soldiers', 'Three White Soldiers')
  await add('rising window', 'Rising Window')
  assert.deepEqual(await names(), ['DOJI', 'ENGB', 'HAMR', 'MOST', 'RWIN', 'TWS'])

  // the flat-body sine fixture flags Doji on every bar; the draw path must run clean
  const dojiFlags = await page.evaluate(() => {
    let rows
    window.pro.getChart().getIndicatorByPaneId().forEach(pane => pane.forEach((instance, instanceName) => {
      if (instanceName === 'DOJI') rows = instance.result
    }))
    return rows.filter(row => row.value !== undefined).length
  })
  assert.ok(dojiFlags === 200, `doji should flag every flat-body bar, got ${dojiFlags}`)

  // the Patterns category exists in the drawer with all 44 entries
  await page.getByRole('button', { name: 'Indicators', exact: true }).click()
  const categoryText = await page.locator('.klinecharts-pro-indicator-modal nav').textContent()
  assert.match(categoryText ?? '', /Candlestick patterns44/, 'Patterns category missing or wrong count')
  await page.keyboard.press('Escape')
  await page.locator('.klinecharts-pro-indicator-modal').waitFor({ state: 'detached' })

  await page.reload()
  await page.waitForFunction(() => window.pro.getChart()?.getDataList().length === 200)
  assert.deepEqual(await names(), ['DOJI', 'ENGB', 'HAMR', 'MOST', 'RWIN', 'TWS'])

  assert.deepEqual(errors, [])
  console.log('candle-patterns browser check passed:', (await names()).join(', '))
} finally {
  await browser.close()
}
