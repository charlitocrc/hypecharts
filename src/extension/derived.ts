/** Data-aware drawings whose geometry is calculated from a selected candle range. */
import {
  Coordinate, KLineData, OverlayFigure, OverlayTemplate, Point, RectAttrs
} from 'klinecharts'

const BLUE = '#2962ff'
const GREEN = '#089981'
const ORANGE = '#ff9800'

export const DATA_DRAWING_TOOLS = new Set([
  'anchoredVwap', 'fixedRangeVolumeProfile', 'regressionChannel', 'barsPattern'
])

interface SeriesPoint { dataIndex: number, value: number }
export interface ProfileRow { low: number, high: number, volume: number, valueArea: boolean, poc: boolean }
interface ProjectedBar { dataIndex: number, open: number, high: number, low: number, close: number }

export interface DerivedDrawingData {
  series?: SeriesPoint[]
  upper?: SeriesPoint[]
  lower?: SeriesPoint[]
  profile?: ProfileRow[]
  maxVolume?: number
  bars?: ProjectedBar[]
}

function resolveIndex (data: KLineData[], point: Partial<Point>): number {
  const timestamp = point.timestamp
  if (typeof timestamp === 'number') {
    let low = 0
    let high = data.length - 1
    while (low <= high) {
      const mid = (low + high) >> 1
      const value = data[mid].timestamp
      if (value === timestamp) return mid
      if (value < timestamp) low = mid + 1
      else high = mid - 1
    }
  }
  const index = Math.round(point.dataIndex ?? 0)
  return Math.max(0, Math.min(data.length - 1, index))
}

function selectedRange (data: KLineData[], points: Array<Partial<Point>>): [number, number] | null {
  if (data.length === 0 || points.length < 2) return null
  const a = resolveIndex(data, points[0])
  const b = resolveIndex(data, points[1])
  return [Math.min(a, b), Math.max(a, b)]
}

export function anchoredVwapData (data: KLineData[], anchor: Partial<Point>): DerivedDrawingData {
  if (data.length === 0) return { series: [] }
  const start = resolveIndex(data, anchor)
  let cumulativeVolume = 0
  let cumulativeValue = 0
  const series: SeriesPoint[] = []
  for (let i = start; i < data.length; i++) {
    const bar = data[i]
    const volume = Math.max(0, bar.volume ?? 0)
    cumulativeVolume += volume
    cumulativeValue += ((bar.high + bar.low + bar.close) / 3) * volume
    if (cumulativeVolume > 0) series.push({ dataIndex: i, value: cumulativeValue / cumulativeVolume })
  }
  return { series }
}

export function regressionChannelData (data: KLineData[], points: Array<Partial<Point>>): DerivedDrawingData {
  const range = selectedRange(data, points)
  if (!range) return {}
  const [start, end] = range
  const count = end - start + 1
  if (count < 2) return {}
  const sumX = count * (count - 1) / 2
  const sumX2 = count * (count - 1) * (2 * count - 1) / 6
  let sumY = 0
  let sumXY = 0
  for (let i = 0; i < count; i++) {
    const close = data[start + i].close
    sumY += close
    sumXY += i * close
  }
  const denominator = count * sumX2 - sumX * sumX
  const slope = denominator === 0 ? 0 : (count * sumXY - sumX * sumY) / denominator
  const intercept = (sumY - slope * sumX) / count
  let squaredError = 0
  for (let i = 0; i < count; i++) {
    const residual = data[start + i].close - (intercept + slope * i)
    squaredError += residual * residual
  }
  const deviation = Math.sqrt(squaredError / count) * 2
  const first = intercept
  const last = intercept + slope * (count - 1)
  return {
    series: [{ dataIndex: start, value: first }, { dataIndex: end, value: last }],
    upper: [{ dataIndex: start, value: first + deviation }, { dataIndex: end, value: last + deviation }],
    lower: [{ dataIndex: start, value: first - deviation }, { dataIndex: end, value: last - deviation }]
  }
}

export const profileRowColor = (row: ProfileRow): string =>
  row.poc ? ORANGE : row.valueArea ? 'rgba(41, 98, 255, 0.52)' : 'rgba(120, 123, 134, 0.30)'

export function volumeProfileData (
  data: KLineData[], points: Array<Partial<Point>>, rowCount = 24, valueAreaPercent = 0.7
): DerivedDrawingData {
  const range = selectedRange(data, points)
  return range ? volumeProfileRange(data, range[0], range[1], rowCount, valueAreaPercent) : {}
}

