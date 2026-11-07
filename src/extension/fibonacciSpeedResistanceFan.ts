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

import { getRayLine } from './utils'
import { fibLevels, isLevelVisible, levelColor, levelStylesOf, showLevelLabels } from './fibLevels'
import type { LineAttrs } from 'klinecharts'

const asArray = (value: LineAttrs | LineAttrs[]): LineAttrs[] => Array.isArray(value) ? value : [value]

const fibonacciSpeedResistanceFan: OverlayTemplate = {
  name: 'fibonacciSpeedResistanceFan',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, bounding, overlay }) => {
    const figures: OverlayFigure[] = []
    if (coordinates.length > 1) {
      const xOffset = coordinates[1].x > coordinates[0].x ? -38 : 4
      const yOffset = coordinates[1].y > coordinates[0].y ? -2 : 20
      const xDistance = coordinates[1].x - coordinates[0].x
      const yDistance = coordinates[1].y - coordinates[0].y
      const percents = fibLevels(overlay, 'fibonacciSpeedResistanceFan')
      const styles = levelStylesOf(overlay)
      const labels = showLevelLabels(overlay)
      percents.forEach(percent => {
        if (!isLevelVisible(styles, percent)) return
        const x = coordinates[1].x - xDistance * percent
        const y = coordinates[1].y - yDistance * percent
        const levelStyle = { color: levelColor(styles, percent) }
        figures.push({
          type: 'line',
          attrs: [
            { coordinates: [{ x, y: coordinates[0].y }, { x, y: coordinates[1].y }] },
            { coordinates: [{ x: coordinates[0].x, y }, { x: coordinates[1].x, y }] },
            ...asArray(getRayLine([coordinates[0], { x, y: coordinates[1].y }], bounding)),
            ...asArray(getRayLine([coordinates[0], { x: coordinates[1].x, y }], bounding))
          ],
          styles: levelStyle
        })
        if (labels) {
          const texts: TextAttrs[] = [
            { x: coordinates[0].x + xOffset, y: y + 10, text: `${percent.toFixed(3)}` },
            { x: x - 18, y: coordinates[0].y + yOffset, text: `${percent.toFixed(3)}` }
          ]
          figures.push({ type: 'text', ignoreEvent: true, attrs: texts, styles: levelStyle })
        }
      })
    }
    return figures
  }
}

export default fibonacciSpeedResistanceFan
