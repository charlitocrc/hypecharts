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

import { registerIndicator, registerOverlay, setMaxPixelRatio } from 'klinecharts'

import overlays from './extension'
import indicators from './indicator'

import KLineChartPro from './KLineChartPro'
import { createChartGrid, createChartSyncGroup } from './multiChart'

import { load } from './i18n'

import { aggregateBars, parsePeriodText, periodText } from './aggregate'

import { Datafeed, SymbolInfo, Period, DatafeedSubscribeCallback, ChartProOptions, ChartPro,
  DatafeedConfiguration, DatafeedExchange, DatafeedSymbolType, SymbolSearchFilters,
  SymbolSearchResult, SymbolResolveError, SymbolResolveErrorCode } from './types'

import './index.less'

overlays.forEach(o => { registerOverlay(o) })
indicators.forEach(i => { registerIndicator(i) })

export {
  KLineChartPro,
  createChartSyncGroup,
  createChartGrid,
  aggregateBars,
  parsePeriodText,
  periodText,
  setMaxPixelRatio,
  load as loadLocales
}
export type { ChartSyncGroup, ChartSyncGroupOptions, ChartGrid, ChartGridOptions } from './multiChart'

export * from './datafeeds'

export type {
  Datafeed, SymbolInfo, Period, DatafeedSubscribeCallback, ChartProOptions, ChartPro,
  DatafeedConfiguration, DatafeedExchange, DatafeedSymbolType, SymbolSearchFilters,
  SymbolSearchResult, SymbolResolveError, SymbolResolveErrorCode
}
export type { KLineData } from 'klinecharts'
