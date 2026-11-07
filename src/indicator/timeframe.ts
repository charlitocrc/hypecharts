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

import type { KLineData } from 'klinecharts'

export const PRICE_SOURCES = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'] as const

export type PriceSourceOption = typeof PRICE_SOURCES[number]

/**
 * Map higher-timeframe bars onto chart bars: every chart bar inherits the
 * HTF bucket that contains its timestamp, so an indicator computing over the
 * mapped series shows TV-style per-timeframe values (the forming bucket keeps
 * updating live). Chart bars before the first bucket fall back to it.
 */
export function mapHtfBuckets (chartData: KLineData[], htfBars: KLineData[]): KLineData[] {
  if (htfBars.length === 0) return chartData
  let cursor = 0
  return chartData.map(bar => {
    while (cursor + 1 < htfBars.length && htfBars[cursor + 1].timestamp <= bar.timestamp) {
      cursor++
    }
    const bucket = htfBars[cursor]
    return bucket !== undefined ? { ...bucket, timestamp: bar.timestamp } : bar
  })
}
