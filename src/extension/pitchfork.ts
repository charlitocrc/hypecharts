/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { OverlayTemplate, OverlayFigure, Coordinate, Bounding, LineAttrs } from 'klinecharts'

import { getRayLine } from './utils'

const MEDIAN_COLOR = '#f23645'

export const PITCHFORK_LEVELS = [
  { value: 0.5, color: '#089981', fill: 'rgba(8, 153, 129, 0.12)' },
  { value: 1, color: '#2962ff', fill: 'rgba(41, 98, 255, 0.12)' }
]

export type PitchforkVariant = 'pitchfork' | 'schiffPitchfork' | 'modifiedSchiffPitchfork' | 'insidePitchfork'

export interface PitchforkGeometry {
  legs: LineAttrs[]
  median: LineAttrs | null
  spine: LineAttrs | null
  tines: Array<[LineAttrs, LineAttrs]>
}

/**
 * Where the median starts and which point sets its slope. M is the handle
 * midpoint. Andrews: P0 -> M. Schiff: (P0.x, mid price of P0-P1) -> M.
 * Modified Schiff: mid(P0, P1) -> M. Inside: slope of mid(P0, P1) -> P2, but
 * the median itself is drawn from M, since from its origin it would coincide
 * with the P2 tine.
 */
function getOrigin (variant: PitchforkVariant, p0: Coordinate, p1: Coordinate): Coordinate {
  switch (variant) {
    case 'pitchfork': return p0
    case 'schiffPitchfork': return { x: p0.x, y: (p0.y + p1.y) / 2 }
    default: return { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
  }
}

/**
 * Every tine is parallel to the median. Level k starts at M + k * (P1 - M) and
 * M + k * (P2 - M), so k = 1 passes through the handle ends. `spine` is the
 * median starting at M, the inner edge of the first fill. `legs` are
 * P0 -> P1 and the handle P1 -> P2.
 */
export function getPitchfork (coordinates: Coordinate[], bounding: Bounding, variant: PitchforkVariant = 'pitchfork'): PitchforkGeometry {
  const geometry: PitchforkGeometry = { legs: [], median: null, spine: null, tines: [] }
  if (coordinates.length < 2) return geometry
  const [p0, p1, p2] = coordinates
  geometry.legs.push({ coordinates: [p0, p1] })
  if (p2 === undefined) return geometry
  geometry.legs.push({ coordinates: [p1, p2] })
  const mx = (p1.x + p2.x) / 2
  const my = (p1.y + p2.y) / 2
  const origin = getOrigin(variant, p0, p1)
  const target = variant === 'insidePitchfork' ? p2 : { x: mx, y: my }
  const dx = target.x - origin.x
  const dy = target.y - origin.y
  if (dx === 0 && dy === 0) return geometry
  const ray = (x: number, y: number): LineAttrs => getRayLine([{ x, y }, { x: x + dx, y: y + dy }], bounding) as LineAttrs
  const spine = ray(mx, my)
  geometry.spine = spine
  geometry.median = variant === 'insidePitchfork' ? spine : { coordinates: [origin, spine.coordinates[1]] }
  for (const { value } of PITCHFORK_LEVELS) {
    geometry.tines.push([
      ray(mx + (p1.x - mx) * value, my + (p1.y - my) * value),
      ray(mx + (p2.x - mx) * value, my + (p2.y - my) * value)
    ])
  }
  return geometry
}

function createPitchfork (name: PitchforkVariant): OverlayTemplate {
  return {
    name,
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding }) => {
      const { legs, median, spine, tines } = getPitchfork(coordinates, bounding, name)
      const figures: OverlayFigure[] = []
      if (spine !== null && median !== null) {
        let inner: [LineAttrs, LineAttrs] = [spine, spine]
        tines.forEach((outer, i) => {
          for (let side = 0; side < 2; side++) {
            const a = inner[side].coordinates
            const b = outer[side].coordinates
            figures.push({
              type: 'polygon',
              ignoreEvent: true,
              attrs: { coordinates: [a[0], a[1], b[1], b[0]] },
              styles: { style: 'fill', color: PITCHFORK_LEVELS[i].fill }
            })
          }
          inner = outer
        })
        legs.push(median)
        tines.forEach((pair, i) => {
          figures.push({ type: 'line', attrs: pair, styles: { color: PITCHFORK_LEVELS[i].color } })
        })
      }
      figures.push({ type: 'line', attrs: legs, styles: { color: MEDIAN_COLOR } })
      return figures
    }
  }
}

export const pitchfork = createPitchfork('pitchfork')
export const schiffPitchfork = createPitchfork('schiffPitchfork')
export const modifiedSchiffPitchfork = createPitchfork('modifiedSchiffPitchfork')
export const insidePitchfork = createPitchfork('insidePitchfork')
