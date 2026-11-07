import { describe, expect, it } from 'vitest'
import type { KLineData } from 'klinecharts'

import * as patterns from './candle-patterns'

const ohlcs = (rows: Array<[number, number, number, number]>): KLineData[] =>
  rows.map(([open, high, low, close], index) => ({
    timestamp: index * 60_000, open, high, low, close, volume: 1
  }))

const fires = (template: { name: string, calc: any, calcParams?: number[] }, rows: Array<[number, number, number, number]>, at: number): boolean => {
  const result = template.calc(rows.map(([open, high, low, close], index) => ({
    timestamp: index * 60_000, open, high, low, close, volume: 1
  })), { ...template, calcParams: template.calcParams ?? [] } as any)
  return result[at].value !== undefined
}

const DECLINE: Array<[number, number, number, number]> = [
  [12.5, 12.9, 12.1, 12.4], [12, 12.4, 11.6, 12], [11.8, 12.2, 11, 11.2], [11, 11.4, 10.4, 10.6], [10, 10.3, 8.8, 10.2]
]
const RISE: Array<[number, number, number, number]> = [
  [7.5, 7.9, 7.1, 7.4], [8, 8.4, 7.6, 8], [8.2, 8.6, 7.8, 8.4], [8.5, 8.9, 8.1, 8.8], [9.4, 9.7, 8.2, 9.6]
]

