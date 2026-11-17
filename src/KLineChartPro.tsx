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

import { render } from 'solid-js/web'

import { utils, Nullable, DeepPartial, Styles, Chart } from 'klinecharts'

import ChartProComponent, { type ChartProComponentApi } from './ChartProComponent'

import { SymbolInfo, Period, ChartPro, ChartProOptions, ChartSelection } from './types'

/** Browser chart widget. Import hypecharts/styles.css and dispose the instance when its host unmounts. */
export default class KLineChartPro implements ChartPro {
  /** Render into an existing container with a nonzero height. The host owns the supplied datafeed. */
  constructor (options: ChartProOptions) {
    if (utils.isString(options.container)) {
      this._container = document.getElementById(options.container as string)
      if (!this._container) {
        throw new Error('Container is null')
      }
    } else {
      this._container = options.container as HTMLElement
    }
    this._container.classList.add('klinecharts-pro')
    this._container.setAttribute('data-theme', options.theme ?? 'light')

    this._dispose = render(
      () => (
        <ChartProComponent
          ref={(chart: ChartProComponentApi) => { this._chartApi = chart }}
          styles={options.styles ?? {}}
          theme={options.theme ?? 'light'}
          locale={options.locale ?? 'zh-CN'}
          drawingBarVisible={options.drawingBarVisible ?? true}
          symbol={options.symbol}
          period={options.period}
          periods={
            options.periods ?? [
              { multiplier: 1, timespan: 'minute', text: '1m' },
              { multiplier: 5, timespan: 'minute', text: '5m' },
              { multiplier: 15, timespan: 'minute', text: '15m' },
              { multiplier: 1, timespan: 'hour', text: '1H' },
              { multiplier: 2, timespan: 'hour', text: '2H' },
              { multiplier: 4, timespan: 'hour', text: '4H' },
              { multiplier: 1, timespan: 'day', text: 'D' },
              { multiplier: 1, timespan: 'week', text: 'W' },
              { multiplier: 1, timespan: 'month', text: 'M' },
              { multiplier: 1, timespan: 'year', text: 'Y' }
            ]
          }
          quickPeriods={options.quickPeriods ?? ['15m', '1h', '4h']}
          timezone={options.timezone ?? 'Asia/Shanghai'}
          mainIndicators={options.mainIndicators ?? ['MA']}
          subIndicators={options.subIndicators ?? ['VOL']}
          onSelectionChange={selection => {
            this._selection = selection
            for (const listener of [...this._selectionListeners]) {
              if (this._disposing) break
              try { listener(selection) } catch (error) { console.error('Chart selection listener failed', error) }
            }
          }}
          onSymbolResolveError={options.onSymbolResolveError}
          datafeed={options.datafeed}/>
      ),
      this._container
    )
  }

  private _container: Nullable<HTMLElement>

  private _chartApi: Nullable<ChartProComponentApi> = null

  private _dispose: Nullable<() => void> = null

  private _selection: ChartSelection | null = null
  private _selectionListeners = new Set<(selection: ChartSelection) => void>()
  private _disposeListeners = new Set<() => void>()
  private _disposing = false

  /** Capture a serializable workspace; throws while loading/restoring, after a data failure or disposal. */
  getWorkspace (): import('./workspace').ChartWorkspaceState {
    if (!this._chartApi || this._disposing) throw new Error('Chart is disposed')
    return this._chartApi.getWorkspace()
  }
  /** Restore a workspace; resolves after restoration and rejects on invalid state, failure or interruption. */
  applyWorkspace (state: import('./workspace').ChartWorkspaceState): Promise<void> {
    if (!this._chartApi || this._disposing) return Promise.reject(new Error('Chart is disposed'))
    return this._chartApi.applyWorkspace(state)
  }

  /** Latest notified selection, or null before the first notification and after disposal. */
  getSelection (): ChartSelection | null { return this._selection }

  /** Observe future selection/loading changes without replay. Read getSelection for current state. Returns an unsubscribe function. */
  subscribeSelectionChange (listener: (selection: ChartSelection) => void): () => void {
    if (this._disposing || this._dispose === null) return () => {}
    this._selectionListeners.add(listener)
    return () => { this._selectionListeners.delete(listener) }
  }

  /** Observe disposal before component cleanup. Returns an unsubscribe function; subscribing after disposal is a no-op. */
  subscribeDispose (listener: () => void): () => void {
    if (this._disposing || this._dispose === null) return () => {}
    this._disposeListeners.add(listener)
    return () => { this._disposeListeners.delete(listener) }
  }

  /** Release this chart and its listeners. Safe to call repeatedly; the host retains ownership of shared datafeeds. */
  dispose (): void {
    if (this._dispose === null || this._disposing) return
    this._disposing = true
    const listeners = [...this._disposeListeners]
    this._disposeListeners.clear()
    this._selectionListeners.clear()
    this._selection = null
    try {
      for (const listener of listeners) {
        try { listener() } catch (error) { console.error('Chart disposal listener failed', error) }
      }
      this._dispose()
    } finally {
      this._dispose = null
      this._chartApi = null
      this._container?.classList.remove('klinecharts-pro')
      this._container?.removeAttribute('data-theme')
      this._container = null
    }
  }

  /** Change the theme; built-ins are 'light' and 'dark'. */
  setTheme (theme: string): void {
    this._container?.setAttribute('data-theme', theme)
    this._chartApi!.setTheme(theme)
  }

  /** Current theme key. */
  getTheme (): string {
    return this._chartApi!.getTheme()
  }

  /** Apply partial style overrides to the bundled chart core. */
  setStyles(styles: DeepPartial<Styles>): void {
    this._chartApi!.setStyles(styles)
  }

  /** Current resolved core styles. */
  getStyles(): Styles {
    return this._chartApi!.getStyles()
  }

  /** Change the locale; use loadLocales to register additional dictionaries. */
  setLocale (locale: string): void {
    this._chartApi!.setLocale(locale)
  }

  /** Current locale key. */
  getLocale (): string {
    return this._chartApi!.getLocale()
  }

  /** Change the IANA display timezone, for example 'Etc/UTC'. */
  setTimezone (timezone: string): void {
    this._chartApi!.setTimezone(timezone)
  }

  /** Current display timezone key. */
  getTimezone (): string {
    return this._chartApi!.getTimezone()
  }

  /** Select metadata or resolve a name through the feed. Returns immediately; observe completion with subscribeSelectionChange. */
  setSymbol (symbol: SymbolInfo | string): void {
    this._chartApi!.setSymbol(symbol)
  }

  /** Current effective symbol; retains the previous symbol while a name is resolving. */
  getSymbol (): SymbolInfo {
    return this._chartApi!.getSymbol()
  }

  /** Current effective symbol, as returned by getSymbol. */
  resolvedSymbol (): SymbolInfo {
    return this._chartApi!.resolvedSymbol()
  }

  /** Select an interval; unsupported intervals can snap to an available one. Data loads asynchronously. */
  setPeriod (period: Period): void {
    this._chartApi!.setPeriod(period)
  }

  /** Current effective interval. */
  getPeriod (): Period {
    return this._chartApi!.getPeriod()
  }

  /** Bundled core chart, or null before core initialization and after disposal. */
  getChart (): Nullable<Chart> {
    return this._chartApi?.getChart() ?? null
  }
}
