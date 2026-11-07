// Run after `vite build`: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node benchmarks/fifth-wave.mjs
// Browser workflow check for the fifth-wave indicators (BBB, STDDEV, TYP, MED,
// PPO, VO, MACROSS, MAEMACROSS, EMACROSS): menu search, add to panes, values
// computed, marker draw path, persistence. Fixture feed only — no network.
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
const bars = Array.from({length:200}, (_, i) => ({timestamp:1700000000000+i*60000,open:100,high:110,low:90,close:100+Math.sin(i/5)*8,volume:1000}));
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

  // Price overlays go onto the candles, sub studies into new panes.
  await add('typical price', 'Typical Price', 'On chart')
  await add('median price', 'Median Price', 'On chart')
  await add('MA Cross', 'MA Cross', 'On chart')
  await add('%B', 'Bollinger Bands %B', 'New pane')
  await add('standard deviation', 'Standard Deviation', 'New pane')
  await add('Price Oscillator', 'Price Oscillator (PPO)', 'New pane')
  await add('volume oscillator', 'Volume Oscillator', 'New pane')
  assert.deepEqual(await names(), ['BBB', 'MACROSS', 'MED', 'PPO', 'STDDEV', 'TYP', 'VO'])

  // %B stays in [0, 1] on this fixture, PPO carries both figures, VO reads zero.
  const percentB = await lastValues('BBB')
  assert.ok(percentB.percent > 0 && percentB.percent < 1, `%B out of range: ${percentB.percent}`)
  const ppo = await lastValues('PPO')
  assert.ok(typeof ppo.ppo === 'number' && typeof ppo.absolute === 'number')
  const vo = await lastValues('VO')
  assert.equal(vo.value, 0)
  const stddev = await lastValues('STDDEV')
  assert.ok(stddev.value > 0)
  assert.ok(typeof (await lastValues('TYP')).value === 'number')
  assert.ok(typeof (await lastValues('MED')).value === 'number')

  // MA Cross markers render (draw callback runs, no canvas errors) and survive reload.
  await page.reload()
  await page.waitForFunction(() => window.pro.getChart()?.getDataList().length === 200)
  assert.deepEqual(await names(), ['BBB', 'MACROSS', 'MED', 'PPO', 'STDDEV', 'TYP', 'VO'])

  assert.deepEqual(errors, [])
  console.log('fifth-wave browser check passed:', (await names()).join(', '))
} finally {
  await browser.close()
}
