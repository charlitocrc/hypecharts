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

import {
  bandPairs, fibLevels, isLevelVisible, levelColor, levelStylesOf, showBandsOf, showLevelLabels, withAlpha
} from './fibLevels'

const retracement = (name: 'fibonacciSegment' | 'fibonacciLine'): OverlayTemplate => ({
  name,
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, overlay, precision, bounding }) => {
    const figures: OverlayFigure[] = []
    if (coordinates.length > 1) {
      const fullWidth = name === 'fibonacciLine'
      const left = fullWidth ? 0 : Math.min(coordinates[0].x, coordinates[1].x)
      const right = fullWidth ? bounding.width : Math.max(coordinates[0].x, coordinates[1].x)
      const textX = left
      const percents = fibLevels(overlay, name)
      const styles = levelStylesOf(overlay)
      const labels = showLevelLabels(overlay)
      const yOf = (percent: number): number => coordinates[1].y + (coordinates[0].y - coordinates[1].y) * percent
      const points = overlay.points
      // @ts-expect-error
      const valueDif = points[0].value - points[1].value
      // @ts-expect-error
      const priceAt = (percent: number): string => (points[1].value + valueDif * percent).toFixed(precision.price)

      // Filled bands: between adjacent levels, tinted by the outer
      // level's color. Hidden levels remove their adjacent bands.
      if (showBandsOf(overlay)) {
        for (const [outer, inner] of bandPairs(percents)) {
          if (!isLevelVisible(styles, outer) || !isLevelVisible(styles, inner)) continue
          const yOuter = yOf(outer)
          const yInner = yOf(inner)
          figures.push({
            type: 'polygon',
            ignoreEvent: true,
            attrs: [{ coordinates: [
              { x: left, y: yOuter }, { x: right, y: yOuter },
              { x: right, y: yInner }, { x: left, y: yInner }
            ] }],
            styles: { style: 'fill', color: withAlpha(levelColor(styles, outer), 0.1) }
          })
        }
      }

      percents.forEach(percent => {
        if (!isLevelVisible(styles, percent)) return
        const y = yOf(percent)
        const color = levelColor(styles, percent)
        figures.push({
          type: 'line',
          attrs: [{ coordinates: [{ x: left, y }, { x: right, y }] }],
          styles: { color }
        })
        if (labels) {
          const text: TextAttrs = {
            x: textX,
            y,
            text: `${priceAt(percent)} (${(percent * 100).toFixed(1)}%)`,
            baseline: 'bottom'
          }
          figures.push({ type: 'text', ignoreEvent: true, attrs: [text], styles: { color } })
        }
      })
    }
    return figures
  }
})

export const fibonacciLine = retracement('fibonacciLine')
const fibonacciSegment = retracement('fibonacciSegment')

export default fibonacciSegment
