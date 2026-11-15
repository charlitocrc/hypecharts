import type { KLineData } from 'klinecharts'

export const MAX_PROFILE_ROWS = 200
export const UTC_DAY = 86_400_000

export interface ProfileRow {
  low: number
  high: number
  volume: number
  upVolume: number
  downVolume: number
  valueArea: boolean
  poc: boolean
}

export interface VolumeProfile {
  profile?: ProfileRow[]
  maxVolume?: number
  totalVolume?: number
  pocPrice?: number
  valueAreaHigh?: number
  valueAreaLow?: number
}

export const validProfileBar = (bar: KLineData): boolean =>
  [bar.timestamp, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) &&
  bar.high >= Math.max(bar.open, bar.close, bar.low) && bar.low <= Math.min(bar.open, bar.close) &&
  (bar.volume ?? -1) >= 0

/** OHLCV estimate, not trade-at-price or aggressor-side volume. */
export function buildVolumeProfile (bars: KLineData[], rowCount = 24, valueAreaPercent = 0.7): VolumeProfile {
  const data = bars.filter(validProfileBar)
  if (data.length === 0) return {}
  let low = Infinity
  let high = -Infinity
  for (const bar of data) { low = Math.min(low, bar.low); high = Math.max(high, bar.high) }
  const count = high === low ? 1 : Math.max(1, Math.min(MAX_PROFILE_ROWS, Math.floor(Number.isFinite(rowCount) ? rowCount : 24)))
  const step = high === low ? Math.max(Math.abs(high) * 0.001, 1e-8) : (high - low) / count
  const profile: ProfileRow[] = Array.from({ length: count }, (_, i) => ({
    low: high === low ? low - step / 2 : low + step * i,
    high: high === low ? high + step / 2 : low + step * (i + 1),
    volume: 0, upVolume: 0, downVolume: 0, valueArea: false, poc: false
  }))
  for (const bar of data) {
    const volume = bar.volume ?? 0
    const range = bar.high - bar.low
    if (range === 0) {
      const row = profile[Math.max(0, Math.min(count - 1, Math.floor((bar.close - low) / step)))]
      row.volume += volume
      row.upVolume += volume // close == open is up, consistently with non-flat bars
      continue
    }
    const first = Math.max(0, Math.min(count - 1, Math.floor((bar.low - low) / step)))
    const last = Math.max(first, Math.min(count - 1, Math.ceil((bar.high - low) / step) - 1))
    let allocated = 0
    for (let i = first; i <= last; i++) {
      const row = profile[i]
      const overlap = Math.max(0, Math.min(bar.high, row.high) - Math.max(bar.low, row.low))
      const share = i === last ? Math.max(0, volume - allocated) : volume * overlap / range
      allocated += share
      row.volume += share
      if (bar.close >= bar.open) row.upVolume += share
      else row.downVolume += share
    }
  }
  let poc = 0
  for (let i = 1; i < count; i++) if (profile[i].volume > profile[poc].volume) poc = i
  const total = profile.reduce((sum, row) => sum + row.volume, 0)
  if (!(total > 0)) return { profile, maxVolume: 0, totalVolume: 0 }
  profile[poc].poc = true
  const fraction = Number.isFinite(valueAreaPercent) ? Math.min(1, Math.max(0, valueAreaPercent)) : 0.7
  const target = total * fraction
  let included = profile[poc].volume
  let areaLow = poc
  let areaHigh = poc
  // Reference rule: choose the larger adjacent row, then nearest POC, then above.
  // Stop before an addition would exceed the requested share (POC is always included).
  while (included < target && (areaLow > 0 || areaHigh < count - 1)) {
    const below = areaLow > 0 ? profile[areaLow - 1].volume : -1
    const above = areaHigh < count - 1 ? profile[areaHigh + 1].volume : -1
    const chooseAbove = above > below || (above === below && areaHigh - poc <= poc - areaLow)
    const next = chooseAbove ? areaHigh + 1 : areaLow - 1
    if (included + profile[next].volume > target + total * 1e-12) break
    included += profile[next].volume
    if (chooseAbove) areaHigh = next
    else areaLow = next
  }
  for (let i = areaLow; i <= areaHigh; i++) profile[i].valueArea = true
  return {
    profile, maxVolume: profile[poc].volume, totalVolume: total,
    pocPrice: (profile[poc].low + profile[poc].high) / 2,
    valueAreaHigh: profile[areaHigh].high, valueAreaLow: profile[areaLow].low
  }
}
