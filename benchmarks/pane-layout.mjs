// Build first. Fixture workflow for pane ordering, shared membership and history.
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
const key='klinecharts-pro:indicators:TEST:BTC';
if(!localStorage.getItem(key)) localStorage.setItem(key,JSON.stringify({main:[],sub:[
 {name:'VOL',pane:'volume',height:120,calcParams:[7,14],plots:{volume:{upColor:'#ffff00'}}},
 {name:'RSI',pane:'rsi',height:130},
 {name:'EMA',pane:'ema',height:70,calcParams:[9],source:'hl2',offset:2},
 {name:'MACD',pane:'macd',height:110}
]}));
window.pro=new klinechartspro.KLineChartPro({container:'chart',locale:'en-US',theme:'dark',symbol:{ticker:'BTC',exchange:'TEST',pricePrecision:2},period:minute,periods:[minute],mainIndicators:[],subIndicators:[],datafeed:feed});
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
  await page.goto('http://pane-layout.test/')
  const ready=()=>page.waitForFunction(()=>window.pro.getSelection()?.dataReady)
  const layout=()=>page.evaluate(()=>{const c=window.pro.getChart();return c.getPaneOrder().map(id=>({id,names:[...c.getIndicatorByPaneId(id).keys()],height:Math.round(c.getSize(id).height)}))})
  const order=async()=> (await layout()).map(p=>p.id)
  const settings=page.locator('.klinecharts-pro-indicator-setting-modal')
  const open=async(name)=>{
    await page.evaluate(name=>{const c=window.pro.getChart(),i=window.state().find(i=>i.name===name);c.getChartStore().getActionStore().execute('onTooltipIconClick',{indicatorName:name,paneId:i.pane,iconId:'setting'})},name)
    await settings.waitFor()
  }
  const move=async(name,target)=>{await open(name);await settings.getByLabel('Move to pane',{exact:true}).selectOption(target);await settings.waitFor({state:'detached'})}
  const step=async(name,direction)=>{await open(name);await settings.getByRole('button',{name:`Move pane ${direction}`,exact:true}).click();await settings.waitFor({state:'detached'})}
  const undo=()=>page.getByRole('button',{name:/^Undo /}).click()
  const redo=()=>page.getByRole('button',{name:/^Redo /}).click()
  const close=async(name)=>page.evaluate(name=>{const c=window.pro.getChart(),i=window.state().find(i=>i.name===name);c.getChartStore().getActionStore().execute('onTooltipIconClick',{indicatorName:name,paneId:i.pane,iconId:'close'})},name)
  const stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('klinecharts-pro:indicators:TEST:BTC')))
  await ready()
  assert.deepEqual(await order(),['volume','rsi','ema','macd'])
  const original=await layout()
  await page.evaluate(()=>{
    const c=window.pro.getChart();window.rsiRef=c.getIndicatorByPaneId('rsi','RSI');window.volRef=c.getIndicatorByPaneId('volume','VOL');
    c.createOverlay({id:'host-order',name:'horizontalStraightLine',groupId:'host-owned-orders',points:[{value:102}]});window.hostRef=c.getOverlayById('host-order')
  })
  await move('EMA','volume')
  assert.deepEqual(await layout(),[
    {id:'volume',names:['VOL','EMA'],height:120},{id:'rsi',names:['RSI'],height:130},{id:'macd',names:['MACD'],height:110}
  ])
  await undo()
  assert.deepEqual(await layout(),original,'undo restores the emptied pane in its original position')
  await redo()
  assert.deepEqual(await order(),['volume','rsi','macd'])
  await step('EMA','down')
  assert.deepEqual(await order(),['rsi','volume','macd'],'reorder moves the entire shared pane')
  assert.ok(await page.evaluate(()=>{const c=window.pro.getChart();return c.getIndicatorByPaneId('rsi','RSI')===window.rsiRef&&c.getIndicatorByPaneId('volume','VOL')===window.volRef&&c.getOverlayById('host-order')===window.hostRef}))
  await undo();assert.deepEqual(await order(),['volume','rsi','macd'])
  await redo();assert.deepEqual(await order(),['rsi','volume','macd'])
  await open('RSI')
  assert.ok(await settings.getByRole('button',{name:'Move pane up',exact:true}).isDisabled())
  await page.keyboard.press('Escape')
  await open('MACD')
  assert.ok(await settings.getByRole('button',{name:'Move pane down',exact:true}).isDisabled())
  // Each shared destination is offered once, even when it contains multiple studies.
  assert.equal(await settings.getByLabel('Move to pane',{exact:true}).locator('option[value="volume"]').count(),1)
  await page.keyboard.press('Escape')
  await step('MACD','up')
  assert.deepEqual(await order(),['rsi','macd','volume'])
  assert.deepEqual((await stored()).sub.map(i=>[i.name,i.pane]),[['RSI','rsi'],['MACD','macd'],['VOL','volume'],['EMA','volume']])
  // Delete both members, then undo twice: recreate the same pane and legend order.
  await close('VOL');await close('EMA')
  assert.deepEqual(await order(),['rsi','macd'])
  await undo();await undo()
  assert.deepEqual((await layout()).at(-1).names,['VOL','EMA'])
  assert.deepEqual(await order(),['rsi','macd','volume'])
  await move('EMA','__new__')
  assert.equal((await layout()).length,4)
  await undo()
  assert.deepEqual((await layout()).at(-1).names,['VOL','EMA'])
  await redo();assert.equal((await layout()).length,4)
  await undo()
  // Reordered separators must resize their current neighbors, not old neighbors.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  const beforeResize=await layout()
  const separator=await page.evaluate(()=>{const r=window.pro.getChart().getPaneById('volume').getSeparatorWidget().getContainer().getBoundingClientRect();return {x:r.left+250,y:r.top+r.height/2}})
  await page.mouse.move(separator.x,separator.y);await page.mouse.down();await page.mouse.move(separator.x,separator.y+15,{steps:8});await page.waitForTimeout(100);await page.mouse.up()
  const afterResize=await layout()
  assert.equal(afterResize[0].height,beforeResize[0].height)
  assert.ok(afterResize[1].height>beforeResize[1].height)
  assert.ok(afterResize[2].height<beforeResize[2].height)
  assert.ok(await page.evaluate(()=>{const c=window.pro.getChart(),ids=['candle_pane',...c.getPaneOrder()];return ids.every((id,index)=>{const p=c.getPaneById(id);return p.getTopPane()?.getId()===(ids[index-1])&&p.getBottomPane()?.getId()===ids[index+1]})}))
  assert.ok(await page.evaluate(()=>window.pro.getChart().getOverlayById('host-order')===window.hostRef))
  await page.reload();await ready()
  assert.deepEqual(await layout(),afterResize,'reload retains shared membership, pane order and resized heights')
  assert.ok(await page.evaluate(()=>{const i=window.pro.getChart().getIndicatorByPaneId('volume','EMA');return i.calcParams[0]===9&&i.source==='hl2'&&i.offset===2}))
  assert.equal(await page.evaluate(()=>window.pro.getChart().getIndicatorByPaneId('volume','VOL').styles.plots.volume.upColor),'#ffff00')
  await page.evaluate(()=>window.pro.setSymbol({ticker:'ETH',exchange:'TEST',pricePrecision:2}))
  await page.waitForFunction(()=>window.pro.getSelection()?.dataReady&&window.pro.getSelection()?.symbol?.ticker==='ETH')
  assert.deepEqual(await order(),[])
  await page.evaluate(()=>window.pro.setSymbol({ticker:'BTC',exchange:'TEST',pricePrecision:2}))
  await page.waitForFunction(()=>window.pro.getSelection()?.dataReady&&window.pro.getSelection()?.symbol?.ticker==='BTC')
  assert.deepEqual(await layout(),afterResize,'returning to a symbol restores its ordered shared panes')
  await page.screenshot({path:'/tmp/hypecharts-pane-layout.png'})
  await open('EMA')
  await page.screenshot({path:'/tmp/hypecharts-pane-order-controls.png'})
  assert.deepEqual(errors,[])
  console.log('Pane layout passed: legacy-compatible grouped restore, whole-pane ordering, history, removed pane position, shared legend order, target height, neighbor resize, settings retention, reload/symbol restore and host overlay isolation')
} finally { await browser.close() }
