/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { DATA_DRAWING_TOOLS } from './extension/derived'
import { PRICE_SOURCES } from './indicator/timeframe'

const PREFIX = 'klinecharts-pro:'

export const SETTINGS_KEY = 'settings'
export const VIEWPORT_KEY = 'viewport'
export const DRAWING_PRESETS_KEY = 'drawing-presets'
export const DRAWING_DEFAULT_PRESETS_KEY = 'drawing-default-presets'
export const TOOLBAR_FAVORITES_KEY = 'toolbar-favorites'
export const INDICATOR_FAVORITES_KEY = 'indicator-favorites'
export const INDICATOR_TEMPLATES_KEY = 'indicator-templates'
export const SYMBOL_RECENTS_KEY = 'symbol-recents'
export const SYMBOL_PERIODS_KEY = 'symbol-periods'

/** Reusable per-object style presets (M2): a named DrawingStyleDraft snapshot. */
export interface StoredDrawingPreset {
  name: string
  tool?: string
  draft: Record<string, unknown>
}

const MAX_PRESETS = 30
const MAX_PRESET_NAME = 40

export function readDrawingPresets (): StoredDrawingPreset[] {
  const raw = read<StoredDrawingPreset[]>(DRAWING_PRESETS_KEY)
  if (!Array.isArray(raw)) return []
  return raw
    .filter(preset => typeof preset?.name === 'string' && preset.name.trim().length > 0 && typeof preset?.draft === 'object' && preset.draft !== null)
    .slice(0, MAX_PRESETS)
    .map(preset => ({ name: preset.name.slice(0, MAX_PRESET_NAME), tool: typeof preset.tool === 'string' ? preset.tool : undefined, draft: preset.draft }))
}

export function writeDrawingPresets (presets: StoredDrawingPreset[]): void {
  write(DRAWING_PRESETS_KEY, presets.slice(0, MAX_PRESETS))
}

/** Per-tool default preset: new drawings of that tool start from this preset. */
export function readDefaultDrawingPresets (): Record<string, string> {
  const raw = read<Record<string, unknown>>(DRAWING_DEFAULT_PRESETS_KEY)
  if (typeof raw !== 'object' || raw === null) return {}
  const out: Record<string, string> = {}
  for (const [tool, name] of Object.entries(raw)) {
    if (typeof name === 'string' && name.trim().length > 0 && tool.length > 0 && tool.length <= 40) out[tool] = name.trim()
  }
  return out
}

export function writeDefaultDrawingPresets (presets: Record<string, string>): void {
  write(DRAWING_DEFAULT_PRESETS_KEY, presets)
}

const MAX_TOOLBAR_FAVORITES = 30

/** Favorited drawing-toolbar tool names, most recently added last. */
export function readToolbarFavorites (): string[] {
  const raw = read<unknown>(TOOLBAR_FAVORITES_KEY)
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter(item => typeof item === 'string' && item.length > 0 && item.length <= 40))].slice(-MAX_TOOLBAR_FAVORITES)
}

export function writeToolbarFavorites (favorites: string[]): void {
  write(TOOLBAR_FAVORITES_KEY, [...new Set(favorites)].slice(-MAX_TOOLBAR_FAVORITES))
}

const MAX_FAVORITES = 40

/** Last-selected symbols for the search dialog, most recent first. */
export interface StoredSymbolRecent {
  exchange: string
  ticker: string
  symbol?: string
  description?: string
  market?: string
  type?: string
}

const MAX_SYMBOL_RECENTS = 10
const MAX_RECENT_TEXT = 60

