// Build first: npm run build
// Fixture-only Chromium workflow: no exchange connectivity or reference parity claim.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const assets = { '/pro.js': read('../dist/klinecharts-pro.umd.js'), '/pro.css': read('../dist/klinecharts-pro.css') }
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/pro.css">
<style>body{margin:0}#chart{height:700px}</style><div id="chart"></div>
<script src="/pro.js"></script><script>
const minute = {multiplier:1,timespan:'minute',text:'1m'};
const five = {multiplier:5,timespan:'minute',text:'5m'};
const week = {multiplier:1,timespan:'week',text:'1w'};
const start = Date.UTC(2026,0,1);
const fine = Array.from({length:600}, (_,i) => {
  const open = 100 + Math.sin(i/12)*4, close = 100 + Math.sin((i+1)/12)*4;
  return {timestamp:start+i*60000,open,close,low:Math.min(open,close)-0.2,high:Math.max(open,close)+0.2,volume:10+i%7};
});
const parent = Array.from({length:120}, (_,i) => {
  const children = fine.slice(i*5,i*5+5);
  return {timestamp:children[0].timestamp,open:children[0].open,close:children[4].close,
    low:Math.min(...children.map(b=>b.low)),high:Math.max(...children.map(b=>b.high)),volume:children.reduce((s,b)=>s+b.volume,0)};
});
window.requests=[]; window.delay=30; window.sparse=new URL(location.href).searchParams.has('sparse');
const feed = {
  async getHistoryKLineData(symbol,period,from,to) {
    window.requests.push({symbol:symbol.ticker,period:period.text,from,to});
    const isFine=period.text==='1m';
    if(isFine) await new Promise(r=>setTimeout(r,window.delay));
    const scale=symbol.ticker==='ETH'?10:1;
    return (isFine?fine.filter(b=>b.timestamp>=from&&b.timestamp<=to&&(!window.sparse || b.timestamp!==start+60*60000)):parent.filter(b=>b.timestamp<=to))
      .map(b=>({...b,open:b.open*scale,close:b.close*scale,high:b.high*scale,low:b.low*scale}));
  },subscribe(){},unsubscribe(){},
  config:async()=>({exchanges:[{key:'TEST',name:'Fixture'}],intervals:[minute,five,week]})
};
if(!localStorage.getItem('profile-seeded')) {
  localStorage.setItem('profile-seeded','1');
  localStorage.setItem('klinecharts-pro:drawings:TEST:perp:BTC',JSON.stringify([
    {name:'fixedRangeVolumeProfile',visible:true,lock:false,points:[{timestamp:parent[30].timestamp,value:98},{timestamp:parent[70].timestamp,value:103}]}
  ]));
}
window.pro = new klinechartspro.KLineChartPro({container:'chart',locale:'en-US',theme:'dark',
 symbol:{ticker:'BTC',exchange:'TEST',market:'perp',pricePrecision:2},period:five,
 periods:[minute,five,week],quickPeriods:['1m','5m'],mainIndicators:[],subIndicators:[],datafeed:feed});
