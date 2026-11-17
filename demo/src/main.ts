import { render } from 'solid-js/web'
import { createComponent } from 'solid-js'
import WorkspaceModal from '../../src/widget/workspace-modal'
import { createChartGrid, createWorkspaceStore, KLineChartPro } from '../../src'
import type { ChartGrid, ChartSyncGroup, ChartGridSizes, ChartWorkspaceState, NamedWorkspace } from '../../src'
import type { Period, SymbolInfo } from '../../src/types'
import { createDemoFeed } from './datafeed'
import './style.css'

interface Asset {
  ticker: string
  name: string
}

const ASSETS: Asset[] = [
  { ticker: 'BTC', name: 'Bitcoin' },
  { ticker: 'ETH', name: 'Ethereum' },
  { ticker: 'SOL', name: 'Solana' },
  { ticker: 'DOGE', name: 'Dogecoin' },
  { ticker: 'XRP', name: 'XRP' }
]

const PERIODS: Period[] = [
  { multiplier: 1, timespan: 'second', text: '1s' },
  { multiplier: 1, timespan: 'minute', text: '1m' },
  { multiplier: 2, timespan: 'minute', text: '2m' },
  { multiplier: 3, timespan: 'minute', text: '3m' },
  { multiplier: 5, timespan: 'minute', text: '5m' },
  { multiplier: 15, timespan: 'minute', text: '15m' },
  { multiplier: 1, timespan: 'hour', text: '1h' },
  { multiplier: 4, timespan: 'hour', text: '4h' },
  { multiplier: 12, timespan: 'hour', text: '12h' },
  { multiplier: 1, timespan: 'day', text: '1d' },
  { multiplier: 1, timespan: 'week', text: '1w' },
  { multiplier: 1, timespan: 'month', text: '1M' }
]

interface Venue {
  key: string
  label: string
  integrated: boolean
  /** Exchange-qualified demo symbol for an asset. */
  nameFor: (asset: Asset) => string
  chipLabel: (asset: Asset) => string
}

const VENUES: Venue[] = [
  {
    key: 'HYPERLIQUID', label: 'Hyperliquid', integrated: true,
    nameFor: a => `HYPERLIQUID:${a.ticker}`,
    chipLabel: a => `${a.ticker}-PERP`
  },
  {
    key: 'BINANCE', label: 'Binance', integrated: true,
    nameFor: a => `BINANCE:${a.ticker}USDT`,
    chipLabel: a => `${a.ticker}USDT`
  },
  { key: 'COINBASE', label: 'Coinbase', integrated: false, nameFor: a => `COINBASE:${a.ticker}`, chipLabel: a => a.ticker },
  { key: 'BYBIT', label: 'Bybit', integrated: false, nameFor: a => `BYBIT:${a.ticker}`, chipLabel: a => a.ticker },
  { key: 'OKX', label: 'OKX', integrated: false, nameFor: a => `OKX:${a.ticker}`, chipLabel: a => a.ticker },
  { key: 'LIGHTER', label: 'Lighter', integrated: false, nameFor: a => `LIGHTER:${a.ticker}`, chipLabel: a => a.ticker }
]

const INITIAL_ASSET = ASSETS[0]
const INITIAL_VENUE = VENUES[0]

/** The initial chart symbol: fully-formed so the first render needs no resolution. */
const initialSymbol: SymbolInfo = {
  ticker: INITIAL_ASSET.ticker,
  name: INITIAL_ASSET.name,
  shortName: `${INITIAL_ASSET.ticker}-PERP`,
  exchange: INITIAL_VENUE.key,
  market: 'perp',
  pricePrecision: 1,
  volumePrecision: 2
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`#${id} not found`)
  return node as T
}

let charts: KLineChartPro[] = []
let syncGroup: ChartSyncGroup | null = null
let grid: ChartGrid | null = null
let splitLayout = false

// WORK-002: the workspace persists per cell — which symbol and period each
// grid pane shows — so a reload puts the split back the way it was left.
const WORKSPACE_KEY = 'hypecharts-demo:workspace-v1'
interface SavedCell { symbol?: string, period?: string, state?: ChartWorkspaceState }
interface SavedWorkspace { layout: 'single' | 'split', cells: SavedCell[], sizes?: Partial<ChartGridSizes>, links?: { symbol: boolean, period: boolean } }

