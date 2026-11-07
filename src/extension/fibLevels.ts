import type { Overlay } from 'klinecharts'

const RETRACEMENT = [1, 0.786, 0.618, 0.5, 0.382, 0.236, 0]

export const FIB_LEVEL_DEFAULTS: Record<string, number[]> = {
  fibonacciLine: RETRACEMENT,
  fibonacciSegment: RETRACEMENT,
  fibonacciExtension: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1],
  fibonacciSpeedResistanceFan: [1, 0.75, 0.618, 0.5, 0.382, 0.25, 0],
  fibonacciCircle: [0.236, 0.382, 0.5, 0.618, 0.786, 1],
  fibonacciChannel: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618]
}

const MAX_LEVELS = 24

const isLevelList = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length > 0 && value.length <= MAX_LEVELS &&
  value.every(level => typeof level === 'number' && Number.isFinite(level) && level >= -10 && level <= 10)

export const fibLevels = (overlay: Pick<Overlay, 'name' | 'extendData'> | undefined, name: string): number[] => {
  const levels = overlay?.extendData?.levels
  return isLevelList(levels) ? levels : FIB_LEVEL_DEFAULTS[name]
}

/**
 * Default per-level palette, matching the standard Fibonacci reference
 * sequence (gray 0/1, red 0.236/2.618, greens 0.382-0.618, slate 0.786,
 * blue 1.618, purple 3.618, pink 4.236). Levels are keyed by their value.
 */
export const FIB_LEVEL_COLORS: Record<string, string> = {
  0: '#787B86',
  0.236: '#F23645',
  0.382: '#83B07F',
  0.5: '#61A257',
  0.618: '#3F8D82',
  0.786: '#5880AD',
  1: '#787B86',
  1.618: '#4891E7',
  2.618: '#F23645',
  3.618: '#862FA0',
  4.236: '#C2345D'
}

const FALLBACK_LEVEL_COLOR = '#787B86'

export const defaultLevelColor = (level: number): string =>
  FIB_LEVEL_COLORS[String(level)] ?? FALLBACK_LEVEL_COLOR

export const parseFibLevels = (text: string): number[] | null => {
  const parts = text.split(/[\s,;]+/).filter(part => part !== '')
  if (parts.length === 0 || !parts.every(part => /^-?(\d+\.?\d*|\.\d+)$/.test(part))) return null
  const levels = [...new Set(parts.map(Number))]
  return isLevelList(levels) ? levels : null
}

export const formatFibLevels = (levels: number[]): string => levels.join(', ')

/** Per-level appearance override, keyed by level value ('0.618'). */
export interface LevelStyle {
  color?: string
  visible?: boolean
}

const isValidHex = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)

export const levelStylesOf = (overlay: Pick<Overlay, 'extendData'> | undefined | null): Record<string, LevelStyle> => {
  const raw = overlay?.extendData?.levelStyles
  if (typeof raw !== 'object' || raw === null) return {}
  const out: Record<string, LevelStyle> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue
    const style: LevelStyle = {}
    if (isValidHex((value as LevelStyle).color)) style.color = (value as LevelStyle).color
    if (typeof (value as LevelStyle).visible === 'boolean') style.visible = (value as LevelStyle).visible
    if (Object.keys(style).length > 0) out[key] = style
  }
  return out
}

/** Effective level color: user override, then the default sequence. */
export const levelColor = (styles: Record<string, LevelStyle>, level: number): string =>
  styles[String(level)]?.color ?? defaultLevelColor(level)

export const isLevelVisible = (styles: Record<string, LevelStyle>, level: number): boolean =>
  styles[String(level)]?.visible !== false

/** Level labels are drawn unless the user switched them off. */
export const showLevelLabels = (overlay: Pick<Overlay, 'extendData'> | undefined | null): boolean =>
  overlay?.extendData?.showLabels !== false

/** Retracement-style bands between adjacent levels default on. */
export const showBandsOf = (overlay: Pick<Overlay, 'extendData'> | undefined | null): boolean =>
  overlay?.extendData?.showBands !== false

/** Adjacent level pairs by descending value, for band fills: [[1, 0.786], ...]. */
export const bandPairs = (levels: number[]): Array<[number, number]> => {
  const sorted = [...levels].sort((a, b) => b - a)
  const pairs: Array<[number, number]> = []
  for (let i = 0; i < sorted.length - 1; i++) pairs.push([sorted[i], sorted[i + 1]])
  return pairs
}

export const withAlpha = (hex: string, alpha: number): string => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Normalize editor/persisted values down to the persisted shape (undefined when empty). */
export const sanitizeLevelStyles = (value: unknown): Record<string, LevelStyle> | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const out: Record<string, LevelStyle> = {}
  for (const [key, style] of Object.entries(value as Record<string, unknown>)) {
    if (typeof style !== 'object' || style === null) continue
    const clean: LevelStyle = {}
    if (isValidHex((style as LevelStyle).color)) clean.color = (style as LevelStyle).color
    if (typeof (style as LevelStyle).visible === 'boolean') clean.visible = (style as LevelStyle).visible
    if (Object.keys(clean).length > 0) out[key] = clean
  }
  return Object.keys(out).length > 0 ? out : undefined
}
