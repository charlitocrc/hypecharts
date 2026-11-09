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

import { KLineData, Styles, DeepPartial, Nullable, Chart } from 'klinecharts'

export interface SymbolInfo {
  ticker: string
  name?: string
  shortName?: string
  exchange?: string
  market?: string
  pricePrecision?: number
  volumePrecision?: number
  priceCurrency?: string
  type?: string
  logo?: string
  description?: string
  /** TV-style session, e.g. '24x7' — consumed by the session display work. */
  session?: string
  /** IANA timezone, e.g. 'Etc/UTC' — display-timezone default for the symbol. */
  timezone?: string
  /** Periods this symbol supports; the period bar intersects these with the feed config and host options. */
  intervals?: Period[]
  /** TV pricescale/minmov equivalent, e.g. 0.1 for BTC, 0.0001 for DOGE. */
  minPriceDelta?: number
  dataStatus?: 'streaming' | 'delayed' | 'snapshot'
}

export interface Period {
  multiplier: number
  timespan: string
  text: string
}

export type DatafeedSubscribeCallback = (data: KLineData) => void

export interface DatafeedExchange {
  /** 'BINANCE' — matches SymbolInfo.exchange and search-result exchange. */
  key: string
  /** Display name, e.g. 'Binance'. */
  name: string
  logo?: string
  markets?: string[]
}

export interface DatafeedSymbolType {
  key: string
  /** i18n key for the label; falls back to the key itself. */
  labelKey?: string
}

export interface DatafeedConfiguration {
  exchanges: DatafeedExchange[]
  symbolTypes?: DatafeedSymbolType[]
  /** Venue-wide period fallback for the period bar when a symbol declares none. */
  intervals?: Period[]
  /** Default: true when searchSymbols exists. */
  supportsSearch?: boolean
  /** Debounce for search requests, ms; default 250. */
  searchDelayMs?: number
}

export interface SymbolSearchFilters {
  exchange?: string
  type?: string
  limit?: number
}

export interface SymbolSearchResult {
  /** Canonical key within the feed, e.g. 'BTCUSDT'. */
  ticker: string
  /** Short display form; defaults to the ticker. */
  symbol?: string
  description?: string
  /** Must match one of config().exchanges keys. */
  exchange: string
  market?: string
  type?: string
  logo?: string
}

export type SymbolResolveErrorCode = 'unknown_symbol' | 'unknown_exchange'

export interface SymbolResolveError {
  name: string
  code: SymbolResolveErrorCode
}

export interface Datafeed {
  /** Week bars must open Monday 00:00 UTC and month bars on the 1st at 00:00 UTC. */
  getHistoryKLineData (symbol: SymbolInfo, period: Period, from: number, to: number): Promise<KLineData[]>
  subscribe (symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void
  unsubscribe (symbol: SymbolInfo, period: Period): void
  /** Chart capabilities: exchange list, filters, period fallback, search availability. Called once per chart lifetime. */
  config? (): Promise<DatafeedConfiguration>
  searchSymbols? (query: string, filters?: SymbolSearchFilters): Promise<SymbolSearchResult[]>
  /** Resolves any user-facing name the feed advertises ('BINANCE:BTCUSDT', 'BTCUSDT') to a full SymbolInfo. */
  resolveSymbol? (name: string): Promise<SymbolInfo>
  /** Optional capability; consumed by the bar-close-countdown milestone. */
  getServerTime? (): Promise<number>
}

export interface ChartProOptions {
  container: string | HTMLElement
  styles?: DeepPartial<Styles>
  theme?: string
  locale?: string
  drawingBarVisible?: boolean
  symbol: SymbolInfo
  period: Period
  periods?: Period[]
  quickPeriods?: string[]
  timezone?: string
  mainIndicators?: string[]
  subIndicators?: string[]
  datafeed: Datafeed
  /** Fired when a name passed to setSymbol cannot be resolved; the chart keeps the current symbol. */
  onSymbolResolveError?: (error: SymbolResolveError) => void
}

export interface ChartPro {
  setTheme(theme: string): void
  getTheme(): string
  setStyles(styles: DeepPartial<Styles>): void
  getStyles(): Styles
  setLocale(locale: string): void
  getLocale(): string
  setTimezone(timezone: string): void
  getTimezone(): string
  setSymbol(symbol: SymbolInfo | string): void
  getSymbol(): SymbolInfo
  /** The effective (resolved) symbol — what legends and the symbol-info read model render. */
  resolvedSymbol(): SymbolInfo
  setPeriod(period: Period): void
  getPeriod(): Period
  getChart(): Nullable<Chart>
}
