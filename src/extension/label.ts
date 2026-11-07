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

import { Coordinate, OverlayFigure, Point, utils } from 'klinecharts'

export const FONT_FAMILY = 'Helvetica Neue'

let measureCtx: CanvasRenderingContext2D | null | undefined

/**
 * Canvas text width, with a width estimate where no DOM exists (unit tests).
 * The context is created once; measureText itself is cheap enough to call per
 * frame for the handful of labels a drawing carries.
 */
export function measureText (text: string, size: number, weight: string | number = 'normal', family = FONT_FAMILY): number {
  if (measureCtx === undefined) {
    measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  }
  if (measureCtx === null) return text.length * size * 0.6
  measureCtx.font = `${weight} ${size}px ${family}`
  return measureCtx.measureText(text).width
}

export interface LabelStyle {
  color: string
  background: string
  border?: string
  size?: number
  weight?: string | number
  family?: string
  padding?: number
  radius?: number
}

export interface Box { x: number, y: number, width: number, height: number }

/**
 * A multi-line text block with a background box. `anchor` is placed at the
 * box edge picked by `align`/`baseline`. The box is the hit target so the
 * label selects and drags its drawing; the text itself ignores events.
 */
export function createLabel (
  lines: string[],
  anchor: Coordinate,
  align: 'left' | 'center' | 'right',
  baseline: 'top' | 'middle' | 'bottom',
  style: LabelStyle,
  ignoreEvent = true
): { figures: OverlayFigure[], box: Box } {
  const size = style.size ?? 12
  const weight = style.weight ?? 'normal'
  const family = style.family ?? FONT_FAMILY
  const padding = style.padding ?? 6
  const lineHeight = Math.round(size * 1.35)
  let textWidth = 0
  for (const line of lines) textWidth = Math.max(textWidth, measureText(line, size, weight, family))
  const width = Math.ceil(textWidth) + padding * 2
  const height = lines.length * lineHeight + padding * 2
  const x = align === 'left' ? anchor.x : align === 'right' ? anchor.x - width : anchor.x - width / 2
  const y = baseline === 'top' ? anchor.y : baseline === 'bottom' ? anchor.y - height : anchor.y - height / 2
  const box = { x, y, width, height }
  const textY = y + padding + (lineHeight - size) / 2
  return {
    box,
    figures: [
      {
        type: 'rect',
        ignoreEvent,
        attrs: box,
        styles: {
          style: style.border !== undefined ? 'stroke_fill' : 'fill',
          color: style.background,
          borderColor: style.border ?? style.background,
          borderSize: 1,
          borderRadius: style.radius ?? 3
        }
      },
      {
        type: 'text',
        ignoreEvent: true,
        attrs: lines.map((text, i) => ({ x: x + padding, y: textY + i * lineHeight, text, align: 'left', baseline: 'top' })),
        styles: { color: style.color, size, weight, family }
      }
    ]
  }
}

/** Two short strokes forming an arrow head at `tip`, pointing away from `from`. */
export function arrowHead (from: Coordinate, tip: Coordinate, size = 7): Coordinate[] {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x)
  const spread = Math.PI / 7
  return [
    { x: tip.x - size * Math.cos(angle - spread), y: tip.y - size * Math.sin(angle - spread) },
    tip,
    { x: tip.x - size * Math.cos(angle + spread), y: tip.y - size * Math.sin(angle + spread) }
  ]
}

export function formatDuration (ms: number): string {
  if (Math.abs(ms) < 60000) return `${Math.round(Math.abs(ms) / 1000)}s`
  const minutes = Math.round(Math.abs(ms) / 60000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  return `${mins}m`
}

export function formatSigned (value: number, precision: number): string {
  const text = utils.formatPrecision(Math.abs(value), precision)
  return value < 0 ? `-${text}` : `+${text}`
}

export function formatPercent (change: number, base: number): string {
  if (base === 0) return '—'
  return `${formatSigned((change / base) * 100, 2)}%`
}

export function barsBetween (x1: number, x2: number, barSpace: number): number {
  return barSpace > 0 ? Math.round((x2 - x1) / barSpace) : 0
}

/**
 * Point value, or the axis reading of its pixel while the point is still a
 * preview (drawing in progress, or derived from a default like a position box).
 */
export function valueAt (points: Array<Partial<Point>>, index: number, y: number, yAxis: { convertFromPixel: (y: number) => number } | null): number {
  const value = points[index]?.value
  if (typeof value === 'number') return value
  return yAxis?.convertFromPixel(y) ?? 0
}
