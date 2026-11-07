import type { StoredDrawing, StoredPoint } from '../../persist'
import i18n from '../../i18n'
import { TEXT_TOOLS } from '../../extension/annotation'
import { FREEHAND_TOOLS } from '../../extension/brush'
import { DATA_DRAWING_TOOLS } from '../../extension/derived'
import { FIB_LEVEL_DEFAULTS, sanitizeLevelStyles } from '../../extension/fibLevels'
import { POSITION_TOOLS } from '../../extension/position'

export interface DrawingItem extends StoredDrawing { id: string }

export const drawingLabel = (name: string, locale: string): string =>
  i18n(name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`), locale)

export type LineStyle = 'solid' | 'dashed' | 'dotted'

export interface DrawingStyleDraft {
  lineColor?: string
  lineWidth?: number
  lineStyle?: LineStyle
  lineOpacity?: number
  fillColor?: string
  fillOpacity?: number
  textColor?: string
  textSize?: number
  textBold?: boolean
  /** DRAW-003: label box color for text tools; unset keeps the tool default. */
  textBackground?: string
}

const UNSTYLED = new Set([
  ...POSITION_TOOLS, ...DATA_DRAWING_TOOLS, ...FREEHAND_TOOLS,
  'priceRange', 'dateRange', 'datePriceRange', 'measure'
])
const FILL_TOOLS = new Set([
  'rect', 'circle', 'triangle', 'parallelogram', 'ellipse', 'gannBox', 'fibonacciChannel', 'xabcd',
  'pitchfork', 'schiffPitchfork', 'modifiedSchiffPitchfork', 'insidePitchfork'
])

export const drawingStyleSections = (name: string): { line: boolean, fill: boolean, text: boolean, levels: boolean, bands: boolean } => {
  if (UNSTYLED.has(name)) return { line: false, fill: false, text: false, levels: false, bands: false }
  const levels = name in FIB_LEVEL_DEFAULTS
  // Level tools style each level (and its label) individually, so the flat
  // line/text pickers would only fight the per-level colors.
  const bands = name === 'fibonacciLine' || name === 'fibonacciSegment'
  return { line: name !== 'text' && !levels, fill: FILL_TOOLS.has(name), text: TEXT_TOOLS.has(name), levels, bands }
}

const SHAPES = ['polygon', 'rect', 'circle']
const dashes = (style: LineStyle): number[] => style === 'dotted' ? [1, 3] : [4, 4]

const hexToRgba = (hex: string, opacity: number): string => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  return `rgba(${r}, ${g}, ${b}, ${Math.round(opacity) / 100})`
}

const rgbaToFill = (color: unknown): Pick<DrawingStyleDraft, 'fillColor' | 'fillOpacity'> => {
  const match = typeof color === 'string' ? color.match(/^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/) : null
  if (!match) return {}
  const hex = `#${match.slice(1, 4).map(n => Number(n).toString(16).padStart(2, '0')).join('')}`
  return { fillColor: hex, fillOpacity: Math.round(Number(match[4]) * 100) }
}

export const toUserStyles = (draft: DrawingStyleDraft): Record<string, any> | undefined => {
  const user: Record<string, any> = {}
  const line: Record<string, unknown> = {}
  const border: Record<string, unknown> = {}
  const opacity = draft.lineOpacity !== undefined && draft.lineOpacity < 100 ? Math.max(0, draft.lineOpacity) / 100 : 1
  const applyColor = (hex: string): string => opacity < 1 ? hexToRgba(hex, Math.round(opacity * 100)) : hex
  if (draft.lineColor) { line.color = applyColor(draft.lineColor); border.borderColor = applyColor(draft.lineColor) }
  if (draft.lineWidth) { line.size = draft.lineWidth; border.borderSize = draft.lineWidth }
  if (draft.lineStyle) {
    line.style = draft.lineStyle === 'solid' ? 'solid' : 'dashed'
    line.dashedValue = dashes(draft.lineStyle)
    border.borderStyle = line.style
    border.borderDashedValue = line.dashedValue
  }
  if (draft.fillColor) border.color = hexToRgba(draft.fillColor, draft.fillOpacity ?? 20)
  if (Object.keys(line).length > 0) { user.line = line; user.arc = { ...line } }
  if (Object.keys(border).length > 0) SHAPES.forEach(type => { user[type] = { ...border } })
  const text: Record<string, unknown> = {}
  if (draft.textColor) text.color = draft.textColor
  if (draft.textSize) text.size = draft.textSize
  if (draft.textBold) text.weight = 'bold'
  if (Object.keys(text).length > 0) user.text = text
  // The label box is a rect figure; the vendor's user style layer applies
  // user[figureType] over a tool's own figure styles.
  if (draft.textBackground) user.rect = { color: draft.textBackground }
  return Object.keys(user).length > 0 ? user : undefined
}