export function readSymbolRecents (): StoredSymbolRecent[] {
  const raw = read<StoredSymbolRecent[]>(SYMBOL_RECENTS_KEY)
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: StoredSymbolRecent[] = []
  for (const item of raw) {
    if (typeof item?.exchange !== 'string' || item.exchange.length === 0 || item.exchange.length > MAX_RECENT_TEXT) continue
    if (typeof item?.ticker !== 'string' || item.ticker.length === 0 || item.ticker.length > MAX_RECENT_TEXT) continue
    const key = `${item.exchange.toUpperCase()}:${item.ticker}`
    if (seen.has(key)) continue
    seen.add(key)
    const recent: StoredSymbolRecent = { exchange: item.exchange, ticker: item.ticker }
    if (typeof item.symbol === 'string') recent.symbol = item.symbol.slice(0, MAX_RECENT_TEXT)
    if (typeof item.description === 'string') recent.description = item.description.slice(0, MAX_RECENT_TEXT)
    if (typeof item.market === 'string' && item.market.length <= 24) recent.market = item.market
    if (typeof item.type === 'string' && item.type.length <= 24) recent.type = item.type
    out.push(recent)
  }
  return out.slice(0, MAX_SYMBOL_RECENTS)
}

export function writeSymbolRecents (recents: StoredSymbolRecent[]): void {
  write(SYMBOL_RECENTS_KEY, recents.slice(0, MAX_SYMBOL_RECENTS))
}

/** Per-symbol period choice (SQ-4): the period bar's selection keyed by symbolKey. */
export function readSymbolPeriods (): Record<string, string> {
  const raw = read<Record<string, unknown>>(SYMBOL_PERIODS_KEY)
  if (typeof raw !== 'object' || raw === null) return {}
  const out: Record<string, string> = {}
  for (const [key, text] of Object.entries(raw)) {
    if (key.length > 0 && key.length <= 120 && typeof text === 'string' && text.length > 0 && text.length <= 8) {
      out[key] = text
    }
  }
  return out
}

export function writeSymbolPeriod (key: string, periodText: string): void {
  if (key.length === 0 || periodText.length === 0) return
  const next = readSymbolPeriods()
  next[key] = periodText
  const entries = Object.entries(next)
  // Bounded map: drop the oldest entries beyond the cap.
  const trimmed = entries.length > 60 ? entries.slice(entries.length - 60) : entries
  write(SYMBOL_PERIODS_KEY, Object.fromEntries(trimmed))
}


/** Favorited indicator type names, most recently added last. */
export function readIndicatorFavorites (): string[] {
  const raw = read<unknown>(INDICATOR_FAVORITES_KEY)
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter(item => typeof item === 'string' && item.length > 0 && item.length <= 24))].slice(-MAX_FAVORITES)
}

export function writeIndicatorFavorites (favorites: string[]): void {
  write(INDICATOR_FAVORITES_KEY, [...new Set(favorites)].slice(-MAX_FAVORITES))
}

/** A reusable indicator setup: type, params and plot styles under a user name. */
export interface StoredIndicatorTemplate {
  id: string
  name: string
  typeId: string
  calcParams?: number[]
  plots?: Record<string, PlotStyle>
  source?: string
  offset?: number
  timeframe?: string
}

const MAX_TEMPLATES = 30
const MAX_TEMPLATE_NAME = 40

const templateId = (name: string): string =>
  `tpl_${Array.from(name).reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 5381).toString(36)}`

export function readIndicatorTemplates (): StoredIndicatorTemplate[] {
  const raw = read<StoredIndicatorTemplate[]>(INDICATOR_TEMPLATES_KEY)
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: StoredIndicatorTemplate[] = []
  for (const item of raw) {
    if (typeof item?.name !== 'string' || item.name.trim().length === 0) continue
    if (typeof item?.typeId !== 'string' || item.typeId.length === 0 || item.typeId.length > 24) continue
    const id = typeof item.id === 'string' && item.id.length > 0 ? item.id : templateId(item.name)
    if (seen.has(id)) continue
    seen.add(id)
    const template: StoredIndicatorTemplate = {
      id,
      name: item.name.trim().slice(0, MAX_TEMPLATE_NAME),
      typeId: item.typeId
    }
    if (Array.isArray(item.calcParams) && item.calcParams.every(param => typeof param === 'number' && Number.isFinite(param))) {
      template.calcParams = [...item.calcParams]
    }
    const plots = toPlotStyles(item.plots)
    if (plots) template.plots = plots
    if (typeof item.source === 'string' && (PRICE_SOURCES as readonly string[]).includes(item.source) && item.source !== 'close') {
      template.source = item.source
    }
    if (typeof item.offset === 'number' && Number.isFinite(item.offset) && Math.abs(item.offset) <= 1000 && item.offset !== 0) {
      template.offset = Math.round(item.offset)
    }
    if (typeof item.timeframe === 'string' && item.timeframe.length > 0 && item.timeframe.length <= 8) {
      template.timeframe = item.timeframe
    }
    out.push(template)
  }
  return out.slice(0, MAX_TEMPLATES)
}

