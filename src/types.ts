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

import type { KLineData, Styles, DeepPartial, Nullable, Chart } from 'klinecharts'

/** Venue-qualified symbol metadata supplied by a datafeed or host application. */
export interface SymbolInfo {
  /** Canonical datafeed key, for example BTC or BTCUSDT. */
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
  /** Session metadata, for example '24x7'; does not configure exchange-session calculations. */
  session?: string
  /** Symbol timezone metadata; set ChartProOptions.timezone to configure the display. */
  timezone?: string
  /** Periods this symbol supports; the period bar intersects these with the feed config and host options. */
  intervals?: Period[]
  /** TV pricescale/minmov equivalent, e.g. 0.1 for BTC, 0.0001 for DOGE. */
  minPriceDelta?: number
  dataStatus?: 'streaming' | 'delayed' | 'snapshot'
}

/** An interval. Use parsePeriodText to build supported custom intervals from text. */
export interface Period {
  /** Number of timespan units in one bar; use a positive integer. */
  multiplier: number
  /** Unit such as second, minute, hour, day, week, month or year; availability depends on the feed. */
  timespan: string
  /** Display/selection key, for example '15m'; keep it consistent with the interval. */
  text: string
}

/** Receives a live candle with a bar-open timestamp in milliseconds. */
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

