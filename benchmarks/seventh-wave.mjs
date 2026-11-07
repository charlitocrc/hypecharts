// Run after `vite build`: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node benchmarks/seventh-wave.mjs
// Browser workflow check for the seventh-wave volatility family (CHAVOL, RVI,
// C2C, C2CZT, VOHLC, UI, VSTOP, CKS, CMO, CRSI, SMI, MASS, SMIE, RVGI):
// menu search, add to panes, values computed, persistence. Fixture feed only.
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

  await add('volatility stop', 'Volatility Stop', 'On chart')
  await add('kroll', 'Chande Kroll Stop', 'On chart')
  for (const [search, label] of [
    ['chaikin volatility', 'Chaikin Volatility'],
    ['relative volatility', 'Relative Volatility Index'],
    ['annualized log returns', 'Volatility Close-to-Close'],
    ['zero trend', 'Volatility Zero Trend Close-to-Close'],
    ['volatility o-h-l-c', 'Volatility O-H-L-C'],
    ['ulcer', 'Ulcer Index'],
    ['chande momentum', 'Chande Momentum Oscillator'],
    ['connors', 'Connors RSI'],
    ['stochastic momentum', 'Stochastic Momentum Index'],
    ['mass index', 'Mass Index'],
    ['ergodic', 'SMI Ergodic'],
    ['vigor', 'Relative Vigor Index']
  ]) {
    await add(search, label, 'New pane')
  }
  assert.deepEqual(await names(), ['C2C', 'C2CZT', 'CHAVOL', 'CKS', 'CMO', 'CRSI', 'MASS', 'RVGI', 'RVI', 'SMI', 'SMIE', 'UI', 'VOHLC', 'VSTOP'])

  for (const indicator of ['CHAVOL', 'RVI', 'C2C', 'C2CZT', 'VOHLC', 'UI', 'CMO', 'CRSI', 'SMI', 'MASS', 'SMIE', 'RVGI']) {
    const row = await lastValues(indicator)
    const values = Object.values(row ?? {})
    assert.ok(values.some(v => typeof v === 'number' && Number.isFinite(v)), `${indicator} last row has no finite number: ${JSON.stringify(row)}`)
  }
  const rvi = await lastValues('RVI')
  assert.ok(rvi.value >= 0 && rvi.value <= 100, `RVI out of range: ${rvi.value}`)
  const cmo = await lastValues('CMO')
  assert.ok(Math.abs(cmo.value) <= 100, `CMO out of range: ${cmo.value}`)
  const stop = await lastValues('VSTOP')
  const kroll = await lastValues('CKS')
  assert.ok(stop.up !== undefined || stop.down !== undefined, 'VSTOP emitted no stop')
  assert.ok(kroll.long !== undefined && kroll.short !== undefined, 'CKS missing stops')

  await page.reload()
  await page.waitForFunction(() => window.pro.getChart()?.getDataList().length === 200)
  assert.deepEqual(await names(), ['C2C', 'C2CZT', 'CHAVOL', 'CKS', 'CMO', 'CRSI', 'MASS', 'RVGI', 'RVI', 'SMI', 'SMIE', 'UI', 'VOHLC', 'VSTOP'])

  assert.deepEqual(errors, [])
  console.log('seventh-wave browser check passed:', (await names()).join(', '))
} finally {
  await browser.close()
}
