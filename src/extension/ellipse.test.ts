import { describe, expect, it } from 'vitest'

import { getEllipseCoordinates } from './utils'

const center = { x: 400, y: 200 }

function extents (points: Array<{ x: number, y: number }>): { x: number, y: number } {
  return {
    x: Math.max(...points.map(p => Math.abs(p.x - center.x))),
    y: Math.max(...points.map(p => Math.abs(p.y - center.y)))
  }
}

describe('round overlays', () => {
  it('reaches exactly the point it was anchored to on each axis', () => {
    const corner = { x: 520, y: 150 }
    expect(extents(getEllipseCoordinates(center, corner))).toEqual({ x: 120, y: 50 })
  })

  // The whole point of the change: rescaling the price axis must not touch the
  // shape's time extent, and zooming must not touch its price extent. A single
  // pixel radius taken from both gaps at once fails this, which is what made a
  // circle wander off the candles it was drawn over.
  it('follows each axis independently when the other is rescaled', () => {
    const corner = { x: 520, y: 150 }
    const before = extents(getEllipseCoordinates(center, corner))

    const priceRescaled = { x: corner.x, y: center.y + (corner.y - center.y) * 3 }
    expect(extents(getEllipseCoordinates(center, priceRescaled))).toEqual({ x: before.x, y: before.y * 3 })

    const zoomed = { x: center.x + (corner.x - center.x) * 0.25, y: corner.y }
    expect(extents(getEllipseCoordinates(center, zoomed))).toEqual({ x: before.x * 0.25, y: before.y })
  })

  it('scales concentric rings without moving the centre', () => {
    const corner = { x: 500, y: 300 }
    const half = getEllipseCoordinates(center, corner, 0.5)
    expect(extents(half)).toEqual({ x: 50, y: 50 })
    expect(getEllipseCoordinates(center, corner, 0)).toSatisfy(
      (points: Array<{ x: number, y: number }>) => points.every(p => p.x === center.x && p.y === center.y)
    )
  })

  it('stays within half a pixel of the true curve at any size', () => {
    for (const r of [10, 120, 800]) {
      const points = getEllipseCoordinates(center, { x: center.x + r, y: center.y + r })
      // Worst error is at a segment midpoint, so measure the chord midpoints.
      const sagitta = points.map((p, i) => {
        const next = points[(i + 1) % points.length]
        const mid = { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 }
        return r - Math.hypot(mid.x - center.x, mid.y - center.y)
      })
      expect(Math.max(...sagitta)).toBeLessThan(0.5)
    }
  })
})