export const fromUserStyles = (user: any): DrawingStyleDraft => {
  const draft: DrawingStyleDraft = { ...rgbaToFill(user?.polygon?.color) }
  if (typeof user?.line?.color === 'string') {
    const flat = rgbaToFill(user.line.color)
    if (flat.fillColor !== undefined) {
      draft.lineColor = flat.fillColor
      draft.lineOpacity = flat.fillOpacity
    } else {
      draft.lineColor = user.line.color
    }
  }
  if (typeof user?.line?.size === 'number') draft.lineWidth = user.line.size
  if (user?.line?.style !== undefined) draft.lineStyle = user.line.style === 'solid' ? 'solid' : user.line.dashedValue?.[0] === 1 ? 'dotted' : 'dashed'
  if (typeof user?.text?.color === 'string') draft.textColor = user.text.color
  if (typeof user?.text?.size === 'number') draft.textSize = user.text.size
  if (user?.text?.weight === 'bold') draft.textBold = true
  // Fill tools share the rect layer with an rgba() color; only a plain hex
  // is a text-tool background.
  if (typeof user?.rect?.color === 'string' && /^#[0-9a-f]{6}$/i.test(user.rect.color)) draft.textBackground = user.rect.color
  return draft
}

/**
 * Convert a stored preset draft into the `styles`/`extendData` a NEW drawing
 * should start with (DRAW-006: presets applied at placement time).
 */
const PRESET_DRAFT_KEYS = [
  'lineColor', 'lineWidth', 'lineStyle', 'lineOpacity',
  'fillColor', 'fillOpacity', 'textColor', 'textSize', 'textBold', 'textBackground'
] as const

export const presetToOverlayParts = (
  draft: Record<string, unknown>, tool: string
): { styles?: any, extendData?: any } => {
  const styleDraft: DrawingStyleDraft = {}
  PRESET_DRAFT_KEYS.forEach(key => {
    const value = draft[key]
    if (value !== undefined && value !== '') (styleDraft as any)[key] = value
  })
  const sections = drawingStyleSections(tool)
  const styles = sections.levels ? withLevelAwareStyles(undefined, styleDraft, true) : toUserStyles(styleDraft)
  const extendData: Record<string, unknown> = {}
  if (sections.levels) {
    const clean = sanitizeLevelStyles(draft.levelStyles)
    if (clean) extendData.levelStyles = clean
    if (draft.showLabels === false) extendData.showLabels = false
  }
  if (sections.bands && draft.showBands === false) extendData.showBands = false
  return {
    styles: styles ?? undefined,
    extendData: Object.keys(extendData).length > 0 ? extendData : undefined
  }
}

/**
 * Per-level (and label) colors live in extendData, but for level tools the flat
 * line/text fields are no longer editable — while still round-tripping through
 * the draft from older saves. Drop them so the rebuilt user layer cannot keep
 * flattening the per-level colors; fill drafts still pass through untouched.
 */
export const withLevelAwareStyles = (styles: any, draft: DrawingStyleDraft, levels: boolean): any => {
  if (!levels) return withUserStyles(styles, draft)
  const { lineColor: _c, lineWidth: _w, lineStyle: _s, lineOpacity: _o, textColor: _tc, textSize: _ts, textBold: _b, ...rest } = draft
  return withUserStyles(styles, rest)
}

export interface PointDraft { value?: string, time?: string, dataIndex?: number }
export const pointDrafts = (points: StoredPoint[]): PointDraft[] => points.map(point => ({
  value: point.value === undefined ? undefined : String(point.value),
  time: point.timestamp === undefined ? undefined : new Date(point.timestamp).toISOString().slice(0, 19),
  dataIndex: point.timestamp === undefined ? point.dataIndex : undefined
}))

export const parsePoints = (drafts: PointDraft[]): StoredPoint[] | null => {
  const points: StoredPoint[] = []
  for (const draft of drafts) {
    const point: StoredPoint = {}
    if (draft.value !== undefined) {
      if (!draft.value.trim() || !Number.isFinite(Number(draft.value))) return null
      point.value = Number(draft.value)
    }
    if (draft.time !== undefined) {
      const timestamp = Date.parse(`${draft.time}Z`)
      if (!draft.time || !Number.isFinite(timestamp)) return null
      point.timestamp = timestamp
    } else if (draft.dataIndex !== undefined) point.dataIndex = draft.dataIndex
    points.push(point)
  }
  return points
}

export const withUserStyles = (styles: any, draft: DrawingStyleDraft): any => {
  const { user, ...rest } = styles ?? {}
  const next = toUserStyles(draft)
  if (next) return { ...rest, user: next }
  // null, not undefined: klinecharts overrideOverlay ignores undefined, so the old styles would stay
  return Object.keys(rest).length > 0 ? rest : null
}