const readWorkspace = (): SavedWorkspace | null => {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as SavedWorkspace
    if ((parsed.layout !== 'single' && parsed.layout !== 'split') || !Array.isArray(parsed.cells)) return null
    return parsed
  } catch {
    return null
  }
}

let lastSavedWorkspace = ''
let restoringNamedWorkspace = false
let mountEpoch = 0
const saveWorkspace = (): void => {
  if (restoringNamedWorkspace) return
  try {
    const workspace: SavedWorkspace = {
      layout: splitLayout ? 'split' : 'single',
      sizes: grid?.getSizes(),
      links: { symbol: syncGroup?.getOptions().symbol ?? false, period: syncGroup?.getOptions().period ?? false },
      cells: charts.map((chart, index) => {
        // Mid-rebuild (or disposed) instances have no live API — persist
        // nothing for them rather than throwing.
        if (!chart.getChart()) return {}
        // Before the feed resolves, the resolved symbol has unset fields —
        // persist nothing rather than a symbol that can never resolve.
        const resolved = chart.resolvedSymbol()
        const symbol = resolved?.exchange && resolved?.ticker
          ? `${resolved.exchange}:${resolved.ticker}`
          : undefined
        const period = chart.getPeriod().text
        const previous = readWorkspace()?.cells[index]?.state
        let state: ChartWorkspaceState | undefined
        // Selection notifications are queued; never let a stale cell snapshot
        // replace a newly resolved venue or interval during a quick grid switch.
        try { if (chart.getSelection()?.dataReady) state = chart.getWorkspace() } catch {}
        const matches = (candidate?: ChartWorkspaceState): boolean => !!candidate &&
          `${candidate.symbol.exchange}:${candidate.symbol.ticker}` === symbol && candidate.period.text === period
        if (!matches(state)) state = matches(previous) ? previous : undefined
        return { symbol, period, state }
      })
    }
    const serialized = JSON.stringify(workspace)
    if (serialized !== lastSavedWorkspace) {
      lastSavedWorkspace = serialized
      localStorage.setItem(WORKSPACE_KEY, serialized)
    }
  } catch {}
}
let liveVenues = new Set<string>()
let discoveringVenues = true
let activeVenue = INITIAL_VENUE
let activeAssetIndex = 0
let currentTheme = 'dark'

function setStatus (text: string, kind: 'live' | 'simulated' | 'error'): void {
  const chip = el<HTMLSpanElement>('feed-status')
  chip.textContent = text
  chip.classList.remove('live', 'simulated', 'error')
  chip.classList.add(kind)
}

function applySymbol (): void {
  const primary = charts[0]
  if (!primary) return
  const asset = ASSETS[activeAssetIndex]
  if (!activeVenue.integrated || !liveVenues.has(activeVenue.key)) return
  primary.setSymbol(activeVenue.nameFor(asset))
  saveWorkspace()
}

// Search selections bypass the demo's own buttons, so the toolbar chips and the
// status line follow the chart's resolved symbol instead of local state.
function syncChromeFromChart (): void {
  const chart = charts[0]
  if (!chart || !chart.getChart()) return
  const resolved = chart.resolvedSymbol()
  if (!resolved?.exchange) return
  const exchange = resolved.exchange.toUpperCase()
  const venue = VENUES.find(candidate => candidate.key === exchange)
  if (!venue || venue.key === activeVenue.key && ASSETS[activeAssetIndex]?.ticker === (resolved.shortName ?? resolved.ticker).replace(/-PERP|USDT$/i, '')) return
  activeVenue = venue
  const ticker = (resolved.shortName ?? resolved.ticker).replace(/-PERP|USDT$/i, '')
  const index = ASSETS.findIndex(asset => asset.ticker === ticker)
  if (index >= 0) activeAssetIndex = index
  renderExchangeButtons()
  renderSymbolButtons()
  setStatus(liveVenues.has(venue.key) ? `LIVE · ${venue.label}` : `${venue.label} (no live route)`, liveVenues.has(venue.key) ? 'live' : 'simulated')
}

