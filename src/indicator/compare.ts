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

import { IndicatorSeries, YAxisType, type IndicatorCreateTooltipDataSourceParams, type IndicatorTemplate } from 'klinecharts'

import type { SymbolInfo } from '../types'

/**
 * Legend values for a COMPARE instance. On a percentage price scale the line
 * is drawn in price space and the axis rebases it, so the legend rebases too —
 * against the same first visible close the axis and crosshair use. Returns
 * undefined on a normal axis so the default price formatting applies.
 */
export function compareTooltipValues (
  { kLineDataList, indicator, visibleRange, crosshair, yAxis }: IndicatorCreateTooltipDataSourceParams
): { title: string, value: string }[] | undefined {
  if (yAxis.getType() !== YAxisType.Percentage) {
    return undefined
  }
  const base = kLineDataList[visibleRange.from]?.close
  const value = indicator.result?.[crosshair.dataIndex ?? -1]?.compare as unknown
  if (base === undefined || !Number.isFinite(value as number)) {
    return undefined
  }
  const percent = ((value as number) - base) / base * 100
  return [{ title: 'Compare: ', value: `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%` }]
}

/**
 * M5 increment 1: the COMPARE indicator template. The shell pre-computes
 * aligned, normalized values into `extendData.values` (one per chart bar);
 * calc only projects them so live updates are an extendData swap + recalc.
 */
const compareIndicator: IndicatorTemplate = {
  name: 'COMPARE',
  shortName: 'COMPARE',
  series: IndicatorSeries.Price, // drawn against the candle pane's price axis
  figures: [
    { key: 'compare', title: 'Compare: ', type: 'line' }
  ],
  calc: (dataList, indicator) => {
    const values = (indicator.extendData as { values?: number[] } | null)?.values
    // Carry the last known value forward through indexes the aligned array
    // doesn't cover yet (the flow's new walking bars land before the next
    // refresh) — the line paints continuously instead of breaking at every
    // bar the refresh hasn't reached. Leading NaNs (before the compare's
    // first value) draw as a gap, as before.
    let last = Number.NaN
    return dataList.map((_, index) => {
      const value = values?.[index]
      if (Number.isFinite(value)) {
        last = value as number
      }
      return { compare: Number.isFinite(last) ? last : Number.NaN }
    })
  },
  createTooltipDataSource: params => ({ values: compareTooltipValues(params) })
}

export default compareIndicator

/** Metadata the shell attaches to every COMPARE instance via extendData. */
export interface CompareExtendData {
  /** Compared symbol (persisted via StoredIndicator.compare). */
  symbol: Pick<SymbolInfo, 'exchange' | 'market' | 'ticker' | 'shortName' | 'name'>
  /** Aligned + normalized values, one per chart bar. */
  values: number[]
  mode: 'pinned' | 'raw'
}
