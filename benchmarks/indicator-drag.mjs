// Build first. Drag actual canvas titles with a fixture feed. No network requests.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const assets = { '/pro.js': read('../dist/klinecharts-pro.umd.js'), '/pro.css': read('../dist/klinecharts-pro.css') }
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/pro.css">
<div id="chart" style="width:1100px;height:700px"></div><script src="/pro.js"></script><script>
const minute={multiplier:1,timespan:'minute',text:'1m'};
const bars=Array.from({length:200},(_,i)=>({timestamp:1700000000000+i*60000,open:100,high:110,low:90,close:i%2?105:95,volume:(i%15+1)*1000000}));
const feed={getHistoryKLineData:async()=>bars,subscribe(){},unsubscribe(){},config:async()=>({exchanges:[{key:'TEST',name:'Fixture'}],intervals:[minute]})};
window.pro=new klinechartspro.KLineChartPro({container:'chart',locale:'en-US',theme:'dark',symbol:{ticker:'BTC',exchange:'TEST',pricePrecision:2},period:minute,periods:[minute],mainIndicators:[],subIndicators:['VOL','RSI','EMA'],datafeed:feed});
window.state=()=>{const c=window.pro.getChart(),all=[];c.getIndicatorByPaneId().forEach((inds,pane)=>inds.forEach(i=>all.push({name:i.name,pane,ownScale:i.ownScale})));return all};
window.range=()=>window.pro.getChart().getPaneById('candle_pane').getAxisComponent().getExtremum();
</script>`
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? process.argv[2] })
try {
  const page = await browser.newPage({ viewport: { width: 1150, height: 800 } })
  page.setDefaultTimeout(10000)
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname
    return route.fulfill({ body: assets[path] ?? html, contentType: path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' })
  })
  await page.goto('http://indicator-drag.test/')
  await page.waitForFunction(()=>window.pro.getSelection()?.dataReady)
  const state=()=>page.evaluate(()=>window.state())
  const title=async(name)=>{
    await page.waitForFunction(name=>{const c=window.pro.getChart(),i=window.state().find(i=>i.name===name);return i&&c.getIndicatorTitleBounds(i.pane).some(b=>b.indicatorName===name)},name)
    return page.evaluate(name=>{
    const c=window.pro.getChart(),i=window.state().find(i=>i.name===name),r=c.getDom(i.pane,'main').getBoundingClientRect(),b=c.getIndicatorTitleBounds(i.pane).find(b=>b.indicatorName===name)
    return {x:r.left+b.x+b.width/2,y:r.top+b.y+b.height/2}
  },name)
  }
  const destination=()=>page.evaluate(()=>{const r=window.pro.getChart().getDom('candle_pane','main').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})
  const drag=async(name,where)=>{const t=await title(name);await page.mouse.move(t.x,t.y);await page.mouse.down();await page.mouse.move(where.x,where.y,{steps:8});await page.mouse.up()}
  await page.mouse.move(500,150)
  await page.waitForFunction(()=>window.pro.getChart().getIndicatorTitleBounds(window.state().find(i=>i.name==='VOL').pane).length>0)
  // Ineligible study never acquires the drag feedback or changes placement.
  const rsi=(await state()).find(i=>i.name==='RSI')
  await drag('RSI',await destination())
  assert.deepEqual((await state()).find(i=>i.name==='RSI'),rsi)
  assert.equal(await page.locator('.klinecharts-pro-indicator-drag-hint').count(),0)
  // An outside drop and Escape both leave eligible studies untouched.
  const original=(await state()).find(i=>i.name==='VOL')
  await drag('VOL',{x:1140,y:780})
  assert.deepEqual((await state()).find(i=>i.name==='VOL'),original)
  let t=await title('VOL'),d=await destination()
  await page.mouse.move(t.x,t.y);await page.mouse.down();await page.mouse.move(d.x,d.y,{steps:8})
  assert.equal(await page.locator('.klinecharts-pro-indicator-drop-target').count(),1)
  await page.keyboard.press('Escape');await page.mouse.up()
  assert.deepEqual((await state()).find(i=>i.name==='VOL'),original)
  await page.evaluate(()=>{const c=window.pro.getChart(),i=window.state().find(i=>i.name==='VOL');c.overrideIndicator({name:'VOL',calcParams:[7,14],styles:{plots:{volume:{upColor:'#ffff00'}}}},i.pane)})
  const viewport=await page.evaluate(()=>({range:window.pro.getChart().getVisibleRange(),bar:window.pro.getChart().getBarSpace()}))
  await drag('VOL',await destination())
  await page.waitForFunction(()=>window.state().some(i=>i.name==='VOL'&&i.pane==='candle_pane'&&i.ownScale))
  assert.deepEqual(await page.evaluate(()=>({range:window.pro.getChart().getVisibleRange(),bar:window.pro.getChart().getBarSpace()})),viewport,'title drag must not pan the chart')
  assert.deepEqual(await page.evaluate(()=>{const i=window.pro.getChart().getIndicatorByPaneId('candle_pane','VOL');return {params:i.calcParams,plots:i.styles.plots}}),{params:[7,14],plots:{volume:{upColor:'#ffff00'}}})
  const undo=page.getByRole('button',{name:/^Undo /}),redo=page.getByRole('button',{name:/^Redo /})
  await undo.click()
  await page.waitForFunction(()=>window.state().some(i=>i.name==='VOL'&&i.pane!=='candle_pane'&&!i.ownScale))
  await redo.click()
  await page.waitForFunction(()=>window.state().some(i=>i.name==='VOL'&&i.pane==='candle_pane'&&i.ownScale))
  // Move EMA into RSI's pane first; dragging its own title leaves RSI there.
  await page.evaluate(()=>{const c=window.pro.getChart(),i=window.state().find(i=>i.name==='EMA');c.getChartStore().getActionStore().execute('onTooltipIconClick',{indicatorName:'EMA',paneId:i.pane,iconId:'setting'})})
  await page.getByLabel('Move to pane',{exact:true}).selectOption(rsi.pane)
  await page.waitForFunction(()=>{const s=window.state();return s.find(i=>i.name==='EMA').pane===s.find(i=>i.name==='RSI').pane})
  // A second eligible study joins the candles without displacing volume.
  await drag('EMA',await destination())
  await page.waitForFunction(()=>window.state().filter(i=>i.pane==='candle_pane').length===2)
  assert.equal((await state()).find(i=>i.name==='RSI').pane,rsi.pane)
  await page.reload()
  await page.waitForFunction(()=>window.pro.getSelection()?.dataReady&&window.state().filter(i=>i.pane==='candle_pane').length===2)
  assert.equal((await state()).find(i=>i.name==='VOL').ownScale,true)
  assert.equal(await page.locator('.klinecharts-pro-indicator-drag-hint').count(),0)
  await page.screenshot({path:'/tmp/hypecharts-indicator-drag.png'})
  // Dataset changes invalidate a pending move, and disposal removes feedback/listeners.
  await page.getByRole('button',{name:'Indicators',exact:true}).click()
  await page.getByLabel('Search indicators').fill('VOL')
  await page.getByRole('button',{name:/^Add New pane: Volume( \(\d+\))?$/}).click()
  await page.keyboard.press('Escape')
  t=await title('VOL~2');d=await destination()
  await page.mouse.move(t.x,t.y);await page.mouse.down();await page.mouse.move(d.x,d.y,{steps:8})
  await page.evaluate(()=>window.pro.setSymbol({ticker:'ETH',exchange:'TEST',pricePrecision:2}))
  await page.waitForFunction(()=>window.pro.getSelection()?.dataReady&&window.pro.getSelection()?.symbol?.ticker==='ETH')
  await page.mouse.up()
  assert.ok((await state()).every(i=>i.pane!=='candle_pane'))
  t=await title('VOL');d=await destination()
  await page.mouse.move(t.x,t.y);await page.mouse.down();await page.mouse.move(d.x,d.y,{steps:8})
  await page.evaluate(()=>window.pro.dispose())
  await page.mouse.up()
  assert.equal(await page.locator('.klinecharts-pro-indicator-drag-hint').count(),0)
  assert.deepEqual(errors,[])
  console.log('Indicator title drag passed: eligibility, outside/Escape cancellation, no panning, multiple studies on chart, undo/redo and reload')
} finally { await browser.close() }
