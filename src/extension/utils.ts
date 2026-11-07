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

import { Coordinate, Bounding, LineAttrs, utils } from 'klinecharts'

export function getRotateCoordinate (coordinate: Coordinate, targetCoordinate: Coordinate, angle: number): Coordinate {
  const x = (coordinate.x - targetCoordinate.x) * Math.cos(angle) - (coordinate.y - targetCoordinate.y) * Math.sin(angle) + targetCoordinate.x
  const y = (coordinate.x - targetCoordinate.x) * Math.sin(angle) + (coordinate.y - targetCoordinate.y) * Math.cos(angle) + targetCoordinate.y
  return { x, y }
}

export function getRayLine (coordinates: Coordinate[], bounding: Bounding): LineAttrs | LineAttrs[] {
  if (coordinates.length > 1) {
    let coordinate: Coordinate
    if (coordinates[0].x === coordinates[1].x && coordinates[0].y !== coordinates[1].y) {
      if (coordinates[0].y < coordinates[1].y) {
        coordinate = {
          x: coordinates[0].x,
          y: bounding.height
        }
      } else {
        coordinate = {
          x: coordinates[0].x,
          y: 0
        }
      }
    } else if (coordinates[0].x > coordinates[1].x) {
      coordinate = {
        x: 0,
        y: utils.getLinearYFromCoordinates(coordinates[0], coordinates[1], { x: 0, y: coordinates[0].y })
      }
    } else {
      coordinate = {
        x: bounding.width,
        y: utils.getLinearYFromCoordinates(coordinates[0], coordinates[1], { x: bounding.width, y: coordinates[0].y })
      }
    }
    return { coordinates: [coordinates[0], coordinate] }
  }
  return []
}

export function getDistance (coordinate1: Coordinate, coordinate2: Coordinate,): number {
  const xDis = Math.abs(coordinate1.x - coordinate2.x)
  const yDis = Math.abs(coordinate1.y - coordinate2.y)
  return Math.sqrt(xDis * xDis + yDis * yDis)
}

/**
 * Points of the ellipse centred on `center` whose semi-axes reach `corner`.
 *
 * A round shape anchored to two chart points cannot stay a circle: the axes
 * carry different units and rescale independently, so a single pixel radius
 * derived from both (Math.hypot of the two gaps) changes whenever either axis
 * changes and stops covering the candles and prices it was drawn over. Keeping
 * the horizontal and vertical extents separate lets each follow its own axis,
 * which is what holds the shape in place.
 *
 * `scale` multiplies both semi-axes, for concentric rings.
 */
export function getEllipseCoordinates (center: Coordinate, corner: Coordinate, scale = 1): Coordinate[] {
  const rx = Math.abs(corner.x - center.x) * scale
  const ry = Math.abs(corner.y - center.y) * scale
  // A regular n-gon inscribed in a curve of radius r sits up to about
  // r * PI^2 / (2 * n^2) inside it, so n = PI * sqrt(r) keeps that under half a
  // pixel at any size worth drawing.
  // Rounded up to a multiple of four so a vertex lands on each semi-axis and
  // the shape touches the exact price and time it was anchored to.
  const segments = Math.ceil(Math.min(360, Math.max(24, Math.PI * Math.sqrt(Math.max(rx, ry)))) / 4) * 4
  const coordinates: Coordinate[] = []
  for (let i = 0; i < segments; i++) {
    const angle = i / segments * Math.PI * 2
    coordinates.push({
      x: center.x + rx * Math.cos(angle),
      y: center.y + ry * Math.sin(angle)
    })
  }
  return coordinates
}