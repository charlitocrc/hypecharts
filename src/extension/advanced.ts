/**
 * High-value geometry overlays. Data-backed drawings live in
 * derived.ts; these tools depend only on their anchor coordinates.
 */
import { Coordinate, LineAttrs, OverlayFigure, OverlayTemplate, TextAttrs } from 'klinecharts'

import { getEllipseCoordinates } from './utils'
import {
  FIB_LEVEL_DEFAULTS, bandPairs, fibLevels, isLevelVisible, levelColor, levelStylesOf, showLevelLabels, withAlpha
} from './fibLevels'

const BLUE = '#2962ff'
const ORANGE = '#ff9800'
const FILL = 'rgba(41, 98, 255, 0.10)'
const FIB_TIME_LEVELS = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144]
const HEAD_AND_SHOULDERS_LABELS = ['Start', 'LS', 'N1', 'Head', 'N2', 'RS', 'End']
const TRIANGLE_LABELS = ['A', 'B', 'C', 'D']
const THREE_DRIVES_LABELS = ['1', 'A', '2', 'B', '3', 'C']

const anchored = {
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true
}

const pointLabels = (coordinates: Coordinate[], labels: string[]): OverlayFigure => ({
  type: 'text',
  ignoreEvent: true,
  attrs: coordinates.map((point, index) => ({ ...point, text: labels[index] ?? '', baseline: 'bottom' }))
})

export const polyline: OverlayTemplate = {
  ...anchored,
  name: 'polyline',
  totalStep: Number.MAX_SAFE_INTEGER,
  createPointFigures: ({ coordinates }) => ({ type: 'line', attrs: { coordinates } })
}

export const path: OverlayTemplate = {
  ...anchored,
  name: 'path',
  totalStep: Number.MAX_SAFE_INTEGER,
  createPointFigures: ({ coordinates }) => ({
    type: 'line',
    attrs: { coordinates },
    styles: { smooth: coordinates.length > 2 }
  })
}

/** An ellipse defined by opposite corners of its bounding box. */
export const ellipse: OverlayTemplate = {
  ...anchored,
  name: 'ellipse',
  totalStep: 3,
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length < 2) return []
    const a = coordinates[0]
    const b = coordinates[1]
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    return {
      type: 'polygon',
      attrs: { coordinates: getEllipseCoordinates(center, b) },
      styles: { style: 'stroke_fill', color: FILL }
    }
  }
}

export interface FibonacciChannelGeometry {
  lines: LineAttrs[]
  fills: Coordinate[][]
  labels: TextAttrs[]
}

export function getFibonacciChannel (coordinates: Coordinate[], levels = FIB_LEVEL_DEFAULTS.fibonacciChannel): FibonacciChannelGeometry {
  const result: FibonacciChannelGeometry = { lines: [], fills: [], labels: [] }
  if (coordinates.length < 3) return result
  const [a, b, c] = coordinates
  const offset = { x: c.x - a.x, y: c.y - a.y }
  levels.forEach((level, index) => {
    const start = { x: a.x + offset.x * level, y: a.y + offset.y * level }
    const end = { x: b.x + offset.x * level, y: b.y + offset.y * level }
    if (index > 0) {
      const [previousStart, previousEnd] = result.lines[index - 1].coordinates
      result.fills.push([previousStart, previousEnd, end, start])
    }
    result.lines.push({ coordinates: [start, end] })
    result.labels.push({ x: end.x, y: end.y, text: `${(level * 100).toFixed(1)}%`, baseline: 'bottom' })
  })
  return result
}

