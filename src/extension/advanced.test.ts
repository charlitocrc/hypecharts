import { describe, expect, it } from 'vitest'

import advancedOverlays, { fibonacciTimeZoneXs, getFibonacciChannel } from './advanced'
import {
  anchoredVwapData, barsPatternData, regressionChannelData, volumeProfileData
} from './derived'
import derivedOverlays from './derived'

const candle = (close: number, volume = 1, timestamp = close): any => ({
  timestamp, open: close, high: close + 1, low: close - 1, close, volume
})

describe('advanced geometry drawings', () => {
  it('registers every requested advanced overlay under a unique name', () => {
    const names = [...advancedOverlays, ...derivedOverlays].map(overlay => overlay.name)
    expect(names).toHaveLength(12)
    expect(new Set(names).size).toBe(names.length)
  })

  it('builds parallel Fibonacci channel levels through the third anchor', () => {
    const geometry = getFibonacciChannel([{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 20 }])
    expect(geometry.lines).toHaveLength(8)
    expect(geometry.lines[0].coordinates).toEqual([{ x: 0, y: 10 }, { x: 10, y: 0 }])
    expect(geometry.lines[6].coordinates).toEqual([{ x: 0, y: 20 }, { x: 10, y: 10 }])
    expect(geometry.fills).toHaveLength(7)
  })

  it('places Fibonacci time zones at Fibonacci multiples of the selected interval', () => {
    expect(fibonacciTimeZoneXs(10, 5, 40)).toEqual([
      { x: 10, level: 0 }, { x: 15, level: 1 }, { x: 20, level: 2 },
      { x: 25, level: 3 }, { x: 35, level: 5 }
    ])
  })
})

describe('data-aware drawings', () => {
  it('calculates anchored HLC3 VWAP from the selected candle onward', () => {
    const result = anchoredVwapData([candle(10, 1, 1), candle(20, 3, 2)], { timestamp: 1 })
    expect(result.series).toEqual([{ dataIndex: 0, value: 10 }, { dataIndex: 1, value: 17.5 }])
  })

  it('fits a zero-width regression channel to a straight line', () => {
    const result = regressionChannelData(
      [candle(1), candle(2), candle(3), candle(4)],
      [{ dataIndex: 0 }, { dataIndex: 3 }]
    )
    expect(result.series).toEqual([{ dataIndex: 0, value: 1 }, { dataIndex: 3, value: 4 }])
    expect(result.upper).toEqual(result.series)
    expect(result.lower).toEqual(result.series)
  })

  it('creates a 70% contiguous value area around the volume-profile POC', () => {
    const data = [candle(1, 1), candle(2, 10), candle(3, 2)]
    const result = volumeProfileData(data, [{ dataIndex: 0 }, { dataIndex: 2 }], 3, 0.7)
    const profile = result.profile!
    expect(profile).toHaveLength(3)
    expect(profile.reduce((sum, row) => sum + row.volume, 0)).toBeCloseTo(13)
    expect(profile.filter(row => row.poc)).toHaveLength(1)
    expect(profile.find(row => row.poc)?.valueArea).toBe(true)
  })

  it('copies closes into a projected bars pattern at the selected target', () => {
    const result = barsPatternData(
      [candle(10), candle(12), candle(11), candle(20), candle(21)],
      [{ dataIndex: 0 }, { dataIndex: 2 }, { dataIndex: 7, value: 30 }]
    )
    expect(result.series).toEqual([
      { dataIndex: 7, value: 30 }, { dataIndex: 8, value: 32 }, { dataIndex: 9, value: 31 }
    ])
    expect(result.bars?.[0]).toEqual({ dataIndex: 7, open: 30, high: 31, low: 29, close: 30 })
  })
})
