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

import { OverlayTemplate, OverlayFigure, TextAttrs } from 'klinecharts'

import { fibLevels, isLevelVisible, levelColor, levelStylesOf, showLevelLabels } from './fibLevels'

const fibonacciExtension: OverlayTemplate = {
  name: 'fibonacciExtension',
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, overlay, precision }) => {
    const figures: OverlayFigure[] = []
    if (coordinates.length > 2) {
      const points = overlay.points
      // @ts-expect-error
      const valueDif = points[1].value - points[0].value
      const yDif = coordinates[1].y - coordinates[0].y
      const percents = fibLevels(overlay, 'fibonacciExtension')
      const styles = levelStylesOf(overlay)
      const labels = showLevelLabels(overlay)
      const textX = coordinates[2].x > coordinates[1].x ? coordinates[1].x : coordinates[2].x
      percents.forEach(percent => {
        if (!isLevelVisible(styles, percent)) return
        const y = coordinates[2].y + yDif * percent
        // @ts-expect-error
        const price = (points[2].value + valueDif * percent).toFixed(precision.price)
        const color = levelColor(styles, percent)
        figures.push({
          type: 'line',
          attrs: [{ coordinates: [{ x: coordinates[1].x, y }, { x: coordinates[2].x, y }] }],
          styles: { color }
        })
        if (labels) {
          const text: TextAttrs = {
            x: textX,
            y,
            text: `${price} (${(percent * 100).toFixed(1)}%)`,
            baseline: 'bottom'
          }
          figures.push({ type: 'text', ignoreEvent: true, attrs: [text], styles: { color } })
        }
      })
    }
    figures.unshift({
      type: 'line',
      attrs: { coordinates },
      styles: { style: 'dashed' }
    })
    return figures
  }
}

export default fibonacciExtension
