import { describe, expect, it } from 'vitest'
import type { KLineData } from 'klinecharts'

import { alignSeries, fillLeadingGaps, nextCompareColor, normalizeCompareValues } from './compare'

const bar = (timestamp: number, close: number): KLineData =>
  ({ timestamp, open: close, high: close, low: close, close, volume: 1 })

describe('alignSeries (M5 compare)', () => {
  const bars = [bar(1000, 10), bar(3000, 30), bar(5000, 50)]

  it('carries closes forward onto chart timestamps', () => {
    expect(alignSeries([1000, 2000, 3000, 4000, 5000, 6000], bars))
      .toEqual([10, 10, 30, 30, 50, 50])
  })

  it('yields NaN before the series starts', () => {
    expect(alignSeries([500], bars)).toEqual([Number.NaN])
  })

  it('handles an empty compare series', () => {
    expect(alignSeries([1000], [])).toEqual([Number.NaN])
  })
})

describe('normalizeCompareValues (M5 compare)', () => {
  it('pins the first value onto the anchor close', () => {
    const values = normalizeCompareValues([100, 150, 50], 1000)
    expect(values).toEqual([1000, 1500, 500])
  })

  it('returns null while the anchor is not computable', () => {
    expect(normalizeCompareValues([Number.NaN, 3], 1000)).toBeNull()
    expect(normalizeCompareValues([0, 3], 1000)).toBeNull()
  })

  it('passes raw mode through untouched', () => {
    expect(normalizeCompareValues([100, 150], 1000, 'raw')).toEqual([100, 150])
  })

  it('independent mode keeps venue prices (own scale maps them at draw)', () => {
    expect(normalizeCompareValues([100, 150, 50], 1000, 'independent')).toEqual([100, 150, 50])
  })

  it('maps an empty list to empty', () => {
    expect(normalizeCompareValues([], 1000)).toEqual([])
  })
})

describe('fillLeadingGaps (M5 compare, thin 1s seeds)', () => {
  it('pads values before the series start with the first close', () => {
    expect(fillLeadingGaps([Number.NaN, Number.NaN, 30, 31])).toEqual([30, 30, 30, 31])
  })

  it('leaves series without leading gaps untouched', () => {
    expect(fillLeadingGaps([10, Number.NaN, 30])).toEqual([10, Number.NaN, 30])
  })

  it('passes all-NaN and empty lists through', () => {
    expect(fillLeadingGaps([Number.NaN, Number.NaN])).toEqual([Number.NaN, Number.NaN])
    expect(fillLeadingGaps([])).toEqual([])
  })

  it('lets a thin compare seed anchor pinned normalization', () => {
    // Chart has 5 one-second bars; the compare trade seed only covers the tail.
    const aligned = fillLeadingGaps(alignSeries(
      [1000, 2000, 3000, 4000, 5000],
      [bar(3000, 60), bar(4000, 66)]
    ))
    const pinned = normalizeCompareValues(aligned, 1000)
    expect(pinned).not.toBeNull()
    pinned!.forEach((value, index) => {
      expect(value).toBeCloseTo(index < 3 ? 1000 : 1100, 6)
    })
  })
})

describe('nextCompareColor', () => {
  it('rotates through the palette skipping taken colors', () => {
    expect(nextCompareColor([])).toBe('#f0a020')
    expect(nextCompareColor(['#f0a020'])).toBe('#9b59b6')
    expect(nextCompareColor(['#f0a020', '#9b59b6', '#e91e63', '#00bcd4', '#8bc34a', '#ff7043']))
      .toBe('#f0a020')
  })
})