export function volumeProfileRange (
  data: KLineData[], start: number, end: number, rowCount = 24, valueAreaPercent = 0.7
): { profile?: ProfileRow[], maxVolume?: number } {
  if (start > end || start < 0 || end >= data.length) return {}
  let low = Infinity
  let high = -Infinity
  for (let i = start; i <= end; i++) {
    low = Math.min(low, data[i].low)
    high = Math.max(high, data[i].high)
  }
  const rows = Math.max(1, Math.floor(rowCount))
  const step = high === low ? Math.max(Math.abs(high) * 0.001, 1e-8) : (high - low) / rows
  const volumes = new Array<number>(rows).fill(0)
  for (let i = start; i <= end; i++) {
    const bar = data[i]
    // OHLCV candles do not reveal the exact price of every trade. Spread each
    // candle's volume evenly across the price rows its high-low range touched;
    // this preserves total volume and avoids a misleading single-price spike.
    const firstBucket = Math.max(0, Math.min(rows - 1, Math.floor((bar.low - low) / step)))
    const lastBucket = Math.max(firstBucket, Math.min(rows - 1, Math.floor((bar.high - low) / step)))
    const share = Math.max(0, bar.volume ?? 0) / (lastBucket - firstBucket + 1)
    for (let bucket = firstBucket; bucket <= lastBucket; bucket++) volumes[bucket] += share
  }
  let poc = 0
  for (let i = 1; i < rows; i++) if (volumes[i] > volumes[poc]) poc = i
  const total = volumes.reduce((sum, value) => sum + value, 0)
  const target = total * Math.min(1, Math.max(0, valueAreaPercent))
  let included = volumes[poc]
  let areaLow = poc
  let areaHigh = poc
  while (included < target && (areaLow > 0 || areaHigh < rows - 1)) {
    const below = areaLow > 0 ? volumes[areaLow - 1] : -1
    const above = areaHigh < rows - 1 ? volumes[areaHigh + 1] : -1
    if (above >= below) included += volumes[++areaHigh]
    else included += volumes[--areaLow]
  }
  const profile = volumes.map((volume, index) => ({
    low: low + step * index,
    high: low + step * (index + 1),
    volume,
    valueArea: index >= areaLow && index <= areaHigh,
    poc: index === poc
  }))
  return { profile, maxVolume: volumes[poc] }
}

export function barsPatternData (data: KLineData[], points: Array<Partial<Point>>): DerivedDrawingData {
  if (points.length < 3) return {}
  const range = selectedRange(data, points)
  if (!range) return {}
  const [start, end] = range
  // Projection anchors may intentionally sit in blank future space, so unlike
  // source-range points their data index must not be clamped to the last bar.
  const target = typeof points[2].dataIndex === 'number'
    ? Math.round(points[2].dataIndex)
    : resolveIndex(data, points[2])
  const targetValue = points[2].value ?? data[target]?.close ?? data[start].close
  const delta = targetValue - data[start].close
  const series: SeriesPoint[] = []
  const bars: ProjectedBar[] = []
  for (let i = start; i <= end; i++) {
    const dataIndex = target + i - start
    const bar = data[i]
    series.push({ dataIndex, value: bar.close + delta })
    bars.push({
      dataIndex,
      open: bar.open + delta,
      high: bar.high + delta,
      low: bar.low + delta,
      close: bar.close + delta
    })
  }
  return { series, bars }
}

export function buildDerivedDrawingData (
  name: string, data: KLineData[], points: Array<Partial<Point>>
): DerivedDrawingData | null {
  switch (name) {
    case 'anchoredVwap': return points.length > 0 ? anchoredVwapData(data, points[0]) : {}
    case 'fixedRangeVolumeProfile': return volumeProfileData(data, points)
    case 'regressionChannel': return regressionChannelData(data, points)
    case 'barsPattern': return barsPatternData(data, points)
    default: return null
  }
}

function seriesCoordinates (
  series: SeriesPoint[] | undefined,
  xAxis: { convertToPixel: (value: number) => number } | null,
  yAxis: { convertToPixel: (value: number) => number } | null
): Coordinate[] {
  if (!series || !xAxis || !yAxis) return []
  return series.map(point => ({ x: xAxis.convertToPixel(point.dataIndex), y: yAxis.convertToPixel(point.value) }))
}

export const anchoredVwap: OverlayTemplate = {
  name: 'anchoredVwap',
  totalStep: 2,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ overlay, xAxis, yAxis }) => ({
    type: 'line',
    attrs: { coordinates: seriesCoordinates(overlay.extendData?.series, xAxis, yAxis) },
    styles: { color: ORANGE, size: 2 }
  })
}

export const regressionChannel: OverlayTemplate = {
  name: 'regressionChannel',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ overlay, xAxis, yAxis }) => {
    const middle = seriesCoordinates(overlay.extendData?.series, xAxis, yAxis)
    const upper = seriesCoordinates(overlay.extendData?.upper, xAxis, yAxis)
    const lower = seriesCoordinates(overlay.extendData?.lower, xAxis, yAxis)
    const figures: OverlayFigure[] = []
    if (upper.length === 2 && lower.length === 2) {
      figures.push({
        type: 'polygon',
        ignoreEvent: true,
        attrs: { coordinates: [upper[0], upper[1], lower[1], lower[0]] },
        styles: { style: 'fill', color: 'rgba(41, 98, 255, 0.10)' }
      })
    }
    figures.push(
      { type: 'line', attrs: [{ coordinates: upper }, { coordinates: lower }], styles: { color: BLUE } },
      { type: 'line', attrs: { coordinates: middle }, styles: { color: BLUE, style: 'dashed' } }
    )
    return figures
  }
}

