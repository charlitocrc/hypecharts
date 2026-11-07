// Run after `vite build`: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node benchmarks/chart-patterns.mjs
// Browser workflow check for the auto chart patterns: the category renders with
// all 18 entries, patterns add from the browser, geometry draws onto the canvas,
// a settings select recalculates, and layouts persist. Fixture feed only — this
// does not validate reference-platform detection parity.
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
// A double top that breaks its neckline and reaches the target, then drifts.
const way = [[0,90],[8,80],[20,120],[32,100],[44,120],[56,100],[70,70],[199,75]];
const bars = [];
for (let w = 0; w + 1 < way.length; w++) {
  const [i0,p0] = way[w], [i1,p1] = way[w+1];
  for (let i = w === 0 ? i0 : i0 + 1; i <= i1; i++) {
    const c = p0 + (p1 - p0) * (i - i0) / (i1 - i0);
    bars.push({timestamp:1700000000000+i*60000,open:c,high:c,low:c,close:c,volume:1000});
  }
}
const feed = {
  getHistoryKLineData: async () => bars,
  subscribe () {}, unsubscribe () {},
  config: async () => ({ exchanges: [{ key: 'TEST', name: 'Test' }], intervals: [{ multiplier: 1, timespan: 'minute', text: '1m' }] }),
  searchSymbols: async () => [{ ticker: 'BTC', exchange: 'TEST', symbol: 'BTC', description: 'BTC fixture' }],
  resolveSymbol: async (name) => ({ ticker: name, exchange: 'TEST', pricePrecision: 2 })
};
window.expectedBars = bars.length;
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
  const loaded = () => page.waitForFunction(() => window.pro.getChart()?.getDataList().length === window.expectedBars)
  await page.goto('http://chart.test/')
  await loaded()

  const names = () => page.evaluate(() => {
    const out = []
    window.pro.getChart().getIndicatorByPaneId().forEach(pane => pane.forEach((_, name) => out.push(name)))
    return out.sort()
  })
  const patterns = name => page.evaluate(target => {
    let rows = []
    window.pro.getChart().getIndicatorByPaneId().forEach(pane => pane.forEach((instance, instanceName) => {
      if (instanceName === target) rows = instance.result
    }))
    return rows.flatMap(row => row.patterns ?? []).map(p => ({ name: p.name, status: p.status, target: p.target, showTarget: p.showTarget }))
  }, name)
  const add = async (search, label) => {
    await page.getByRole('button', { name: 'Indicators', exact: true }).click()
    await page.getByLabel('Search indicators').fill(search)
    await page.getByRole('button', { name: `Add On chart: ${label}`, exact: true }).click()
    await page.keyboard.press('Escape')
    await page.locator('.klinecharts-pro-indicator-modal').waitFor({ state: 'detached' })
  }
  // Count the pattern color on the main canvases so "drew something" is measured, not assumed.
  const bearPixels = () => page.evaluate(() => {
    let count = 0
    document.querySelectorAll('#chart canvas').forEach(canvas => {
      if (canvas.width === 0 || canvas.height === 0) return
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] === 0xef && data[i + 1] === 0x53 && data[i + 2] === 0x50 && data[i + 3] === 255) count++
      }
    })
    return count
  })

  await page.getByRole('button', { name: 'Indicators', exact: true }).click()
  const categoryText = await page.locator('.klinecharts-pro-indicator-modal nav').textContent()
  assert.match(categoryText ?? '', /Chart patterns18/, 'Chart patterns category missing or wrong count')
  await page.keyboard.press('Escape')
  await page.locator('.klinecharts-pro-indicator-modal').waitFor({ state: 'detached' })

  // Added first so its legend row (and canvas-drawn settings icon) has a known position.
  const before = await bearPixels()
  await add('all chart patterns', 'All Chart Patterns')
  await page.waitForFunction(() => {
    let found = false
    window.pro.getChart().getIndicatorByPaneId().forEach(pane => pane.forEach((instance, name) => {
      if (name === 'CPALL' && instance.result.length > 0) found = true
    }))
    return found
  })
  await page.waitForTimeout(150)
  const after = await bearPixels()
  assert.ok(after > before + 50, `pattern geometry should draw on the canvas (pixels ${before} -> ${after})`)
  const all = await patterns('CPALL')
  assert.ok(all.some(p => p.name === 'CPDT'), 'All Chart Patterns should include the double top')
  assert.ok(all.some(p => p.showTarget), 'targets show by default')

  // The real dialog: Price Targets = None. Legend icons are canvas-drawn, so this clicks by position;
  // the wait clears the core's 500 ms double-click window.
  await page.waitForTimeout(550)
  await page.mouse.move(600, 300)
  await page.mouse.move(239, 72)
  await page.mouse.click(239, 72)
  const settings = page.locator('.klinecharts-pro-indicator-setting-modal')
  await settings.waitFor()
  await settings.getByLabel('Price Targets').selectOption('3')
  await settings.getByLabel('Failed Patterns').selectOption('1')
  await settings.getByRole('button', { name: 'Apply' }).click()
  await settings.waitFor({ state: 'detached' })
  await page.waitForFunction(() => {
    let done = false
    window.pro.getChart().getIndicatorByPaneId().forEach(pane => pane.forEach((instance, name) => {
      const rows = name === 'CPALL' ? instance.result.flatMap(row => row.patterns ?? []) : []
      if (rows.length > 0 && rows.every(p => !p.showTarget)) done = true
    }))
    return done
  })

  await add('double top', 'Double Top')
  await add('elliott', 'Elliott Wave')
  assert.deepEqual(await names(), ['CPALL', 'CPDT', 'CPEW'])
  await page.waitForFunction(() => {
    let found = false
    window.pro.getChart().getIndicatorByPaneId().forEach(pane => pane.forEach((instance, name) => {
      if (name === 'CPDT' && instance.result.length > 0) found = true
    }))
    return found
  })
  const detected = await patterns('CPDT')
  assert.equal(detected.length, 1, 'fixture double top should be detected once')
  assert.equal(detected[0].status, 'reached')
  assert.equal(detected[0].target, 80)

  await page.reload()
  await loaded()
  await page.waitForFunction(() => {
    let count = 0
    window.pro.getChart().getIndicatorByPaneId().forEach(pane => pane.forEach(() => { count++ }))
    return count === 3
  })
  assert.deepEqual(await names(), ['CPALL', 'CPDT', 'CPEW'])
  assert.deepEqual(await page.evaluate(() => window.pro.getChart().getIndicatorByPaneId('candle_pane', 'CPALL').calcParams), [0, 3, 0, 1], 'dialog inputs should persist')

  assert.deepEqual(errors, [])
  console.log('chart-patterns browser check passed:', (await names()).join(', '))
} finally {
  await browser.close()
}
