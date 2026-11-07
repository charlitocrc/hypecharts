import { describe, expect, it } from 'vitest'
import { DrawingHistory } from './drawingHistory'

describe('drawing history', () => {
  it('undoes create, move, and delete without retaining mutable references', () => {
    const history = new DrawingHistory<Array<{ value: number }>>()
    const state = [{ value: 1 }]
    history.reset([])
    history.record(state)
    state[0].value = 2
    history.record(state)
    history.record([])
    expect(history.undo()).toEqual([{ value: 2 }])
    const restored = history.undo()!
    expect(restored).toEqual([{ value: 1 }])
    restored[0].value = 999
    expect(history.undo()).toEqual([])
    expect(history.redo()).toEqual([{ value: 1 }])
  })

  it('ignores unchanged snapshots and invalidates redo after a new edit', () => {
    const history = new DrawingHistory<number[]>()
    history.reset([])
    history.record([1])
    history.record([1])
    expect(history.undo()).toEqual([])
    history.record([2])
    expect(history.canRedo).toBe(false)
    expect(history.redo()).toBeNull()
    expect(history.undo()).toEqual([])
    expect(history.undo()).toBeNull()
  })

  it('names the action each undo and redo step reverts or reapplies', () => {
    const history = new DrawingHistory<number>(2)
    history.reset(0)
    history.record(1, 'Add EMA')
    history.record(2, 'Chart type')
    history.record(3, 'Remove RSI')
    expect(history.undoLabel).toBe('Remove RSI')
    history.undo()
    expect(history.undoLabel).toBe('Chart type')
    expect(history.redoLabel).toBe('Remove RSI')
    history.undo()
    expect(history.canUndo).toBe(false)
    expect(history.undoLabel).toBe('')
    expect(history.redoLabel).toBe('Chart type')
  })

  it('bounds memory and resets history when the symbol changes', () => {
    const history = new DrawingHistory<number>(2)
    history.reset(0)
    ;[1, 2, 3].forEach(value => history.record(value))
    expect(history.undo()).toBe(2)
    expect(history.undo()).toBe(1)
    expect(history.undo()).toBeNull()
    history.reset(10)
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
  })
})
