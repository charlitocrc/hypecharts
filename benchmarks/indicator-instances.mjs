// Run after `vite build`: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node benchmarks/indicator-instances.mjs
// Uses local assets and a fixture feed. No exchange or trading requests are made.
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
const bars5m = bars.filter((_, i) => i % 5 === 0);
const ethBars = bars.map((b, i) => { const close = 2000 + Math.cos(i / 7) * 100; return { timestamp: b.timestamp, open: close, high: close + 10, low: close - 10, close, volume: b.volume } });
const feed = {
  getHistoryKLineData: async (symbol, period) => {
    if (symbol.ticker === 'ETH') return ethBars
    if (period.text === '5m') return bars5m
    return bars
  },
  subscribe () {}, unsubscribe () {},
  config: async () => ({ exchanges: [{ key: 'TEST', name: 'Test' }], intervals: [{ multiplier: 1, timespan: 'minute', text: '1m' }, { multiplier: 5, timespan: 'minute', text: '5m' }] }),
  searchSymbols: async (query) => ['BTC', 'ETH', 'SOL'].filter(t => t.toLowerCase().includes(query.trim().toLowerCase())).map(t => ({ ticker: t, exchange: 'TEST', symbol: t, description: t + ' fixture' })),
  resolveSymbol: async (name) => ({ ticker: name.split(':').pop(), exchange: 'TEST', pricePrecision: 2 })
};
window.pro = new klinechartspro.KLineChartPro({container:'chart',locale:'en-US',theme:'dark',symbol:{ticker:'BTC',pricePrecision:2},period:{multiplier:1,timespan:'minute',text:'1m'},periods:[{multiplier:1,timespan:'minute',text:'1m'},{multiplier:5,timespan:'minute',text:'5m'}],quickPeriods:['1m'],mainIndicators:[],subIndicators:[],datafeed:feed});
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

  const instances = () => page.evaluate(() => {
    const out = {}
    window.pro.getChart().getIndicatorByPaneId().forEach((pane, paneId) => {
      pane.forEach((indicator, name) => { out[name] = { paneId, shortName: indicator.shortName, calcParams: indicator.calcParams, values: indicator.result.length } })
    })
    return out
  })
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('klinecharts-pro:indicators:BTC') ?? 'null'))
  const add = async (name, placement) => {
    await page.getByRole('button', { name: new RegExp(`^Add ${placement}: ${name}( \\(\\d+\\))?$`) }).click()
  }

  await page.getByRole('button', { name: 'Indicators', exact: true }).click()
  await page.getByLabel('Search indicators').fill('EMA')
  await add('Exponential Moving Average', 'On chart')
  await add('Exponential Moving Average', 'On chart')
  assert.match(await page.getByRole('button', { name: /^Add On chart: Exponential Moving Average/ }).getAttribute('aria-label') ?? '', /\(2\)$/)
  await page.getByLabel('Search indicators').fill('RSI')
  await add('Relative Strength Index', 'New pane')
  await add('Relative Strength Index', 'New pane')
  await page.keyboard.press('Escape')
  await page.locator('.klinecharts-pro-indicator-modal').waitFor({ state: 'detached' })

  const undo = page.getByRole('button', { name: /^Undo / })
  const redo = page.getByRole('button', { name: /^Redo / })
  const ids = async () => Object.keys(await instances()).sort()
  assert.equal(await undo.getAttribute('title'), 'Undo add RSI (Ctrl/⌘ Z)')
  await undo.click()
  await undo.click()
  assert.deepEqual(await ids(), ['EMA', 'EMA~2'])
  assert.deepEqual((await stored()).sub, [])
  assert.equal(await redo.getAttribute('title'), 'Redo add RSI (Ctrl/⌘ Shift Z)')
  await redo.click()
  await redo.click()
  assert.deepEqual(await ids(), ['EMA', 'EMA~2', 'RSI', 'RSI~2'])
  assert.equal(await redo.isDisabled(), true)

  await page.getByRole('button', { name: 'Candle Type', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /Heikin Ashi/ }).click()
  assert.equal(await undo.getAttribute('title'), 'Undo chart type (Ctrl/⌘ Z)')
  await undo.click()
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('klinecharts-pro:settings') ?? '{}').chartType ?? 'candle_solid'), 'candle_solid')
  await redo.click()
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('klinecharts-pro:settings') ?? '{}').chartType), 'heikin_ashi')
  await undo.click()
  assert.equal(await undo.getAttribute('title'), 'Undo add RSI (Ctrl/⌘ Z)')

  let live = await instances()
  assert.deepEqual(Object.keys(live).sort(), ['EMA', 'EMA~2', 'RSI', 'RSI~2'])
  assert.equal(live.EMA.paneId, 'candle_pane')
  assert.equal(live['EMA~2'].paneId, 'candle_pane')
  assert.equal(live['EMA~2'].shortName, 'EMA')
  assert.notEqual(live.RSI.paneId, live['RSI~2'].paneId)
  assert.ok(live['EMA~2'].values === 200 && live['RSI~2'].values === 200)
  assert.deepEqual((await stored()).main.map(item => item.name), ['EMA', 'EMA~2'])

  await page.evaluate(() => window.pro.getChart().overrideIndicator({ name: 'EMA~2', calcParams: [50, 12, 20] }, 'candle_pane'))
  await page.reload()
  await page.waitForFunction(() => window.pro.getChart()?.getDataList().length === 200)
  live = await instances()
  assert.deepEqual(Object.keys(live).sort(), ['EMA', 'EMA~2', 'RSI', 'RSI~2'])
  assert.deepEqual(live['EMA~2'].calcParams, [50, 12, 20])
  assert.deepEqual(live.EMA.calcParams, [6, 12, 20])

  const greenPixels = expected => page.waitForFunction(expected => [...document.querySelectorAll('canvas')].some(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    for (let i = 0; i < data.length; i += 4) if (data[i] < 40 && data[i + 1] > 215 && data[i + 2] < 40 && data[i + 3] > 200) return true
    return false
  }) === expected, expected, { timeout: 2000 }).then(() => expected, () => !expected)
  const plotsOf = name => page.evaluate(name => window.pro.getChart().getIndicatorByPaneId('candle_pane', name).styles?.plots, name)
  const settings = page.locator('.klinecharts-pro-indicator-setting-modal')
  const openSettings = async () => {
    // ponytail: legend icons are canvas-drawn, so this clicks the fixture's second legend row settings icon.
    // The wait clears the core's 500 ms double-click window, which would swallow a fast repeat click.
    await page.waitForTimeout(550)
    await page.mouse.move(600, 300)
    await page.mouse.move(181, 93)
    await page.mouse.click(181, 93)
    await settings.waitFor()
  }
  assert.equal(await greenPixels(false), false)
  await openSettings()
  assert.equal(await settings.locator('.plot-visible span').first().innerText(), 'EMA50')
  await settings.getByLabel('Color EMA50').fill('#00ff00')
  await settings.getByLabel('Width EMA50').selectOption('3')
  await settings.getByRole('button', { name: 'Apply' }).click()
  assert.deepEqual(await plotsOf('EMA~2'), { ema1: { color: '#00ff00', size: 3 } })
  assert.equal(await plotsOf('EMA'), undefined)
  assert.deepEqual((await stored()).main[1].plots, { ema1: { color: '#00ff00', size: 3 } })
  assert.equal(await greenPixels(true), true)

  await openSettings()
  await settings.locator('.plot-visible input').first().uncheck()
  await settings.getByRole('button', { name: 'Apply' }).click()
  assert.deepEqual(await plotsOf('EMA~2'), { ema1: { color: '#00ff00', size: 3, visible: false } })
  assert.equal(await greenPixels(false), false)

  assert.equal(await undo.getAttribute('title'), 'Undo EMA settings (Ctrl/⌘ Z)')
  await undo.click()
  assert.deepEqual(await plotsOf('EMA~2'), { ema1: { color: '#00ff00', size: 3 } })
  assert.equal(await greenPixels(true), true)
  await undo.click()
  assert.deepEqual(await plotsOf('EMA~2'), {})
  assert.equal(await greenPixels(false), false)
  assert.equal((await stored()).main[1].plots, undefined)
  await redo.click()
  await redo.click()
  assert.deepEqual(await plotsOf('EMA~2'), { ema1: { color: '#00ff00', size: 3, visible: false } })
  assert.deepEqual((await stored()).main[1].plots, { ema1: { color: '#00ff00', size: 3, visible: false } })

  await page.reload()
  await page.waitForFunction(() => window.pro.getChart()?.getDataList().length === 200)
  assert.deepEqual(await plotsOf('EMA~2'), { ema1: { color: '#00ff00', size: 3, visible: false } })
  await openSettings()
  await settings.getByRole('button', { name: 'Restore default' }).click()
  await settings.getByRole('button', { name: 'Apply' }).click()
  assert.deepEqual(await plotsOf('EMA~2'), {})
  assert.equal((await stored()).main[1].plots, undefined)

  // IND-002: calculation inputs — source, offset, per-study timeframe
  const lastValueOf = name => page.evaluate(name => {
    const indicator = window.pro.getChart().getIndicatorByPaneId('candle_pane', name)
    return indicator.result[indicator.result.length - 1].ema1
  }, name)
  const closeEma = await lastValueOf('EMA~2')
  await openSettings()
  const sourceSelect = settings.getByLabel('Source')
  assert.equal(await sourceSelect.inputValue(), 'close')
  await sourceSelect.selectOption({ label: 'HLC3' })
  await settings.getByLabel('Offset (bars)').fill('5')
  await settings.getByRole('button', { name: 'Apply' }).click()
  assert.deepEqual(await page.evaluate(() => {
    const indicator = window.pro.getChart().getIndicatorByPaneId('candle_pane', 'EMA~2')
    return { source: indicator.source, offset: indicator.offset }
  }), { source: 'hlc3', offset: 5 })
  const hlc3Ema = await lastValueOf('EMA~2')
  assert.notEqual(closeEma, hlc3Ema)
  const storedInputs = (await stored()).main.find(item => item.name === 'EMA~2')
  assert.equal(storedInputs.source, 'hlc3')
  assert.equal(storedInputs.offset, 5)

  await openSettings()
  await settings.getByLabel('Timeframe').selectOption('5m')
  await settings.getByRole('button', { name: 'Apply' }).click()
  await page.waitForFunction(() => {
    const indicator = window.pro.getChart().getIndicatorByPaneId('candle_pane', 'EMA~2')
    return Array.isArray(indicator.timeframeData) && indicator.timeframeData.length === 200
  })
  const tfEma = await lastValueOf('EMA~2')
  assert.notEqual(tfEma, hlc3Ema)
  assert.equal((await stored()).main.find(item => item.name === 'EMA~2').timeframe, '5m')

  await openSettings()
  await settings.getByRole('button', { name: 'Restore default' }).click()
  await settings.getByRole('button', { name: 'Apply' }).click()
  assert.equal(await page.evaluate(() => {
    const indicator = window.pro.getChart().getIndicatorByPaneId('candle_pane', 'EMA~2')
    return `${indicator.source ?? ''}|${indicator.offset ?? ''}|${indicator.timeframe ?? ''}`
  }), 'close|0|')
  // persisted layout drops the defaults entirely
  const resetInputs = (await stored()).main.find(item => item.name === 'EMA~2')
  assert.equal(resetInputs.source, undefined)
  assert.equal(resetInputs.offset, undefined)
  assert.equal(resetInputs.timeframe, undefined)

  await page.evaluate(() => { window.pro.getChart().removeIndicator('candle_pane', 'EMA') })
  live = await instances()
  assert.ok(!('EMA' in live) && 'EMA~2' in live)

  const rsiPane = live.RSI.paneId
  await page.evaluate(paneId => {
    const chart = window.pro.getChart()
    chart.setPaneOptions({ id: paneId, height: 180 })
    chart.setBarSpace(14)
  }, rsiPane)
  await page.reload()
  await page.waitForFunction(() => window.pro.getChart()?.getDataList().length === 200)
  live = await instances()
  assert.equal(await page.evaluate(paneId => Math.round(window.pro.getChart().getSize(paneId).height), live.RSI.paneId), 180)
  assert.equal(await page.evaluate(() => window.pro.getChart().getBarSpace()), 14)

  // M5 WORK-001: compare series on the main pane. New compares draw in
  // their own scale (independent): venue prices pass through, the instance is
  // own-scale, and the pane axis ignores them entirely — the candle range
  // must not move even though ETH trades an order of magnitude above BTC.
  const candleRangeBefore = await page.evaluate(() => {
    const extremum = window.pro.getChart().getPaneById('candle_pane')?.getAxisComponent?.()?.getExtremum?.()
    return Math.round((extremum?.range ?? 0) * 1e6) / 1e6
  })
  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  const compareDialog = page.locator('.klinecharts-pro-symbol-search-modal')
  await compareDialog.waitFor()
  assert.match(await compareDialog.locator('.title-container').innerText(), /Compare symbol/)
  await compareDialog.getByRole('searchbox', { name: 'Symbol Search' }).fill('eth')
  await page.waitForFunction(() => [...document.querySelectorAll('.symbol-search-results .symbol-row')].some(row => row.textContent.includes('ETH')), undefined, { timeout: 4000 })
  await compareDialog.locator('.symbol-row', { hasText: 'ETH' }).first().click()
  await page.waitForFunction(() => {
    const indicator = window.pro.getChart().getIndicatorByPaneId('candle_pane', 'COMPARE')
    return Array.isArray(indicator?.extendData?.values) && indicator.extendData.values.length === 200
  })
  const compareState = await page.evaluate(() => {
    const chart = window.pro.getChart()
    const indicator = chart.getIndicatorByPaneId('candle_pane', 'COMPARE')
    const extremum = chart.getPaneById('candle_pane')?.getAxisComponent?.()?.getExtremum?.()
    return {
      shortName: indicator.shortName,
      ownScale: indicator.ownScale === true,
      mode: indicator.extendData.mode,
      first: indicator.extendData.values[0],
      anchor: chart.getDataList()[0].close,
      candleRangeAfter: Math.round((extremum?.range ?? 0) * 1e6) / 1e6,
      stored: JSON.parse(localStorage.getItem('klinecharts-pro:indicators:BTC') ?? '[]').main.find(item => item.name === 'COMPARE')?.compare
    }
  })
  assert.equal(compareState.shortName, 'ETH')
  assert.equal(compareState.mode, 'independent')
  assert.equal(compareState.ownScale, true)
  // independent: venue prices pass through, so the first value is the
  // compare's own close, NOT the main anchor
  assert.ok(Math.abs(compareState.first - compareState.anchor) > 1e-6, `independent first value ${compareState.first} vs anchor ${compareState.anchor}`)
  assert.equal(compareState.candleRangeAfter, candleRangeBefore, 'own-scale compare must not move the candle axis range')
  assert.equal(compareState.stored?.ticker, 'ETH')
  assert.equal(compareState.stored?.exchange, 'TEST')
  assert.equal(compareState.stored?.mode, 'independent')
  // undo removes the comparison, redo brings it back (values re-aligned)
  await undo.click()
  assert.equal(await page.evaluate(() => window.pro.getChart().getIndicatorByPaneId('candle_pane', 'COMPARE')), null)
  await redo.click()
  await page.waitForFunction(() => {
    const indicator = window.pro.getChart().getIndicatorByPaneId('candle_pane', 'COMPARE')
    return Array.isArray(indicator?.extendData?.values) && indicator.extendData.values.length === 200
  })
  // survives a reload (target persisted with its mode, bars re-fetched)
  await page.reload()
  await page.waitForFunction(() => {
    const indicator = window.pro.getChart().getIndicatorByPaneId('candle_pane', 'COMPARE')
    return Array.isArray(indicator?.extendData?.values) && indicator.extendData.values.length === 200
  })
  const restoredCompare = await page.evaluate(() => {
    const indicator = window.pro.getChart().getIndicatorByPaneId('candle_pane', 'COMPARE')
    return { ownScale: indicator.ownScale === true, mode: indicator.extendData.mode }
  })
  assert.equal(restoredCompare.mode, 'independent')
  assert.equal(restoredCompare.ownScale, true)
  await page.evaluate(() => window.pro.getChart().removeIndicator('candle_pane', 'COMPARE'))

  // layouts saved before independent scales existed restore as pinned
  // (seed the layout and switch symbols — a reload would flush the live
  // layout over the seeded storage before it is read)
  await page.evaluate(() => {
    const layout = { main: [{ name: 'COMPARE', compare: { ticker: 'ETH', exchange: 'TEST', market: 'perpetual', shortName: 'ETH', mode: 'pinned' } }], sub: [] }
    localStorage.setItem('klinecharts-pro:indicators:Hyperliquid:perpetual:ETH', JSON.stringify(layout))
    window.pro.setSymbol({ ticker: 'ETH', exchange: 'Hyperliquid', market: 'perpetual', pricePrecision: 2 })
  })
  await page.waitForFunction(() => {
    const indicator = window.pro.getChart().getIndicatorByPaneId('candle_pane', 'COMPARE')
    return Array.isArray(indicator?.extendData?.values) && indicator.extendData.values.length === 200
  })
  const pinnedRestore = await page.evaluate(() => {
    const chart = window.pro.getChart()
    const indicator = chart.getIndicatorByPaneId('candle_pane', 'COMPARE')
    return { ownScale: indicator.ownScale === true, mode: indicator.extendData.mode, first: indicator.extendData.values[0], anchor: chart.getDataList()[0].close }
  })
  assert.equal(pinnedRestore.mode, 'pinned')
  assert.equal(pinnedRestore.ownScale, false)
  assert.ok(Math.abs(pinnedRestore.first - pinnedRestore.anchor) < 1e-6, `pinned restore first ${pinnedRestore.first} vs anchor ${pinnedRestore.anchor}`)
  await page.evaluate(() => window.pro.getChart().removeIndicator('candle_pane', 'COMPARE'))

  await page.evaluate(() => {
    localStorage.setItem('klinecharts-pro:indicators:SOL', JSON.stringify({ main: [{ name: 'MA', calcParams: [7] }], sub: [] }))
    window.pro.setSymbol({ ticker: 'SOL', exchange: 'Hyperliquid', market: 'perpetual', pricePrecision: 2 })
  })
  await page.waitForFunction(() => window.pro.getChart().getIndicatorByPaneId('candle_pane', 'MA') !== null)
  assert.notEqual(await page.evaluate(() => localStorage.getItem('klinecharts-pro:indicators:Hyperliquid:perpetual:SOL')), null)
  assert.equal(await page.evaluate(() => localStorage.getItem('klinecharts-pro:indicators:SOL')), null)
  await page.evaluate(() => window.pro.setSymbol({ ticker: 'SOL', exchange: 'Other', market: 'perpetual', pricePrecision: 2 }))
  await page.waitForFunction(() => window.pro.getChart().getIndicatorByPaneId('candle_pane', 'MA') === null)

  assert.deepEqual(errors, [])
  console.log('Indicator workflow passed: repeated instances on chart and in panes, independent params, per-plot color/width/visibility, reload restore, reset, and undo/redo of indicator add, settings and chart type, pane height/zoom restore, exchange+market keys with legacy migration, calculation inputs (source/offset/timeframe), compare series (M5).')
} finally { await browser.close() }
