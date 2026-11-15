import { describe, expect, it } from 'vitest'
import type { KLineData } from 'klinecharts'
import { buildVolumeProfile, MAX_PROFILE_ROWS } from './volumeProfile'

const bar = (low: number, high: number, volume: number, up = true): KLineData =>
  ({ timestamp: 0, low, high, open: up ? low : high, close: up ? high : low, volume })
const bins = (volumes: number[]) => [bar(0, volumes.length, 0), ...volumes.map((v, i) => bar(i + 0.5, i + 0.5, v))]

describe('OHLCV profile allocation', () => {
  it('weights price overlap and preserves total and directional volume', () => {
    const { profile } = buildVolumeProfile([bar(0, 10, 100), bar(0, 1, 20, false)], 2)
    expect(profile!.map(row => [row.volume, row.upVolume, row.downVolume])).toEqual([[70, 50, 20], [50, 50, 0]])
    expect(profile!.reduce((sum, row) => sum + row.volume, 0)).toBeCloseTo(120)
  })

  it('does not allocate a boundary-ending candle into the next row', () => {
    const { profile } = buildVolumeProfile([bar(0, 10, 0), bar(0, 5, 20)], 2)
    expect(profile!.map(row => row.volume)).toEqual([20, 0])
  })

  it('allocates flat candles once and produces one meaningful flat-price bin', () => {
    const { profile } = buildVolumeProfile([bar(42, 42, 10)], 24)
    expect(profile).toHaveLength(1)
    expect((profile![0].low + profile![0].high) / 2).toBe(42)
    expect(profile![0]).toMatchObject({ volume: 10, upVolume: 10, downVolume: 0, poc: true })
  })

  it('ignores invalid/missing/negative volume and bounds the row allocation', () => {
    expect(buildVolumeProfile([bar(0, 1, -2), bar(0, 1, NaN), { ...bar(0, 1, 2), open: 3 }])).toEqual({})
    const result = buildVolumeProfile([bar(0, 1, 0)], 1000000)
    expect(result.profile).toHaveLength(MAX_PROFILE_ROWS)
    expect(result.maxVolume).toBe(0)
    expect(result.profile!.some(row => row.poc || row.valueArea)).toBe(false)
  })
})

describe('POC and contiguous value area', () => {
  it('chooses the lower POC on equal volume and stops before target overshoot', () => {
    const { profile } = buildVolumeProfile(bins([20, 50, 30]), 3, 0.7)
    expect(profile!.map(row => row.valueArea)).toEqual([false, true, false])
    const tied = buildVolumeProfile(bins([50, 50]), 2).profile!
    expect(tied.map(row => row.poc)).toEqual([true, false])
  })

  it('breaks adjacent ties by distance to POC, then prefers the upper row', () => {
    const { profile } = buildVolumeProfile(bins([10, 10, 40, 10, 10]), 5, 0.75)
    expect(profile!.map(row => row.valueArea)).toEqual([false, true, true, true, false])
  })

  it('includes every row at 100 percent without losing tiny fractional volume', () => {
    const { profile } = buildVolumeProfile([bar(0, 3, 0.1), bar(1, 2.7, 0.2, false)], 7, 1)
    expect(profile!.every(row => row.valueArea)).toBe(true)
    expect(profile!.reduce((sum, row) => sum + row.volume, 0)).toBeCloseTo(0.3)
  })
})
