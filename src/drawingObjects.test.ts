import { describe, expect, it } from 'vitest'
import { drawingClipboard, drawingGroups, pasteDrawings, reorderDrawings } from './drawingObjects'
import { toStoredDrawing } from './persist'
const drawings = [
  { name: 'rect', points: [{ timestamp: 100, value: 10 }, { timestamp: 200, value: 20 }], objectGroup: 'Trend' },
  { name: 'horizontalStraightLine', points: [{ value: 30 }], objectGroup: 'Trend' }
]
describe('drawing object operations', () => {
  it('groups without conflating the engine ownership group', () => {
    expect(drawingGroups([...drawings, { name: 'text', points: [{ value: 1 }] }]).map(group => [group.name, group.drawings.length])).toEqual([['Trend', 2], ['', 1]])
    expect(toStoredDrawing({ ...drawings[0], groupId: 'host-orders' }, 'drawing_tools')).toBeNull()
  })
  it('moves selected blocks without reversing their relative order', () => {
    const items = ['a', 'b', 'c', 'd'].map(id => ({ id }))
    expect(reorderDrawings(items, new Set(['a', 'b']), 1).map(i => i.id)).toEqual(['c', 'a', 'b', 'd'])
    expect(reorderDrawings(items, new Set(['b', 'd']), -1).map(i => i.id)).toEqual(['b', 'a', 'd', 'c'])
    expect(items.map(i => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('pastes relative time/price geometry around the destination viewport', () => {
    const copies = pasteDrawings(drawings, { timestamp: 1000, value: 100 })
    expect(copies[0].points).toEqual([{ timestamp: 1000, value: 100 }, { timestamp: 1100, value: 110 }])
    expect(copies[1].points).toEqual([{ value: 120 }])
    expect(copies[0].objectGroup).toBe('Trend')
    expect(drawings[0].points[0].value).toBe(10)
  })
  it('copies by value and notifies other chart instances', () => {
    const seen: boolean[] = [], stop = drawingClipboard.subscribe(value => seen.push(value))
    drawingClipboard.copy(drawings)
    const pasted = drawingClipboard.read();pasted[0].points[0].value = -1
    expect(drawingClipboard.read()[0].points[0].value).toBe(10)
    expect(seen.at(-1)).toBe(true)
    stop()
  })
})