function renderSymbolButtons (): void {
  const wrap = el<HTMLDivElement>('symbol-buttons')
  wrap.innerHTML = ''
  ASSETS.forEach((asset, i) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'chip' + (i === activeAssetIndex ? ' active' : '')
    button.textContent = activeVenue.chipLabel(asset)
    button.addEventListener('click', () => {
      activeAssetIndex = i
      renderSymbolButtons()
      applySymbol()
    })
    wrap.appendChild(button)
  })
}

function renderExchangeButtons (): void {
  const wrap = el<HTMLDivElement>('exchange-buttons')
  wrap.innerHTML = ''
  VENUES.forEach(venue => {
    const live = venue.integrated && liveVenues.has(venue.key)
    const probed = venue.integrated && liveVenues.size > 0
    const pending = venue.integrated && !live && discoveringVenues
    const node = document.createElement(live ? 'button' : 'span')
    node.className = `chip exchange ${live ? 'live' : (probed ? 'roadmap' : 'roadmap')}` + (venue.key === activeVenue.key ? ' active' : '')
    node.textContent = live ? venue.label : `${venue.label} · ${pending ? 'checking…' : venue.integrated ? 'unavailable' : 'roadmap'}`
    if (live) {
      node.setAttribute('aria-label', `Switch to ${venue.label}`)
      node.addEventListener('click', () => {
        activeVenue = venue
        renderExchangeButtons()
        renderSymbolButtons()
        applySymbol()
      })
    } else if (pending) {
      node.title = 'Checking connection'
    } else if (venue.integrated) {
      node.title = 'Not reachable from this network'
    } else {
      node.title = 'Planned integration — see docs/roadmap.md'
    }
    wrap.appendChild(node)
  })
}

