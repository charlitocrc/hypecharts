// Run after `vite build`: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node benchmarks/sixth-wave.mjs
// Browser workflow check for the sixth-wave indicators (DPO, COPPOCK, KVO,
// KST, MCGINLEY, ALMA, LSMA, LRSLOPE, ZIGZAG, FRACTAL, W52): menu search, add
// to panes, values computed, custom draw paths, persistence. Fixture feed only.
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
  const lastValues = name => page.evaluate(indicator => {
    let rows
    window.pro.getChart().getIndicatorByPaneId().forEach(pane => pane.forEach((instance, instanceName) => {
      if (instanceName === indicator) rows = instance.result
    }))
    return rows?.[rows.length - 1] ?? null
  }, name)
  const add = async (search, label, placement) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    await page.getByRole('button', { name: 'Indicators', exact: true }).click()
    await page.getByLabel('Search indicators').fill(search)
    await page.getByRole('button', { name: new RegExp(`^Add ${placement}: ${escaped}$`) }).click()
    await page.keyboard.press('Escape')
    await page.locator('.klinecharts-pro-indicator-modal').waitFor({ state: 'detached' })
  }

  await add('legoux', 'Arnaud Legoux Moving Average', 'On chart')
  await add('mcginley', 'McGinley Dynamic', 'On chart')
  await add('least squares', 'Least Squares Moving Average', 'On chart')
  await add('zig zag', 'Zig Zag', 'On chart')
  await add('fractal', 'Williams Fractal', 'On chart')
  await add('52 week', '52 Week High/Low', 'On chart')
  await add('detrended', 'Detrended Price Oscillator', 'New pane')
  await add('coppock', 'Coppock Curve', 'New pane')
  await add('klinger', 'Klinger Oscillator', 'New pane')
  await add('sure thing', 'Know Sure Thing', 'New pane')
  await add('regression slope', 'Linear Regression Slope', 'New pane')
  assert.deepEqual(await names(), ['ALMA', 'COPPOCK', 'DPO', 'FRACTAL', 'KST', 'KVO', 'LRSLOPE', 'LSMA', 'MCGINLEY', 'W52', 'ZIGZAG'])

  const sineHasPivot = name => page.evaluate(indicator => {
    let rows
    window.pro.getChart().getIndicatorByPaneId().forEach(pane => pane.forEach((instance, instanceName) => {
      if (instanceName === indicator) rows = instance.result
    }))
    return rows.some(row => row.value !== undefined)
  }, name)
  assert.ok(await sineHasPivot('ZIGZAG'), 'zigzag found no pivots on the sine fixture')
  const fractals = await page.evaluate(() => {
    let rows
    window.pro.getChart().getIndicatorByPaneId().forEach(pane => pane.forEach((instance, instanceName) => {
      if (instanceName === 'FRACTAL') rows = instance.result
    }))
    return { up: rows.some(row => row.up !== undefined), down: rows.some(row => row.down !== undefined) }
  })
  assert.ok(fractals.up && fractals.down, 'fractal markers missing on the sine fixture')
  const w52 = await lastValues('W52')
  assert.ok(w52.high >= w52.low && w52.high > 0, `52-week extremes broken: ${JSON.stringify(w52)}`)
  for (const indicator of ['DPO', 'COPPOCK', 'KVO', 'KST', 'LRSLOPE', 'MCGINLEY', 'ALMA', 'LSMA']) {
    const row = await lastValues(indicator)
    const value = row.value ?? row.kvo ?? row.kst
    assert.ok(typeof value === 'number' && Number.isFinite(value), `${indicator} last value not finite: ${JSON.stringify(row)}`)
  }

  // reload: custom-drawn overlays restore from persisted layout
  await page.reload()
  await page.waitForFunction(() => window.pro.getChart()?.getDataList().length === 200)
  assert.deepEqual(await names(), ['ALMA', 'COPPOCK', 'DPO', 'FRACTAL', 'KST', 'KVO', 'LRSLOPE', 'LSMA', 'MCGINLEY', 'W52', 'ZIGZAG'])

  assert.deepEqual(errors, [])
  console.log('sixth-wave browser check passed:', (await names()).join(', '))
} finally {
  await browser.close()
}
