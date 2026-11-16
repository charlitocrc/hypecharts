// Build first. Delayed fixture feeds exercise study/compare dataset ownership.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const assets = { '/pro.js': read('../dist/klinecharts-pro.umd.js'), '/pro.css': read('../dist/klinecharts-pro.css') }
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/pro.css">
<div id="chart" style="width:1100px;height:700px"></div><script src="/pro.js"></script><script>
const minute={multiplier:1,timespan:'minute',text:'1m'},five={multiplier:5,timespan:'minute',text:'5m'};
const end=Math.floor(Date.now()/300000)*300000;
const makeBars=(ticker,period)=>Array.from({length:200},(_,i)=>({timestamp:end-(199-i)*(period.text==='5m'?300000:60000),open:ticker==='BTC'?100:2000,high:3000,low:50,close:ticker==='BTC'?100:2000,volume:10}));
window.pending=[];window.calls=[];window.listeners=new Map();window.hold=true;
const feed={
 async getHistoryKLineData(symbol,period){
  window.calls.push({symbol:symbol.ticker,period:period.text});
  const bars=makeBars(symbol.ticker,period);
  if(window.hold&&(period.text==='5m'||symbol.ticker==='OLD'||symbol.ticker==='LIVE'))
   return await new Promise(resolve=>window.pending.push({symbol:symbol.ticker,period:period.text,resolve:()=>resolve(bars)}));
  return bars;
 },
 subscribe(symbol,period,callback){window.listeners.set(callback,{symbol:symbol.ticker,period:period.text})},
 unsubscribe(symbol,period,callback){window.listeners.delete(callback)},
 config:async()=>({exchanges:[{key:'TEST',name:'Fixture'}],intervals:[minute,five]})
};
const layout=target=>({main:[{name:'EMA',timeframe:'5m'},{name:'EMA~2',timeframe:'5m'},{name:'COMPARE',compare:{ticker:target,exchange:'TEST',shortName:target,mode:'independent'}}],sub:[]});
localStorage.setItem('klinecharts-pro:indicators:TEST:BTC',JSON.stringify(layout('OLD')));
localStorage.setItem('klinecharts-pro:indicators:TEST:ETH',JSON.stringify(layout('LIVE')));
window.pro=new klinechartspro.KLineChartPro({container:'chart',locale:'en-US',symbol:{ticker:'BTC',exchange:'TEST',pricePrecision:2},period:minute,periods:[minute,five],mainIndicators:[],subIndicators:[],datafeed:feed});
window.state=()=>{const c=window.pro.getChart(),compare=c.getIndicatorByPaneId('candle_pane','COMPARE'),ema=c.getIndicatorByPaneId('candle_pane','EMA');return {target:compare?.extendData?.symbol?.ticker,values:compare?.extendData?.values,htf:ema?.timeframeData?.map(b=>b?.close)}};
</script>`
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? process.argv[2] })
try {
  const page = await browser.newPage({ viewport: { width: 1150, height: 800 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname
    return route.fulfill({ body: assets[path] ?? html, contentType: path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' })
  })
  await page.goto('http://study-stability.test/')
  await page.waitForFunction(() => window.pro.getSelection()?.dataReady && window.pending.some(p => p.symbol === 'BTC') && window.pending.some(p => p.symbol === 'OLD'))
  assert.equal(await page.evaluate(() => window.calls.filter(p => p.symbol === 'BTC' && p.period === '5m').length), 1, 'two HTF indicators must share one pending history request')
  await page.evaluate(() => window.pro.setSymbol({ ticker: 'ETH', exchange: 'TEST', pricePrecision: 2 }))
  await page.waitForFunction(() => window.pro.getSelection()?.dataReady && window.pending.some(p => p.symbol === 'ETH') && window.pending.some(p => p.symbol === 'LIVE'))
  await page.evaluate(() => {
    for (const [callback, sub] of window.listeners) if (sub.symbol === 'LIVE') callback({ timestamp: end, open: 2999, high: 3000, low: 2998, close: 2999, volume: 20 })
  })
  await page.waitForFunction(() => window.state().values?.at(-1) === 2999)
  await page.evaluate(() => {
    const old = window.pending.filter(p => p.symbol === 'BTC' || p.symbol === 'OLD')
    window.pending = window.pending.filter(p => !old.includes(p)); old.forEach(p => p.resolve())
  })
  await page.waitForTimeout(80)
  assert.equal(await page.evaluate(() => window.state().target), 'LIVE', 'old compare response must not overwrite a reused instance ID')
  assert.equal(await page.evaluate(() => [...window.listeners.values()].filter(s => s.symbol === 'BTC' || s.symbol === 'OLD').length), 0, 'old requests must not subscribe after the symbol changed')
  await page.evaluate(() => window.pending.splice(0).forEach(p => p.resolve()))
  await page.waitForFunction(() => window.state().htf?.some(close => close === 2000))
  assert.equal(await page.evaluate(() => window.state().values.at(-1)), 2999, 'live overlap must win over delayed history')
  assert.ok(await page.evaluate(() => window.state().htf.filter(close => close != null).every(close => close === 2000)))
  // Start fresh delayed study work, dispose, then settle every response.
  await page.evaluate(() => window.pro.setSymbol({ ticker: 'BTC', exchange: 'TEST', pricePrecision: 2 }))
  await page.waitForFunction(() => window.pending.some(p => p.symbol === 'BTC'))
  await page.evaluate(() => { window.pro.dispose(); window.pending.splice(0).forEach(p => p.resolve()) })
  await page.waitForTimeout(100)
  assert.equal(await page.evaluate(() => window.listeners.size), 0)
  assert.deepEqual(errors, [])
  console.log('Study stability passed: HTF request dedupe, stale symbol/instance protection, live compare merge, disposed request cleanup')
} finally { await browser.close() }
