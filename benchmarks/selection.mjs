// Controlled browser fixtures for awaitable selection ownership; no live venues or reference parity.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const assets = {
  '/pro.js': readFileSync(new URL('../dist/klinecharts-pro.umd.js', import.meta.url)),
  '/pro.css': readFileSync(new URL('../dist/klinecharts-pro.css', import.meta.url))
}
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/pro.css">
<style>#chart{width:1100px;height:650px}</style><div id="chart"></div><script src="/pro.js"></script><script>
localStorage.clear();
window.minute={multiplier:1,timespan:'minute',text:'1m'};
window.five={multiplier:5,timespan:'minute',text:'5m'};
window.resolves=[];window.histories=[];window.requests=[];window.results={};window.listeners=new Map();
window.holdResolves=new Set();window.holdHistory=new Set();window.failHistory=new Set();
window.symbolInfo=ticker=>({ticker,exchange:'TEST',pricePrecision:2,intervals:[minute,five]});
const bars=(symbol,period)=>{
 const end=Math.floor(Date.now()/300000)*300000,step=period.multiplier*60000;
 const base=Array.from(symbol.ticker).reduce((sum,c)=>sum+c.charCodeAt(0),0);
 return symbol.ticker==='EMPTY'?[]:Array.from({length:300},(_,i)=>({timestamp:end-(299-i)*step,open:base,high:base+2,low:base-2,close:base+1,volume:10}));
};
const feed={
 marker:'bound',
 resolveSymbol(name){
  if(this.marker!=='bound')throw new Error('lost feed receiver');
  if(name==='THROW_RESOLVE')throw new Error('sync resolution');
  if(name==='BAD_RESOLVE')return Promise.reject(new Error('resolution failed'));
  if(name==='INVALID_META')return Promise.resolve({});
  if(holdResolves.has(name))return new Promise((resolve,reject)=>resolves.push({name,resolve,reject}));
  return Promise.resolve(symbolInfo(name.split(':').at(-1)));
 },
 getHistoryKLineData(symbol,period){
  requests.push({ticker:symbol.ticker,period:period.text});
  if(failHistory.has(symbol.ticker))throw new Error('history failed');
  const data=bars(symbol,period);
  if(holdHistory.has(symbol.ticker))return new Promise((resolve,reject)=>histories.push({ticker:symbol.ticker,resolve:()=>resolve(data),reject}));
  return Promise.resolve(data);
 },
 subscribe(symbol,period,callback){
  if(window.reenterSubscribe){const action=window.reenterSubscribe;window.reenterSubscribe=null;action();}
  // Deliberately register AFTER reentrancy, to catch stale-listener leaks.
  listeners.set(callback,symbol.ticker);
  if(symbol.ticker==='SUB_FAIL')throw new Error('subscription failed');
 },
 unsubscribe(symbol,period,callback){
  listeners.delete(callback);
  if(window.reenterUnsubscribe){const action=window.reenterUnsubscribe;window.reenterUnsubscribe=null;action();}
 }
};
window.chart=new klinechartspro.KLineChartPro({container:'chart',locale:'en-US',timezone:'Etc/UTC',
 symbol:symbolInfo('BTC'),period:minute,periods:[minute,five],quickPeriods:['1m','5m'],mainIndicators:[],subIndicators:[],datafeed:feed});
