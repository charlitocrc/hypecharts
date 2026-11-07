// Run after `vite build`: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node benchmarks/drawing-styles.mjs
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
const t = i => 1700000000000 + i * 60000
const seed = {
  BTC: [{ name: 'fibonacciLine', points: [{ timestamp: t(120), value: 95 }, { timestamp: t(160), value: 105 }], lock: false, visible: true }],
  ETH: [{ name: 'rect', points: [{ timestamp: t(60), value: 108 }, { timestamp: t(100), value: 92 }], lock: false, visible: true }],
  SOL: [{ name: 'pitchfork', points: [{ timestamp: t(40), value: 100 }, { timestamp: t(80), value: 106 }, { timestamp: t(80), value: 94 }], lock: false, visible: true }]
}
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/pro.css"><style>body{margin:0}#chart{width:100%;height:700px}</style>
<div id="chart"></div>
<script>if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); ${Object.entries(seed).map(([ticker, drawings]) => `localStorage.setItem('klinecharts-pro:drawings:${ticker}', ${JSON.stringify(JSON.stringify(drawings))});`).join(' ')} }</script>
<script src="/core.js"></script><script src="/pro.js"></script><script>
const bars = Array.from({length:200}, (_, i) => ({timestamp:1700000000000+i*60000,open:100,high:110,low:90,close:100,volume:1000}));
window.pro = new klinechartspro.KLineChartPro({container:'chart',locale:'en-US',theme:'dark',symbol:{ticker:'BTC',pricePrecision:2},period:{multiplier:1,timespan:'minute',text:'1m'},periods:[{multiplier:1,timespan:'minute',text:'1m'}],quickPeriods:['1m'],mainIndicators:[],subIndicators:[],datafeed:{getHistoryKLineData:async()=>bars,subscribe(){},unsubscribe(){}}});
</script>`
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname
    return route.fulfill({ body: assets[path] ?? html, contentType: path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' })
  })
  await page.goto('http://chart.test/')
  await page.waitForFunction(() => window.pro.getChart()?.getDataList().length === 200)

  const stored = ticker => page.evaluate(ticker => JSON.parse(localStorage.getItem(`klinecharts-pro:drawings:${ticker}`)), ticker)
  const pixels = ([r, g, b]) => page.evaluate(([r, g, b]) => {
    let count = 0
    const rows = new Set()
    for (const canvas of document.querySelectorAll('canvas')) {
      const { width, height } = canvas
      const data = canvas.getContext('2d').getImageData(0, 0, width, height).data
      for (let i = 0; i < data.length; i += 4) {
        if (Math.abs(data[i] - r) < 30 && Math.abs(data[i + 1] - g) < 30 && Math.abs(data[i + 2] - b) < 30 && data[i + 3] > 200) {
          count++
          if ((i / 4) % width === 50) rows.add(Math.floor(i / 4 / width))
        }
      }
    }
    const runs = [...rows].sort((a, b) => a - b).filter((row, index, all) => index === 0 || row - all[index - 1] > 2).length
    return { count, runs }
  }, [r, g, b])
  const settle = () => page.waitForTimeout(250)
  const editor = page.locator('.klinecharts-pro-drawing-editor')
  const openEditor = async () => {
    if (await page.locator('.klinecharts-pro-drawing-manager').count() === 0) {
      await page.getByRole('button', { name: 'Layers', exact: true }).click()
    }
    await page.locator('.klinecharts-pro-drawing-manager li .drawing-name').first().click()
    await editor.waitFor()
  }
  const switchTo = async ticker => {
    await page.evaluate(ticker => window.pro.setSymbol({ ticker, pricePrecision: 2 }), ticker)
    await settle()
  }

  await openEditor()
  assert.equal(await editor.getByLabel(/Comma-separated ratios/).inputValue(), '1, 0.786, 0.618, 0.5, 0.382, 0.236, 0')
  await editor.getByLabel(/Comma-separated ratios/).fill('0, 0.5, oops')
  assert.equal(await editor.getByRole('button', { name: 'Apply', exact: true }).isDisabled(), true)
  await editor.getByLabel(/Comma-separated ratios/).fill('0, 0.5, 1')
  // per-level colors: level tools no longer expose a flat stroke picker
  assert.equal(await editor.getByLabel('Stroke color', { exact: true }).count(), 0)
  await editor.locator('.level-fields').last().locator('input[type=color]').fill('#ff00ff')
  await editor.getByRole('button', { name: 'Apply', exact: true }).click()
  await settle()
  assert.deepEqual((await stored('BTC'))[0].extendData, { levels: [0, 0.5, 1], levelStyles: { 1: { color: '#ff00ff' } } })
  assert.ok((await pixels([255, 0, 255])).count > 100)

  await page.getByRole('button', { name: /^Undo / }).click()
  await settle()
  assert.equal((await pixels([255, 0, 255])).count, 0)
  await page.getByRole('button', { name: /^Redo / }).click()
  await settle()
  assert.ok((await pixels([255, 0, 255])).count > 100)

  await switchTo('ETH')
  assert.equal((await pixels([255, 255, 0])).count, 0)
  await openEditor()
  await editor.getByLabel('Fill color', { exact: true }).fill('#ffff00')
  await editor.getByLabel('Opacity', { exact: true }).fill('100')
  await editor.getByRole('button', { name: 'Apply', exact: true }).click()
  await settle()
  assert.equal((await stored('ETH'))[0].styles.user.rect.color, 'rgba(255, 255, 0, 1)')
  assert.ok((await pixels([255, 255, 0])).count > 1000)

  await switchTo('SOL')
  assert.equal((await pixels([0, 255, 255])).count, 0)
  await openEditor()
  assert.equal(await editor.getByLabel('Fill color', { exact: true }).count(), 1)
  await editor.getByLabel('Stroke color', { exact: true }).fill('#00ffff')
  await editor.getByLabel('Stroke width', { exact: true }).selectOption('3')
  await editor.getByRole('button', { name: 'Apply', exact: true }).click()
  await settle()
  assert.ok((await pixels([0, 255, 255])).count > 100)
  await openEditor()
  await editor.getByRole('button', { name: 'Reset style', exact: true }).click()
  await editor.getByRole('button', { name: 'Apply', exact: true }).click()
  await settle()
  assert.equal((await stored('SOL'))[0].styles?.user, undefined)
  assert.equal((await pixels([0, 255, 255])).count, 0)

  await page.reload()
  await page.waitForFunction(() => window.pro.getChart()?.getDataList().length === 200)
  await settle()
  assert.ok((await pixels([255, 0, 255])).count > 100)

  assert.deepEqual(errors, [])
  console.log('Drawing style workflow passed: Fib levels and per-level colors, fill color/opacity, color override on a hard-coded tool, reset, undo/redo and reload.')
} finally { await browser.close() }
