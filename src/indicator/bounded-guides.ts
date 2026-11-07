/**
 * Core RSI / KDJ / WR re-registered with guide lines. These shadow the
 * klinecharts built-ins of the same name (the established pattern in this
 * fork, e.g. STOCH) so bounded studies get their 20/80 guides. The calc
 * implementations mirror klinecharts 9.1.1 exactly.
 */
import type { IndicatorFigure, IndicatorTemplate, KLineData } from 'klinecharts'

import { guideLines, positiveInt } from './math'

interface RsiResult { rsi1?: number, rsi2?: number, rsi3?: number }
interface WrResult { wr1?: number, wr2?: number, wr3?: number }
interface KdjResult { k?: number, d?: number, j?: number }

const rangedFigures = (prefix: string, title: string): IndicatorFigure[] => [
  { key: `${prefix}1`, title: `${title}1: `, type: 'line' },
  { key: `${prefix}2`, title: `${title}2: `, type: 'line' },
  { key: `${prefix}3`, title: `${title}3: `, type: 'line' }
]

const rollingRsi = (dataList: KLineData[], periods: number[], keys: string[]): RsiResult[] => {
  const gains: number[] = []
  const losses: number[] = []
  return dataList.map((kLineData, index) => {
    const result: RsiResult = {}
    const previous = dataList[index - 1] ?? kLineData
    const change = kLineData.close - previous.close
    periods.forEach((period, slot) => {
      if (change > 0) gains[slot] = (gains[slot] ?? 0) + change
      else losses[slot] = (losses[slot] ?? 0) + Math.abs(change)
      if (index >= period - 1) {
        result[keys[slot] as keyof RsiResult] = losses[slot] === 0
          ? 0
          : 100 - (100 / (1 + gains[slot] / losses[slot]))
        const agoData = dataList[index - (period - 1)]
        const agoPreData = dataList[index - period] ?? agoData
        const agoChange = agoData.close - agoPreData.close
        if (agoChange > 0) gains[slot] -= agoChange
        else losses[slot] -= Math.abs(agoChange)
      }
    })
    return result
  })
}

export const rsi: IndicatorTemplate<RsiResult> = {
  name: 'RSI',
  shortName: 'RSI',
  calcParams: [6, 12, 24],
  figures: rangedFigures('rsi', 'RSI'),
  regenerateFigures: params => params.map((_, index) => ({ key: `rsi${index + 1}`, title: `RSI${index + 1}: `, type: 'line' })),
  calc: (dataList, indicator) => {
    const periods = indicator.calcParams.map(param => positiveInt(param, 6))
    return rollingRsi(dataList, periods, ['rsi1', 'rsi2', 'rsi3'])
  },
  draw: guideLines([20, 80])
}

export const wr: IndicatorTemplate<WrResult> = {
  name: 'WR',
  shortName: 'WR',
  calcParams: [6, 10, 14],
  figures: rangedFigures('wr', 'WR'),
  regenerateFigures: params => params.map((_, index) => ({ key: `wr${index + 1}`, title: `WR${index + 1}: `, type: 'line' })),
  calc: (dataList, indicator) => {
    const periods = indicator.calcParams.map(param => positiveInt(param, 6))
    return dataList.map((kLineData, index) => {
      const result: WrResult = {}
      periods.forEach((period, slot) => {
        const offset = period - 1
        if (index < offset) return
        let high = -Infinity
        let low = Infinity
        for (let i = index - offset; i <= index; i++) {
          high = Math.max(high, dataList[i].high)
          low = Math.min(low, dataList[i].low)
        }
        const range = high - low
        result[`wr${slot + 1}` as keyof WrResult] = range === 0 ? 0 : (kLineData.close - high) / range * 100
      })
      return result
    })
  },
  draw: guideLines([-20, -80])
}

export const kdj: IndicatorTemplate<KdjResult> = {
  name: 'KDJ',
  shortName: 'KDJ',
  calcParams: [9, 3, 3],
  figures: [
    { key: 'k', title: 'K: ', type: 'line' },
    { key: 'd', title: 'D: ', type: 'line' },
    { key: 'j', title: 'J: ', type: 'line' }
  ],
  calc: (dataList, indicator) => {
    const [n, m1, m2] = indicator.calcParams.map(param => positiveInt(param, 9))
    const result: KdjResult[] = []
    dataList.forEach((kLineData, index) => {
      const row: KdjResult = {}
      if (index >= n - 1) {
        let high = -Infinity
        let low = Infinity
        for (let i = index - (n - 1); i <= index; i++) {
          high = Math.max(high, dataList[i].high)
          low = Math.min(low, dataList[i].low)
        }
        const range = high - low
        const rsv = (kLineData.close - low) / (range === 0 ? 1 : range) * 100
        row.k = ((m1 - 1) * ((result[index - 1]?.k ?? 50)) + rsv) / m1
        row.d = ((m2 - 1) * ((result[index - 1]?.d ?? 50)) + row.k) / m2
        row.j = 3 * row.k - 2 * row.d
      }
      result.push(row)
    })
    return result
  },
  draw: guideLines([20, 80])
}
