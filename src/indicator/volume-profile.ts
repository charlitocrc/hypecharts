import { IndicatorSeries, type IndicatorTemplate, type YAxis } from 'klinecharts'
import type { KLineData } from 'klinecharts'
import { type ProfileRow, buildVolumeProfile, UTC_DAY } from '../volumeProfile'
import { type ProfileSource } from '../profileData'
import { positiveInt, positiveNumber } from './math'

export const profileSettings = (calcParams: unknown[], defaultWidth: number) => ({
  rows: Math.min(200, positiveInt(calcParams[0], 24)),
  valueArea: Math.min(100, positiveNumber(calcParams[1], 70)) / 100,
  width: Math.min(100, positiveNumber(calcParams[2], defaultWidth)) / 100,
  upDown: calcParams[3] === 1,
  showPoc: calcParams[4] !== 0,
  showVa: calcParams[5] !== 0,
  extend: calcParams[6] === 1
})

const paintProfile = (
  ctx: CanvasRenderingContext2D, yAxis: YAxis, profile: ProfileRow[], maxVolume: number,
  edgeX: number, maxWidth: number, grow: 1 | -1, lineLeft: number, lineRight: number,
  settings: ReturnType<typeof profileSettings>
): void => {
  for (const row of profile) {
    const top = yAxis.convertToPixel(row.high)
    const bottom = yAxis.convertToPixel(row.low)
    const width = maxWidth * row.volume / maxVolume
    const x = grow > 0 ? edgeX : edgeX - width
    const y = Math.min(top, bottom)
    const height = Math.max(1, Math.abs(bottom - top) - 1)
    if (settings.upDown) {
      const upWidth = maxWidth * row.upVolume / maxVolume
      ctx.fillStyle = row.valueArea ? 'rgba(8,153,129,0.75)' : 'rgba(8,153,129,0.30)'
      ctx.fillRect(x, y, upWidth, height)
      ctx.fillStyle = row.valueArea ? 'rgba(242,54,69,0.75)' : 'rgba(242,54,69,0.30)'
      ctx.fillRect(x + upWidth, y, Math.max(0, width - upWidth), height)
    } else {
      ctx.fillStyle = row.valueArea ? 'rgba(41,98,255,0.52)' : 'rgba(120,123,134,0.30)'
      ctx.fillRect(x, y, width, height)
    }
  }
  const line = (price: number, color: string): void => {
    const y = Math.round(yAxis.convertToPixel(price)) + 0.5
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(lineLeft, y); ctx.lineTo(lineRight, y); ctx.stroke()
  }
  const poc = profile.find(row => row.poc)
  if (poc && settings.showPoc) line((poc.low + poc.high) / 2, '#ff9800')
  if (settings.showVa) {
    const area = profile.filter(row => row.valueArea)
    if (area.length) { line(area[0].low, '#2962ff'); line(area[area.length - 1].high, '#2962ff') }
  }
}

interface ProfileGroup { from: number, to: number, profile: ProfileRow[], maxVolume: number }
const cache = new WeakMap<object, { key: string, source?: ProfileSource, groups: ProfileGroup[] }>()

