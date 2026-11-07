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

import ChartProComponent from './ChartProComponent'

import { SymbolInfo, Period, ChartPro, ChartProOptions } from './types'

export default class KLineChartPro implements ChartPro {
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
          ref={(chart: ChartPro) => { this._chartApi = chart }}
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
          onSymbolResolveError={options.onSymbolResolveError}
          datafeed={options.datafeed}/>
      ),
      this._container
    )
  }

  private _container: Nullable<HTMLElement>

  private _chartApi: Nullable<ChartPro> = null

  private _dispose: Nullable<() => void> = null

  dispose (): void {
    this._dispose?.()
    this._dispose = null
    this._chartApi = null
    this._container?.classList.remove('klinecharts-pro')
    this._container?.removeAttribute('data-theme')
    this._container = null
  }

  setTheme (theme: string): void {
    this._container?.setAttribute('data-theme', theme)
    this._chartApi!.setTheme(theme)
  }

  getTheme (): string {
    return this._chartApi!.getTheme()
  }

  setStyles(styles: DeepPartial<Styles>): void {
    this._chartApi!.setStyles(styles)
  }

  getStyles(): Styles {
    return this._chartApi!.getStyles()
  }

  setLocale (locale: string): void {
    this._chartApi!.setLocale(locale)
  }

  getLocale (): string {
    return this._chartApi!.getLocale()
  }

  setTimezone (timezone: string): void {
    this._chartApi!.setTimezone(timezone)
  }

  getTimezone (): string {
    return this._chartApi!.getTimezone()
  }

  setSymbol (symbol: SymbolInfo | string): void {
    this._chartApi!.setSymbol(symbol)
  }

  getSymbol (): SymbolInfo {
    return this._chartApi!.getSymbol()
  }

  resolvedSymbol (): SymbolInfo {
    return this._chartApi!.resolvedSymbol()
  }

  setPeriod (period: Period): void {
    this._chartApi!.setPeriod(period)
  }

  getPeriod (): Period {
    return this._chartApi!.getPeriod()
  }

  getChart (): Nullable<Chart> {
    return this._chartApi!.getChart()
  }
}