async function main (): Promise<void> {
  renderExchangeButtons()
  renderSymbolButtons()

  const savedOnMount = readWorkspace()
  const initialCells = savedOnMount?.layout === 'split' ? savedOnMount.cells : savedOnMount?.cells.slice(0, 1)
  const requiredVenues = savedOnMount?.layout === 'split' ? ['HYPERLIQUID', 'BINANCE']
    : initialCells?.map(cell => cell.symbol?.split(':')[0]).filter((venue): venue is string => !!venue)
  const demo = await createDemoFeed(requiredVenues?.length ? requiredVenues : undefined)
  ;(window as unknown as { __demoFeed: typeof demo.datafeed }).__demoFeed = demo.datafeed
  liveVenues = new Set(demo.venues)
  setStatus(demo.label, demo.venues.length > 0 ? 'live' : 'simulated')
  renderExchangeButtons()
  renderSymbolButtons()

  void demo.discoveryComplete.then(status => {
    discoveringVenues = false
    liveVenues = new Set(status.venues)
    if (!el('feed-status').classList.contains('error')) {
      setStatus(status.label, status.venues.length > 0 ? 'live' : 'simulated')
    }
    renderExchangeButtons()
    renderSymbolButtons()
  })

  const createChart = (container: HTMLElement, symbol: SymbolInfo, periodText?: string, timeAxisVisible = true): KLineChartPro =>
    new KLineChartPro({
      container,
      theme: currentTheme,
      locale: 'en-US',
      timezone: 'UTC',
      // Chart-wide line smoothness; the user's own choice persists from Settings.
      // WORK-002 shared time axis: cells with a grid row below them hide their
      // own axis — the bottom row's axis is the layout's single time axis.
      // The vendor's axis pane keeps its configured size even when hidden, so
      // size must collapse too or every top cell leaves a dead 22px strip.
      styles: { smoothness: 'medium', xAxis: { show: timeAxisVisible, ...(timeAxisVisible ? {} : { size: 0 }) } },
      symbol,
      period: PERIODS.find(p => p.text === periodText) ?? PERIODS.find(p => p.text === '15m') ?? PERIODS[0],
      periods: PERIODS,
      quickPeriods: ['1s', '15m', '1h', '4h'],
      mainIndicators: ['MA'],
      subIndicators: ['VOL'],
      onSymbolResolveError: error => {
        console.warn('symbol resolve failed:', error)
        setStatus(`${error.name} unavailable — ${error.code.replace('unknown_', 'unknown ')}`, 'error')
      },
      datafeed: demo.datafeed
    })

  // Split view: the primary selection on top, the same asset on the next live
  // venue below — one sync group keeps range and crosshair together (M5).
  // WORK-002: the layout itself comes from the library's grid helper, and each
  // cell's symbol/period persists so a reload restores the workspace.
  if (savedOnMount?.layout === 'split') splitLayout = true
  syncGroup = null
  charts = []
  const mountCharts = (named?: NamedWorkspace): Promise<void> => {
    // A resolved selection may be newer than the timer's last persisted record.
    // Flush before reading saved targets; otherwise a quick layout switch can
    // replace the user's latest venue with that older saved symbol.
    if (charts.some(chart => chart.getChart() !== null)) saveWorkspace()
    // Read the previous symbol while the chart is still alive — grid.destroy()
    // disposes every instance below.
    const previous = charts[0]?.getChart() ? charts[0].resolvedSymbol() : undefined
    grid?.destroy()
    grid = null
    charts = []
    const saved: SavedWorkspace | null = named ? {
      layout: named.charts.length > 1 ? 'split' : 'single',
      cells: named.charts.map(state => ({ symbol: `${state.symbol.exchange}:${state.symbol.ticker}`, period: state.period.text, state })),
      sizes: named.grid.sizes, links: named.grid.links
    } : readWorkspace()
    const epoch = ++mountEpoch
    const states = saved?.cells.map(cell => cell.state) ?? []
    const restoring = states.some(Boolean)
    const container = el<HTMLDivElement>('chart')
    container.classList.toggle('split', splitLayout)

    const asset = ASSETS[activeAssetIndex]
    const venues = VENUES.filter(candidate => candidate.integrated && liveVenues.has(candidate.key))
    const primary = venues.find(venue => venue.key === previous?.exchange?.toUpperCase()) ??
      (activeVenue.integrated && liveVenues.has(activeVenue.key) ? activeVenue : venues[0] ?? INITIAL_VENUE)
    const defaultSpecFor = (index: number): SymbolInfo | string => {
      if (splitLayout && venues.length > 1) {
        if (index === 0) return previous ?? primary.nameFor(asset)
        return venues.find(candidate => candidate.key !== primary.key)!.nameFor(asset)
      }
      return index === 0 ? (previous ?? (primary.key === INITIAL_VENUE.key ? initialSymbol : primary.nameFor(asset))) : initialSymbol
    }
    const periodFor = (index: number): string | undefined => saved?.cells[index]?.period
    grid = createChartGrid({
      container,
      columns: 1,
      gap: 4,
      sync: { symbol: !restoring && saved?.links?.symbol === true, period: !restoring && saved?.links?.period === true, range: !restoring, crosshair: !restoring },
      resizable: true,
      sizes: saved?.sizes,
      onResize: () => saveWorkspace(),
      sharedTimeAxis: true,
      createChart: (cell, index, { timeAxisVisible }) => {
        // The constructor gets a fully-formed SymbolInfo (strings resolve only
        // through setSymbol); the venue-specific target then goes through
        // setSymbol, which resolves qualified names through the feed.
        const chart = createChart(cell, states[index]?.symbol ?? (index === 0 ? (previous ?? initialSymbol) : initialSymbol), periodFor(index), timeAxisVisible)
        const savedSymbol = saved?.cells[index]?.symbol
        // Resolve one target. Starting the default and saved symbols together
        // lets a slower default resolution overwrite the restored selection.
        const target = savedSymbol !== undefined && !savedSymbol.includes('undefined') ? savedSymbol : defaultSpecFor(index)
        if (!states[index] && target !== chart.getSymbol()) chart.setSymbol(target)
        return chart
      }
    })
    grid.setLayout(named?.charts.length ?? (splitLayout ? 2 : 1), named?.grid.columns ?? 1)
    charts = grid.charts
    syncGroup = grid.syncGroup
    el<HTMLElement>('chart-links').hidden = !splitLayout
    el<HTMLInputElement>('link-symbol').checked = syncGroup?.getOptions().symbol ?? false
    el<HTMLInputElement>('link-period').checked = syncGroup?.getOptions().period ?? false
    // Dev/testing hook: refresh on every mount so it never holds disposed charts.
    ;(window as unknown as { __hypecharts: KLineChartPro[] }).__hypecharts = charts
    const finish = async (): Promise<void> => {
      const restoringCharts = charts.slice()
      await Promise.all(restoringCharts.map(async (chart, index) => { if (states[index]) await chart.applyWorkspace(states[index]!) }))
      if (epoch !== mountEpoch) return
      syncGroup?.setOptions({ symbol: saved?.links?.symbol === true, period: saved?.links?.period === true, range: named?.grid.links?.range !== false, crosshair: named?.grid.links?.crosshair !== false })
      el<HTMLInputElement>('link-symbol').checked = syncGroup?.getOptions().symbol ?? false
      el<HTMLInputElement>('link-period').checked = syncGroup?.getOptions().period ?? false
      restoringNamedWorkspace = false
      saveWorkspace()
    }
    return finish()
  }

  await mountCharts()
  el<HTMLButtonElement>('layout-toggle').textContent = splitLayout ? '⊟ Single' : '◱ Split'

  el<HTMLButtonElement>('layout-toggle').addEventListener('click', () => {
    const venues = VENUES.filter(candidate => candidate.integrated && liveVenues.has(candidate.key))
    if (venues.length < 2) {
      setStatus(discoveringVenues ? 'Checking the second exchange…' : 'split needs two reachable venues', discoveringVenues ? 'live' : 'simulated')
      return
    }
    splitLayout = !splitLayout
    el<HTMLButtonElement>('layout-toggle').textContent = splitLayout ? '⊟ Single' : '◱ Split'
    void mountCharts().catch(error => { restoringNamedWorkspace = false; setStatus(String(error), 'error') })
  })

  for (const [id, key] of [['link-symbol', 'symbol'], ['link-period', 'period']] as const) {
    el<HTMLInputElement>(id).addEventListener('change', event => {
      syncGroup?.setOptions({ [key]: (event.currentTarget as HTMLInputElement).checked })
      saveWorkspace()
    })
  }

  const namedStore = createWorkspaceStore('hypecharts-demo:named-workspaces:v1')
  el<HTMLButtonElement>('workspace-manager').addEventListener('click', () => {
    const host = document.createElement('div')
    host.className = 'klinecharts-pro'
    host.dataset.theme = currentTheme
    host.style.cssText = 'position:fixed;inset:0;z-index:1000;'
    document.body.appendChild(host)
    let dispose: (() => void) | undefined
    const close = (): void => { dispose?.(); host.remove() }
    dispose = render(() => createComponent(WorkspaceModal, {
      locale: 'en-US', store: namedStore,
      capture: () => charts.map(chart => chart.getWorkspace()),
      grid: () => ({ columns: 1, sizes: grid?.getSizes(), links: {
        symbol: syncGroup?.getOptions().symbol ?? false, period: syncGroup?.getOptions().period ?? false,
        range: syncGroup?.getOptions().range ?? true, crosshair: syncGroup?.getOptions().crosshair ?? true
      } }),
      load: async workspace => {
        saveWorkspace()
        restoringNamedWorkspace = true
        splitLayout = workspace.charts.length > 1
        try {
          await mountCharts(workspace)
          currentTheme = workspace.charts[0].theme
          document.body.dataset.theme = currentTheme
          el<HTMLButtonElement>('layout-toggle').textContent = splitLayout ? '⊟ Single' : '◱ Split'
        } finally { restoringNamedWorkspace = false }
      },
      onClose: close
    }), host)
  })

  el<HTMLButtonElement>('theme-toggle').addEventListener('click', () => {
    const toLight = currentTheme === 'dark'
    currentTheme = toLight ? 'light' : 'dark'
    document.body.dataset.theme = currentTheme
    el<HTMLButtonElement>('theme-toggle').textContent = toLight ? '☾ Dark' : '☀ Light'
    charts.forEach(instance => instance.setTheme(currentTheme))
  })

  setInterval(() => {
    syncChromeFromChart()
    saveWorkspace()
  }, 1000)
}

main().catch(error => {
  console.error(error)
  setStatus(`failed to start: ${error}`, 'error')
})
