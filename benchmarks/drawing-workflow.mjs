// Run after `vite build`: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node benchmarks/drawing-workflow.mjs
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
<div id="chart"></div><input id="outside" aria-label="Outside chart">
<script src="/core.js"></script><script src="/pro.js"></script><script>
const bars = Array.from({length:200}, (_, i) => ({timestamp:1700000000000+i*60000,open:100,high:110,low:90,close:100+Math.sin(i),volume:1000}));
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
  await page.evaluate(() => window.pro.getChart().createOverlay({ id: 'live-order', name: 'horizontalStraightLine', groupId: 'orders', points: [{ value: 105 }] }))
  const undo = page.getByRole('button', { name: /^Undo .*\(Ctrl\/⌘ Z\)$/ })
  const redo = page.getByRole('button', { name: /^Redo .*\(Ctrl\/⌘ Shift Z\)$/ })
  const objects = page.getByRole('button', { name: 'Layers', exact: true })
  const rows = page.locator('.klinecharts-pro-drawing-manager li')
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('klinecharts-pro:drawings:BTC') ?? '[]'))
  assert.equal(await undo.isDisabled(), true)
  // Create a drawing through the same keyboard and canvas path as a user.
  await page.locator('.klinecharts-pro-widget').focus()
  await page.keyboard.press('Alt+h')
  await page.mouse.click(350, 220)
  await objects.click()
  await rows.first().waitFor()
  assert.equal(await rows.count(), 1)
  assert.equal((await stored()).length, 1)
  await rows.first().getByRole('button', { name: 'Duplicate', exact: true }).click()
  assert.equal(await rows.count(), 2)
  await undo.click()
  assert.equal(await rows.count(), 1)
  await redo.click()
  assert.equal(await rows.count(), 2)
  await rows.first().getByRole('button', { name: 'Hide', exact: true }).click()
  assert.equal((await stored())[0].visible, false)
  await rows.first().getByRole('button', { name: 'Lock', exact: true }).click()
  assert.equal((await stored())[0].lock, true)
  await rows.first().locator('.drawing-name').click()
  const editor = page.locator('.klinecharts-pro-drawing-editor')
  await editor.getByLabel('Price', { exact: true }).fill('103.25')
  await editor.getByLabel('Stroke width', { exact: true }).selectOption('3')
  await editor.getByLabel('Stroke color', { exact: true }).fill('#ff00ff')
  await editor.getByLabel('Line style', { exact: true }).selectOption('dotted')
  await editor.getByRole('button', { name: 'Apply', exact: true }).click()
  assert.equal((await stored())[0].points[0].value, 103.25)
  assert.deepEqual((await stored())[0].styles.user.line, { color: '#ff00ff', size: 3, style: 'dashed', dashedValue: [1, 3] })
  await undo.click()
  assert.notEqual((await stored())[0].points[0].value, 103.25)
  await redo.click()
  assert.equal((await stored())[0].points[0].value, 103.25)
  // Editing inputs must keep native undo and Escape must close the dialog.
  await rows.first().locator('.drawing-name').click()
  await editor.getByLabel('Price', { exact: true }).focus()
  await page.keyboard.press('Control+z')
  assert.equal((await stored())[0].points[0].value, 103.25)
  await page.keyboard.press('Escape')
  assert.equal(await editor.count(), 0)
  await rows.first().getByRole('button', { name: 'Delete', exact: true }).click()
  assert.equal(await rows.count(), 1)
  await undo.click()
  assert.equal(await rows.count(), 2)
  // Clear-all must be one operation, and leave host orders untouched.
  await page.getByRole('button', { name: 'Remove Drawings', exact: true }).click()
  assert.equal(await rows.count(), 0)
  await undo.click()
  assert.equal(await rows.count(), 2)
  assert.equal(await page.evaluate(() => !!window.pro.getChart().getOverlayById('live-order')), true)
  await page.locator('#outside').focus()
  await page.keyboard.press('Control+z')
  assert.equal(await rows.count(), 2)
  // Reload restores edits; a new symbol starts with its own history.
  await page.reload()
  await page.waitForFunction(() => window.pro.getChart()?.getDataList().length === 200)
  await objects.click()
  assert.equal(await rows.count(), 2)
  assert.equal((await stored())[0].visible, false)
  assert.equal((await stored())[0].lock, true)
  assert.equal((await stored())[0].points[0].value, 103.25)
  await page.evaluate(() => window.pro.setSymbol({ ticker: 'ETH', pricePrecision: 2 }))
  await page.waitForFunction(() => document.querySelector('.klinecharts-pro-drawing-manager')?.textContent.includes('(0)'))
  assert.equal(await undo.isDisabled(), true)
  await page.evaluate(() => window.pro.setSymbol({ ticker: 'BTC', pricePrecision: 2 }))
  await rows.first().waitFor()
  assert.equal(await rows.count(), 2)
  assert.equal(await undo.isDisabled(), true)
  // Narrow viewport must keep the new controls and editor reachable.
  await page.setViewportSize({ width: 390, height: 844 })
  await rows.first().locator('.drawing-name').click()
  assert.equal(await editor.getByRole('button', { name: 'Apply', exact: true }).isVisible(), true)
  await page.screenshot({ path: '/private/tmp/kline-drawing-editor-mobile.png' })
  assert.deepEqual(errors, [])
  console.log('Drawing workflow passed: create, duplicate, edit, hide, lock, delete, undo/redo, clear-all, persistence, symbol isolation, host overlays, input shortcuts, mobile editor.')
} finally { await browser.close() }
