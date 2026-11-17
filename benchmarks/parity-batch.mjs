// Build first. Fixture-only integration checks for recovery, workspaces and object management.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const assets = { '/pro.js': read('../dist/klinecharts-pro.umd.js'), '/pro.css': read('../dist/klinecharts-pro.css') }
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/pro.css"><style>body{margin:0}#a,#b{width:1100px;height:650px}</style><div id="a"></div><div id="b"></div><script src="/pro.js"></script><script>
const minute={multiplier:1,timespan:'minute',text:'1m'};
window.end=Math.floor(Date.now()/60000)*60000;window.seedEnd=end-5*60000;
window.calls=[];window.listeners=new Map();window.connections=new Set();window.failOlder=0;window.hold=false;window.pending=[];
window.bar=t=>({timestamp:t,open:100+Math.sin(t/60000),high:110,low:90,close:100+Math.cos(t/60000),volume:1000});
const feed={
 async getHistoryKLineData(s,p,from,to){window.calls.push({symbol:s.ticker,from,to});
  if(to<end-400*60000&&window.failOlder>0){window.failOlder--;throw Error('fixture offline')}
  const bars=Array.from({length:6001},(_,i)=>bar(end-(6000-i)*60000)).filter(b=>b.timestamp>=from&&b.timestamp<=to&&b.timestamp<=seedEnd);
  if(window.hold)return await new Promise(resolve=>pending.push(()=>resolve(bars)));
  return bars;
 },subscribe(s,p,cb){listeners.set(cb,s.ticker)},unsubscribe(s,p,cb){listeners.delete(cb)},
 subscribeConnection(cb){connections.add(cb);return()=>connections.delete(cb)},
 config:async()=>({exchanges:[{key:'TEST',name:'Fixture'}],intervals:[minute]})
};
window.pro=new klinechartspro.KLineChartPro({container:'a',locale:'en-US',theme:'dark',symbol:{ticker:'BTC',exchange:'TEST',pricePrecision:2},period:minute,periods:[minute],mainIndicators:[],subIndicators:['VOL','RSI'],datafeed:feed});
window.other=new klinechartspro.KLineChartPro({container:'b',locale:'en-US',theme:'dark',symbol:{ticker:'SOL',exchange:'TEST',pricePrecision:2},period:minute,periods:[minute],mainIndicators:[],subIndicators:[],datafeed:feed});
</script>`
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? process.argv[2] })
let page
try {
  page=await browser.newPage({viewport:{width:1150,height:1400}})
  page.setDefaultTimeout(15000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>{const path=new URL(route.request().url()).pathname;return route.fulfill({body:assets[path]??html,contentType:path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':'text/html'})})
  await page.goto('http://parity-batch.test/')
  await page.waitForFunction(()=>window.pro.getSelection()?.dataReady&&window.other.getSelection()?.dataReady)
  const a=page.locator('#a'), b=page.locator('#b')
  // Turn on Heikin Ashi, then retry a failed older history page without losing the viewport.
  await a.getByRole('button',{name:'Candle Type',exact:true}).click()
  await a.getByRole('menuitemradio',{name:/Heikin Ashi/}).click()
  const oldFirst=await page.evaluate(()=>window.pro.getChart().getDataList()[0].timestamp)
  await page.evaluate(()=>{window.failOlder=2;window.pro.getChart().scrollToDataIndex(0,0)})
  await page.waitForFunction(first=>window.pro.getChart().getDataList()[0].timestamp<first,oldFirst)
  assert.ok(await page.evaluate(()=>{const list=window.pro.getChart().getDataList();let prev;return list.every(row=>{const raw=bar(row.timestamp),close=(raw.open+raw.high+raw.low+raw.close)/4,open=prev?(prev.open+prev.close)/2:(raw.open+raw.close)/2;prev={open,close};return Math.abs(row.open-open)<1e-8&&Math.abs(row.close-close)<1e-8})}),'paged Heikin Ashi matches a full loaded-history calculation')
  assert.equal(await a.locator('.klinecharts-pro-data-retry').count(),0)
  await page.evaluate(()=>{window.failOlder=99;window.pro.getChart().scrollToDataIndex(0,0)})
  await a.locator('.klinecharts-pro-data-retry button').waitFor()
  await page.evaluate(()=>{window.failOlder=0})
  await a.locator('.klinecharts-pro-data-retry button').click()
  await a.locator('.klinecharts-pro-data-retry').waitFor({state:'detached'})
  // Fill an outage while a newer live revision arrives before the history response.
  await page.evaluate(()=>{window.pro.getChart().resetViewport();window.seedEnd=end;window.hold=true;connections.forEach(cb=>cb({status:'reconnected',symbol:{ticker:'BTC',exchange:'TEST'}}))})
  await page.waitForFunction(()=>window.pending.length>0)
  await page.evaluate(()=>{for(const [cb,symbol] of listeners)if(symbol==='BTC')cb({timestamp:end,open:999,high:1001,low:998,close:1000,volume:20});window.hold=false;pending.splice(0).forEach(resolve=>resolve())})
  await page.waitForFunction(()=>window.pro.getChart().getDataList().at(-1)?.close===(999+1001+998+1000)/4)
  assert.ok(await page.evaluate(()=>{const times=new Set(window.pro.getChart().getDataList().map(b=>b.timestamp));return [1,2,3,4].every(i=>times.has(end-i*60000))}))
  // Seed user-owned drawings and a host order. Workspace restore must keep the host object untouched.
  await page.evaluate(async()=>{
    const c=pro.getChart();c.createOverlay({id:'host-order',name:'horizontalStraightLine',groupId:'orders',points:[{value:108}]});window.host=c.getOverlayById('host-order');
    const state=pro.getWorkspace();state.drawings=[{name:'horizontalStraightLine',points:[{value:97}]},{name:'horizontalStraightLine',points:[{value:102}]},{name:'rect',points:[{timestamp:end-20*60000,value:98},{timestamp:end-10*60000,value:104}]}];
    const shared=state.indicators.sub[0].pane;state.indicators.sub[1].pane=shared;
    await pro.applyWorkspace(state)
  })
  assert.ok(await page.evaluate(()=>pro.getChart().getOverlayById('host-order')===window.host))
  await a.getByRole('button',{name:'Layers',exact:true}).click()
  const manager=a.locator('.klinecharts-pro-drawing-manager'), rows=manager.locator('li')
  await rows.first().waitFor();assert.equal(await rows.count(),3)
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  const linePoint=async(value)=>page.evaluate(value=>{const c=pro.getChart(),r=c.getDom('candle_pane','main').getBoundingClientRect(),p=c.convertToPixel({value},{paneId:'candle_pane'});return {x:r.left+220,y:r.top+p.y}},value)
  let point=await linePoint(97);await page.mouse.click(point.x,point.y)
  assert.equal(await rows.locator('input[type=checkbox]:checked').count(),1,'canvas selection updates the object tree')
  point=await linePoint(102);await page.keyboard.down('Control');await page.mouse.click(point.x,point.y);await page.keyboard.up('Control')
  assert.equal(await rows.locator('input[type=checkbox]:checked').count(),2,'modifier canvas selection supports multiple objects')

  await rows.nth(0).getByRole('checkbox').check();await rows.nth(1).getByRole('checkbox').check()
  await manager.getByLabel('Group name',{exact:true}).fill('Trend')
  await manager.getByRole('button',{name:'Assign group',exact:true}).click()
  assert.equal(await manager.getByRole('group',{name:'Trend',exact:true}).count(),1)
  assert.equal(await page.evaluate(()=>pro.getWorkspace().drawings.filter(d=>d.objectGroup==='Trend').length),2)
  await manager.getByRole('button',{name:'Hide selected',exact:true}).click()
  assert.equal(await page.evaluate(()=>pro.getWorkspace().drawings.filter(d=>d.visible===false).length),2)
  await a.getByRole('button',{name:/^Undo /}).click()
  assert.equal(await page.evaluate(()=>pro.getWorkspace().drawings.filter(d=>d.visible===false).length),0)
  await manager.getByRole('checkbox',{name:'Select group Trend',exact:true}).check()
  const layerBefore=await page.evaluate(()=>pro.getChart().getOverlayOrder('candle_pane','drawing_tools'))
  await manager.getByRole('button',{name:'Bring forward',exact:true}).click()
  const layerAfter=await page.evaluate(()=>pro.getChart().getOverlayOrder('candle_pane','drawing_tools'))
  assert.notDeepEqual(layerAfter,layerBefore)
  assert.ok(await page.evaluate(()=>pro.getChart().getOverlayById('host-order')===window.host))
  await manager.getByRole('button',{name:'Copy',exact:true}).click()
  await b.getByRole('button',{name:'Layers',exact:true}).click()
  await b.getByRole('button',{name:'Paste',exact:true}).click()
  assert.equal(await page.evaluate(()=>other.getWorkspace().drawings.length),2)
  assert.equal(await page.evaluate(()=>other.getWorkspace().drawings.filter(d=>d.objectGroup==='Trend').length),2)
  await b.getByRole('button',{name:/^Undo /}).click()
  assert.equal(await page.evaluate(()=>other.getWorkspace().drawings.length),0)
  // Named dialog: save, rename, change symbol, then restore the full workspace.
  await a.getByRole('button',{name:'Workspaces',exact:true}).click()
  let modal=a.locator('.klinecharts-pro-workspace-modal')
  await modal.getByLabel('Workspace name',{exact:true}).fill('Research')
  await modal.getByRole('button',{name:'Save new',exact:true}).click()
  await modal.getByLabel('Workspace name',{exact:true}).fill('Research renamed')
  await modal.getByRole('button',{name:'Rename',exact:true}).click()
  const saved=await page.evaluate(()=>klinechartspro.createWorkspaceStore().list()[0])
  assert.equal(saved.name,'Research renamed');assert.equal(saved.charts[0].drawings.length,3)
  assert.ok(saved.charts[0].indicators.sub.every(i=>i.pane===saved.charts[0].indicators.sub[0].pane))
  await modal.getByRole('button',{name:'Close',exact:true}).click()
  await page.evaluate(()=>pro.setSymbol({ticker:'ETH',exchange:'TEST',pricePrecision:2}))
  await page.waitForFunction(()=>pro.getSelection()?.dataReady&&pro.getSelection()?.symbol?.ticker==='ETH')
  await a.locator('.klinecharts-pro-widget').focus();await page.keyboard.press('Control+v')
  assert.equal(await page.evaluate(()=>pro.getWorkspace().drawings.length),2,'clipboard also works after switching symbols')
  await a.getByRole('button',{name:'Workspaces',exact:true}).click()
  modal=a.locator('.klinecharts-pro-workspace-modal')
  await modal.getByLabel('Saved workspaces',{exact:true}).selectOption(saved.id)
  await modal.getByRole('button',{name:'Load',exact:true}).click()
  await modal.waitFor({state:'detached'})
  assert.equal(await page.evaluate(()=>pro.getSelection().symbol.ticker),'BTC')
  assert.equal(await page.evaluate(()=>pro.getWorkspace().drawings.length),3)
  assert.equal(await page.evaluate(()=>pro.getChart().getPaneOrder().length),1)
  const restoredViewport=await page.evaluate(()=>pro.getWorkspace().viewport)
  assert.ok(Math.abs(restoredViewport.from-saved.charts[0].viewport.from)<120000)
  assert.ok(Math.abs(restoredViewport.to-saved.charts[0].viewport.to)<120000)

  assert.ok(await page.evaluate(()=>pro.getWorkspace().drawings.every(d=>d.name!=='host-order')))
  // A stale recovery must not change a newly selected dataset.
  await page.evaluate(()=>{window.hold=true;connections.forEach(cb=>cb({status:'reconnected',symbol:{ticker:'BTC',exchange:'TEST'}}))})
  await page.waitForFunction(()=>pending.length>0)
  await page.evaluate(()=>{window.hold=false;pro.setSymbol({ticker:'ETH',exchange:'TEST',pricePrecision:2})})
  await page.waitForFunction(()=>pro.getSelection()?.dataReady&&pro.getSelection()?.symbol?.ticker==='ETH')
  await page.evaluate(()=>{window.hold=true;connections.forEach(cb=>cb({status:'reconnected',symbol:{ticker:'ETH',exchange:'TEST'}}))})
  await page.waitForFunction(()=>pending.length===2)
  await page.evaluate(()=>{window.hold=false;pending.splice(1,1)[0]();pending.splice(0).forEach(resolve=>resolve())})
  await page.waitForTimeout(100)
  assert.equal(await page.evaluate(()=>pro.getSelection().symbol.ticker),'ETH')
  // Interrupted workspace loads reject instead of applying into an unrelated selection.
  await page.evaluate(()=>{window.hold=true;const state=pro.getWorkspace();state.symbol={ticker:'SOL',exchange:'TEST',pricePrecision:2};window.restoreResult=null;pro.applyWorkspace(state).then(()=>window.restoreResult='unexpected success',error=>window.restoreResult=error.message)})
  await page.waitForFunction(()=>pending.length>0)
  await page.evaluate(()=>{window.hold=false;pro.setSymbol({ticker:'ETH',exchange:'TEST',pricePrecision:2})})
  await page.waitForFunction(()=>pro.getSelection()?.dataReady&&window.restoreResult?.includes('interrupted'))
  await page.evaluate(()=>pending.splice(0).forEach(resolve=>resolve()))
  await a.getByRole('button',{name:'Workspaces',exact:true}).click()
  modal=a.locator('.klinecharts-pro-workspace-modal')
  await modal.getByLabel('Saved workspaces',{exact:true}).selectOption(saved.id)
  await modal.getByRole('button',{name:'Delete',exact:true}).click()
  assert.equal(await page.evaluate(()=>klinechartspro.createWorkspaceStore().list().length),0)
  await page.screenshot({path:'/tmp/hypecharts-parity-batch.png'})
  await page.evaluate(()=>{pro.dispose();other.dispose()})
  assert.equal(await page.evaluate(()=>listeners.size+connections.size),0)
  assert.deepEqual(errors,[])
  console.log('Parity batch passed: bounded/manual paging retry, full-series HA seams, reconnect/live precedence, grouped pane workspace, named CRUD, grouped selections, atomic bulk undo, layering, cross-chart/symbol clipboard, host isolation and cleanup')
} catch(error) { if(page)await page.screenshot({path:'/tmp/hypecharts-parity-batch-failure.png'});throw error } finally { await browser.close() }