export function writeIndicatorTemplates (templates: StoredIndicatorTemplate[]): void {
  write(INDICATOR_TEMPLATES_KEY, templates.slice(0, MAX_TEMPLATES))
}

export interface StoredPoint {
  timestamp?: number
  dataIndex?: number
  value?: number
}

export interface StoredDrawing {
  name: string
  points: StoredPoint[]
  styles?: any
  lock?: boolean
  visible?: boolean
  mode?: string
  extendData?: any
  /** DRAW-007 (reserved): timeframes the drawing is visible on; absent = all. */
  timeframes?: string[]
}

export interface StoredSettings {
  styles?: any
  timezone?: string
  drawingBarVisible?: boolean
  cursorMode?: 'arrow' | 'crosshair'
  chartType?: string
  /** Chart type before a 1s line-lock session; wins over chartType on restore. */
  preSecondChartType?: string
  barCountdown?: boolean
  /** Cap canvas backing stores at DPR 1 (Performance mode). */
  performanceMode?: boolean
  /** Builder-made interval texts ('3m', '12h'), served by client aggregation. */
  customIntervals?: string[]
}

export interface PlotStyle {
  color?: string
  size?: number
  style?: 'solid' | 'dashed'
  visible?: boolean
  /** Separate colors for direction-colored bars (VOL, MACD histogram). */
  upColor?: string
  downColor?: string
  /** 0–100; baked into `color` as alpha when applying. */
  opacity?: number
}

export interface StoredIndicator {
  name: string
  calcParams?: number[]
  visible?: boolean
  plots?: Record<string, PlotStyle>
  height?: number
  /** IND-002: price source the study reads as 'close'. */
  source?: string
  /** IND-002: horizontal plot shift in bars. */
  offset?: number
  /** IND-002: higher-timeframe key (period text, e.g. '4h'); '' = chart period. */
  timeframe?: string
  /** M5: compare target for COMPARE instances; bars are re-fetched on restore. */
  compare?: StoredCompareTarget
}

export interface StoredCompareTarget {
  exchange?: string
  market?: string
  ticker: string
  shortName?: string
  name?: string
  /** M5 WORK-001: 'independent' (own scale, default for new compares), 'pinned', or 'raw'. */
  mode?: 'pinned' | 'independent' | 'raw'
}

const COMPARE_MODES = ['pinned', 'independent', 'raw']

const compareTargetOf = (value: unknown): StoredCompareTarget | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<StoredCompareTarget>
  if (typeof candidate.ticker !== 'string' || candidate.ticker.length === 0 || candidate.ticker.length > 60) return undefined
  const target: StoredCompareTarget = { ticker: candidate.ticker }
  if (typeof candidate.exchange === 'string' && candidate.exchange.length > 0 && candidate.exchange.length <= 24) target.exchange = candidate.exchange
  if (typeof candidate.market === 'string' && candidate.market.length > 0 && candidate.market.length <= 24) target.market = candidate.market
  if (typeof candidate.shortName === 'string' && candidate.shortName.length > 0 && candidate.shortName.length <= 24) target.shortName = candidate.shortName
  if (typeof candidate.name === 'string' && candidate.name.length > 0 && candidate.name.length <= 60) target.name = candidate.name
  if (typeof candidate.mode === 'string' && COMPARE_MODES.includes(candidate.mode)) target.mode = candidate.mode as StoredCompareTarget['mode']
  return target
}

