// Build first: npm run build:demo
// Entire production demo with fixture HTTP/WebSockets; no exchange requests.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const delayMs = 3000
const now = Math.floor(Date.now() / 900000) * 900000
const bars = Array.from({ length: 500 }, (_, i) => ({ t: now - (499 - i) * 900000,
  o: '100', h: '104', l: '97', c: String(100 + Math.sin(i / 10)), v: '1000' }))
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? process.argv[2] })
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
      } : bars.filter(b => b.t >= Number(url.searchParams.get('startTime') ?? 0) && b.t <= Number(url.searchParams.get('endTime') ?? Infinity)).map(b => [b.t, b.o, b.h, b.l, b.c, b.v])
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
  await page.waitForFunction(() => window.__hypecharts.length === 2 && window.__hypecharts.every(c => c.getChart().getDataList().length === 500)).catch(async error => {
    console.error('Split state:', JSON.stringify(await page.evaluate(() => ({charts: window.__hypecharts.map(c => ({symbol:c.resolvedSymbol(),period:c.getPeriod(),count:c.getChart().getDataList().length,selection:c.getSelection()})), saved:localStorage.getItem('hypecharts-demo:workspace-v1')}))), errors)
    throw error
  })
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hypecharts-demo:workspace-v1')))
  assert.equal(saved.layout, 'split')
  assert.deepEqual(saved.cells.map(cell => cell.symbol), ['BINANCE:BTCUSDT', 'HYPERLIQUID:BTC'])
  await page.locator('#chart-links').waitFor({ state: 'visible' })
  const separator = page.getByRole('separator', { name: 'Resize chart rows 1 and 2' })
  await separator.focus()
  await page.keyboard.press('ArrowDown')
  await page.locator('#link-period').check()
  const resized = await page.evaluate(() => JSON.parse(localStorage.getItem('hypecharts-demo:workspace-v1')))
  assert.ok(resized.sizes.rows[0] > 0.5)
  assert.equal(resized.links.period, true)
  assert.deepEqual(resized.cells.map(cell => cell.symbol), ['BINANCE:BTCUSDT', 'HYPERLIQUID:BTC'], 'linking intervals must keep independent venues')
  secondaryFinished = false
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__hypecharts?.length === 2 &&
    window.__hypecharts.every(c => c.getChart()?.getDataList().length === 500) &&
    window.__hypecharts[0].resolvedSymbol().exchange === 'BINANCE' &&
    window.__hypecharts[1].resolvedSymbol().exchange === 'HYPERLIQUID').catch(async error => {
      console.error('Restore state:', JSON.stringify(await page.evaluate(() => ({
        charts: window.__hypecharts?.map(c => ({ symbol: c.resolvedSymbol(), period: c.getPeriod(), count: c.getChart()?.getDataList().length, selection: c.getSelection() })),
        saved: localStorage.getItem('hypecharts-demo:workspace-v1'), status: document.getElementById('feed-status')?.textContent
      }))), errors)
      throw error
    })
  assert.equal(secondaryFinished, true, 'Saved split workspace must wait for both required venues')
  const restored = await page.evaluate(() => window.__hypecharts.map(c => c.resolvedSymbol().exchange))
  assert.deepEqual(restored, ['BINANCE', 'HYPERLIQUID'])
  assert.equal(await page.locator('#link-period').isChecked(), true)
  const restoredSizes = await page.evaluate(() => JSON.parse(localStorage.getItem('hypecharts-demo:workspace-v1')).sizes)
  assert.deepEqual(restoredSizes, resized.sizes)
  // Complete named grid snapshots retain per-cell studies/drawings as well as links and geometry.
  await page.waitForFunction(()=>window.__hypecharts.every(chart=>chart.getSelection()?.dataReady))
  await page.evaluate(async()=>{
    await Promise.all(window.__hypecharts.map(async(chart,index)=>{
      const state=chart.getWorkspace()
      state.indicators={main:[{name:'EMA',calcParams:[index?21:9]}],sub:[{name:'VOL',pane:'shared',height:100},{name:'RSI',pane:'shared',height:100}]}
      state.drawings=[{name:'horizontalStraightLine',points:[{value:101+index}],objectGroup:index?'Secondary':'Primary'}]
      await chart.applyWorkspace(state)
    }))
  })
  await page.locator('#workspace-manager').click()
  let namedDialog=page.locator('.klinecharts-pro-workspace-modal')
  await namedDialog.getByLabel('Workspace name',{exact:true}).fill('Two venues')
  await namedDialog.getByRole('button',{name:'Save new',exact:true}).click()
  const named=await page.evaluate(()=>JSON.parse(localStorage.getItem('hypecharts-demo:named-workspaces:v1'))[0])
  assert.equal(named.charts.length,2)
  assert.equal(named.grid.links.period,true)
  await namedDialog.getByRole('button',{name:'Close',exact:true}).click()
  await page.locator('#layout-toggle').click()
  await page.waitForFunction(()=>window.__hypecharts.length===1&&window.__hypecharts[0].getSelection()?.dataReady)
  await page.locator('#workspace-manager').click()
  namedDialog=page.locator('.klinecharts-pro-workspace-modal')
  await namedDialog.getByLabel('Saved workspaces',{exact:true}).selectOption(named.id)
  await namedDialog.getByRole('button',{name:'Load',exact:true}).click()
  await namedDialog.waitFor({state:'detached'})
  await page.waitForFunction(()=>window.__hypecharts.length===2&&window.__hypecharts.every(chart=>chart.getSelection()?.dataReady))
  assert.deepEqual(await page.evaluate(()=>window.__hypecharts.map(chart=>({params:chart.getWorkspace().indicators.main[0].calcParams,group:chart.getWorkspace().drawings[0].objectGroup,panes:chart.getChart().getPaneOrder().length}))),[
    {params:[9],group:'Primary',panes:1},{params:[21],group:'Secondary',panes:1}
  ])
  assert.equal(await page.locator('#link-period').isChecked(),true)
  await page.waitForTimeout(1100)
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.__hypecharts?.length===2&&window.__hypecharts.every(chart=>chart.getSelection()?.dataReady))
  assert.deepEqual(await page.evaluate(()=>window.__hypecharts.map(chart=>chart.getWorkspace().drawings[0]?.objectGroup)),['Primary','Secondary'])
  await page.screenshot({path:'/tmp/hypecharts-named-grid.png'})
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ readyMs, secondaryProbeDelayMs: delayMs,
    verified: ['primary renders before secondary probe', 'indicator menu opens', 'late venue switch', 'split layout', 'saved split restoration', 'keyboard divider resize', 'size/link-flag restoration', 'named complete grid save/load', 'independent cell content and reload'],
    limitations: 'Single localhost fixture run; readiness is a paint opportunity, not actual compositor presentation or live connectivity.' }, null, 2))
} finally { await browser.close() }
