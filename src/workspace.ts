import type { SymbolInfo, Period } from './types'
import { CandleType } from 'klinecharts'
import { SYNTHETIC_CHART_TYPES } from './chartType'
import type { StoredDrawing, StoredIndicatorLayout, StoredSettings } from './persist'
import { toStoredDrawing, toStoredIndicatorLayout } from './persist'
import type { TimeViewport } from './timeViewport'

export interface ChartWorkspaceState {
  version: 1
  symbol: SymbolInfo
  period: Period
  indicators: StoredIndicatorLayout
  drawings: StoredDrawing[]
  settings: StoredSettings
  appearance?: any
  viewport?: TimeViewport
  historyStart?: number
  theme: string
  locale: string
}
export interface NamedWorkspace {
  version: 1
  id: string
  name: string
  updatedAt: number
  charts: ChartWorkspaceState[]
  grid: { columns: number, sizes?: { rows: number[], columns: number[] }, links?: { symbol: boolean, period: boolean, range?: boolean, crosshair?: boolean } }
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
export function toChartWorkspace (value: unknown): ChartWorkspaceState | null {
  const x = value as ChartWorkspaceState
  if (!x || x.version !== 1 || typeof x.symbol?.ticker !== 'string' || !x.symbol.ticker.length || x.symbol.ticker.length > 100 ||
    !Number.isInteger(x.period?.multiplier) || x.period.multiplier < 1 || x.period.multiplier > 999 ||
    !['second', 'minute', 'hour', 'day', 'week', 'month', 'year'].includes(x.period.timespan) ||
    typeof x.period.text !== 'string' || !x.period.text.length || x.period.text.length > 16 ||
    !Array.isArray(x.drawings) || x.drawings.length > 2000 || typeof x.settings !== 'object' || !x.settings ||
    !['light', 'dark'].includes(x.theme) || typeof x.locale !== 'string') return null
  if (x.settings.customIntervals !== undefined && (!Array.isArray(x.settings.customIntervals) || x.settings.customIntervals.some(text => typeof text !== 'string' || text.length > 16))) return null
  if (x.settings.chartType !== undefined && ![...Object.values(CandleType), ...SYNTHETIC_CHART_TYPES].includes(x.settings.chartType as any)) return null
  if (x.settings.timezone !== undefined) {
    if (typeof x.settings.timezone !== 'string') return null
    try { new Intl.DateTimeFormat('en-US', { timeZone: x.settings.timezone }) } catch { return null }
  }
  for (const key of ['pricePrecision', 'volumePrecision'] as const) {
    const value = x.symbol[key]
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 12)) return null
  }
  if (x.appearance !== undefined && (!x.appearance || typeof x.appearance !== 'object' || Array.isArray(x.appearance))) return null
  const indicators = toStoredIndicatorLayout(x.indicators)
  if (!indicators) return null
  const drawings: StoredDrawing[] = []
  for (const item of x.drawings) {
    const drawing = toStoredDrawing({ ...item, groupId: 'drawing_tools' }, 'drawing_tools')
    if (!drawing) return null
    drawings.push(drawing)
  }
  const viewport = x.viewport && Number.isFinite(x.viewport.from) && Number.isFinite(x.viewport.to) && x.viewport.to > x.viewport.from
    ? { from: x.viewport.from, to: x.viewport.to } : undefined
  return clone({ version: 1, symbol: x.symbol, period: x.period, indicators, drawings, settings: x.settings,
    appearance: x.appearance, viewport, historyStart: Number.isFinite(x.historyStart) ? x.historyStart : undefined, theme: x.theme, locale: x.locale })
}
export function toNamedWorkspace (value: unknown): NamedWorkspace | null {
  const x = value as NamedWorkspace
  if (!x || x.version !== 1 || typeof x.id !== 'string' || !x.id.length || x.id.length > 100 ||
    typeof x.name !== 'string' || !x.name.trim() || x.name.length > 80 || !Number.isFinite(x.updatedAt) ||
    !Array.isArray(x.charts) || x.charts.length < 1 || x.charts.length > 8 ||
    !Number.isInteger(x.grid?.columns) || x.grid.columns < 1 || x.grid.columns > x.charts.length) return null
  const charts = x.charts.map(toChartWorkspace)
  if (charts.some(chart => chart === null)) return null
  const sizes = x.grid.sizes && ['rows', 'columns'].every(axis => {
    const weights = x.grid.sizes![axis as 'rows' | 'columns']
    return Array.isArray(weights) && weights.length <= 8 && weights.every(weight => Number.isFinite(weight) && weight > 0)
  }) ? clone(x.grid.sizes) : undefined
  return { version: 1, id: x.id, name: x.name.trim(), updatedAt: x.updatedAt, charts: charts as ChartWorkspaceState[],
    grid: { columns: x.grid.columns, sizes, links: x.grid.links ? { symbol: x.grid.links.symbol === true, period: x.grid.links.period === true,
      range: x.grid.links.range !== false, crosshair: x.grid.links.crosshair !== false } : undefined } }
}

/** Explicit writes surface quota/access failures; a failed save never reports success. */
export function createWorkspaceStore (key = 'klinecharts-pro:workspaces:v1', storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  const backend = (): Pick<Storage, 'getItem' | 'setItem'> => storage ?? window.localStorage
  const list = (): NamedWorkspace[] => {
    const raw = backend().getItem(key)
    if (raw === null) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('Invalid workspace library')
    const items = parsed.map(toNamedWorkspace)
    if (items.some((item: NamedWorkspace | null) => item === null)) throw new Error('Unsupported or invalid saved workspace')
    return items as NamedWorkspace[]
  }
  const write = (items: NamedWorkspace[]): void => { backend().setItem(key, JSON.stringify(items)) }
  return {
    list,
    save (name: string, charts: ChartWorkspaceState[], grid: NamedWorkspace['grid'] = { columns: 1 }, id?: string): NamedWorkspace {
      const items = list()
      if (!id && items.length >= 50) throw new Error('Maximum of 50 workspaces')
      if (id && !items.some(item => item.id === id)) throw new Error('Workspace no longer exists')
      if (items.some(item => item.id !== id && item.name.toLowerCase() === name.trim().toLowerCase())) throw new Error('Workspace name already exists')
      const workspace = toNamedWorkspace({ version: 1, id: id ?? `workspace_${Date.now()}_${Math.random().toString(36).slice(2)}`, name: name.trim(), updatedAt: Date.now(), charts, grid })
      if (!workspace) throw new Error('Invalid workspace')
      write([...items.filter(item => item.id !== workspace.id), workspace])
      return clone(workspace)
    },
    rename (id: string, name: string): void {
      const items = list(), item = items.find(item => item.id === id)
      if (!item) throw new Error('Workspace no longer exists')
      this.save(name, item.charts, item.grid, id)
    },
    remove (id: string): void { write(list().filter(item => item.id !== id)) }
  }
}
