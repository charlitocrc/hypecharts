import { describe, expect, it } from 'vitest'

import enUS from '../../i18n/en-US.json'
import zhCN from '../../i18n/zh-CN.json'

import data from './data'
import {
  applyPlotStyles,
  createDefaultParamDrafts,
  createParamDrafts,
  diffPlotStyles,
  plotDefaults,
  stepParamDraft,
  toHexColor,
  validateParamDrafts
} from './model'

describe('indicator parameter editor model', () => {
  it('has localized, valid defaults for every configurable indicator', () => {
    const english = enUS as Record<string, string>
    const chinese = zhCN as Record<string, string>

    Object.values(data).flat().forEach(item => {
      expect(english[item.paramNameKey]).toBeTypeOf('string')
      expect(chinese[item.paramNameKey]).toBeTypeOf('string')
      if (!item.optional) {
        expect(item.default).toBeTypeOf('number')
      }
      if (item.default !== undefined) {
        expect(item.default).toBeGreaterThanOrEqual(item.min)
        if (item.max !== undefined) expect(item.default).toBeLessThanOrEqual(item.max)
      }
    })
  })

  it('preserves current values and fills missing required values from defaults', () => {
    expect(createParamDrafts(data.MACD, [8, 21, 5])).toEqual(['8', '21', '5'])
    expect(createParamDrafts(data.MACD, [8])).toEqual(['8', '26', '9'])
    expect(createDefaultParamDrafts(data.MACD)).toEqual(['12', '26', '9'])
  })

  it('allows trailing optional lines but rejects gaps between active lines', () => {
    const valid = validateParamDrafts(data.EMA, ['6', '12', '20', '', ''])
    expect(valid).toEqual({ errors: [undefined, undefined, undefined, undefined, undefined], isValid: true, values: [6, 12, 20] })

    const gap = validateParamDrafts(data.EMA, ['6', '12', '20', '', '50'])
    expect(gap.isValid).toBe(false)
    expect(gap.errors[3]).toBe('sequence')
  })

  it('reports invalid numbers, precision, and minimum bounds', () => {
    expect(validateParamDrafts(data.MACD, ['abc', '26', '9']).errors[0]).toBe('number')
    expect(validateParamDrafts(data.MACD, ['12.5', '26', '9']).errors[0]).toBe('precision')
    expect(validateParamDrafts(data.MACD, ['0', '26', '9']).errors[0]).toBe('min')
  })

  it('steps integer and decimal parameters while respecting minimums', () => {
    expect(stepParamDraft('12', data.MACD[0], 1)).toBe('13')
    expect(stepParamDraft('1', data.MACD[0], -1)).toBe('1')
    expect(stepParamDraft('2', data.KC[2], 1)).toBe('2.01')
  })
})

describe('indicator plot style model', () => {
  const defaultStyles = {
    lines: [{ color: '#FF9600', size: 1, style: 'solid' }, { color: 'rgba(33, 150, 243, .5)', size: 2, style: 'dashed' }],
    bars: [{ noChangeColor: '#888' }],
    circles: []
  }
  const indicator = {
    result: [{ fast: 1, hist: -1 }],
    figures: [
      { key: 'fast', title: 'Fast: ', type: 'line' },
      { key: 'slow', type: 'line' },
      { key: 'hist', title: 'Hist: ', type: 'bar', styles: ({ current }: any) => ({ color: current.indicatorData.hist < 0 ? '#ef5350' : '#26a69a' }) },
      { key: 'band', type: 'rect' }
    ]
  }

  it('reads the effective default of every plot, including figure color callbacks', () => {
    expect(plotDefaults(indicator, defaultStyles, [{}])).toEqual([
      { key: 'fast', title: 'Fast', line: true, bar: false, color: '#ff9600', upColor: '', downColor: '', size: 1, style: 'solid', opacity: 100, visible: true },
      { key: 'slow', title: 'slow', line: true, bar: false, color: '#2196f3', upColor: '', downColor: '', size: 2, style: 'dashed', opacity: 100, visible: true },
      { key: 'hist', title: 'Hist', line: false, bar: true, color: '', upColor: '#089981', downColor: '#f23645', size: 1, style: 'solid', opacity: 100, visible: true }
    ])
  })

  it('captures direction-colored bar overrides and opacity in the diff', () => {
    const defaults = plotDefaults(indicator, defaultStyles, [{}])
    const drafts = applyPlotStyles(defaults, {
      fast: { color: '#00ff00', size: 3, opacity: 50 },
      hist: { upColor: '#00ffff', downColor: '#ff00ff', visible: false }
    })
    expect(diffPlotStyles(defaults, drafts)).toEqual({
      fast: { color: '#00ff00', size: 3, opacity: 50 },
      hist: { upColor: '#00ffff', downColor: '#ff00ff', visible: false }
    })
    // a flat color on a bar suppresses the up/down pair, and vice versa
    const flatBar = applyPlotStyles(defaults, { hist: { color: '#888888' } })
    expect(diffPlotStyles(defaults, flatBar)).toEqual({ hist: { color: '#888888' } })
  })

  it('stores only changed fields and reapplies them over defaults', () => {
    const defaults = plotDefaults(indicator, defaultStyles, [{}])
    const drafts = applyPlotStyles(defaults, { fast: { color: '#00ff00', size: 3 }, hist: { visible: false } })
    expect(drafts[0]).toMatchObject({ color: '#00ff00', size: 3, style: 'solid' })
    expect(diffPlotStyles(defaults, drafts)).toEqual({ fast: { color: '#00ff00', size: 3 }, hist: { visible: false } })
    expect(diffPlotStyles(defaults, defaults)).toBeUndefined()
  })

  it('normalizes colors for the native color input', () => {
    expect(toHexColor('#ABC')).toBe('#aabbcc')
    expect(toHexColor('#11223344')).toBe('#112233')
    expect(toHexColor('rgba(45, 192, 142, .7)')).toBe('#2dc08e')
    expect(toHexColor('linear-gradient(red, blue)')).toBe('#888888')
  })
})
