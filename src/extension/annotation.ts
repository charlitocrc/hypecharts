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

import { OverlayTemplate, OverlayFigure, Overlay, Coordinate, utils } from 'klinecharts'

import { createLabel, valueAt, Box, FONT_FAMILY } from './label'

/** Drawings whose content is user text, kept in `extendData.text`. */
export const TEXT_TOOLS = new Set<string>(['text', 'note', 'callout'])

/** DRAW-003: where the text tool's label sits relative to its anchor point. */
export type LabelAlign = 'left' | 'center' | 'right'
export type LabelBaseline = 'top' | 'middle' | 'bottom'
export const labelAlignOf = (overlay: Overlay): LabelAlign => {
  const align = overlay.extendData?.align
  return align === 'center' || align === 'right' ? align : 'left'
}
export const labelBaselineOf = (overlay: Overlay): LabelBaseline => {
  const baseline = overlay.extendData?.baseline
  return baseline === 'middle' || baseline === 'bottom' ? baseline : 'top'
}

const ACCENT = '#2962ff'
const PLACEHOLDER = 'Text'
const BUBBLE = { size: 13, family: FONT_FAMILY, padding: 6, color: '#ffffff', background: ACCENT, radius: 4 }

export function getText (overlay: Pick<Overlay, 'extendData'>): string {
  const text = overlay.extendData?.text
  return typeof text === 'string' ? text : ''
}

function textLines (overlay: Overlay): string[] {
  const text = getText(overlay)
  return text.trim() === '' ? [PLACEHOLDER] : text.split('\n')
}

/**
 * A speech-bubble pointer: a triangle from the box centre to `tip`, with a
 * base 12px wide across the pointing direction. Drawn under the box, so only
 * the part outside the box shows.
 */
export function bubblePointer (box: Box, tip: Coordinate, base = 12): Coordinate[] {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const dx = tip.x - cx
  const dy = tip.y - cy
  const length = Math.hypot(dx, dy) || 1
  const nx = -dy / length * base / 2
  const ny = dx / length * base / 2
  return [{ x: cx + nx, y: cy + ny }, tip, { x: cx - nx, y: cy - ny }]
}

function pointer (box: Box, tip: Coordinate): OverlayFigure {
  return {
    type: 'polygon',
    attrs: { coordinates: bubblePointer(box, tip) },
    styles: { style: 'fill', color: ACCENT }
  }
}

const base = {
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false
}

export const text: OverlayTemplate = {
  ...base,
  name: 'text',
  totalStep: 2,
  createPointFigures: ({ overlay, coordinates }) => {
    if (coordinates.length === 0) return []
    const empty = getText(overlay).trim() === ''
    return createLabel(textLines(overlay), coordinates[0], labelAlignOf(overlay), labelBaselineOf(overlay), {
      size: 14,
      family: FONT_FAMILY,
      padding: 2,
      color: empty ? '#787b86' : ACCENT,
      background: 'rgba(0, 0, 0, 0)'
    }, false).figures
  }
}

export const note: OverlayTemplate = {
  ...base,
  name: 'note',
  totalStep: 2,
  createPointFigures: ({ overlay, coordinates }) => {
    if (coordinates.length === 0) return []
    const { x, y } = coordinates[0]
    const label = createLabel(textLines(overlay), { x, y: y - 26 }, 'center', 'bottom', BUBBLE, false)
    return [
      { type: 'line', attrs: { coordinates: [{ x, y }, { x, y: y - 10 }] }, styles: { color: ACCENT, size: 2 } },
      { type: 'circle', attrs: { x, y: y - 16, r: 6 }, styles: { style: 'fill', color: ACCENT } },
      ...label.figures
    ]
  }
}

export const callout: OverlayTemplate = {
  ...base,
  name: 'callout',
  totalStep: 3,
  createPointFigures: ({ overlay, coordinates }) => {
    if (coordinates.length < 2) return []
    const [tip, center] = coordinates
    const label = createLabel(textLines(overlay), center, 'center', 'middle', BUBBLE, false)
    return [pointer(label.box, tip), ...label.figures]
  }
}

export const priceLabel: OverlayTemplate = {
  ...base,
  name: 'priceLabel',
  totalStep: 2,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ overlay, coordinates, precision, yAxis }) => {
    if (coordinates.length === 0) return []
    const tip = coordinates[0]
    const value = valueAt(overlay.points, 0, tip.y, yAxis)
    const label = createLabel([utils.formatPrecision(value, precision.price)], { x: tip.x + 8, y: tip.y - 12 }, 'left', 'bottom', BUBBLE, false)
    return [pointer(label.box, tip), ...label.figures]
  }
}
