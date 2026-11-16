// npm run build; node benchmarks/multi-chart.mjs [/path/to/chrome-headless-shell]
// Real Chromium/Canvas and fixture histories; no live/reference-platform parity claim.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const assets = { '/pro.js': read('../dist/klinecharts-pro.umd.js'), '/pro.css': read('../dist/klinecharts-pro.css') }
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/pro.css">
<style>body{margin:0;background:#131722}#grid{width:1100px;height:760px}#controls{height:30px;color:white}</style>
<div id="controls"><label><input id="symbol-link" type="checkbox">Link symbol</label><label><input id="period-link" type="checkbox">Link interval</label></div>
<div id="grid"></div><script src="/pro.js"></script><script>
const minute={multiplier:1,timespan:'minute',text:'1m'},five={multiplier:5,timespan:'minute',text:'5m'};
const start=Date.UTC(2026,0,1);
window.requests=[]; window.axisFlags=[]; window.resizeCommits=0;
const feed={
 async getHistoryKLineData(symbol,period,from,to){
   window.requests.push({ticker:symbol.ticker,period:period.text});
   const stride=period.timespan==='minute'?period.multiplier:1;
   const count=Math.floor(400/stride), first=symbol.ticker==='ETH'?Math.floor(80/stride):0;
   if(to<start+first*stride*60000)return [];
   if(symbol.ticker==='ETH')await new Promise(r=>setTimeout(r,50));
   return Array.from({length:count-first},(_,i)=>{
     const t=(i+first)*stride, close=(symbol.ticker==='ETH'?2000:100)+Math.sin(t/5)*8;
     return {timestamp:start+t*60000,open:close-1,high:close+3,low:close-3,close,volume:1000};
   }).filter(b=>b.timestamp<=to);
 }, subscribe(){},unsubscribe(){},
 config:async()=>({exchanges:[{key:'TEST',name:'Fixture'}],intervals:[minute,five]}),
 async resolveSymbol(name){await new Promise(r=>setTimeout(r,name.includes('STALE')?300:10));return{ticker:name.split(':').pop(),exchange:'TEST',market:'perp',pricePrecision:2}}
};
window.grid=klinechartspro.createChartGrid({container:document.getElementById('grid'),columns:2,gap:4,
 sync:true,sharedTimeAxis:true,resizable:true,sizes:JSON.parse(localStorage.getItem('grid-sizes')||'null')||{columns:[0.6,0.4],rows:[0.5,0.5]},
 onResize:sizes=>{window.resizeCommits++;localStorage.setItem('grid-sizes',JSON.stringify(sizes))},
 createChart:(cell,index,flags)=>{
   window.axisFlags.push(flags.timeAxisVisible);
   return new klinechartspro.KLineChartPro({container:cell,locale:'en-US',theme:'dark',
    symbol:{ticker:index===1?'ETH':'BTC',exchange:'TEST',market:'perp',pricePrecision:2},
    period:index===2?five:minute,periods:[minute,five],quickPeriods:['1m','5m'],mainIndicators:[],subIndicators:[],
    styles:{xAxis:{show:flags.timeAxisVisible,...(flags.timeAxisVisible?{}:{size:0})}},datafeed:feed});
 }});
window.grid.setLayout(3,2);
window.charts=window.grid.charts;
for(const [id,key] of [['symbol-link','symbol'],['period-link','period']])document.getElementById(id).onchange=e=>window.grid.syncGroup.setOptions({[key]:e.target.checked});
window.times=chart=>{
 const core=chart.getChart(),s=core.getChartStore().getTimeScaleStore(),data=core.getDataList(),width=core.getSize('candle_pane','main').width;
 const step=chart.getPeriod().multiplier*60000;
 const at=i=>{if(i<0)return data[0].timestamp+i*step;if(i>=data.length-1)return data.at(-1).timestamp+(i-data.length+1)*step;
 const lo=Math.floor(i);return data[lo].timestamp+(data[lo+1].timestamp-data[lo].timestamp)*(i-lo)};
 return [at(s.coordinateToFloatIndex(0)-0.5),at(data.length+s.getOffsetRightBarCount()-0.5)];
};
</script>`
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? process.argv[2] })
try {
  const page = await browser.newPage({ viewport: { width: 1150, height: 850 } })
  page.setDefaultTimeout(10000)
  const errors=[]
  page.on('pageerror',error=>{errors.push(error.message);console.error('Browser error:',error.message)})
  await page.route('**/*',route=>{
    const path=new URL(route.request().url()).pathname
    return route.fulfill({body:assets[path]??html,contentType:path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':'text/html'})
  })
  await page.goto('http://sync.test/')
  const ready=()=>page.waitForFunction(()=>window.charts.every(chart=>chart.getSelection()?.dataReady))
  const aligned=()=>page.waitForFunction(()=>{
    const ranges=window.charts.map(window.times),base=ranges[0];
    return ranges.every(range=>Math.abs(range[0]-base[0])<10&&Math.abs(range[1]-base[1])<10)
  }).catch(async error=>{console.error('Alignment state:',await page.evaluate(()=>window.charts.map(chart=>({range:window.times(chart),selection:chart.getSelection(),width:chart.getChart().getSize('candle_pane','main').width,bar:chart.getChart().getBarSpace(),offset:chart.getChart().getChartStore().getTimeScaleStore().getOffsetRightBarCount(),count:chart.getChart().getDataList().length}))));throw error})
  await ready();await aligned()
  assert.deepEqual(await page.evaluate(()=>window.axisFlags),[false,false,true], 'only actual bottom row retains its time axes')
  assert.ok(await page.evaluate(()=>{
    const rects=window.grid.cells.map(cell=>cell.getBoundingClientRect());
    const host=document.getElementById('grid').getBoundingClientRect();
    return Math.abs(host.height-760)<1 && rects[0].bottom<=rects[2].top && rects.every(r=>r.bottom<=host.bottom+1);
  }), 'chart roots must fill their grid tracks without inheriting the standalone 80vh height')
  await page.evaluate(()=>window.charts[0].getChart().setBarSpace(4))
  await aligned()
  await page.evaluate(()=>window.charts[1].getChart().setOffsetRightDistance(-200,true))
  await aligned()

  // Crosshair time maps into the containing 5m candle, not the same index.
  await page.evaluate(()=>window.charts[0].getChart().getChartStore().getActionStore().execute('onCrosshairChange',
    {x:100,realDataIndex:212,dataIndex:212,paneId:'source-only-pane'}))
  const cross=await page.evaluate(()=>window.charts.map(chart=>chart.getChart().getChartStore().getCrosshairStore().get()))
  assert.equal(cross[1].kLineData.timestamp,Date.UTC(2026,0,1)+212*60000)
  assert.equal(cross[2].kLineData.timestamp,Date.UTC(2026,0,1)+210*60000)
  assert.equal(cross[2].paneId,'candle_pane')
  await page.evaluate(()=>window.charts[0].getChart().getChartStore().getActionStore().execute('onCrosshairChange',{}))
  assert.ok(await page.evaluate(()=>window.charts.slice(1).every(chart=>chart.getChart().getChartStore().getCrosshairStore().get().x===undefined)))

  // Pointer and keyboard divider changes retain chart instances and time ranges.
  const before=await page.evaluate(()=>window.grid.getSizes())
  const column=page.getByRole('separator',{name:'Resize chart columns 1 and 2'})
  const bounds=await column.boundingBox()
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+100);await page.mouse.down()
  await page.mouse.move(bounds.x+bounds.width/2+60,bounds.y+100,{steps:8});await page.mouse.up()
  assert.ok((await page.evaluate(()=>window.grid.getSizes())).columns[0]>before.columns[0])
  await aligned()
  await column.focus();await page.keyboard.press('ArrowLeft');await aligned()
  assert.ok(await page.evaluate(()=>window.resizeCommits>=2))
  const row=page.getByRole('separator',{name:'Resize chart rows 1 and 2'})
  await row.focus();await page.keyboard.press('ArrowDown')
  await aligned()
  const saved=await page.evaluate(()=>window.grid.getSizes())
  await page.reload();await ready()
  await aligned()
  assert.deepEqual(await page.evaluate(()=>window.grid.getSizes()),saved)

  // Enable links through real controls, change symbols asynchronously and intervals through the toolbar.
  await page.locator('#symbol-link').check()
  await page.locator('#period-link').check()
  await page.evaluate(()=>window.charts[0].setSymbol('TEST:SOL'))
  await page.waitForFunction(()=>window.charts.every(chart=>chart.resolvedSymbol().ticker==='SOL'))
  await ready();await aligned()
  await page.locator('#grid').getByRole('button',{name:'5m',exact:true}).first().click()
  await page.waitForFunction(()=>window.charts.every(chart=>chart.getPeriod().text==='5m'))
  await ready();await aligned()
  // Zoom-out must use a common feasible span instead of independently clamping
  // the narrower linked chart. Reset must retain its original realtime padding.
  await page.evaluate(()=>window.charts[0].getChart().setBarSpace(1))
  await aligned()
  assert.ok(await page.evaluate(()=>window.charts.every(c=>c.getChart().getBarSpace()>=1)))
  await page.evaluate(()=>window.charts[0].getChart().scrollToDataIndex(20))
  await aligned()
  assert.ok(await page.evaluate(()=>window.charts.every(c=>c.getChart().getChartStore().getTimeScaleStore().getOffsetRightDistance()===50)))
  await page.locator('#grid').getByRole('button',{name:'Reset Chart',exact:true}).nth(1).click()
  await aligned()
  assert.ok(await page.evaluate(()=>window.charts.every(c=>{
    const core=c.getChart(), data=core.getDataList(), scale=core.getChartStore().getTimeScaleStore();
    const x=scale.dataIndexToCoordinate(data.length-1), width=core.getSize('candle_pane','main').width;
    return x>=0&&x<=width;
  })), 'reset must put latest candles back on screen')
  // A stale earlier resolver cannot overwrite the latest linked selection.
  await page.evaluate(()=>{window.charts[0].setSymbol('TEST:STALE');window.charts[0].setSymbol('TEST:BTC')})
  await page.waitForFunction(()=>window.charts.every(chart=>chart.resolvedSymbol().ticker==='BTC'))
  await page.waitForTimeout(350)
  assert.ok(await page.evaluate(()=>window.charts.every(chart=>chart.resolvedSymbol().ticker==='BTC')))
  await page.locator('#symbol-link').uncheck();await page.locator('#period-link').uncheck()
  await page.evaluate(()=>window.charts[1].setSymbol('TEST:ETH'))
  await page.waitForFunction(()=>window.charts[1].resolvedSymbol().ticker==='ETH')
  assert.equal(await page.evaluate(()=>window.charts[0].resolvedSymbol().ticker),'BTC')
  await ready();await aligned()
  await page.screenshot({path:'/tmp/hypecharts-multi-chart.png'})
  // Remove/re-add and destruction must clean callbacks and active drag listeners.
  await page.evaluate(()=>{const group=window.grid.syncGroup;group.remove(window.charts[1]);group.add(window.charts[1])})
  await aligned()
  await column.focus();await page.keyboard.press('ArrowRight')
  const activeDivider=await column.boundingBox()
  await page.mouse.move(activeDivider.x+activeDivider.width/2,activeDivider.y+100)
  await page.mouse.down()
  await page.mouse.move(activeDivider.x+activeDivider.width/2+15,activeDivider.y+100)
  await page.evaluate(()=>window.grid.destroy())
  assert.equal(await page.locator('#grid').locator(':scope > *').count(),0)
  assert.ok(await page.evaluate(()=>window.charts.every(chart=>chart.getChart()===null)))
  await page.mouse.move(1000,700);await page.mouse.up()
  assert.deepEqual(errors,[])
  console.log('Multi-chart browser workflow passed: timestamps, unequal histories/intervals/widths, crosshair, dividers, persisted weights, links, stale resolution and cleanup.')
} finally {await browser.close()}