export interface StoredIndicatorLayout {
  main: StoredIndicator[]
  sub: StoredIndicator[]
}

export function read<T> (key: string): T | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw === null ? null : JSON.parse(raw) as T
  } catch (e) {
    return null
  }
}

export function write (key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch (e) {}
}

export function symbolKey (symbol?: { ticker?: string, exchange?: string, market?: string }): string {
  return [symbol?.exchange, symbol?.market, symbol?.ticker].filter(Boolean).join(':')
}

export function readMigrated<T> (key: string, legacyKey: string): T | null {
  const current = read<T>(key)
  if (current !== null || legacyKey === key) return current
  const legacy = read<T>(legacyKey)
  if (legacy === null) return null
  write(key, legacy)
  try { window.localStorage.removeItem(PREFIX + legacyKey) } catch (e) {}
  return legacy
}

export function drawingsKey (ticker?: string): string {
  return `drawings:${ticker ?? ''}`
}

export function indicatorsKey (ticker?: string): string {
  return `indicators:${ticker ?? ''}`
}

export const indicatorType = (id: string): string => id.split('~')[0]

export function nextIndicatorId (type: string, taken: Iterable<string>): string {
  const ids = new Set(taken)
  if (!ids.has(type)) return type
  let n = 2
  while (ids.has(`${type}~${n}`)) n++
  return `${type}~${n}`
}

export function toPlotStyles (value: unknown): Record<string, PlotStyle> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const out: Record<string, PlotStyle> = {}
  Object.entries(value).forEach(([key, raw]) => {
    if (typeof raw !== 'object' || raw === null) return
    const plot: PlotStyle = {}
    if (typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color)) plot.color = raw.color
    if (typeof raw.size === 'number' && raw.size >= 1 && raw.size <= 10) plot.size = raw.size
    if (raw.style === 'solid' || raw.style === 'dashed') plot.style = raw.style
    if (typeof raw.visible === 'boolean') plot.visible = raw.visible
    if (typeof raw.upColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.upColor)) plot.upColor = raw.upColor
    if (typeof raw.downColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.downColor)) plot.downColor = raw.downColor
    if (typeof raw.opacity === 'number' && Number.isFinite(raw.opacity) && raw.opacity >= 0 && raw.opacity <= 100) plot.opacity = raw.opacity
    if (Object.keys(plot).length > 0) out[key] = plot
  })
  return Object.keys(out).length > 0 ? out : undefined
}

export const toStoredIndicator = (value: unknown): StoredIndicator | null => {
  if (typeof value === 'string') {
    return value.length > 0 ? { name: value } : null
  }
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const candidate = value as Partial<StoredIndicator>
  if (typeof candidate.name !== 'string' || candidate.name.length === 0) {
    return null
  }
  const stored: StoredIndicator = { name: candidate.name }
  if (Array.isArray(candidate.calcParams) && candidate.calcParams.every(param => typeof param === 'number' && Number.isFinite(param))) {
    stored.calcParams = [...candidate.calcParams]
  }
  if (typeof candidate.visible === 'boolean') {
    stored.visible = candidate.visible
  }
  const plots = toPlotStyles(candidate.plots)
  if (plots) stored.plots = plots
  if (typeof candidate.height === 'number' && candidate.height >= 30 && candidate.height <= 4000) {
    stored.height = Math.round(candidate.height)
  }
  // IND-002 calculation inputs
  if (typeof candidate.source === 'string' && (PRICE_SOURCES as readonly string[]).includes(candidate.source) && candidate.source !== 'close') {
    stored.source = candidate.source
  }
  if (typeof candidate.offset === 'number' && Number.isFinite(candidate.offset) && Math.abs(candidate.offset) <= 1000 && candidate.offset !== 0) {
    stored.offset = Math.round(candidate.offset)
  }
  if (typeof candidate.timeframe === 'string' && candidate.timeframe.length > 0 && candidate.timeframe.length <= 8) {
    stored.timeframe = candidate.timeframe
  }
  const compare = compareTargetOf(candidate.compare)
  if (compare) stored.compare = compare
  return stored
}