export const fixedRangeVolumeProfile: OverlayTemplate = {
  name: 'fixedRangeVolumeProfile',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ overlay, coordinates, yAxis }) => {
    if (coordinates.length < 2 || !yAxis) return []
    const rows = overlay.extendData?.profile as ProfileRow[] | undefined
    const maxVolume = Number(overlay.extendData?.maxVolume ?? 0)
    if (!rows || maxVolume <= 0) return []
    const left = Math.min(coordinates[0].x, coordinates[1].x)
    const right = Math.max(coordinates[0].x, coordinates[1].x)
    const width = Math.max(1, right - left)
    const figures: OverlayFigure[] = []
    let poc: ProfileRow | undefined
    let areaLow: ProfileRow | undefined
    let areaHigh: ProfileRow | undefined
    for (const row of rows) {
      if (row.poc) poc = row
      if (row.valueArea) {
        areaLow = areaLow ?? row
        areaHigh = row
      }
      const y1 = yAxis.convertToPixel(row.high)
      const y2 = yAxis.convertToPixel(row.low)
      const rowWidth = width * row.volume / maxVolume
      figures.push({
        type: 'rect',
        ignoreEvent: true,
        attrs: { x: right - rowWidth, y: Math.min(y1, y2), width: rowWidth, height: Math.max(1, Math.abs(y2 - y1)) },
        styles: { style: 'fill', color: profileRowColor(row) }
      })
    }
    if (poc) {
      const y = yAxis.convertToPixel((poc.low + poc.high) / 2)
      figures.push({ type: 'line', attrs: { coordinates: [{ x: left, y }, { x: right, y }] }, styles: { color: ORANGE } })
    }
    if (areaLow && areaHigh) {
      const valueAreaLow = yAxis.convertToPixel(areaLow.low)
      const valueAreaHigh = yAxis.convertToPixel(areaHigh.high)
      figures.push({
        type: 'line',
        attrs: [
          { coordinates: [{ x: left, y: valueAreaLow }, { x: right, y: valueAreaLow }] },
          { coordinates: [{ x: left, y: valueAreaHigh }, { x: right, y: valueAreaHigh }] }
        ],
        styles: { color: BLUE, style: 'dashed' }
      })
    }
    const profileTop = yAxis.convertToPixel(rows[rows.length - 1].high)
    const profileBottom = yAxis.convertToPixel(rows[0].low)
    figures.push({
      type: 'rect',
      attrs: { x: left, y: Math.min(profileTop, profileBottom), width, height: Math.abs(profileBottom - profileTop) },
      styles: { style: 'stroke', color: 'rgba(120, 123, 134, 0.55)' }
    })
    return figures
  }
}

export const barsPattern: OverlayTemplate = {
  name: 'barsPattern',
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ overlay, coordinates, xAxis, yAxis, barSpace }) => {
    const figures: OverlayFigure[] = [{
      type: 'line',
      attrs: { coordinates: coordinates.slice(0, 2) },
      styles: { color: 'rgba(120, 123, 134, 0.75)', style: 'dashed' }
    }]
    if (!xAxis || !yAxis) return figures
    const bars = overlay.extendData?.bars as ProjectedBar[] | undefined
    if (!bars) return figures
    const halfWidth = Math.max(1, Math.min(5, barSpace.bar * 0.32))
    const upWicks: Array<{ coordinates: Coordinate[] }> = []
    const downWicks: Array<{ coordinates: Coordinate[] }> = []
    const upBodies: RectAttrs[] = []
    const downBodies: RectAttrs[] = []
    for (const bar of bars) {
      const x = xAxis.convertToPixel(bar.dataIndex)
      const open = yAxis.convertToPixel(bar.open)
      const close = yAxis.convertToPixel(bar.close)
      const up = bar.close >= bar.open
      const wicks = up ? upWicks : downWicks
      const bodies = up ? upBodies : downBodies
      wicks.push({ coordinates: [{ x, y: yAxis.convertToPixel(bar.high) }, { x, y: yAxis.convertToPixel(bar.low) }] })
      bodies.push({ x: x - halfWidth, y: Math.min(open, close), width: halfWidth * 2, height: Math.max(1, Math.abs(close - open)) })
    }
    const addCandles = (wicks: Array<{ coordinates: Coordinate[] }>, bodies: RectAttrs[], color: string) => {
      if (wicks.length === 0) return
      figures.push(
        { type: 'line', ignoreEvent: true, attrs: wicks, styles: { color } },
        { type: 'rect', ignoreEvent: true, attrs: bodies, styles: { style: 'stroke_fill', color } }
      )
    }
    addCandles(upWicks, upBodies, GREEN)
    addCandles(downWicks, downBodies, '#f23645')
    return figures
  }
}

export default [anchoredVwap, fixedRangeVolumeProfile, regressionChannel, barsPattern]