</script>`
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? process.argv[2] })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message) })
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname
    return route.fulfill({ body: assets[path] ?? html, contentType: path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' })
  })
  await page.goto('http://chart.test/')
  await page.waitForFunction(() => window.pro.getChart()?.getDataList().length === 120)
  const add = async (query, name) => {
    await page.getByRole('button', { name: 'Indicators', exact: true }).click()
    await page.getByLabel('Search indicators').fill(query)
    await page.getByRole('button', { name: new RegExp('^Add On chart: ' + name) }).click()
    await page.keyboard.press('Escape')
  }
  await add('VRVP', 'Volume Profile Visible Range')
  const ready = () => page.waitForFunction(() => {
    const source = window.pro.getChart().getIndicatorByPaneId('candle_pane','VRVP')?.extendData?.volumeProfile
    return source?.state==='ready' && source.detailedParents>0
  })
  await ready()
  const source = await page.evaluate(() => {
    const value = window.pro.getChart().getIndicatorByPaneId('candle_pane','VRVP').extendData.volumeProfile
    return { detailed:value.detailedParents, fallback:value.fallbackParents, period:value.period.text }
  })
  assert.ok(source.detailed>0)
  assert.equal(source.period,'1m')
  // Inspect restored drawing through the registry; its data stays transient.
  await page.getByRole('button', { name: 'Layers', exact: true }).click()
  assert.ok(await page.locator('.drawing-name').count() >= 1)
  await page.keyboard.press('Escape')

  const fixed = await page.evaluate(() => {
    const drawing = window.pro.getChart().getChartStore().getOverlayStore().getInstances().find(o=>o.name==='fixedRangeVolumeProfile')
    return { label: drawing.extendData.sourceLabel, total: drawing.extendData.totalVolume,
      sum: drawing.extendData.profile.reduce((sum,row)=>sum+row.volume,0) }
  })
  assert.match(fixed.label,/Finer candles 1m/)
  assert.ok(Math.abs(fixed.total-fixed.sum)<1e-7)

  // Open the actual settings UI via the same action dispatched by canvas legend icons.
  await page.evaluate(() => window.pro.getChart().getChartStore().getActionStore().execute('onTooltipIconClick',
    {paneId:'candle_pane',indicatorName:'VRVP',iconId:'setting'}))
  const settings=page.locator('.klinecharts-pro-indicator-setting-modal')
  await settings.waitFor()
  await settings.getByLabel('Rows', { exact: true }).fill('32')
  await settings.getByLabel('Volume display', { exact: true }).selectOption('1')
  await settings.getByLabel('Extend levels right', { exact: true }).selectOption('1')
  await settings.getByRole('button', { name:'Apply', exact:true }).click()
  await ready()
  const expected=[32,70,30,1,1,1,1]
  assert.deepEqual(await page.evaluate(() => window.pro.getChart().getIndicatorByPaneId('candle_pane','VRVP').calcParams),expected)
  await page.getByRole('button', { name: /^Undo / }).click()
  assert.equal(await page.evaluate(() => window.pro.getChart().getIndicatorByPaneId('candle_pane','VRVP').calcParams[0]),24)
  await page.getByRole('button', { name: /^Redo / }).click()
  await page.reload()
  await ready()
  assert.deepEqual(await page.evaluate(() => window.pro.getChart().getIndicatorByPaneId('candle_pane','VRVP').calcParams),expected)
  const persisted=await page.evaluate(()=>JSON.stringify([...Array(localStorage.length)].map((_,i)=>localStorage.getItem(localStorage.key(i)))))
  assert.ok(!persisted.includes('detailedTimestamps') && !persisted.includes('volumeProfile'), 'detail candles must not enter persistence')

  // Actual canvas pixels: substantial blue/orange profile geometry and green/red up/down bins.
  const pixels=await page.evaluate(()=>{
    let green=0,red=0,orange=0;
    for(const canvas of document.querySelectorAll('canvas')) {
      const d=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      for(let i=0;i<d.length;i+=4) {
        if(d[i+1]>60&&d[i+1]>d[i]*2&&d[i+1]>d[i+2]*1.1)green++;
        if(d[i]>70&&d[i]>d[i+1]*2&&d[i]>d[i+2]*1.5)red++;
        if(d[i]>200&&d[i+1]>100&&d[i+1]<190&&d[i+2]<50)orange++;
      }
    }
    return {green,red,orange};
  })
  assert.ok(pixels.green>100&&pixels.red>100&&pixels.orange>20,JSON.stringify(pixels))
  await add('SVP','Session Volume Profile')
  await page.evaluate(()=>{window.pro.getChart().zoomAtDataIndex(1.5,70);window.pro.getChart().scrollToDataIndex(70)})
  await ready()
  await page.screenshot({path:'/tmp/hypecharts-volume-profile.png'})

  // Profiles retain raw source prices while the chart transforms to Heikin Ashi.
  await page.getByRole('button', { name:'Candle Type', exact:true }).click()
  await page.getByRole('menuitemradio', { name:/Heikin Ashi/ }).click()
  await ready()
  assert.ok(await page.evaluate(()=>{
    const chart=window.pro.getChart(), source=chart.getIndicatorByPaneId('candle_pane','VRVP').extendData.volumeProfile
    return source.bars[0].open!==chart.getDataList()[0].open
  }))
  await page.getByRole('button', { name:'Candle Type', exact:true }).click()
  await page.getByRole('menuitemradio', { name:'Candle Solid', exact:true }).click()
  await ready()

  // Missing intrabars keep exactly their whole parent candle, without double counting.
  await page.goto('http://chart.test/?sparse=1')
  await ready()
  assert.ok(await page.evaluate(()=>window.pro.getChart().getIndicatorByPaneId('candle_pane','VRVP').extendData.volumeProfile.fallbackParents>0))
  await page.goto('http://chart.test/')
  await ready()

  // Dataset switches isolate cached detailed prices and disable unsupported daily sessions.
  await page.evaluate(()=>window.pro.setSymbol({ticker:'ETH',exchange:'TEST',market:'perp',pricePrecision:2}))
  await page.waitForFunction(()=>window.pro.getChart().getDataList()[0]?.close>500)
  await add('VRVP','Volume Profile Visible Range')
  await ready()
  assert.ok(await page.evaluate(()=>window.pro.getChart().getIndicatorByPaneId('candle_pane','VRVP').extendData.volumeProfile.bars.every(b=>b.close>500)))
  await add('SVP','Session Volume Profile')
  await page.evaluate(()=>window.pro.setPeriod({multiplier:1,timespan:'week',text:'1w'}))
  await page.waitForFunction(()=>window.pro.getChart().getIndicatorByPaneId('candle_pane','SVP')?.extendData?.volumeProfile?.unsupported===true)
  await page.evaluate(()=>window.pro.dispose())
  await page.waitForTimeout(250)
  assert.deepEqual(errors,[])
  console.log('volume-profile browser workflow passed:',{...source,pixels})
} finally { await browser.close() }
