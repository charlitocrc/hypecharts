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

import { OverlayTemplate, OverlayFigure, Coordinate, OverlayCreateFiguresCallbackParams } from 'klinecharts'

import { createLabel, arrowHead, formatDuration, formatSigned, formatPercent, barsBetween, valueAt, FONT_FAMILY } from './label'

const UP = { line: '#2962ff', fill: 'rgba(41, 98, 255, 0.15)', label: 'rgba(41, 98, 255, 0.9)' }
const DOWN = { line: '#f23645', fill: 'rgba(242, 54, 69, 0.15)', label: 'rgba(242, 54, 69, 0.9)' }
const LABEL_FONT = { size: 12, family: FONT_FAMILY, padding: 6, color: '#ffffff' }

export interface Measurement {
  change: number
  percent: string
  bars: number
  duration: string | null
  up: boolean
}

/** Price change, % change, bar count and elapsed time between two points. */
export function measure (
  from: Coordinate, to: Coordinate,
  fromValue: number, toValue: number,
  fromTime: number | undefined, toTime: number | undefined,
  barSpace: number
): Measurement {
  const change = toValue - fromValue
  return {
    change,
    percent: formatPercent(change, fromValue),
    bars: barsBetween(from.x, to.x, barSpace),
    duration: typeof fromTime === 'number' && typeof toTime === 'number' ? formatDuration(toTime - fromTime) : null,
    up: change >= 0
  }
}

function read (params: OverlayCreateFiguresCallbackParams): { from: Coordinate, to: Coordinate, m: Measurement } | null {
  const { overlay, coordinates, barSpace, yAxis } = params
  if (coordinates.length < 2) return null
  const [from, to] = coordinates
  const m = measure(
    from, to,
    valueAt(overlay.points, 0, from.y, yAxis), valueAt(overlay.points, 1, to.y, yAxis),
    overlay.points[0]?.timestamp, overlay.points[1]?.timestamp,
    barSpace.bar
  )
  return { from, to, m }
}

function priceText (m: Measurement, precision: number): string {
  return `${formatSigned(m.change, precision)} (${m.percent})`
}

function timeText (m: Measurement): string {
  return m.duration === null ? `${m.bars} bars` : `${m.bars} bars, ${m.duration}`
}

function labelBelow (lines: string[], x: number, edgeY: number, otherY: number, color: string): OverlayFigure[] {
  const below = edgeY >= otherY
  return createLabel(lines, { x, y: edgeY + (below ? 8 : -8) }, 'center', below ? 'top' : 'bottom', { ...LABEL_FONT, background: color }).figures
}

function box (from: Coordinate, to: Coordinate, fill: string): OverlayFigure {
  return {
    type: 'rect',
    attrs: { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) },
    styles: { style: 'fill', color: fill }
  }
}

function arrow (from: Coordinate, to: Coordinate, color: string): OverlayFigure {
  return {
    type: 'line',
    attrs: [{ coordinates: [from, to] }, { coordinates: arrowHead(from, to) }],
    styles: { color }
  }
}

const base = {
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true
}

export const priceRange: OverlayTemplate = {
  ...base,
  name: 'priceRange',
  createPointFigures: params => {
    const r = read(params)
    if (r === null) return []
    const { from, to, m } = r
    const c = m.up ? UP : DOWN
    const midX = (from.x + to.x) / 2
    return [
      box(from, to, c.fill),
      {
        type: 'line',
        attrs: [
          { coordinates: [{ x: from.x, y: from.y }, { x: to.x, y: from.y }] },
          { coordinates: [{ x: from.x, y: to.y }, { x: to.x, y: to.y }] }
        ],
        styles: { color: c.line }
      },
      arrow({ x: midX, y: from.y }, { x: midX, y: to.y }, c.line),
      ...labelBelow([priceText(m, params.precision.price)], midX, to.y, from.y, c.label)
    ]
  }
}

export const dateRange: OverlayTemplate = {
  ...base,
  name: 'dateRange',
  createPointFigures: params => {
    const r = read(params)
    if (r === null) return []
    const { from, to, m } = r
    const midY = (from.y + to.y) / 2
    return [
      box(from, to, UP.fill),
      {
        type: 'line',
        attrs: [
          { coordinates: [{ x: from.x, y: from.y }, { x: from.x, y: to.y }] },
          { coordinates: [{ x: to.x, y: from.y }, { x: to.x, y: to.y }] }
        ],
        styles: { color: UP.line }
      },
      arrow({ x: from.x, y: midY }, { x: to.x, y: midY }, UP.line),
      ...labelBelow([timeText(m)], (from.x + to.x) / 2, Math.max(from.y, to.y), Math.min(from.y, to.y), UP.label)
    ]
  }
}

function datePriceFigures (params: OverlayCreateFiguresCallbackParams): OverlayFigure[] {
  const r = read(params)
  if (r === null) return []
  const { from, to, m } = r
  const c = m.up ? UP : DOWN
  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2
  return [
    box(from, to, c.fill),
    arrow({ x: midX, y: from.y }, { x: midX, y: to.y }, c.line),
    arrow({ x: from.x, y: midY }, { x: to.x, y: midY }, c.line),
    ...labelBelow([priceText(m, params.precision.price), timeText(m)], midX, to.y, from.y, c.label)
  ]
}

export const datePriceRange: OverlayTemplate = { ...base, name: 'datePriceRange', createPointFigures: datePriceFigures }

/** Same read-out as datePriceRange; the host treats it as temporary and never stores it. */
export const measureTool: OverlayTemplate = { ...base, name: 'measure', createPointFigures: datePriceFigures }

export const infoLine: OverlayTemplate = {
  ...base,
  name: 'infoLine',
  createPointFigures: params => {
    const r = read(params)
    if (r === null) return []
    const { from, to, m } = r
    const angle = Math.atan2(from.y - to.y, to.x - from.x) * 180 / Math.PI
    const right = to.x >= from.x
    return [
      { type: 'line', attrs: { coordinates: [from, to] } },
      ...createLabel(
        [priceText(m, params.precision.price), timeText(m), `${angle.toFixed(1)}°`],
        { x: to.x + (right ? 10 : -10), y: to.y },
        right ? 'left' : 'right', 'middle',
        { ...LABEL_FONT, background: UP.label }
      ).figures
    ]
  }
}
