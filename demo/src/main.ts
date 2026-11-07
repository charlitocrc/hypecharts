import { createChartGrid, createChartSyncGroup, ChartGrid, ChartSyncGroup, KLineChartPro } from '../../src'
import type { ChartSyncGroup } from '../../src'
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
interface SavedCell { symbol?: string, period?: string }
interface SavedWorkspace { layout: 'single' | 'split', cells: SavedCell[] }

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
const saveWorkspace = (): void => {
  try {
    const workspace: SavedWorkspace = {
      layout: splitLayout ? 'split' : 'single',
      cells: charts.map(chart => {
        // Mid-rebuild (or disposed) instances have no live API — persist
        // nothing for them rather than throwing.
        if (!chart.getChart()) return {}
        // Before the feed resolves, the resolved symbol has unset fields —
        // persist nothing rather than a symbol that can never resolve.
        const resolved = chart.resolvedSymbol()
        const symbol = resolved?.exchange && resolved?.ticker
          ? `${resolved.exchange}:${resolved.ticker}`
          : undefined
        return {
          symbol,
          period: chart.getPeriod().text
        }
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
  const venue = VENUES.find(candidate => candidate.key === resolved.exchange.toUpperCase())
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
    const node = document.createElement(live ? 'button' : 'span')
    node.className = `chip exchange ${live ? 'live' : (probed ? 'roadmap' : 'roadmap')}` + (venue.key === activeVenue.key ? ' active' : '')
    node.textContent = live ? venue.label : `${venue.label} · ${venue.integrated ? 'roadmap' : 'roadmap'}`
    if (live) {
      node.setAttribute('aria-label', `Switch to ${venue.label}`)
      node.addEventListener('click', () => {
        activeVenue = venue
        renderExchangeButtons()
        renderSymbolButtons()
        applySymbol()
      })
    } else if (venue.integrated && probed) {
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

  const demo = await createDemoFeed()
  ;(window as unknown as { __demoFeed: typeof demo.datafeed }).__demoFeed = demo.datafeed
  liveVenues = new Set(demo.venues)
  setStatus(demo.label, demo.venues.length > 0 ? 'live' : 'simulated')
  renderExchangeButtons()
  renderSymbolButtons()

  const createChart = (container: HTMLElement, symbol: SymbolInfo | string, periodText?: string, timeAxisVisible = true): KLineChartPro =>
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
  const savedOnMount = readWorkspace()
  if (savedOnMount?.layout === 'split') splitLayout = true
  syncGroup = null
  charts = []
  const mountCharts = (): void => {
    // Read the previous symbol while the chart is still alive — grid.destroy()
    // disposes every instance below.
    const previous = charts[0]?.getChart() ? charts[0].resolvedSymbol() : undefined
    grid?.destroy()
    grid = null
    charts = []
    const saved = readWorkspace()
    const container = el<HTMLDivElement>('chart')
    container.classList.toggle('split', splitLayout)

    const asset = ASSETS[activeAssetIndex]
    const venues = VENUES.filter(candidate => candidate.integrated && liveVenues.has(candidate.key))
    const primary = activeVenue.integrated && liveVenues.has(activeVenue.key) ? activeVenue : venues[0] ?? INITIAL_VENUE
    const defaultSpecFor = (index: number): SymbolInfo => {
      if (splitLayout && venues.length > 1) {
        if (index === 0) return previous ?? primary.nameFor(asset)
        return venues.find(candidate => candidate.key !== primary.key)!.nameFor(asset)
      }
      return index === 0 ? (previous ?? initialSymbol) : initialSymbol
    }
    const periodFor = (index: number): string | undefined => saved?.cells[index]?.period
    grid = createChartGrid({
      container,
      columns: 1,
      gap: 4,
      sync: true,
      sharedTimeAxis: true,
      createChart: (cell, index, { timeAxisVisible }) => {
        // The constructor gets a fully-formed SymbolInfo (strings resolve only
        // through setSymbol); the venue-specific target then goes through
        // setSymbol, which resolves qualified names through the feed.
        const chart = createChart(cell, index === 0 ? (previous ?? initialSymbol) : initialSymbol, periodFor(index), timeAxisVisible)
        const target = defaultSpecFor(index)
        if (target !== chart.getSymbol()) chart.setSymbol(target)
        const savedSymbol = saved?.cells[index]?.symbol
        if (savedSymbol !== undefined && !savedSymbol.includes('undefined')) chart.setSymbol(savedSymbol)
        return chart
      }
    })
    grid.setLayout(splitLayout ? 2 : 1)
    charts = grid.charts
    syncGroup = grid.syncGroup
    // Dev/testing hook: refresh on every mount so it never holds disposed charts.
    ;(window as unknown as { __hypecharts: KLineChartPro[] }).__hypecharts = charts
    saveWorkspace()
  }

  mountCharts()
  el<HTMLButtonElement>('layout-toggle').textContent = splitLayout ? '⊟ Single' : '◱ Split'

  el<HTMLButtonElement>('layout-toggle').addEventListener('click', () => {
    const venues = VENUES.filter(candidate => candidate.integrated && liveVenues.has(candidate.key))
    if (venues.length < 2) {
      setStatus('split needs two reachable venues', 'simulated')
      return
    }
    splitLayout = !splitLayout
    el<HTMLButtonElement>('layout-toggle').textContent = splitLayout ? '⊟ Single' : '◱ Split'
    mountCharts()
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
