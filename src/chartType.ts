import { CandleType, type KLineData } from 'klinecharts'

import { atrSeries } from './indicator/math'
import type { Period } from './types'

export type SyntheticChartType = 'heikin_ashi' | 'renko' | 'line_break'
export type ChartType = CandleType | SyntheticChartType

export const SYNTHETIC_CHART_TYPES: SyntheticChartType[] = ['heikin_ashi', 'renko', 'line_break']

export const isSynthetic = (type: ChartType): type is SyntheticChartType =>
  (SYNTHETIC_CHART_TYPES as string[]).includes(type)

/** Brick types are not time-based: one source candle can form many bars, and history cannot be paged in. */
export const isBrickType = (type: ChartType): boolean => type === 'renko' || type === 'line_break'

/**
 * Second-based bars are trade-derived: they carry no coherent open/high/low,
 * so they always render as a line and every other chart type is refused.
 */
export const isLineLockedPeriod = (period: Period): boolean => period.timespan === 'second'

export const resolveChartTypeForPeriod = (period: Period, type: ChartType): ChartType =>
  isLineLockedPeriod(period) ? CandleType.Line : type

export const nativeCandleType = (type: ChartType): CandleType =>
  isSynthetic(type) ? CandleType.CandleSolid : type

const bar = (timestamp: number, open: number, close: number, volume: number): KLineData => ({
  timestamp, open, close, high: Math.max(open, close), low: Math.min(open, close), volume
})

export const heikinAshiBar = (source: KLineData, previous?: KLineData): KLineData => {
  const close = (source.open + source.high + source.low + source.close) / 4
  const open = previous ? (previous.open + previous.close) / 2 : (source.open + source.close) / 2
  return {
    ...source,
    open,
    close,
    high: Math.max(source.high, open, close),
    low: Math.min(source.low, open, close)
  }
}

export const heikinAshi = (data: KLineData[], previous?: KLineData): KLineData[] => {
  const result: KLineData[] = []
  for (const source of data) {
    previous = heikinAshiBar(source, previous)
    result.push(previous)
  }
  return result
}

export const renkoBoxSize = (data: KLineData[], period = 14): number => {
  const atr = atrSeries(data, Math.min(period, Math.max(1, data.length)))
  const value = atr[atr.length - 1]
  if (value !== undefined && value > 0) return value
  const close = data[data.length - 1]?.close ?? 1
  return Math.max(Math.abs(close) * 0.001, 1e-8)
}

export const renko = (data: KLineData[], boxSize: number): KLineData[] => {
  const result: KLineData[] = []
  if (data.length === 0 || !(boxSize > 0)) return result
  let top = data[0].close
  let bottom = top
  let volume = 0
  for (let i = 1; i < data.length; i++) {
    const { close, timestamp } = data[i]
    volume += data[i].volume ?? 0
    let offset = 0
    while (close >= top + boxSize) {
      result.push(bar(timestamp + offset++, top, top + boxSize, volume))
      volume = 0
      bottom = top
      top += boxSize
    }
    while (close <= bottom - boxSize) {
      result.push(bar(timestamp + offset++, bottom, bottom - boxSize, volume))
      volume = 0
      top = bottom
      bottom -= boxSize
    }
  }
  return result
}

export const lineBreak = (data: KLineData[], lineCount = 3): KLineData[] => {
  const result: KLineData[] = []
  let volume = 0
  for (const source of data) {
    volume += source.volume ?? 0
    const last = result[result.length - 1]
    if (!last) {
      if (source.close !== source.open) {
        result.push(bar(source.timestamp, source.open, source.close, volume))
        volume = 0
      }
      continue
    }
    const recent = result.slice(-lineCount)
    const rising = last.close > last.open
    const breaksUp = source.close > (rising ? last.high : Math.max(...recent.map(line => line.high)))
    const breaksDown = source.close < (rising ? Math.min(...recent.map(line => line.low)) : last.low)
    if (breaksUp || breaksDown) {
      result.push(bar(source.timestamp, breaksUp ? last.high : last.low, source.close, volume))
      volume = 0
    }
  }
  return result
}

/** Index from which `current` must be replaced by `next`, or null when equal. Never returns `current.length` for a pure removal, so the caller always re-pushes at least one bar. */
export const divergenceIndex = (current: KLineData[], next: KLineData[]): number | null => {
  let same = 0
  while (same < current.length && same < next.length &&
    current[same].timestamp === next[same].timestamp && current[same].close === next[same].close) same++
  if (same === current.length && same === next.length) return null
  return same === next.length ? Math.max(0, same - 1) : same
}

export const transformBars =(type: ChartType, data: KLineData[], boxSize: number): KLineData[] => {
  switch (type) {
    case 'heikin_ashi': return heikinAshi(data)
    case 'renko': return renko(data, boxSize)
    case 'line_break': return lineBreak(data)
    default: return data
  }
}
