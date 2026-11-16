// Build first. Fixture-only regressions for linked zoom/reset and asynchronous history transitions.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const assets = { '/pro.js': read('../dist/klinecharts-pro.umd.js'), '/pro.css': read('../dist/klinecharts-pro.css') }
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/pro.css">
<style>body{margin:0;background:#131722}#grid{height:760px;width:1100px}</style><div id="grid"></div>
<script src="/pro.js"></script><script>
const minute={multiplier:1,timespan:'minute',text:'1m'},second={multiplier:1,timespan:'second',text:'1s'};
window.requests=[];window.pending=[];window.deferOld=false;window.deferSeconds=false;
window.listeners=new Map();
const end=Math.floor(Date.now()/60000)*60000;
const series=(symbol,period)=>{
 const step=period.timespan==='second'?1000:60000,base=symbol.ticker==='BTC'?100:symbol.ticker==='ETH'?2000:4000;
 return Array.from({length:2500},(_,i)=>({timestamp:end-(2499-i)*step,open:base+1,high:base+3,low:base-3,close:base+Math.sin(i/8),volume:100}));
};
const feed={
 async getHistoryKLineData(symbol,period,from,to){
  const data=series(symbol,period), initial=to>=end;
  const page=initial?data.slice(-40):data.filter(b=>b.timestamp>=from&&b.timestamp<=to).slice(-60);
  window.requests.push({symbol:symbol.ticker,period:period.text,from,to,initial,count:page.length});
  if((window.deferOld&&!initial&&symbol.ticker==='BTC')||(window.deferSeconds&&period.timespan==='second'))
   return await new Promise((resolve,reject)=>window.pending.push({symbol:symbol.ticker,period:period.text,resolve:()=>resolve(page),reject:()=>reject(new Error('deferred fixture failure'))}));
  await new Promise(r=>setTimeout(r,8));return page;
 },
 subscribe(symbol,period,callback){window.listeners.set(callback,{symbol:symbol.ticker,period:period.text})},
 unsubscribe(symbol,period,callback){window.listeners.delete(callback)},
 config:async()=>({exchanges:[{key:'TEST',name:'Fixture'}],intervals:[second,minute]})
};
window.grid=klinechartspro.createChartGrid({container:document.getElementById('grid'),columns:1,sync:{period:true},createChart:(cell,index)=>new klinechartspro.KLineChartPro({
 container:cell,locale:'en-US',theme:'dark',drawingBarVisible:false,symbol:{ticker:index?'ETH':'BTC',exchange:'TEST',market:'perp',pricePrecision:2},period:minute,
 periods:[second,minute],quickPeriods:['1m'],mainIndicators:[],subIndicators:[],datafeed:feed})});
window.grid.setLayout(2);window.charts=window.grid.charts;
window.range=chart=>{const core=chart.getChart(),s=core.getChartStore().getTimeScaleStore(),d=core.getDataList(),width=core.getSize('candle_pane','main').width,step=chart.getPeriod().timespan==='second'?1000:60000;
 const at=i=>d[0].timestamp+i*step;
 return {from:at(s.coordinateToFloatIndex(0)-.5),to:at(d.length+s.getOffsetRightBarCount()-.5),count:d.length,padding:s.getOffsetRightDistance(),bar:s.getBarSpace().bar,first:d[0]?.timestamp,last:d.at(-1)?.timestamp};};
</script>`
const browser = await chromium.launch({ headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? process.argv[2] })
try {
 const page=await browser.newPage({viewport:{width:1150,height:850}})
 page.setDefaultTimeout(12000)
 const errors=[]
 page.on('pageerror',error=>{errors.push(error.message);console.error('Browser error:',error.message)})
 await page.route('**/*',route=>{
  const path=new URL(route.request().url()).pathname
  return route.fulfill({body:assets[path]??html,contentType:path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':'text/html'})
 })
 await page.goto('http://stability.test/')
 const ready=()=>page.waitForFunction(()=>window.charts.every(c=>c.getSelection()?.dataReady))
 const aligned=()=>page.waitForFunction(()=>{const [a,b]=window.charts.map(window.range);return Math.abs(a.from-b.from)<20&&Math.abs(a.to-b.to)<20})
 await ready();await aligned()
 // Real wheel easing, zooming out through multiple older-history pages.
 const pane=await page.locator('#grid .klinecharts-pro-widget').first().boundingBox()
 await page.mouse.move(pane.x+pane.width*.6,pane.y+pane.height*.5)
 for(let i=0;i<18;i++)await page.mouse.wheel(0,180)
 await page.waitForTimeout(400)
 // Reach the minimum supported shared span even if the OS coalesces wheel events.
 await page.evaluate(()=>window.charts[0].getChart().zoomAtCoordinate(.1,{x:400,y:100},180))
 await page.waitForFunction(()=>window.charts.every(c=>c.getChart().getDataList().length>700))
 await aligned()
 const paged=await page.evaluate(()=>({ranges:window.charts.map(window.range),pages:window.requests.filter(r=>!r.initial).length}))
 assert.ok(paged.pages>5,'zoom-out should continue past one older page')
 assert.ok(paged.ranges.every(r=>r.padding===50))
 // Pan to old candles, queue a zoom, and use the actual reset button on a follower.
 await page.evaluate(()=>{const c=window.charts[0].getChart();c.scrollToDataIndex(200);c.zoomAtCoordinate(2,{x:300,y:100},180)})
 await aligned()
 await page.locator('#grid').getByRole('button',{name:'Reset Chart',exact:true}).nth(1).click()
 await page.waitForTimeout(250);await aligned()
 assert.ok(Math.abs(await page.evaluate(()=>window.charts[1].getChart().getBarSpace())-6)<1e-6,'a peer animation must not undo reset zoom')
 assert.ok(await page.evaluate(()=>window.charts.every(chart=>{
  const c=chart.getChart(),d=c.getDataList(),s=c.getChartStore().getTimeScaleStore(),x=s.dataIndexToCoordinate(d.length-1);
  return x>=0&&x<=c.getSize('candle_pane','main').width&&s.getOffsetRightDistance()===50;
 })), 'latest candles must remain visible after reset and pending animation frames')
 // Hold an older BTC page, switch to ETH, then deliver the obsolete success.
 await page.evaluate(()=>{window.deferOld=true;window.charts[0].getChart().scrollToDataIndex(0)})
 await page.waitForFunction(()=>window.pending.some(p=>p.symbol==='BTC'))
 await page.evaluate(()=>window.charts[0].setSymbol({ticker:'ETH',exchange:'TEST',market:'perp',pricePrecision:2}))
 await page.waitForFunction(()=>window.charts[0].getSelection()?.dataReady&&window.charts[0].resolvedSymbol().ticker==='ETH')
 await page.evaluate(()=>{window.deferOld=false;window.pending.splice(0).forEach(p=>p.resolve())})
 await page.waitForTimeout(150)
 assert.ok(await page.evaluate(()=>window.charts[0].getChart().getDataList().every(b=>b.close>1000)), 'old BTC page must never enter ETH history')
 // Hold a failing page and prove it cannot disable paging for a later dataset.
 await page.evaluate(()=>window.charts[0].setSymbol({ticker:'BTC',exchange:'TEST',market:'perp',pricePrecision:2}))
 await page.waitForFunction(()=>window.charts[0].getSelection()?.dataReady&&window.charts[0].resolvedSymbol().ticker==='BTC')
 await page.evaluate(()=>{window.deferOld=true;window.charts[0].getChart().scrollToDataIndex(0)})
 await page.waitForFunction(()=>window.pending.some(p=>p.symbol==='BTC'))
 await page.evaluate(()=>window.charts[0].setSymbol({ticker:'SOL',exchange:'TEST',market:'perp',pricePrecision:2}))
 await page.waitForFunction(()=>window.charts[0].getSelection()?.dataReady&&window.charts[0].resolvedSymbol().ticker==='SOL')
 await page.evaluate(()=>{window.deferOld=false;window.pending.splice(0).forEach(p=>p.reject());window.charts[0].getChart().setBarSpace(1)})
 await page.waitForFunction(()=>window.charts[0].getChart().getDataList().length>700)
 assert.ok(await page.evaluate(()=>window.charts[0].getChart().getDataList().every(b=>b.close>3000)))
 // External event hooks cannot block later listeners or resource cleanup.
 await page.evaluate(()=>{
  window.selectionDeliveries=0;
  window.charts[0].subscribeSelectionChange(()=>{throw new Error('fixture listener')});
  window.charts[0].subscribeSelectionChange(()=>window.selectionDeliveries++);
 });
 // The 1s RAF cannot append carry bars to a previous interval while loading/error.
 await page.evaluate(()=>{window.grid.syncGroup.setOptions({period:false,range:false});window.deferSeconds=true;window.snapshot=window.charts[0].getChart().getDataList().map(b=>b.timestamp);window.charts[0].setPeriod({multiplier:1,timespan:'second',text:'1s'})})
 await page.waitForFunction(()=>window.pending.some(p=>p.period==='1s'))
 await page.waitForTimeout(180)
 assert.ok(await page.evaluate(()=>JSON.stringify(window.snapshot)===JSON.stringify(window.charts[0].getChart().getDataList().map(b=>b.timestamp))))
 await page.evaluate(()=>window.pending.splice(0).forEach(p=>p.reject()))
 await page.waitForTimeout(180)
 assert.ok(await page.evaluate(()=>JSON.stringify(window.snapshot)===JSON.stringify(window.charts[0].getChart().getDataList().map(b=>b.timestamp))))
 assert.ok(await page.evaluate(()=>window.selectionDeliveries>0))
 await page.evaluate(()=>{
  window.charts[0].subscribeDispose(()=>{window.charts[0].dispose();throw new Error('fixture disposal listener')});
  window.grid.destroy();
 })
 assert.equal(await page.evaluate(()=>window.listeners.size),0)
 assert.deepEqual(errors,[])
 console.log('Chart stability browser checks passed:',{pages:paged.pages,verified:['wheel zoom-out and multi-page loading','shared zoom limits','reset/live padding','stale page success/failure','1s loading/error isolation','subscription cleanup']})
} finally {await browser.close()}
