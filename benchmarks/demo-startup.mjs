// Build first: npm run build:demo
// Entire production demo with fixture HTTP/WebSockets; no exchange requests.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const delayMs = 3000
const now = Math.floor(Date.now() / 900000) * 900000
const bars = Array.from({ length: 500 }, (_, i) => ({ t: now - (499 - i) * 900000,
  o: '100', h: '104', l: '97', c: String(100 + Math.sin(i / 10)), v: '1000' }))
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let secondaryFinished = false
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
  await page.routeWebSocket('**/*', socket => { socket.onMessage(() => {}) })
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ body: '', contentType: 'text/css' })
    if (url.hostname === 'demo.test') {
      const path = url.pathname === '/' ? '/index.html' : url.pathname
      if (!/^\/(index\.html|assets\/[\w.-]+|[\w-]+\.svg)$/.test(path)) return route.fulfill({ status: 404, body: '' })
      const type = path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/html'
      return route.fulfill({ body: readFileSync(new URL('../dist-demo' + path, import.meta.url)), contentType: type })
    }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    let body
    if (url.hostname === 'api.hyperliquid.xyz') {
      const request = route.request().postDataJSON()
      body = request.type === 'meta' ? { universe: [{ name: 'BTC', szDecimals: 3 }] } : bars
    } else if (url.hostname === 'api.binance.com') {
      if (url.searchParams.get('limit') === '1') {
        await new Promise(resolve => setTimeout(resolve, delayMs))
        secondaryFinished = true
      }
      body = url.pathname.endsWith('exchangeInfo') ? {
        symbols: [{ symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING', filters: [] }]
      } : bars.map(b => [b.t, b.o, b.h, b.l, b.c, b.v])
    } else throw new Error('Unexpected external request: ' + url.href)
    return route.fulfill({ json: body, headers })
  })
  const start = Date.now()
  await page.goto('http://demo.test/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__hypecharts?.[0]?.getChart()?.getDataList().length === 500 && !document.querySelector('.klinecharts-pro-loading'))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const readyMs = Date.now() - start
  assert.equal(secondaryFinished, false, 'Healthy primary must render while the secondary probe is pending')
  await page.getByRole('button', { name: 'Indicators', exact: true }).click()
  await page.locator('.klinecharts-pro-indicator-modal').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Switch to Binance', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Switch to Binance', exact: true }).click()
  await page.waitForFunction(() => window.__hypecharts[0].resolvedSymbol().exchange === 'BINANCE' && window.__hypecharts[0].getChart().getDataList().length === 500)
  await page.locator('#layout-toggle').click()
  await page.waitForFunction(() => window.__hypecharts.length === 2 && window.__hypecharts.every(c => c.getChart().getDataList().length === 500))
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hypecharts-demo:workspace-v1')))
  assert.equal(saved.layout, 'split')
  assert.deepEqual(saved.cells.map(cell => cell.symbol), ['BINANCE:BTCUSDT', 'HYPERLIQUID:BTC'])
  secondaryFinished = false
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__hypecharts?.length === 2 &&
    window.__hypecharts.every(c => c.getChart()?.getDataList().length === 500) &&
    window.__hypecharts[0].resolvedSymbol().exchange === 'BINANCE' &&
    window.__hypecharts[1].resolvedSymbol().exchange === 'HYPERLIQUID')
  assert.equal(secondaryFinished, true, 'Saved split workspace must wait for both required venues')
  const restored = await page.evaluate(() => window.__hypecharts.map(c => c.resolvedSymbol().exchange))
  assert.deepEqual(restored, ['BINANCE', 'HYPERLIQUID'])
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ readyMs, secondaryProbeDelayMs: delayMs,
    verified: ['primary renders before secondary probe', 'indicator menu opens', 'late venue switch', 'split layout', 'saved split restoration'],
    limitations: 'Single localhost fixture run; readiness is a paint opportunity, not actual compositor presentation or live connectivity.' }, null, 2))
} finally { await browser.close() }
