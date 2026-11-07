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

import { OverlayTemplate, OverlayFigure, Coordinate, utils, Overlay } from 'klinecharts'

import { createLabel, valueAt, FONT_FAMILY } from './label'

export type PositionSide = 'longPosition' | 'shortPosition'

export const POSITION_TOOLS = new Set<string>(['longPosition', 'shortPosition'])

const PROFIT = { line: '#089981', fill: 'rgba(8, 153, 129, 0.2)' }
const LOSS = { line: '#f23645', fill: 'rgba(242, 54, 69, 0.2)' }
const ENTRY = '#787b86'

const DEFAULT_BARS = 30
const MIN_WIDTH = 120
const TARGET_SHARE = 0.1
const STOP_SHARE = 0.05

/**
 * The box placed by a single click: [entry, target, stop] in pixels. Width is
 * 30 bars (at least 120px) and heights are a share of the pane, giving a 2:1
 * reward/risk that reads well at any zoom. Long puts the target above.
 */
export function getPositionCoordinates (side: PositionSide, entry: Coordinate, paneHeight: number, barSpace: number): Coordinate[] {
  const right = entry.x + Math.max(MIN_WIDTH, barSpace * DEFAULT_BARS)
  const dir = side === 'longPosition' ? -1 : 1
  return [
    entry,
    { x: right, y: entry.y + dir * paneHeight * TARGET_SHARE },
    { x: right, y: entry.y - dir * paneHeight * STOP_SHARE }
  ]
}

export interface PositionStats {
  targetChange: number
  stopChange: number
  targetPercent: number
  stopPercent: number
  ratio: number
}

export function getPositionStats (entry: number, target: number, stop: number): PositionStats {
  const targetChange = Math.abs(target - entry)
  const stopChange = Math.abs(stop - entry)
  return {
    targetChange,
    stopChange,
    targetPercent: entry === 0 ? 0 : (targetChange / entry) * 100,
    stopPercent: entry === 0 ? 0 : (stopChange / entry) * 100,
    ratio: stopChange === 0 ? 0 : targetChange / stopChange
  }
}

/** Optional risk plan carried in extendData, edited from the object manager. */
export interface PositionRisk {
  accountSize?: number
  riskPercent?: number
}

export const riskOf = (overlay: Pick<Overlay, 'extendData'> | undefined): PositionRisk => {
  const raw = overlay?.extendData?.risk
  const pick = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
  return { accountSize: pick(raw?.accountSize), riskPercent: pick(raw?.riskPercent) }
}

/** Position size implied by risking `riskPercent` of `accountSize` over the stop distance. */
export function positionSize (accountSize: number, riskPercent: number, stopChange: number): number {
  if (!(accountSize > 0) || !(riskPercent > 0) || !(stopChange > 0)) return 0
  return (accountSize * riskPercent / 100) / stopChange
}

function zone (left: number, right: number, y1: number, y2: number, color: string): OverlayFigure {
  return {
    type: 'rect',
    attrs: { x: Math.min(left, right), y: Math.min(y1, y2), width: Math.abs(right - left), height: Math.abs(y2 - y1) },
    styles: { style: 'fill', color }
  }
}

function createPosition (side: PositionSide): OverlayTemplate {
  return {
    name: side,
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ overlay, coordinates, bounding, barSpace, precision, yAxis }) => {
      if (coordinates.length === 0) return []
      const [entry, target, stop] = coordinates.length >= 3
        ? coordinates
        : getPositionCoordinates(side, coordinates[0], bounding.height, barSpace.bar)
      const { points } = overlay
      const entryValue = valueAt(points, 0, entry.y, yAxis)
      const targetValue = valueAt(points, 1, target.y, yAxis)
      const stopValue = valueAt(points, 2, stop.y, yAxis)
      const stats = getPositionStats(entryValue, targetValue, stopValue)
      const price = (v: number): string => utils.formatPrecision(v, precision.price)
      const risk = riskOf(overlay)
      const riskAmount = risk.accountSize !== undefined && risk.riskPercent !== undefined
        ? risk.accountSize * risk.riskPercent / 100
        : 0
      const size = riskAmount > 0 ? positionSize(risk.accountSize!, risk.riskPercent!, stats.stopChange) : 0
      const sizeLabel = size > 0
        ? ` · Size ${utils.formatPrecision(size, 4)} · Risk ${utils.formatPrecision(riskAmount, 2)}`
        : ''
      const left = entry.x
      const right = target.x
      const mid = (left + right) / 2
      const labelAt = (y: number, away: number): { y: number, baseline: 'top' | 'bottom' } =>
        y <= away ? { y: y - 4, baseline: 'bottom' } : { y: y + 4, baseline: 'top' }
      const targetLabel = labelAt(target.y, entry.y)
      const stopLabel = labelAt(stop.y, entry.y)
      const font = { size: 11, family: FONT_FAMILY, padding: 4 }
      return [
        zone(left, right, entry.y, target.y, PROFIT.fill),
        zone(left, right, entry.y, stop.y, LOSS.fill),
        {
          type: 'line',
          attrs: [
            { coordinates: [{ x: left, y: target.y }, { x: right, y: target.y }] }
          ],
          styles: { color: PROFIT.line }
        },
        {
          type: 'line',
          attrs: [
            { coordinates: [{ x: left, y: stop.y }, { x: right, y: stop.y }] }
          ],
          styles: { color: LOSS.line }
        },
        {
          type: 'line',
          attrs: { coordinates: [{ x: left, y: entry.y }, { x: right, y: entry.y }] },
          styles: { color: ENTRY }
        },
        ...createLabel(
          [`Target: ${price(targetValue)} (${stats.targetPercent.toFixed(2)}%) ${price(stats.targetChange)}`],
          { x: mid, y: targetLabel.y }, 'center', targetLabel.baseline,
          { ...font, color: '#ffffff', background: PROFIT.line }
        ).figures,
        ...createLabel(
          [`Stop: ${price(stopValue)} (${stats.stopPercent.toFixed(2)}%) ${price(stats.stopChange)}`],
          { x: mid, y: stopLabel.y }, 'center', stopLabel.baseline,
          { ...font, color: '#ffffff', background: LOSS.line }
        ).figures,
        ...createLabel(
          [`${side === 'longPosition' ? 'Long' : 'Short'} ${price(entryValue)} · R/R ${stats.ratio.toFixed(2)}${sizeLabel}`],
          { x: mid, y: entry.y }, 'center', 'middle',
          { ...font, color: '#ffffff', background: ENTRY }
        ).figures
      ]
    },
    performEventPressedMove: ({ points, performPointIndex, performPoint }) => {
      if (performPointIndex === 0 || points.length < 3) return
      const other = points[performPointIndex === 1 ? 2 : 1]
      other.timestamp = performPoint.timestamp
      other.dataIndex = performPoint.dataIndex
    }
  }
}

export const longPosition = createPosition('longPosition')
export const shortPosition = createPosition('shortPosition')
