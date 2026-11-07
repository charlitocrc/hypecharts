import type { IndicatorParamConfig } from './data'
import type { PlotStyle } from '../../persist'

export interface PlotDraft {
  key: string
  title: string
  line: boolean
  /** Direction-colored bar figure (VOL, MACD histogram): has up/down colors. */
  bar: boolean
  /** Flat override; empty string on bars means "use the up/down colors". */
  color: string
  upColor: string
  downColor: string
  size: number
  style: 'solid' | 'dashed'
  /** 0–100, 100 = opaque. */
  opacity: number
  visible: boolean
}

// Opacity travels in PlotStyle and is baked into the color by the vendor core.
export const toHexColor = (color: unknown, fallback = '#888888'): string => {
  if (typeof color !== 'string') return fallback
  const value = color.trim().toLowerCase()
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(value)) return value.slice(0, 7)
  if (/^#[0-9a-f]{3,4}$/.test(value)) return `#${[...value.slice(1, 4)].map(c => c + c).join('')}`
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (rgb) return `#${rgb.slice(1, 4).map(n => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`
  return fallback
}

const STYLE_GROUPS: Record<string, string> = { line: 'lines', bar: 'bars', circle: 'circles' }

export const plotDefaults = (indicator: any, defaultStyles: any, dataList: unknown[]): PlotDraft[] => {
  const counts: Record<string, number> = {}
  const last = dataList.length - 1
  const result = indicator?.result ?? []
  const data = {
    prev: { kLineData: dataList[last - 1], indicatorData: result[last - 1] },
    current: { kLineData: dataList[last], indicatorData: result[last] },
    next: { kLineData: undefined, indicatorData: undefined }
  }
  const barBase = defaultStyles?.bars?.[0] ?? {}
  return (indicator?.figures ?? []).flatMap((figure: any): PlotDraft[] => {
    const group = STYLE_GROUPS[figure.type]
    if (!group || typeof figure.key !== 'string') return []
    const list = defaultStyles?.[group] ?? []
    counts[group] = (counts[group] ?? -1) + 1
    const base = list[counts[group] % Math.max(1, list.length)] ?? {}
    let own: any = {}
    try { own = figure.styles?.(data, indicator, defaultStyles) ?? {} } catch (e) {}
    const line = figure.type === 'line'
    const bar = figure.type === 'bar'
    return [{
      key: figure.key,
      title: String(figure.title ?? figure.key).replace(/:\s*$/, ''),
      line,
      bar,
      color: bar ? '' : toHexColor(own.color ?? (line ? base.color : base.noChangeColor)),
      upColor: bar ? toHexColor(barBase.upColor, '#089981') : '',
      downColor: bar ? toHexColor(barBase.downColor, '#f23645') : '',
      size: typeof base.size === 'number' ? base.size : 1,
      style: line && (own.style ?? base.style) === 'dashed' ? 'dashed' : 'solid',
      opacity: 100,
      visible: true
    }]
  })
}

export const applyPlotStyles = (defaults: PlotDraft[], overrides?: Record<string, PlotStyle>): PlotDraft[] =>
  defaults.map(plot => ({ ...plot, ...overrides?.[plot.key] }))

export const diffPlotStyles = (defaults: PlotDraft[], drafts: PlotDraft[]): Record<string, PlotStyle> | undefined => {
  const out: Record<string, PlotStyle> = {}
  drafts.forEach(draft => {
    const base = defaults.find(plot => plot.key === draft.key)
    if (!base) return
    const plot: PlotStyle = {}
    if (draft.bar) {
      // empty color = use the up/down colors; empty up/down = template defaults
      if (draft.color !== '' && draft.color !== base.color) plot.color = draft.color
      if (draft.upColor !== '' && draft.upColor !== base.upColor) plot.upColor = draft.upColor
      if (draft.downColor !== '' && draft.downColor !== base.downColor) plot.downColor = draft.downColor
    } else if (draft.color !== base.color) {
      plot.color = draft.color
    }
    if (draft.line && draft.size !== base.size) plot.size = draft.size
    if (draft.line && draft.style !== base.style) plot.style = draft.style
    if (draft.opacity !== base.opacity && draft.opacity < 100) plot.opacity = draft.opacity
    if (draft.visible !== base.visible) plot.visible = draft.visible
    if (Object.keys(plot).length > 0) out[draft.key] = plot
  })
  return Object.keys(out).length > 0 ? out : undefined
}

export type IndicatorParamError = 'required' | 'number' | 'precision' | 'min' | 'max' | 'sequence'

export interface IndicatorParamValidation {
  errors: Array<IndicatorParamError | undefined>
  isValid: boolean
  values: number[]
}

const toDraft = (value: unknown): string =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : ''

export const createParamDrafts = (
  config: IndicatorParamConfig[],
  calcParams: unknown[]
): string[] => config.map((item, index) => {
  const current = toDraft(calcParams[index])
  if (current !== '') return current
  return item.optional ? '' : toDraft(item.default)
})

export const createDefaultParamDrafts = (config: IndicatorParamConfig[]): string[] =>
  config.map(item => toDraft(item.default))

const decimalPlaces = (value: string): number => {
  const decimal = value.toLowerCase().split('e')[0].split('.')[1]
  return decimal?.length ?? 0
}

export const validateParamDrafts = (
  config: IndicatorParamConfig[],
  drafts: string[]
): IndicatorParamValidation => {
  const errors: Array<IndicatorParamError | undefined> = []
  const values: number[] = []

  config.forEach((item, index) => {
    const raw = (drafts[index] ?? '').trim()
    if (raw === '') {
      const hasLaterValue = drafts.slice(index + 1).some(value => value.trim() !== '')
      errors[index] = item.optional
        ? (hasLaterValue ? 'sequence' : undefined)
        : 'required'
      return
    }

    if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(raw)) {
      errors[index] = 'number'
      return
    }

    const value = Number(raw)
    if (!Number.isFinite(value)) {
      errors[index] = 'number'
    } else if (decimalPlaces(raw) > item.precision) {
      errors[index] = 'precision'
    } else if (value < item.min) {
      errors[index] = 'min'
    } else if (item.max !== undefined && value > item.max) {
      errors[index] = 'max'
    } else {
      values.push(value)
    }
  })

  return { errors, isValid: errors.every(error => error === undefined), values }
}

export const stepParamDraft = (
  raw: string,
  config: IndicatorParamConfig,
  direction: -1 | 1
): string => {
  const parsed = Number(raw)
  const fallback = config.default ?? config.min
  if (raw.trim() === '' || !Number.isFinite(parsed)) return String(fallback)
  const step = 10 ** -config.precision
  const upperBound = config.max ?? Number.MAX_SAFE_INTEGER
  const value = Math.min(upperBound, Math.max(config.min, parsed + direction * step))
  return String(Number(value.toFixed(config.precision)))
}
