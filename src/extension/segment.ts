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

import type { Coordinate, OverlayTemplate } from 'klinecharts'

const linearY = (a: Coordinate, b: Coordinate, x: number): number =>
  a.x === b.x ? a.y : a.y + (x - a.x) * (b.y - a.y) / (b.x - a.x)

/**
 * Trend line — the vendored built-in plus DRAW-003's extend left/right:
 * `extendData.extendLeft`/`extendRight` project the drawn segment to the pane
 * edges. Registering under the built-in's name replaces it.
 */
const segment: OverlayTemplate = {
  name: 'segment',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ overlay, coordinates, bounding }) => {
    if (coordinates.length < 2) return []
    const [first, second] = coordinates
    const extendLeft = overlay.extendData?.extendLeft === true
    const extendRight = overlay.extendData?.extendRight === true
    if (!extendLeft && !extendRight) {
      return [{ type: 'line', attrs: { coordinates } }]
    }
    // A vertical trend line extends across the pane like a ray, not sideways.
    if (first.x === second.x) {
      return [{ type: 'line', attrs: { coordinates: [{ x: first.x, y: 0 }, { x: first.x, y: bounding.height }] } }]
    }
    const left = extendLeft ? { x: 0, y: linearY(first, second, 0) } : first
    const right = extendRight ? { x: bounding.width, y: linearY(first, second, bounding.width) } : second
    return [{ type: 'line', attrs: { coordinates: [left, right] } }]
  }
}

export default segment