export function toStoredIndicatorLayout (value: unknown): StoredIndicatorLayout | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const candidate = value as Partial<StoredIndicatorLayout>
  if (!Array.isArray(candidate.main) || !Array.isArray(candidate.sub)) {
    return null
  }
  const normalize = (items: unknown[]): StoredIndicator[] => {
    const seen = new Set<string>()
    const out: StoredIndicator[] = []
    items.forEach(item => {
      const stored = toStoredIndicator(item)
      if (stored && !seen.has(stored.name)) {
        seen.add(stored.name)
        out.push(stored)
      }
    })
    return out
  }
  return { main: normalize(candidate.main), sub: normalize(candidate.sub) }
}

export interface IndicatorLayoutChange {
  main: boolean
  item: StoredIndicator
}

export function indicatorLayoutChanges (current: StoredIndicatorLayout, next: StoredIndicatorLayout): {
  remove: IndicatorLayoutChange[]
  add: IndicatorLayoutChange[]
  update: IndicatorLayoutChange[]
} {
  const changes = { remove: [] as IndicatorLayoutChange[], add: [] as IndicatorLayoutChange[], update: [] as IndicatorLayoutChange[] }
  ;(['main', 'sub'] as const).forEach(placement => {
    const main = placement === 'main'
    const before = new Map(current[placement].map(item => [item.name, item]))
    const after = new Map(next[placement].map(item => [item.name, item]))
    before.forEach((item, id) => { if (!after.has(id)) changes.remove.push({ main, item }) })
    after.forEach((item, id) => {
      const previous = before.get(id)
      if (!previous) changes.add.push({ main, item })
      else if (JSON.stringify(previous) !== JSON.stringify(item)) changes.update.push({ main, item })
    })
  })
  return changes
}

/**
 * Reduce a live overlay to the subset worth storing. Returns null for anything
 * outside the drawing-bar group, which is what keeps host-owned overlays
 * (position and order lines, re-derived from live data) out of storage.
 */
export function toStoredDrawing (overlay: any, groupId: string): StoredDrawing | null {
  if (!overlay || overlay.groupId !== groupId || typeof overlay.name !== 'string') {
    return null
  }
  if (!Array.isArray(overlay.points) || overlay.points.length === 0) {
    return null
  }
  const points: StoredPoint[] = []
  for (const point of overlay.points) {
    if (!point) {
      return null
    }
    const stored: StoredPoint = {}
    if (typeof point.timestamp === 'number') {
      stored.timestamp = point.timestamp
    } else if (typeof point.dataIndex === 'number') {
      // Future-space points have no candle timestamp yet.
      stored.dataIndex = point.dataIndex
    }
    if (typeof point.value === 'number') {
      stored.value = point.value
    }
    if (stored.timestamp === undefined && stored.dataIndex === undefined && stored.value === undefined) {
      return null
    }
    points.push(stored)
  }
  const timeframes = Array.isArray(overlay.timeframes)
    ? overlay.timeframes.filter((frame: unknown): frame is string => typeof frame === 'string' && frame.length > 0 && frame.length <= 16).slice(0, 12)
    : []
  return {
    name: overlay.name,
    points,
    styles: overlay.styles ?? undefined,
    lock: overlay.lock ?? false,
    visible: overlay.visible,
    mode: overlay.mode ?? undefined,
    extendData: DATA_DRAWING_TOOLS.has(overlay.name) ? undefined : overlay.extendData ?? undefined,
    timeframes: timeframes.length > 0 ? timeframes : undefined
  }
}