/** Shared source metadata is transient; no fetched candles enter layouts/history. */
const groupsFor = (owner: object, data: KLineData[], source: ProfileSource | undefined, from: number, to: number,
  rows: number, valueArea: number, session: boolean): ProfileGroup[] => {
  const tail = data[data.length - 1]
  const key = `${from}:${to}:${rows}:${valueArea}:${session}:${data.length}:${data[0]?.timestamp}:${tail?.timestamp}:${tail?.volume}:${tail?.high}:${tail?.low}:${tail?.open}:${tail?.close}`
  const previous = cache.get(owner)
  if (previous?.key === key && previous.source === source) return previous.groups
  const input = source?.bars ?? data
  const groups: ProfileGroup[] = []
  const ranges: Array<[number, number]> = []
  if (!session) ranges.push([from, to])
  else {
    let start = from
    const day = (i: number): number => Math.floor(data[i].timestamp / UTC_DAY)
    while (start > 0 && day(start - 1) === day(start)) start--
    while (start <= to) {
      let end = start
      while (end + 1 < data.length && day(end + 1) === day(start)) end++
      ranges.push([start, end])
      start = end + 1
    }
  }
  // Bound total rows across visible sessions; retain the most recent visible groups.
  for (const [start, end] of ranges.slice(-Math.max(1, Math.floor(6000 / rows)))) {
    const left = data[start].timestamp
    const right = data[end + 1]?.timestamp ?? Infinity
    const bars = input.filter(bar => bar.timestamp >= left && bar.timestamp < right)
    const result = buildVolumeProfile(bars, rows, valueArea)
    if (result.profile && result.maxVolume) groups.push({ from: start, to: end, profile: result.profile, maxVolume: result.maxVolume })
  }
  cache.set(owner, { key, source, groups })
  return groups
}

const paintStatus = (ctx: CanvasRenderingContext2D, source?: ProfileSource, fallback = 'Chart candles', parents: KLineData[] = [], width = 1000, height = 40, session = false): void => {
  if (!ctx.fillText) return
  const detailedTimes = new Set(source?.detailedTimestamps ?? [])
  const detailed = parents.filter(bar => detailedTimes.has(bar.timestamp)).length
  let label = source?.unsupported ? 'Volume profile unavailable on this chart type / session interval' :
    source?.state === 'loading' ? 'Chart candles · loading finer data' :
    detailed ? `${parents.length > detailed ? 'Mixed' : 'Finer candles'} ${source?.period?.text ?? ''}` : fallback
  label += ' · OHLCV estimate'
  ctx.save?.()
  ctx.textAlign = session ? 'left' : 'right'
  ctx.font = '11px sans-serif'
  ctx.fillStyle = '#929AA5'
  ctx.fillText(label, session ? 8 : width - 8, Math.max(12, height - 8))
  ctx.restore?.()
}

const makeProfile = (session: boolean): IndicatorTemplate => ({
  name: session ? 'SVP' : 'VRVP',
  shortName: session ? 'Session Volume Profile (UTC)' : 'Volume Profile Visible Range',
  series: IndicatorSeries.Price,
  calcParams: [24, 70, session ? 70 : 30, 0, 1, 1, 0],
  figures: [],
  calc: dataList => dataList.map(() => ({})),
  draw: ({ ctx, kLineDataList: data, indicator, visibleRange, bounding, barSpace, xAxis, yAxis }) => {
    const source = indicator.extendData?.volumeProfile as ProfileSource | undefined
    if (source?.unsupported) { paintStatus(ctx, source, 'Chart candles', [], bounding.width, bounding.height, session); return true }
    const from = Math.max(0, Math.floor(visibleRange.from))
    const to = Math.min(data.length - 1, Math.ceil(visibleRange.to) - 1)
    if (from > to) return true
    const settings = profileSettings(indicator.calcParams, session ? 70 : 30)
    const groups = groupsFor(indicator, data, source, from, to, settings.rows, settings.valueArea, session)
    for (const group of groups) {
      const left = session ? xAxis.convertToPixel(group.from) - barSpace.halfBar : Math.max(0, xAxis.convertToPixel(from))
      const right = session ? xAxis.convertToPixel(group.to) + barSpace.halfBar : bounding.width
      paintProfile(ctx, yAxis, group.profile, group.maxVolume,
        session ? left : bounding.width, (session ? right - left : bounding.width) * settings.width,
        session ? 1 : -1, left, settings.extend ? bounding.width : right, settings)
    }
    paintStatus(ctx, source, 'Chart candles', data.slice(groups[0]?.from ?? from, (groups[groups.length - 1]?.to ?? to) + 1), bounding.width, bounding.height, session)
    return true
  }
})

export const visibleRangeVolumeProfile = makeProfile(false)
export const sessionVolumeProfile = makeProfile(true)
export default [visibleRangeVolumeProfile, sessionVolumeProfile]
