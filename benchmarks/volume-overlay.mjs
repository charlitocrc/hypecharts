// Build first. Fixture workflow for on-chart volume placement, moves and persistence.
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
  await page.goto('http://volume-overlay.test/')
  await page.waitForFunction(()=>window.pro.getSelection()?.dataReady)
  const before=await page.evaluate(()=>window.range())
  await page.getByRole('button',{name:'Indicators',exact:true}).click()
  await page.getByLabel('Search indicators').fill('VOL')
  await page.getByRole('button',{name:'Add On chart: Volume',exact:true}).click()
  await page.keyboard.press('Escape')
  await page.waitForFunction(()=>window.state().some(i=>i.name==='VOL'&&i.ownScale))
  assert.deepEqual(await page.evaluate(()=>window.range()),before,'volume must not change candle axis')
  await page.getByRole('button',{name:/^Undo /}).click()
  assert.deepEqual(await page.evaluate(()=>window.state()),[])
  await page.getByRole('button',{name:/^Redo /}).click()
  await page.waitForFunction(()=>window.state().some(i=>i.name==='VOL'&&i.ownScale))
  // Use the same canvas legend action to open the actual settings UI.
  const settings=page.locator('.klinecharts-pro-indicator-setting-modal')
  const open=async()=>{
    await page.evaluate(()=>{const c=window.pro.getChart(),i=window.state().find(i=>i.name==='VOL');c.getChartStore().getActionStore().execute('onTooltipIconClick',{indicatorName:'VOL',paneId:i.pane,iconId:'setting'})})
    await settings.waitFor()
  }
  await open()
  await settings.getByLabel('Move to pane').selectOption('__new__')
  await page.waitForFunction(()=>window.state().some(i=>i.name==='VOL'&&i.pane!=='candle_pane'&&!i.ownScale))
  await page.getByRole('button',{name:/^Undo /}).click()
  await page.waitForFunction(()=>window.state().some(i=>i.name==='VOL'&&i.pane==='candle_pane'&&i.ownScale))
  await page.getByRole('button',{name:/^Redo /}).click()
  await open()
  await settings.getByLabel('Move to pane').selectOption('candle_pane')
  await page.waitForFunction(()=>window.state().some(i=>i.name==='VOL'&&i.pane==='candle_pane'&&i.ownScale))
  await page.reload()
  await page.waitForFunction(()=>window.pro.getSelection()?.dataReady&&window.state().some(i=>i.name==='VOL'&&i.ownScale))
  assert.deepEqual(await page.evaluate(()=>window.range()),before)
  await page.screenshot({path:'/tmp/hypecharts-volume-overlay.png'})
  assert.deepEqual(errors,[])
  console.log('Volume overlay passed: menu add, independent price scale, pane moves, undo/redo, reload; screenshot /tmp/hypecharts-volume-overlay.png')
} finally { await browser.close() }
