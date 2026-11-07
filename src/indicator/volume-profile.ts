import {
  IndicatorSeries,
  type IndicatorTemplate,
  type YAxis
} from 'klinecharts'

import { type ProfileRow, profileRowColor, volumeProfileRange } from '../extension/derived'
import { positiveInt, positiveNumber } from './math'
import { inferPivotBucket, pivotBucketKey } from './second-wave'

const profileSettings = (calcParams: unknown[], defaultWidth: number) => ({
  rows: positiveInt(calcParams[0], 24),
  valueArea: Math.min(100, positiveNumber(calcParams[1], 70)) / 100,
  width: Math.min(100, positiveNumber(calcParams[2], defaultWidth)) / 100
})

const paintProfile = (
  ctx: CanvasRenderingContext2D, yAxis: YAxis, profile: ProfileRow[], maxVolume: number,
  edgeX: number, maxWidth: number, grow: 1 | -1, lineLeft: number, lineRight: number
): void => {
  for (const row of profile) {
    const top = yAxis.convertToPixel(row.high)
    const bottom = yAxis.convertToPixel(row.low)
    const width = maxWidth * row.volume / maxVolume
    ctx.fillStyle = profileRowColor(row)
    ctx.fillRect(grow > 0 ? edgeX : edgeX - width, Math.min(top, bottom), width, Math.max(1, Math.abs(bottom - top) - 1))
    if (!row.poc) continue
    const y = Math.round(yAxis.convertToPixel((row.low + row.high) / 2)) + 0.5
    ctx.strokeStyle = profileRowColor(row)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(lineLeft, y)
    ctx.lineTo(lineRight, y)
    ctx.stroke()
  }
}

// ponytail: candles carry no trade prices, so each bar's volume is spread evenly over its high-low rows (same as the fixed-range drawing)
export const visibleRangeVolumeProfile: IndicatorTemplate = {
  name: 'VRVP',
  shortName: 'Volume Profile Visible Range',
  series: IndicatorSeries.Price,
  calcParams: [24, 70, 30],
  figures: [],
  calc: dataList => dataList.map(() => ({})),
  draw: ({ ctx, kLineDataList, indicator, visibleRange, bounding, xAxis, yAxis }) => {
    const { rows, valueArea, width } = profileSettings(indicator.calcParams, 30)
    const { profile, maxVolume } = volumeProfileRange(kLineDataList, visibleRange.from, visibleRange.to - 1, rows, valueArea)
    if (profile && maxVolume) {
      paintProfile(ctx, yAxis, profile, maxVolume, bounding.width, bounding.width * width, -1,
        Math.max(0, xAxis.convertToPixel(visibleRange.from)), bounding.width)
    }
    return true
  }
}

export const sessionVolumeProfile: IndicatorTemplate = {
  name: 'SVP',
  shortName: 'Session Volume Profile',
  series: IndicatorSeries.Price,
  calcParams: [24, 70, 70],
  figures: [],
  calc: dataList => dataList.map(() => ({})),
  draw: ({ ctx, kLineDataList: data, indicator, visibleRange, barSpace, xAxis, yAxis }) => {
    if (visibleRange.to <= visibleRange.from) return true
    const { rows, valueArea, width } = profileSettings(indicator.calcParams, 70)
    const bucket = inferPivotBucket(data)
    const session = (index: number): number => pivotBucketKey(data[index].timestamp, bucket)
    let start = visibleRange.from
    while (start > 0 && session(start - 1) === session(start)) start--
    while (start < visibleRange.to) {
      const key = session(start)
      let end = start
      while (end + 1 < data.length && session(end + 1) === key) end++
      const { profile, maxVolume } = volumeProfileRange(data, start, end, rows, valueArea)
      if (profile && maxVolume) {
        const left = xAxis.convertToPixel(start) - barSpace.halfBar
        const right = xAxis.convertToPixel(end) + barSpace.halfBar
        paintProfile(ctx, yAxis, profile, maxVolume, left, (right - left) * width, 1, left, right)
      }
      start = end + 1
    }
    return true
  }
}

const volumeProfileIndicators: IndicatorTemplate[] = [visibleRangeVolumeProfile, sessionVolumeProfile]

export default volumeProfileIndicators
