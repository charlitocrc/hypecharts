import type { StoredDrawing } from './persist'
import { toStoredDrawing } from './persist'

export function drawingGroups<T extends StoredDrawing> (drawings: T[]): Array<{ name: string, drawings: T[] }> {
  const groups = new Map<string, T[]>()
  for (const drawing of drawings) {
    const name = drawing.objectGroup ?? ''
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name)!.push(drawing)
  }
  return [...groups].map(([name, drawings]) => ({ name, drawings }))
}

/** Move selected blocks one layer; preserve selected and unselected relative order. */
export function reorderDrawings<T extends { id: string }> (items: T[], selected: Set<string>, direction: -1 | 1): T[] {
  const next = items.slice()
  if (direction > 0) {
    for (let i = next.length - 2; i >= 0; i--) if (selected.has(next[i].id) && !selected.has(next[i + 1].id)) [next[i], next[i + 1]] = [next[i + 1], next[i]]
  } else {
    for (let i = 1; i < next.length; i++) if (selected.has(next[i].id) && !selected.has(next[i - 1].id)) [next[i], next[i - 1]] = [next[i - 1], next[i]]
  }
  return next
}

export function pasteDrawings (drawings: StoredDrawing[], anchor: { timestamp: number, value: number }): StoredDrawing[] {
  const firstTime = drawings.flatMap(drawing => drawing.points).find(point => point.timestamp !== undefined)?.timestamp
  const firstPrice = drawings.flatMap(drawing => drawing.points).find(point => point.value !== undefined)?.value
  return drawings.map(drawing => ({ ...JSON.parse(JSON.stringify(drawing)), visible: true, lock: false,
    points: drawing.points.map(point => ({
      ...(point.timestamp !== undefined ? { timestamp: point.timestamp + anchor.timestamp - (firstTime ?? anchor.timestamp) } : {}),
      ...(point.dataIndex !== undefined ? { dataIndex: point.dataIndex } : {}),
      ...(point.value !== undefined ? { value: point.value + anchor.value - (firstPrice ?? anchor.value) } : {})
    }))
  }))
}

/** App-local clipboard shared by chart instances; no host trading objects or OS clipboard writes. */
export const drawingClipboard = (() => {
  let value: StoredDrawing[] = []
  const listeners = new Set<(available: boolean) => void>()
  return {
    copy (items: StoredDrawing[]): void {
      value = items.slice(0, 500).map(item => toStoredDrawing({ ...item, groupId: 'drawing_tools' }, 'drawing_tools'))
        .filter((item): item is StoredDrawing => item !== null)
      value = JSON.parse(JSON.stringify(value))
      listeners.forEach(listener => listener(value.length > 0))
    },
    read (): StoredDrawing[] { return JSON.parse(JSON.stringify(value)) },
    subscribe (listener: (available: boolean) => void): () => void {
      listeners.add(listener); listener(value.length > 0)
      return () => { listeners.delete(listener) }
    }
  }
})()
