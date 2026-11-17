// Chart-visible diagnostics with deterministic providers; no live venue/reference-platform claims.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
const assets = {
  '/pro.js': readFileSync(new URL('../dist/klinecharts-pro.umd.js', import.meta.url)),
  '/pro.css': readFileSync(new URL('../dist/klinecharts-pro.css', import.meta.url))
}
const html = params => `<!doctype html><meta charset="utf-8">${params.has('missingCss') ? '' : '<link rel="stylesheet" href="/pro.css">'}
<div id="chart" style="width:1100px;height:${params.has('zero') ? '0' : '650'}px"></div><script src="/pro.js"></script><script>
localStorage.clear();
const params=new URLSearchParams(location.search);
window.events=[];window.causes={};window.pending=[];window.calls=[];window.listeners=new Map();
window.minute={multiplier:1,timespan:'minute',text:'1m'};window.five={multiplier:5,timespan:'minute',text:'5m'};
window.failure=name=>causes[name]??(causes[name]=new Error(name));
window.mode='normal';window.searchPending=[];
const period=params.has('profile')?five:minute,end=Math.floor(Date.now()/300000)*300000;
const bars=(symbol,p)=>Array.from({length:300},(_,i)=>({timestamp:end-(299-i)*p.multiplier*60000,open:100,high:102,low:98,close:101,volume:10}));
if(params.has('studies'))localStorage.setItem('klinecharts-pro:indicators:TEST:BTC',JSON.stringify({main:[
 {name:'EMA',timeframe:'5m'},{name:'EMA~2',timeframe:'5m'},
 {name:'COMPARE',compare:{ticker:'CMP',exchange:'TEST',mode:'independent'}}],sub:[]}));
if(params.has('profile'))localStorage.setItem('klinecharts-pro:indicators:TEST:BTC',JSON.stringify({main:[{name:'VRVP'}],sub:[]}));
const feed={
 config(){
  if(params.get('config')==='throw')throw failure('configuration throw');
  if(params.get('config')==='reject')return Promise.reject(failure('configuration rejection'));
  if(params.get('config')==='invalid')return Promise.resolve({exchanges:null});
  return Promise.resolve({exchanges:[{key:'TEST',name:'Fixture'}],intervals:[minute,five],searchDelayMs:200});
 },
 resolveSymbol(name){if(name==='BAD')throw failure('resolution failure');return Promise.resolve({ticker:name,exchange:'TEST'});},
 getHistoryKLineData(symbol,p,from,to){
  calls.push({symbol:symbol.ticker,period:p.text,from,to});
  if(mode==='hold')return new Promise((resolve,reject)=>pending.push({resolve,reject}));
  if(mode==='fail'||symbol.ticker==='FAIL')return Promise.reject(failure('main history failure'));
  if(mode==='paging'&&to<end)return Promise.reject(failure('older history failure'));
  if(mode==='recovery')return Promise.reject(failure('repair failure'));
  if(params.has('studies')&&(p.text==='5m'||symbol.ticker==='CMP'))return Promise.reject(failure('study '+(symbol.ticker==='CMP'?'compare':'indicator')));
  if(params.has('profile')&&p.text==='1m')return Promise.reject(failure('profile detail failure'));
  return Promise.resolve(symbol.ticker==='EMPTY'||to<end?[]:bars(symbol,p));
 },
 subscribe(symbol,p,callback){if(mode==='subscribe')throw failure('subscription failure');listeners.set(callback,symbol.ticker);},
 unsubscribe(symbol,p,callback){listeners.delete(callback);if(mode==='unsubscribe')throw failure('cleanup failure');},
 subscribeConnection(callback){if(params.has('connectionThrow'))throw failure('connection setup');window.connection=callback;return()=>{window.connection=null;};},
 searchSymbols(query){
  if(!query)return Promise.resolve([]);
  if(query==='THROW')throw failure('search throw');
  return new Promise((resolve,reject)=>searchPending.push({query,resolve,reject}));
 }
};
const onDiagnostic=diagnostic=>{
 events.push({...diagnostic,causeMessage:diagnostic.cause?.message,originalCause:diagnostic.cause===causes[diagnostic.cause?.message],state:window.chart?.getSelection?.()});
 window.diagnosticAction?.(diagnostic);
};
try{
 const options={container:params.has('missingContainer')?'absent':'chart',locale:'en-US',timezone:'Etc/UTC',symbol:{ticker:'BTC',exchange:'TEST'},period,
 periods:[minute,five],quickPeriods:['1m','5m'],mainIndicators:[],subIndicators:[],datafeed:feed};
 if(!params.has('console'))options.onDiagnostic=onDiagnostic;
 window.chart=new klinechartspro.KLineChartPro(options);
 if(params.has('disposeNow'))window.chart.dispose();
}catch(error){window.startupError=error.message;}
window.started=true;
</script>`
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } })
  page.setDefaultTimeout(10000)
  const errors = [], logs = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) logs.push(message.text()) })
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return route.fulfill({ body: assets[url.pathname] ?? html(url.searchParams), contentType: url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html' })
  })
  const open = async (query = '') => {
    await page.goto('http://diagnostics.test/?' + query)
    await page.waitForFunction(() => window.started)
    if (!query.includes('missingContainer') && !query.includes('disposeNow')) await page.waitForFunction(() => window.chart.getSelection()?.dataReady)
  }
  const event = async (code, scope) => {
    await page.waitForFunction(([code, scope]) => window.events.some(event => event.code === code && (!scope || event.scope === scope)), [code, scope])
    return page.evaluate(([code, scope]) => window.events.find(event => event.code === code && (!scope || event.scope === scope)), [code, scope])
  }
  const count = code => page.evaluate(code => window.events.filter(event => event.code === code).length, code)
  const select = request => page.evaluate(async request => {
    try { return { selection: await window.chart.setSelection(request) } } catch (error) { return { code: error.code, causeMessage: error.cause?.message } }
  }, request)
  await open()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.deepEqual(await page.evaluate(() => window.events), [], 'healthy startup must stay quiet')
  await open('missingCss&zero')
  await event('stylesheet_missing'); await event('container_zero_height')
  await page.evaluate(() => { window.dispatchEvent(new Event('resize')); document.getElementById('chart').style.width='1000px' })
  assert.equal(await count('stylesheet_missing'), 1)
  assert.equal(await count('container_zero_height'), 1)
  await open('missingCss&zero&disposeNow')
  await page.evaluate(() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  assert.deepEqual(await page.evaluate(() => window.events), [])
  await open('missingContainer')
  await event('container_not_found')
  assert.ok((await page.evaluate(() => window.startupError)).includes('absent'))
  for (const config of ['throw', 'reject', 'invalid']) {
    await open('config=' + config)
    const diagnostic = await event('configuration_failed')
    assert.equal(diagnostic.operation, 'config')
    assert.equal(diagnostic.retryable, false)
    if (config !== 'invalid') assert.equal(diagnostic.originalCause, true)
  }
  await open('connectionThrow')
  assert.equal((await event('subscription_failed')).operation, 'subscribeConnection')
  assert.equal((await event('subscription_failed')).retryable, false)
  await open()
  const failed = await select({ symbol: { ticker: 'FAIL', exchange: 'TEST' } })
  assert.equal(failed.code, 'load_failed')
  const history = await event('history_failed', 'main')
  assert.equal(history.causeMessage, failed.causeMessage)
  assert.equal(history.originalCause, true)
  assert.equal(history.symbol.ticker, 'FAIL')
  assert.equal(history.state.loading, false, 'diagnostics run after state settles')
  await select({ symbol: 'BAD' })
  assert.equal((await event('symbol_resolve_failed')).symbolName, 'BAD')
  await page.evaluate(() => { window.mode='subscribe' })
  await select({ symbol: { ticker: 'SUB', exchange: 'TEST' } })
  assert.equal((await event('subscription_failed')).causeMessage, 'subscription failure')
  await page.evaluate(() => { window.mode='normal' })
  await select({ symbol: { ticker: 'BTC', exchange: 'TEST' } })
  await page.evaluate(() => { window.mode='unsubscribe' })
  await select({ symbol: { ticker: 'ETH', exchange: 'TEST' } })
  await page.waitForFunction(() => window.events.some(event => event.operation === 'unsubscribe'))
  await page.evaluate(() => { window.mode='normal' })
  const beforeEmpty = await count('history_failed')
  await select({ symbol: { ticker: 'EMPTY', exchange: 'TEST' } })
  assert.equal(await count('history_failed'), beforeEmpty)
  await select({ period: { multiplier: 1, timespan: 'minute', text: 'M1' } })
  assert.equal(await count('unsupported_period'), 0, 'display labels must not produce false interval warnings')
  await select({ symbol: { ticker: 'BTC', exchange: 'TEST' }, period: { multiplier: 3, timespan: 'minute', text: '3m' } })
  const unsupported = await event('unsupported_period')
  assert.equal(unsupported.requestedPeriod.text, '3m')
  assert.equal(unsupported.period.text, '5m')

  // Old failures, cancellation and disposal cannot publish misleading current errors.
  await open()
  await page.evaluate(() => { window.mode='hold'; window.old=window.chart.setSelection({symbol:{ticker:'OLD',exchange:'TEST'}}).catch(()=>{}) })
  await page.evaluate(async () => { window.mode='normal'; await window.chart.setSelection({symbol:{ticker:'NEW',exchange:'TEST'}}); window.pending.splice(0).forEach(item=>item.reject(window.failure('obsolete'))); })
  assert.equal(await count('history_failed'), 0)
  await page.evaluate(async () => {
    window.mode='hold'; const controller=new AbortController();
    const pending=window.chart.setSelection({symbol:{ticker:'ABORT',exchange:'TEST'}},{signal:controller.signal}).catch(error=>error.code);
    controller.abort(); window.pending.splice(0).forEach(item=>item.resolve([])); await pending;
  })
  assert.equal(await count('history_failed'), 0)
  await page.evaluate(() => { window.mode='hold'; void window.chart.setSelection({symbol:{ticker:'GONE',exchange:'TEST'}}).catch(()=>{}); window.chart.dispose(); window.pending.splice(0).forEach(item=>item.reject(window.failure('disposed'))); })
  assert.equal(await count('history_failed'), 0)

  // Outage dedupe survives same-symbol refresh and normalizes exchange names.
  await open()
  await page.evaluate(() => { window.connection({status:'disconnected',exchange:'test',cause:window.failure('socket closed')}); window.connection({status:'disconnected',exchange:'OTHER'}); })
  assert.equal((await event('connection_lost')).originalCause, true)
  await select({ period: { multiplier: 1, timespan: 'minute', text: '1m' } })
  await page.evaluate(() => window.connection({status:'disconnected',exchange:'TEST'}))
  assert.equal(await count('connection_lost'), 1)
  await page.evaluate(() => { window.connection({status:'connected',exchange:'TEST'}); window.connection({status:'disconnected',exchange:'test'}); })
  await page.waitForFunction(() => window.events.filter(event=>event.code==='connection_lost').length===2)
  await page.evaluate(() => { window.mode='recovery'; window.connection({status:'reconnected',exchange:'TEST'}); })
  assert.equal((await event('recovery_failed')).causeMessage, 'repair failure')
  await open()
  await page.evaluate(() => { window.mode='paging'; window.chart.getChart().scrollToDataIndex(0) })
  const paging = await event('history_failed', 'paging')
  assert.equal(paging.causeMessage, 'older history failure')
  assert.equal(await page.evaluate(() => window.calls.filter(call=>call.to<Math.floor(Date.now()/300000)*300000).length), 3)

  await open('studies')
  await event('history_failed', 'indicator'); await event('history_failed', 'compare')
  assert.equal(await page.evaluate(() => window.events.filter(event=>event.scope==='indicator').length), 1, 'shared HTF failures deduplicate')
  await open('profile')
  assert.equal((await event('history_failed', 'profile')).retryable, false)

  // A newer query invalidates failures immediately, including its debounce window.
  await open()
  await page.getByRole('button', { name: /Symbol search/ }).click()
  const input = page.getByPlaceholder('Search symbol, e.g. BTC or BTCUSDT')
  await input.fill('A')
  await page.waitForFunction(() => window.searchPending.some(item=>item.query==='A'))
  await input.fill('B')
  await page.evaluate(() => window.searchPending.find(item=>item.query==='A').reject(window.failure('old search')))
  assert.equal(await count('symbol_search_failed'), 0)
  await page.waitForFunction(() => window.searchPending.some(item=>item.query==='B'))
  await page.evaluate(() => window.searchPending.find(item=>item.query==='B').reject(window.failure('current search')))
  assert.equal((await event('symbol_search_failed')).causeMessage, 'current search')
  await input.fill('THROW')
  await page.waitForFunction(() => window.events.some(event=>event.causeMessage==='search throw'))
  await input.fill('C')
  await page.waitForFunction(() => window.searchPending.some(item=>item.query==='C'))
  await page.keyboard.press('Escape')
  const searchCount = await count('symbol_search_failed')
  await page.evaluate(() => window.searchPending.find(item=>item.query==='C').reject(window.failure('closed search')))
  assert.equal(await count('symbol_search_failed'), searchCount)

  // Application callbacks may reenter or throw without corrupting the failed request.
  await open()
  await page.evaluate(() => { window.diagnosticAction=()=>{window.diagnosticAction=null;window.chart.setSymbol({ticker:'RECOVERED',exchange:'TEST'});throw new Error('consumer callback');} })
  assert.equal((await select({ symbol: { ticker: 'FAIL', exchange: 'TEST' } })).code, 'load_failed')
  await page.waitForFunction(() => window.chart.getSelection()?.dataReady&&window.chart.getSymbol().ticker==='RECOVERED')
  assert.ok(logs.some(message=>message.includes('Chart diagnostic listener failed')))
  await open('missingCss&console')
  await page.waitForFunction(() => window.chart.getSelection()?.dataReady)
  await page.evaluate(() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  assert.ok(logs.some(message=>message.includes('HypeCharts:stylesheet_missing')))
  await page.evaluate(() => window.chart.dispose())
  assert.deepEqual(errors, [])
  console.log('Diagnostics browser checks passed: startup/config warnings, original causes, selection compatibility, current-only delivery, outage/retry dedupe, study/profile/search failures and callback isolation. Fixture data only.')
} finally { await browser.close() }