window.start=(name,request,options)=>{
 results[name]={status:'pending'};
 chart.setSelection(request,options).then(selection=>{
  results[name]={status:'ok',selection,current:chart.getSelection()};
 },error=>{
  results[name]={status:'error',code:error.code,instance:error instanceof klinechartspro.ChartSelectionError,causeMessage:error.cause?.message};
 });
};
window.releaseHistory=(ticker,count=Infinity)=>{
 let released=0;
 while(released<count){
  const index=histories.findIndex(item=>item.ticker===ticker);
  if(index<0)break;
  histories.splice(index,1)[0].resolve();released++;
 }
 if(!released)throw new Error('No pending history for '+ticker);
};
window.releaseResolve=(name,ticker)=>{
 const index=resolves.findIndex(item=>item.name===name);
 if(index<0)throw new Error('No pending resolution for '+name);
 resolves.splice(index,1)[0].resolve(symbolInfo(ticker));
};
</script>`

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname
    return route.fulfill({ body: assets[path] ?? html, contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' })
  })
  await page.goto('http://selection.test/')
  const ready = () => page.waitForFunction(() => window.chart.getSelection()?.dataReady)
  const result = async name => {
    try {
      await page.waitForFunction(name => window.results[name] && window.results[name].status !== 'pending', name)
    } catch (error) {
      console.error('Selection fixture stalled:', await page.evaluate(() => ({
        selection: window.chart.getSelection(), requests: window.requests,
        pendingHistory: window.histories.map(item => item.ticker), results: window.results
      })))
      throw error
    }
    return page.evaluate(name => window.results[name], name)
  }
  const code = async (name, expected) => {
    const outcome = await result(name)
    assert.equal(outcome.status, 'error', name)
    assert.equal(outcome.code, expected, name)
    assert.equal(outcome.instance, true, name)
    return outcome
  }
  await ready()
  // Paired commits, unchanged selections, remembered choices, and automatic snapping.
  await page.evaluate(() => window.start('paired', { symbol: 'TEST:ETH', period: window.five }))
  const paired = await result('paired')
  assert.equal(paired.selection.symbol.ticker, 'ETH')
  assert.equal(paired.selection.period.text, '5m')
  assert.deepEqual(paired.selection, paired.current)
  const refreshed = await page.evaluate(async () => {
    const count = window.requests.length
    await window.chart.setSelection({ period: window.chart.getPeriod() })
    return window.requests.length - count
  })
  assert.equal(refreshed, 1, 'an unchanged selection must load fresh history')
  await page.evaluate(async () => {
    await window.chart.setSelection({ symbol: window.symbolInfo('BTC'), period: window.minute })
    window.start('memory', { symbol: 'TEST:ETH', period: window.minute })
  })
  assert.equal((await result('memory')).selection.period.text, '1m')
  await page.evaluate(() => window.start('snap', { symbol: { ...window.symbolInfo('NARROW'), intervals: [window.minute] }, period: window.five }))
  assert.equal((await result('snap')).selection.period.text, '1m')

  // Old history finishing while a new name resolves must never satisfy the new request.
  await page.evaluate(() => {
    window.holdHistory.add('OLD'); window.holdHistory.add('SLOW'); window.holdResolves.add('TEST:SLOW')
    window.chart.setSymbol(window.symbolInfo('OLD'))
    window.start('delayed', { symbol: 'TEST:SLOW', period: window.five })
    window.releaseHistory('OLD')
  })
  await page.waitForFunction(() => window.chart.getSelection()?.loading)
  assert.equal((await page.evaluate(() => window.results.delayed)).status, 'pending')
  assert.equal(await page.evaluate(() => window.chart.getSelection().dataReady), false)
  await page.evaluate(() => window.releaseResolve('TEST:SLOW', 'SLOW'))
  await page.waitForFunction(() => window.histories.some(item => item.ticker === 'SLOW'))
  assert.equal((await page.evaluate(() => window.results.delayed)).status, 'pending')
  await page.evaluate(() => window.releaseHistory('SLOW'))
  assert.equal((await result('delayed')).selection.symbol.ticker, 'SLOW')

  // Exact request ownership also matters for two requests for the SAME symbol/interval.
  await page.evaluate(() => {
    window.holdHistory.add('RACE')
    window.start('raceOld', { symbol: window.symbolInfo('RACE'), period: window.minute })
    window.raceOldCount = window.histories.filter(item => item.ticker === 'RACE').length
    window.start('raceNew', { symbol: window.symbolInfo('RACE'), period: window.minute })
  })
  await code('raceOld', 'superseded')
  await page.evaluate(() => window.releaseHistory('RACE', window.raceOldCount))
  assert.equal((await page.evaluate(() => window.results.raceNew)).status, 'pending')
  await page.evaluate(() => window.releaseHistory('RACE'))
  assert.equal((await result('raceNew')).selection.symbol.ticker, 'RACE')
  await page.evaluate(() => {
    window.holdHistory.add('STALE')
    window.start('staleFailure', { symbol: window.symbolInfo('STALE') })
    window.start('fresh', { symbol: window.symbolInfo('FRESH') })
  })
  await code('staleFailure', 'superseded')
  await result('fresh')
  await page.evaluate(() => window.histories.filter(item => item.ticker === 'STALE').forEach(item => item.reject(new Error('obsolete failure'))))
  await ready()
  assert.equal(await page.evaluate(() => window.chart.getSymbol().ticker), 'FRESH')

  // Empty data and resolver/history/subscribe failures have deterministic outcomes.
  await page.evaluate(() => window.start('empty', { symbol: window.symbolInfo('EMPTY') }))
  assert.equal((await result('empty')).selection.dataReady, false)
  for (const name of ['BAD_RESOLVE', 'THROW_RESOLVE', 'INVALID_META']) {
    await page.evaluate(name => window.start(name, { symbol: name }), name)
    await code(name, 'resolve_failed')
  }
  await page.evaluate(() => { window.failHistory.add('FAIL'); window.start('loadFail', { symbol: window.symbolInfo('FAIL') }) })
  assert.equal((await code('loadFail', 'load_failed')).causeMessage, 'history failed')
  await page.evaluate(() => window.start('subscribeFail', { symbol: window.symbolInfo('SUB_FAIL') }))
  assert.equal((await code('subscribeFail', 'load_failed')).causeMessage, 'subscription failed')
  assert.equal(await page.evaluate(() => window.listeners.size), 0)
  await page.evaluate(() => window.start('invalid', {}))
  await code('invalid', 'invalid_request')

  // Abort before invocation leaves another pending caller untouched.
  await page.evaluate(() => {
    window.holdHistory.add('ABORT_KEEP')
    window.start('keep', { symbol: window.symbolInfo('ABORT_KEEP') })
    const aborted = new AbortController(); aborted.abort()
    window.start('preAbort', { symbol: window.symbolInfo('IGNORED') }, { signal: aborted.signal })
  })
  await code('preAbort', 'aborted')
  await page.evaluate(() => window.releaseHistory('ABORT_KEEP'))
  assert.equal((await result('keep')).selection.symbol.ticker, 'ABORT_KEEP')
  // Abort during resolution prevents any late selection commit.
  await page.evaluate(() => {
    window.holdResolves.add('TEST:ABORT_RESOLVE')
    const controller = new AbortController()
    window.start('abortResolve', { symbol: 'TEST:ABORT_RESOLVE' }, { signal: controller.signal })
    controller.abort(new Error('cancel resolution'))
    window.releaseResolve('TEST:ABORT_RESOLVE', 'ABORT_RESOLVE')
  })
  assert.equal((await code('abortResolve', 'aborted')).causeMessage, 'cancel resolution')
  assert.equal(await page.evaluate(() => window.chart.getSymbol().ticker), 'ABORT_KEEP')
  // Abort after commit stops the wait, but the selected dataset still loads.
  await page.evaluate(() => {
    window.holdHistory.add('ABORT_LOAD')
    const controller = new AbortController()
    window.start('abortLoad', { symbol: window.symbolInfo('ABORT_LOAD') }, { signal: controller.signal })
    controller.abort()
    window.releaseHistory('ABORT_LOAD')
  })
  await code('abortLoad', 'aborted')
  await ready()
  assert.equal(await page.evaluate(() => window.chart.getSymbol().ticker), 'ABORT_LOAD')

  // Legacy setters, real period controls, and workspace restore supersede unresolved intents.
  for (const action of ['symbol', 'period', 'ui', 'workspace']) {
    await page.evaluate(action => {
      window.holdResolves.add('TEST:CANCEL_' + action)
      window.savedWorkspace = window.chart.getWorkspace()
      window.start(action, { symbol: 'TEST:CANCEL_' + action })
      if (action === 'symbol') window.chart.setSymbol(window.symbolInfo('HOST'))
      if (action === 'period') window.chart.setPeriod(window.minute)
      if (action === 'workspace') window.workspacePromise = window.chart.applyWorkspace(window.savedWorkspace)
    }, action)
    if (action === 'ui') await page.getByRole('button', { name: '5m', exact: true }).click()
    await code(action, 'superseded')
    await page.evaluate(action => window.releaseResolve('TEST:CANCEL_' + action, 'CANCEL_' + action), action)
    if (action === 'workspace') await page.evaluate(() => window.workspacePromise)
    await ready()
    assert.ok(!(await page.evaluate(() => window.chart.getSymbol().ticker)).startsWith('CANCEL_'))
  }

  // Subscriber reentrancy must supersede the notified request before its promise resolves.
  await page.evaluate(() => {
    let stop = window.chart.subscribeSelectionChange(selection => {
      if (selection.symbol.ticker === 'NOTIFY' && selection.dataReady) {
        stop(); window.start('notifyReplacement', { symbol: window.symbolInfo('AFTER_NOTIFY') })
      }
    })
    window.start('notifyOld', { symbol: window.symbolInfo('NOTIFY') })
  })
  await code('notifyOld', 'superseded')
  assert.equal((await result('notifyReplacement')).selection.symbol.ticker, 'AFTER_NOTIFY')
  // subscribe reenters before registering its stale callback; cleanup must remove it again.
  await page.evaluate(() => {
    window.reenterSubscribe = () => window.start('subscribeReplacement', { symbol: window.symbolInfo('AFTER_SUBSCRIBE') })
    window.start('subscribeOld', { symbol: window.symbolInfo('REENTER_SUBSCRIBE') })
  })
  await code('subscribeOld', 'superseded')
  await result('subscribeReplacement')
  assert.deepEqual(await page.evaluate(() => [...window.listeners.values()]), ['AFTER_SUBSCRIBE'])
  // Failure cleanup may itself reenter; it must not mark the next dataset ready early.
  await page.evaluate(() => {
    window.holdHistory.add('AFTER_UNSUBSCRIBE')
    window.reenterSubscribe = () => {
      window.reenterUnsubscribe = () => window.start('unsubscribeReplacement', { symbol: window.symbolInfo('AFTER_UNSUBSCRIBE') })
    }
    window.start('unsubscribeOld', { symbol: window.symbolInfo('SUB_FAIL') })
  })
  await code('unsubscribeOld', 'superseded')
  assert.equal((await page.evaluate(() => window.results.unsubscribeReplacement)).status, 'pending')
  assert.equal(await page.evaluate(() => window.chart.getSelection().loading), true)
  await page.evaluate(() => window.releaseHistory('AFTER_UNSUBSCRIBE'))
  await result('unsubscribeReplacement')

  // A core viewport callback can replace a selection during presentData itself.
  await page.evaluate(() => {
    const core = window.chart.getChart()
    const replace = () => {
      if (window.chart.getSymbol().ticker !== 'CORE_REENTER') return
      core.unsubscribeAction('onVisibleRangeChange', replace)
      window.start('coreReplacement', { symbol: window.symbolInfo('AFTER_CORE') })
    }
    core.subscribeAction('onVisibleRangeChange', replace)
    window.start('coreOld', { symbol: window.symbolInfo('CORE_REENTER') })
  })
  await code('coreOld', 'superseded')
  await result('coreReplacement')
  assert.deepEqual(await page.evaluate(() => [...window.listeners.values()]), ['AFTER_CORE'])

  // Disposal rejects an outstanding resolution and ignores its late response.
  await page.evaluate(() => {
    window.holdResolves.add('TEST:DISPOSE')
    window.start('dispose', { symbol: 'TEST:DISPOSE' })
    window.chart.dispose()
    window.releaseResolve('TEST:DISPOSE', 'DISPOSE')
    window.start('afterDispose', { symbol: window.symbolInfo('BTC') })
  })
  await code('dispose', 'disposed')
  await code('afterDispose', 'disposed')
  assert.equal(await page.evaluate(() => window.listeners.size), 0)
  await page.reload()
  await ready()
  await page.evaluate(() => {
    window.holdHistory.add('DISPOSE_LOAD')
    window.start('disposeLoad', { symbol: window.symbolInfo('DISPOSE_LOAD') })
    window.chart.dispose()
    window.releaseHistory('DISPOSE_LOAD')
  })
  await code('disposeLoad', 'disposed')
  assert.equal(await page.evaluate(() => window.listeners.size), 0)
  await page.reload()
  await ready()
  await page.evaluate(() => {
    window.reenterSubscribe = () => window.chart.dispose()
    window.start('disposeSubscribe', { symbol: window.symbolInfo('DISPOSE_SUBSCRIBE') })
  })
  await code('disposeSubscribe', 'disposed')
  assert.equal(await page.evaluate(() => window.listeners.size), 0)
  assert.deepEqual(errors, [])
  console.log('Awaitable selection browser fixtures passed: atomic selection, exact request ownership, snapping/memory, empty/error states, cancellation, UI/workspace supersession, callback reentrancy and cleanup. No live/reference parity claim.')
} finally { await browser.close() }
