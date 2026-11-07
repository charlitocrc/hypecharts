import { describe, expect, it } from 'vitest'

import { getPitchfork } from './pitchfork'

const bounding = { width: 1000, height: 500, left: 0, right: 0, top: 0, bottom: 0 }
type P = { x: number, y: number }
const slope = (a: P, b: P): number => (b.y - a.y) / (b.x - a.x)

describe('pitchfork', () => {
  const p0 = { x: 100, y: 300 }
  const p1 = { x: 300, y: 100 }
  const p2 = { x: 400, y: 300 }

  it('previews the pivot leg while placing the second point', () => {
    expect(getPitchfork([p0, p1], bounding)).toEqual({ legs: [{ coordinates: [p0, p1] }], median: null, spine: null, tines: [] })
    expect(getPitchfork([p0], bounding).legs).toEqual([])
  })

  it('draws a median plus 0.5 and 1 pairs, all parallel, starting on the handle', () => {
    const { legs, spine, tines } = getPitchfork([p0, p1, p2], bounding)
    expect(legs).toEqual([{ coordinates: [p0, p1] }, { coordinates: [p1, p2] }])
    expect(spine!.coordinates[0]).toEqual({ x: 350, y: 200 })
    const k = slope(p0, { x: 350, y: 200 })
    expect(slope(spine!.coordinates[0], spine!.coordinates[1])).toBeCloseTo(k)
    expect(tines).toHaveLength(2)
    expect(tines.map(([a, b]) => [a.coordinates[0], b.coordinates[0]])).toEqual([
      [{ x: 325, y: 150 }, { x: 375, y: 250 }],
      [p1, p2]
    ])
    for (const line of tines.flat()) {
      expect(slope(line.coordinates[0], line.coordinates[1])).toBeCloseTo(k)
      expect(line.coordinates[1].x).toBe(1000)
    }
  })

  it.each([
    ['pitchfork', { x: 100, y: 400 }, -0.8],
    ['schiffPitchfork', { x: 100, y: 250 }, -0.2],
    ['modifiedSchiffPitchfork', { x: 200, y: 250 }, -1 / 3],
    ['insidePitchfork', { x: 350, y: 200 }, 0.25]
  ] as const)('%s starts the median at its origin and keeps every tine parallel', (variant, start, k) => {
    const { median, spine, tines } = getPitchfork([{ x: 100, y: 400 }, p1, p2], bounding, variant)
    expect(median!.coordinates[0]).toEqual(start)
    expect(median!.coordinates[1]).toEqual(spine!.coordinates[1])
    expect(spine!.coordinates[0]).toEqual({ x: 350, y: 200 })
    for (const line of [median!, ...tines.flat()]) {
      expect(slope(line.coordinates[0], line.coordinates[1])).toBeCloseTo(k)
    }
    expect(tines[1].map(l => l.coordinates[0])).toEqual([p1, p2])
  })

  it('extends leftward when the handle sits before the pivot', () => {
    const { spine, tines } = getPitchfork([{ x: 800, y: 250 }, { x: 500, y: 100 }, { x: 500, y: 400 }], bounding)
    expect([spine!, ...tines.flat()].map(l => l.coordinates[1].x)).toEqual([0, 0, 0, 0, 0])
  })

  it('handles vertical medians and collapsed input without NaN', () => {
    const vertical = getPitchfork([{ x: 500, y: 400 }, { x: 400, y: 100 }, { x: 600, y: 100 }], bounding)
    expect(vertical.spine!.coordinates[1]).toEqual({ x: 500, y: 0 })
    const collapsed = getPitchfork([{ x: 350, y: 200 }, p1, p2], bounding)
    expect(collapsed.spine).toBeNull()
    expect(collapsed.tines).toEqual([])
  })
})
