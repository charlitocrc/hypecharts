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

import { OverlayTemplate } from 'klinecharts'

import { getEllipseCoordinates } from './utils'

// Drawn as a polygon rather than the built-in circle figure: the circle figure
// takes one pixel radius, and one radius cannot track two axes that rescale
// independently. See getEllipseCoordinates.
const circle: OverlayTemplate = {
  name: 'circle',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  styles: {
    polygon: {
      color: 'rgba(22, 119, 255, 0.15)'
    }
  },
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length > 1) {
      return {
        type: 'polygon',
        attrs: { coordinates: getEllipseCoordinates(coordinates[0], coordinates[1]) },
        styles: { style: 'stroke_fill' }
      }
    }
    return []
  }
}

export default circle
