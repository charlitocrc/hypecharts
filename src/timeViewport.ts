import { DomPosition } from 'klinecharts'
import type { Chart } from 'klinecharts'
import type { Period } from './types'
import { chartTimeAtIndex, chartIndexAtTime } from './multiChartTime'
export interface TimeViewport { from: number, to: number }
export function captureTimeViewport (chart: Chart, period: Period): TimeViewport | undefined {
  const data = chart.getDataList(), viewport = chart.getViewport()
  const width = chart.getSize('candle_pane', DomPosition.Main)?.width ?? 0
  const right = data.length + viewport.offsetRightBarCount - 0.5
  const from = chartTimeAtIndex(data, right - width / viewport.barSpace, period)
  const to = chartTimeAtIndex(data, right, period)
  return from !== undefined && to !== undefined && to > from ? { from, to } : undefined
}
export function restoreTimeViewport (chart: Chart, period: Period, range?: TimeViewport): void {
  if (!range) return
  const data = chart.getDataList(), width = chart.getSize('candle_pane', DomPosition.Main)?.width ?? 0
  const left = chartIndexAtTime(data, range.from, period), right = chartIndexAtTime(data, range.to, period)
  if (left === undefined || right === undefined || !(right > left) || width <= 0) return
  chart.setViewport(Math.max(1, Math.min(50, width / (right - left))), right + 0.5 - data.length)
}
