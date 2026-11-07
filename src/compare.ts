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

/**
 * M5 increment 1: compare-series helpers. Pure functions, fixture-tested.
 */

/** Carry a series' closes forward onto `timestamps` (missing buckets keep the previous close). */
export function alignSeries (timestamps: number[], bars: KLineData[]): number[] {
  const values: number[] = []
  let cursor = 0
  let last = Number.NaN
  for (const timestamp of timestamps) {
    while (cursor < bars.length && bars[cursor].timestamp <= timestamp) {
      last = bars[cursor].close
      cursor++
    }
    values.push(last)
  }
  return values
}

/**
 * Fill values before the compare series' first bar with that first bar's
 * close, so a compare whose history starts after the chart's (1s compares
 * seed from a thin trade page) still draws — pinned flat until its data
 * begins — instead of being dropped as unanchorable.
 */
export function fillLeadingGaps (values: number[]): number[] {
  const first = values.find(Number.isFinite)
  if (first === undefined) return values
  const out = values.slice()
  for (let i = 0; i < out.length && !Number.isFinite(out[i]); i++) {
    out[i] = first
  }
  return out
}

/**
 * How a compare series maps onto the chart. 'pinned' rescales the series onto
 * the main series' first close and shares the price axis; 'independent' keeps
 * venue prices and draws in the instance's own scale (the pane axis ignores
 * it); 'raw' keeps venue prices on the shared price axis.
 */
export type CompareMode = 'pinned' | 'independent' | 'raw'

/**
 * Normalize aligned compare values onto the chart's price axis.
 * 'pinned' maps the compare series so its first chart-aligned close sits on the
 * main series' first close; 'raw' and 'independent' keep venue prices
 * (independent relies on the instance's own scale for display). Returns null
 * while alignment is warming up (no compare value yet for the anchor).
 */
export function normalizeCompareValues (
  values: number[],
  anchorClose: number,
  mode: CompareMode = 'pinned'
): number[] | null {
  if (values.length === 0) return []
  if (mode === 'raw' || mode === 'independent') return values.slice()
  const first = values[0]
  if (!Number.isFinite(first) || !Number.isFinite(anchorClose) || first === 0) return null
  const factor = anchorClose / first
  return values.map(value => Number.isFinite(value) ? value * factor : Number.NaN)
}

/** Rotation palette for compare lines (distinct from MA defaults). */
export const COMPARE_COLORS = [
  '#f0a020', '#9b59b6', '#e91e63', '#00bcd4', '#8bc34a', '#ff7043'
]

export const nextCompareColor = (taken: string[]): string =>
  COMPARE_COLORS.find(color => !taken.includes(color)) ?? COMPARE_COLORS[taken.length % COMPARE_COLORS.length]
