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

import { OverlayTemplate, Coordinate } from 'klinecharts'

/**
 * Freehand tools. klinecharts only builds drawings click by click, so the host
 * captures the drag itself and creates the overlay with every sampled point.
 */
export const FREEHAND_TOOLS = new Set<string>(['brush', 'highlighter'])

/** Pixels the pointer must travel before another point is sampled. */
export const FREEHAND_MIN_STEP = 3

/**
 * Overlay points snap to whole bars, which turns a stroke into a staircase once
 * bars are wider than a few pixels. `dx` keeps each point's offset from its bar
 * centre in bars, so the stroke scales with zoom and survives moves (which
 * shift whole bars).
 */
export function applyBarOffsets (coordinates: Coordinate[], dx: unknown, barSpace: number): Coordinate[] {
  if (!Array.isArray(dx) || dx.length !== coordinates.length) return coordinates
  return coordinates.map((c, i) => ({ x: c.x + (typeof dx[i] === 'number' ? dx[i] * barSpace : 0), y: c.y }))
}

export function shouldSample (last: Coordinate | null, next: Coordinate): boolean {
  return last === null || Math.hypot(next.x - last.x, next.y - last.y) >= FREEHAND_MIN_STEP
}

function createFreehand (name: string, size: number, color: string): OverlayTemplate {
  return {
    name,
    totalStep: 2,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates, barSpace }) => {
      if (coordinates.length < 2) return []
      const path = applyBarOffsets(coordinates, overlay.extendData?.dx, barSpace.bar)
      return [{
        type: 'line',
        attrs: { coordinates: path },
        styles: { color, size, smooth: path.length > 2 }
      }]
    }
  }
}

export const brush = createFreehand('brush', 2, '#2962ff')
export const highlighter = createFreehand('highlighter', 14, 'rgba(255, 213, 0, 0.35)')
