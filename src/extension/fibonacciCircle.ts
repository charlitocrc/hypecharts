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

import { OverlayTemplate, OverlayFigure, PolygonAttrs, TextAttrs } from 'klinecharts'

import { getEllipseCoordinates } from './utils'
import { fibLevels, isLevelVisible, levelColor, levelStylesOf, showLevelLabels } from './fibLevels'

// Rings are polygons for the same reason the circle tool is. See
// getEllipseCoordinates.
const fibonacciCircle: OverlayTemplate = {
  name: 'fibonacciCircle',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, overlay }) => {
    if (coordinates.length > 1) {
      const yDis = Math.abs(coordinates[1].y - coordinates[0].y)
      const percents = fibLevels(overlay, 'fibonacciCircle')
      const styles = levelStylesOf(overlay)
      const labels = showLevelLabels(overlay)
      const figures: OverlayFigure[] = []
      percents.forEach(percent => {
        if (!isLevelVisible(styles, percent)) return
        const color = levelColor(styles, percent)
        const ring: PolygonAttrs = { coordinates: getEllipseCoordinates(coordinates[0], coordinates[1], percent) }
        figures.push({
          type: 'polygon',
          attrs: [ring],
          styles: { style: 'stroke', color }
        })
        if (labels) {
          const text: TextAttrs = {
            x: coordinates[0].x,
            y: coordinates[0].y + yDis * percent + 6,
            text: `${(percent * 100).toFixed(1)}%`
          }
          figures.push({ type: 'text', ignoreEvent: true, attrs: [text], styles: { color } })
        }
      })
      return figures
    }
    return []
  }
}

export default fibonacciCircle