/** History and live market data. A feed may be shared by multiple charts and studies. */
export interface Datafeed {
  /** Optional transport lifecycle; charts repair missed candles after reconnect. */
  subscribeConnection?: (listener: (event: import('./dataRecovery').ConnectionEvent) => void) => () => void
  /**
   * Return chronological candles for the requested range. Bounds and bar-open timestamps are milliseconds.
   * Week bars open Monday 00:00 UTC; month bars open on the 1st at 00:00 UTC.
   * Reject on failure; return an empty array when no history is available.
   */
  getHistoryKLineData (symbol: SymbolInfo, period: Period, from: number, to: number): Promise<KLineData[]>
  /** Register this live listener; preserve other listeners for the same symbol and period. */
  subscribe (symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void
  /** Removes only this listener: a symbol and period can have several at once. */
  unsubscribe (symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void
  /** Chart capabilities: exchange list, filters, period fallback, search availability. Called once per chart lifetime. */
  config? (): Promise<DatafeedConfiguration>
  /** Search advertised symbols, optionally filtered by exchange/type and limited in count. */
  searchSymbols? (query: string, filters?: SymbolSearchFilters): Promise<SymbolSearchResult[]>
  /** Resolves any user-facing name the feed advertises ('BINANCE:BTCUSDT', 'BTCUSDT') to a full SymbolInfo. */
  resolveSymbol? (name: string): Promise<SymbolInfo>
  /** Optional venue clock capability; the current countdown uses the client clock. */
  getServerTime? (): Promise<number>
}

/** Latest selection/loading state; dataReady distinguishes new data from a previous dataset. */
export interface ChartSelection {
  /** Effective symbol; a pending string resolution retains the previous symbol. */
  symbol: SymbolInfo
  /** Effective interval after capability checks. */
  period: Period
  /** True while an awaited selection resolves its symbol, loads market data or restores a workspace. */
  loading: boolean
  /** True when awaited resolution, main loading and restoration have finished with nonempty data. */
  dataReady: boolean
  /** False for brick-based chart types that cannot participate in time synchronization. */
  timeBased: boolean
}

/** Select a symbol, an interval, or both. A paired request applies them together. */
export type ChartSelectionRequest =
  | { symbol: SymbolInfo | string, period?: Period }
  | { symbol?: SymbolInfo | string, period: Period }

export interface ChartSelectionOptions {
  /** Reject the wait on abort. Before symbol resolution completes this also prevents the later commit. */
  signal?: AbortSignal
}

/** Terminal failure of an awaitable selection; available as ChartSelectionError.code. */
export type ChartSelectionErrorCode = 'invalid_request' | 'resolve_failed' | 'load_failed' | 'aborted' | 'superseded' | 'disposed'

export type ChartDiagnosticCode = 'container_not_found' | 'stylesheet_missing' | 'container_zero_height' |
  'unsupported_period' | 'configuration_failed' | 'symbol_resolve_failed' | 'history_failed' |
  'subscription_failed' | 'recovery_failed' | 'connection_lost' | 'symbol_search_failed'

/** An asynchronous chart-local diagnostic. Normal empty data and selection cancellation are not errors. */
export interface ChartDiagnostic {
  readonly code: ChartDiagnosticCode
  readonly severity: 'warning' | 'error'
  /** Actionable description; use code, rather than message text, for application logic. */
  readonly message: string
  readonly operation: 'initialize' | 'config' | 'resolveSymbol' | 'getHistoryKLineData' | 'subscribe' |
    'unsubscribe' | 'subscribeConnection' | 'recovery' | 'connection' | 'searchSymbols' | 'setPeriod'
  /** Whether retrying the operation is supported, not a prediction that a retry will succeed. */
  readonly retryable: boolean
  readonly timestamp: number
  /** Original provider error or transport event, preserved without wrapping or serializing it. */
  readonly cause?: unknown
  readonly symbol?: SymbolInfo
  readonly period?: Period
  readonly symbolName?: string
  /** Effective period is in period when an unsupported requestedPeriod is snapped. */
  readonly requestedPeriod?: Period
  readonly scope?: 'main' | 'paging' | 'indicator' | 'compare' | 'profile'
}

/** Initial chart configuration. Saved chart preferences can override initial appearance settings. */
export interface ChartProOptions {
  /** Existing element or element ID. The container must have a nonzero height. */
  container: string | HTMLElement
  /** Partial overrides for the bundled chart core's styles. */
  styles?: DeepPartial<Styles>
  /** Initial theme; built-ins are 'light' and 'dark'. @defaultValue 'light' */
  theme?: string
  /** Initial locale; built-ins are 'en-US' and 'zh-CN'. @defaultValue 'zh-CN' */
  locale?: string
  /** Show the drawing toolbar. @defaultValue true */
  drawingBarVisible?: boolean
  /** Initial resolved symbol metadata. Use setSymbol for later name resolution. */
  symbol: SymbolInfo
  /** Initial interval, subject to symbol/feed capabilities. */
  period: Period
  /** Available intervals, intersected with the symbol/feed's supported intervals. */
  periods?: Period[]
  /** Pinned interval text keys. @defaultValue ['15m', '1h', '4h'] */
  quickPeriods?: string[]
  /** Initial IANA display timezone. @defaultValue 'Asia/Shanghai' */
  timezone?: string
  /** Initial main-pane indicator names. @defaultValue ['MA'] */
  mainIndicators?: string[]
  /** Initial sub-pane indicator names. @defaultValue ['VOL'] */
  subIndicators?: string[]
  /** History/live provider. The host owns its lifetime, including when shared across charts. */
  datafeed: Datafeed
  /** Name resolution failed; the current symbol is retained. */
  onSymbolResolveError?: (error: SymbolResolveError) => void
  /**
   * Receive startup warnings and current-operation failures after chart state settles.
   * Replaces console warning/error output; a no-op callback silences it. Exceptions are isolated.
   * Stale/disposed work and normal selection abort/supersession do not emit diagnostics.
   */
  onDiagnostic?: (diagnostic: ChartDiagnostic) => void
}

/** Public chart handle implemented by KLineChartPro. Dispose it when the host unmounts. */
export interface ChartPro {
  /** Capture a serializable workspace. Throws while loading/restoring, after a data failure or after disposal. */
  getWorkspace(): import('./workspace').ChartWorkspaceState
  /** Restore a workspace; resolves after data/state restoration and rejects on invalid state, failure or interruption. */
  applyWorkspace(state: import('./workspace').ChartWorkspaceState): Promise<void>
  /** Release the chart and its listeners. Safe to call repeatedly; shared datafeeds remain host-owned. */
  dispose(): void
  /** Latest notified selection, or null before the first notification and after disposal. */
  getSelection(): ChartSelection | null
  /**
   * Observe future selection/loading changes, including UI changes. Does not replay the current state.
   * Read getSelection for the current state. Returns an unsubscribe function; after disposal it is a no-op.
   */
  subscribeSelectionChange(listener: (selection: ChartSelection) => void): () => void
  /** Observe disposal before component cleanup. Returns an unsubscribe function; after disposal it is a no-op. */
  subscribeDispose(listener: () => void): () => void
  /**
   * Apply a selection and load fresh initial history, even for an unchanged selection.
   * Resolves with the effective selection after interval snapping; empty history resolves with dataReady false.
   * Rejects with ChartSelectionError on failure, abort, supersession by another selection intent, or disposal.
   * Abort after the selection commits stops the wait without rolling back or cancelling shared feed transport.
   */
  setSelection(request: ChartSelectionRequest, options?: ChartSelectionOptions): Promise<ChartSelection>
  /** Change the theme; built-ins are 'light' and 'dark'. */
  setTheme(theme: string): void
  /** Current theme key. */
  getTheme(): string
  /** Apply partial style overrides to the bundled core. */
  setStyles(styles: DeepPartial<Styles>): void
  /** Current resolved core styles. */
  getStyles(): Styles
  /** Change the locale; use loadLocales to register additional dictionaries. */
  setLocale(locale: string): void
  /** Current locale key. */
  getLocale(): string
  /** Change the IANA display timezone, for example 'Etc/UTC'. */
  setTimezone(timezone: string): void
  /** Current display timezone key. */
  getTimezone(): string
  /**
   * Select resolved metadata or a name such as 'BINANCE:BTCUSDT'. Name resolution is asynchronous
   * when the feed supplies resolveSymbol; otherwise ticker/exchange are derived from the name.
   * Returns immediately. Observe selection/loading changes with subscribeSelectionChange.
   */
  setSymbol(symbol: SymbolInfo | string): void
  /** Current effective symbol; retains the previous symbol while a name is resolving. */
  getSymbol(): SymbolInfo
  /** Current effective symbol, as returned by getSymbol. */
  resolvedSymbol(): SymbolInfo
  /** Select an interval; unsupported intervals can snap to an available one. Data loads asynchronously. */
  setPeriod(period: Period): void
  /** Current effective interval. */
  getPeriod(): Period
  /** Bundled core chart, or null before core initialization and after disposal. */
  getChart(): Nullable<Chart>
}