describe('candle-pattern adversarial probes', () => {
  it('single-bar shapes: positive and near-miss', () => {
    expect(fires(patterns.patternDoji, [[10, 10.1, 9.9, 10]], 0)).toBe(true)
    expect(fires(patterns.patternDoji, [[10, 10.1, 9.9, 10.03]], 0)).toBe(false)
    expect(fires(patterns.patternDragonflyDoji, [[10, 10.05, 9, 10]], 0)).toBe(true)
    expect(fires(patterns.patternDragonflyDoji, [[10, 10.5, 9.5, 10]], 0)).toBe(false)
    expect(fires(patterns.patternGravestoneDoji, [[10, 11, 9.95, 10]], 0)).toBe(true)
    expect(fires(patterns.patternGravestoneDoji, [[10, 10.5, 9.5, 10]], 0)).toBe(false)
    expect(fires(patterns.patternSpinningTopWhite, [[10, 10.6, 9.4, 10.2]], 0)).toBe(true)
    expect(fires(patterns.patternSpinningTopWhite, [[10, 10.6, 9.5, 10.35]], 0)).toBe(false)
    expect(fires(patterns.patternSpinningTopBlack, [[10.5, 11, 10, 10.25]], 0)).toBe(true)
    expect(fires(patterns.patternLongLowerShadow, [[10, 10.2, 9, 10.1]], 0)).toBe(true)
    expect(fires(patterns.patternLongLowerShadow, [[10, 10.2, 9.85, 10.1]], 0)).toBe(false)
    expect(fires(patterns.patternLongUpperShadow, [[9.9, 11.2, 10, 10.1]], 0)).toBe(true)
    expect(fires(patterns.patternMarubozuWhite, [[10, 10.5, 10, 10.5]], 0)).toBe(true)
    expect(fires(patterns.patternMarubozuWhite, [[10, 10.5, 9.96, 10.5]], 0)).toBe(false)
    expect(fires(patterns.patternMarubozuBlack, [[10.5, 10.5, 10, 10]], 0)).toBe(true)
  })

  it('trend-context shapes flip between hammer/inverted and hanging/shooting', () => {
    expect(fires(patterns.patternHammer, DECLINE, 4)).toBe(true)
    expect(fires(patterns.patternHangingMan, DECLINE, 4)).toBe(false)
    expect(fires(patterns.patternInvertedHammer, [[12.5, 12.9, 12.1, 12.4], [12, 12.4, 11.6, 12], [11.8, 12.2, 11, 11.2], [11, 11.4, 10.4, 10.6], [10, 11.4, 9.9, 10.1]], 4)).toBe(true)
    expect(fires(patterns.patternShootingStar, DECLINE, 4)).toBe(false)
    expect(fires(patterns.patternHammer, RISE, 4)).toBe(false)
    expect(fires(patterns.patternHangingMan, RISE, 4)).toBe(true)
    expect(fires(patterns.patternInvertedHammer, RISE, 4)).toBe(false)
    expect(fires(patterns.patternShootingStar, [[7.5, 7.9, 7.1, 7.4], [8, 8.4, 7.6, 8], [8.2, 8.6, 7.8, 8.4], [8.5, 8.9, 8.1, 8.8], [9.4, 11.4, 9.3, 9.6]], 4)).toBe(true)
  })

  it('two-bar reversals: engulfing both, harami family, kicking both, piercing, dark cloud', () => {
    expect(fires(patterns.patternBullishEngulfing, [[10, 10.2, 9.7, 9.8], [9.7, 10.3, 9.6, 10.1]], 1)).toBe(true)
    expect(fires(patterns.patternBullishEngulfing, [[10, 10.2, 9.7, 9.8], [9.8, 10.1, 9.75, 10]], 1)).toBe(false)
    expect(fires(patterns.patternBearishEngulfing, [[9.7, 10.2, 9.6, 10], [10.1, 10.3, 9.55, 9.65]], 1)).toBe(true)
    const haramiBase: Array<[number, number, number, number]> = [[10, 10.2, 9.4, 9.4], [9.45, 9.55, 9.35, 9.45]]
    expect(fires(patterns.patternBullishHarami, [[10, 10.2, 9.4, 9.4], [9.45, 9.5, 9.35, 9.45]], 1)).toBe(false)
    void haramiBase
    expect(fires(patterns.patternBearishHarami, [[9.4, 10.1, 9.4, 10], [9.95, 10.05, 9.5, 9.5]], 1)).toBe(true)
    expect(fires(patterns.patternBullishHaramiCross, [[10, 10.2, 9.4, 9.4], [9.45, 9.55, 9.35, 9.45]], 1)).toBe(true)
    expect(fires(patterns.patternKickingBullish, [[10, 10, 9.99, 9.99], [10.01, 10.015, 10.01, 10.015]], 1)).toBe(true)
    expect(fires(patterns.patternKickingBearish, [[9.99, 10, 9.99, 10], [9.985, 9.985, 9.982, 9.982]], 1)).toBe(true)
    expect(fires(patterns.patternPiercing, [[10, 10.1, 9.6, 9.7], [9.6, 10, 9.5, 9.95]], 1)).toBe(true)
    expect(fires(patterns.patternPiercing, [[10, 10.1, 9.6, 9.7], [9.6, 9.85, 9.55, 9.8]], 1)).toBe(false)
    expect(fires(patterns.patternDarkCloudCover, [[10, 10.4, 9.75, 10.4], [10.5, 10.6, 10.05, 10.1]], 1)).toBe(true)
    expect(fires(patterns.patternDarkCloudCover, [[10, 10.4, 9.75, 10.4], [10.5, 10.6, 10.05, 10.25]], 1)).toBe(false)
  })

  it('gaps and necks', () => {
    expect(fires(patterns.patternRisingWindow, [[10, 10.5, 10.2, 10.4], [10.9, 11.5, 10.9, 11.3]], 1)).toBe(true)
    expect(fires(patterns.patternFallingWindow, [[10, 10.5, 10.2, 10.4], [10.1, 10.15, 9.7, 9.75]], 1)).toBe(true)
    expect(fires(patterns.patternTweezerBottom, [[12, 12.4, 11.6, 12], [11.8, 12.2, 11, 11.2], [10.9, 11.1, 10.4, 10.6], [10.5, 10.7, 9.9, 10.2], [10.2, 10.9, 9.9, 10.8]], 4)).toBe(true)
    expect(fires(patterns.patternTweezerTop, [[8, 8.2, 7.6, 8], [8.2, 8.6, 7.8, 8.4], [8.5, 8.9, 8.1, 8.8], [8.9, 9.3, 8.6, 9.2], [9.25, 9.3, 8.9, 9]], 4)).toBe(true)
    expect(fires(patterns.patternOnNeck, [[12.5, 12.9, 12.1, 12.4], [12, 12.4, 11.6, 12], [11.8, 12.2, 11, 11.2], [11, 11.4, 10.4, 10.6], [10.45, 10.55, 10.38, 10.46]], 4)).toBe(true)
  })

  it('three-bar stars, soldiers, crows, tri stars, tasuki, abandoned babies', () => {
    expect(fires(patterns.patternMorningStar, [[10, 10.2, 9.4, 9.5], [9.35, 9.4, 9.3, 9.32], [9.4, 10.2, 9.3, 9.85]], 2)).toBe(true)
    expect(fires(patterns.patternMorningDojiStar, [[10, 10.2, 9.4, 9.5], [9.35, 9.4, 9.3, 9.32], [9.4, 10.2, 9.3, 9.85]], 2)).toBe(false)
    expect(fires(patterns.patternEveningStar, [[9.5, 10.3, 9.45, 10.2], [10.35, 10.45, 10.33, 10.37], [10.3, 10.4, 9.7, 9.8]], 2)).toBe(true)
    expect(fires(patterns.patternEveningDojiStar, [[9.5, 10.3, 9.45, 10.2], [10.35, 10.45, 10.34, 10.35], [10.3, 10.4, 9.7, 9.8]], 2)).toBe(true)
    expect(fires(patterns.patternThreeWhiteSoldiers, [[10.2, 10.4, 10, 10.3], [10.28, 10.55, 10.25, 10.5], [10.42, 10.75, 10.4, 10.7]], 2)).toBe(true)
    expect(fires(patterns.patternThreeBlackCrows, [[10.4, 10.5, 10, 10.1], [10.3, 10.35, 9.9, 10], [10.05, 10.1, 9.6, 9.7]], 2)).toBe(true)
    expect(fires(patterns.patternTriStarBullish, [[10, 10.1, 9.9, 10], [10.1, 10.2, 10.05, 10.1], [10, 10.1, 9.9, 10]], 2)).toBe(false)
    expect(fires(patterns.patternTriStarBearish, [[10, 10.1, 9.9, 10], [10.1, 10.2, 10.05, 10.1], [10, 10.1, 9.9, 10]], 2)).toBe(true)
    expect(fires(patterns.patternUpsideTasukiGap, [[10, 10.4, 9.9, 10.3], [10.5, 10.9, 10.45, 10.8], [10.7, 10.85, 10.5, 10.6]], 2)).toBe(true)
    expect(fires(patterns.patternDownsideTasukiGap, [[10.6, 10.9, 10.35, 10.4], [10.1, 10.3, 9.9, 10.05], [10.08, 10.3, 9.95, 10.3]], 2)).toBe(true)
    expect(fires(patterns.patternDojiStarBullish, [[12.5, 12.9, 12.1, 12.4], [12, 12.4, 11.6, 12], [11.5, 11.9, 11.1, 11.3], [11, 11.4, 10.9, 11.15], [10.9, 10.95, 10.85, 10.9]], 4)).toBe(true)
    expect(fires(patterns.patternDojiStarBearish, [[7.5, 7.9, 7.1, 7.4], [8, 8.4, 7.6, 8], [8.6, 9, 8.55, 8.95], [9.55, 9.65, 9.5, 9.57], [9.6, 9.7, 9.6, 9.6]], 4)).toBe(true)
    expect(fires(patterns.patternAbandonedBabyBullish, [[12.5, 12.9, 12.1, 12.4], [12, 12.4, 11.6, 12], [11, 11.4, 10.9, 11.2], [10.3, 10.35, 10.25, 10.3], [10.5, 11.3, 10.45, 11.2]], 4)).toBe(true)
    expect(fires(patterns.patternAbandonedBabyBearish, [[7.5, 7.9, 7.1, 7.4], [8, 8.4, 7.6, 8], [8.6, 9, 8.55, 8.95], [9.6, 9.65, 9.55, 9.6], [9.5, 9.5, 9.4, 9.45]], 4)).toBe(true)
  })

  it('five-bar methods both directions', () => {
    expect(fires(patterns.patternRisingThreeMethods, [[10, 11, 9.8, 10.8], [10.45, 10.75, 10.3, 10.33], [10.3, 10.6, 10.15, 10.2], [10.2, 10.5, 10.05, 10.1], [10.1, 11.2, 10.05, 11]], 4)).toBe(true)
    expect(fires(patterns.patternFallingThreeMethods, [[11, 11.2, 10.1, 10.25], [10.3, 10.6, 10.15, 10.35], [10.35, 10.55, 10.2, 10.4], [10.3, 10.5, 10.3, 10.35], [10.3, 10.45, 9.9, 10]], 4)).toBe(true)
  })

  it('never reads out of bounds: every detector runs on 1- and 2-bar inputs', () => {
    const tiny: Array<[number, number, number, number]> = [[10, 10.5, 9.5, 10.2]]
    const two: Array<[number, number, number, number]> = [[10, 10.5, 9.5, 10.2], [10.4, 10.9, 10.3, 10.8]]
    for (const [name, template] of Object.entries(patterns)) {
      if (name === 'default' || !(typeof template === 'object' && template !== null && 'calc' in template)) continue
      expect(() => template.calc(ohlcs(tiny), { ...template, calcParams: [] } as any)).not.toThrow()
      expect(() => template.calc(ohlcs(two), { ...template, calcParams: [] } as any)).not.toThrow()
      void name
    }
  })
})