export const fibonacciChannel: OverlayTemplate = {
  ...anchored,
  name: 'fibonacciChannel',
  totalStep: 4,
  createPointFigures: ({ coordinates, overlay }) => {
    const levels = fibLevels(overlay, 'fibonacciChannel')
    const geometry = getFibonacciChannel(coordinates, levels)
    const figures: OverlayFigure[] = []
    const styles = levelStylesOf(overlay)
    const labels = showLevelLabels(overlay)
    const yAt = (index: number): Coordinate[] => geometry.lines[index].coordinates
    // Fills join consecutive visible levels, tinted by the outer level's
    // palette color; hiding a level also drops its adjacent bands.
    for (const [outer, inner] of bandPairs(levels)) {
      const outerIndex = levels.indexOf(outer)
      const innerIndex = levels.indexOf(inner)
      if (outerIndex === -1 || innerIndex === -1) continue
      if (!isLevelVisible(styles, outer) || !isLevelVisible(styles, inner)) continue
      figures.push({
        type: 'polygon',
        ignoreEvent: true,
        attrs: [{ coordinates: [...yAt(outerIndex), ...yAt(innerIndex)] }],
        styles: { style: 'fill', color: withAlpha(levelColor(styles, outer), 0.1) }
      })
    }
    geometry.lines.forEach((line, index) => {
      if (!isLevelVisible(styles, levels[index])) return
      const color = levelColor(styles, levels[index])
      figures.push({
        type: 'line',
        attrs: [line],
        styles: { color }
      })
      if (labels) {
        figures.push({
          type: 'text',
          ignoreEvent: true,
          attrs: [geometry.labels[index]],
          styles: { color }
        })
      }
    })
    return figures
  }
}

export function fibonacciTimeZoneXs (start: number, interval: number, width: number): Array<{ x: number, level: number }> {
  const zones: Array<{ x: number, level: number }> = []
  if (interval === 0) return zones
  for (const level of FIB_TIME_LEVELS) {
    const x = start + interval * level
    if (interval > 0 ? x <= width : x >= 0) zones.push({ x, level })
  }
  return zones
}

export const fibonacciTimeZone: OverlayTemplate = {
  ...anchored,
  needDefaultYAxisFigure: false,
  name: 'fibonacciTimeZone',
  totalStep: 3,
  createPointFigures: ({ coordinates, bounding }) => {
    if (coordinates.length < 2) return []
    const zones = fibonacciTimeZoneXs(coordinates[0].x, coordinates[1].x - coordinates[0].x, bounding.width)
    return [
      {
        type: 'line',
        attrs: zones.map(zone => ({ coordinates: [{ x: zone.x, y: 0 }, { x: zone.x, y: bounding.height }] })),
        styles: { color: BLUE }
      },
      {
        type: 'text',
        ignoreEvent: true,
        attrs: zones.map(zone => ({ x: zone.x + 3, y: 4, text: String(zone.level), baseline: 'top' }))
      }
    ]
  }
}

export const headAndShoulders: OverlayTemplate = {
  ...anchored,
  name: 'headAndShoulders',
  totalStep: 8,
  createPointFigures: ({ coordinates }) => [
    { type: 'line', attrs: { coordinates }, styles: { color: BLUE } },
    {
      type: 'line',
      attrs: coordinates.length >= 5 ? { coordinates: [coordinates[2], coordinates[4]] } : [],
      styles: { color: ORANGE, style: 'dashed' }
    },
    pointLabels(coordinates, HEAD_AND_SHOULDERS_LABELS)
  ]
}

export const trianglePattern: OverlayTemplate = {
  ...anchored,
  name: 'trianglePattern',
  totalStep: 5,
  createPointFigures: ({ coordinates }) => [
    { type: 'line', attrs: { coordinates }, styles: { color: 'rgba(120, 123, 134, 0.70)', style: 'dashed' } },
    {
      type: 'line',
      attrs: coordinates.length >= 4
        ? [{ coordinates: [coordinates[0], coordinates[2]] }, { coordinates: [coordinates[1], coordinates[3]] }]
        : [],
      styles: { color: BLUE }
    },
    pointLabels(coordinates, TRIANGLE_LABELS)
  ]
}

export const threeDrives: OverlayTemplate = {
  ...anchored,
  name: 'threeDrives',
  totalStep: THREE_DRIVES_LABELS.length + 1,
  createPointFigures: ({ coordinates }) => {
    const figures: OverlayFigure[] = [
      { type: 'line', attrs: { coordinates }, styles: { color: BLUE } },
      pointLabels(coordinates, THREE_DRIVES_LABELS)
    ]
    if (coordinates.length > 2) {
      figures.unshift({ type: 'polygon', ignoreEvent: true, attrs: { coordinates }, styles: { style: 'fill', color: FILL } })
    }
    return figures
  }
}

export default [
  polyline,
  path,
  ellipse,
  fibonacciChannel,
  fibonacciTimeZone,
  headAndShoulders,
  trianglePattern,
  threeDrives
]
