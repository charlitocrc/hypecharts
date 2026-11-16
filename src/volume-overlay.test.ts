import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor/klinecharts.js'), 'utf8')
const start = source.indexOf('function createOwnScaleConvertor(')
const end = source.indexOf('\n/**', start)
const convertor = new Function('PaneIdConstants', 'isValid', `${source.slice(start, end)}; return createOwnScaleConvertor;`)({ CANDLE: 'candle_pane' }, Number.isFinite)
function mapping (volumes: number[], reverse = false, name = 'VOL') {
  return convertor(
    { getTimeScaleStore: () => ({ getVisibleRange: () => ({ from: 0, to: volumes.length }) }) },
    { getId: () => 'candle_pane', getMainWidget: () => ({ getBounding: () => ({ height: 400 }) }), getAxisComponent: () => ({ isReverse: () => reverse }) },
    { name, figures: [{ key: 'volume' }] }, volumes.map(volume => ({ volume }))
  )
}

describe('on-chart volume scale', () => {
  it('keeps a zero baseline and scales spikes into the bottom quarter', () => {
    const scale = mapping([100, 1000000])
    expect(scale.base).toBe(0)
    expect(scale.convert(0)).toBe(398)
    expect(scale.convert(1000000)).toBe(298)
    expect(scale.convert(100)).toBeGreaterThanOrEqual(298)
  })
  it('keeps repeated volume instances upright when the price axis reverses', () => {
    expect(mapping([100], true, 'VOL~2').convert(100)).toBe(298)
  })
  it('handles empty and all-zero volume without non-finite coordinates', () => {
    expect(mapping([])).toBeNull()
    expect(mapping([0, 0]).convert(0)).toBe(398)
  })
})
