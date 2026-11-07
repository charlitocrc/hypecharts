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

import { createSignal, createEffect, createMemo, onMount, Show, onCleanup, startTransition, untrack, Component } from 'solid-js'

import {
  init, dispose, utils, Nullable, Chart, OverlayMode, OverlayCreate, Styles,
  TooltipIconPosition, ActionType, PaneOptions, Indicator, DomPosition, FormatDateType,
  KLineData, CandleStyle, CandleType, Overlay, Point, Coordinate,
  setMaxPixelRatio
} from 'klinecharts'

import lodashSet from 'lodash/set'
import lodashClone from 'lodash/cloneDeep'

import { SelectDataSourceItem, Loading, Empty, Button } from './component'

import {
  PeriodBar, DrawingBar, IndicatorModal, TimezoneModal, SettingModal,
  ScreenshotModal, IndicatorSettingModal, TextEditorModal, SymbolSearchModal
} from './widget'

import { POSITION_TOOLS, PositionSide, getPositionCoordinates } from './extension/position'
import { TEXT_TOOLS, getText } from './extension/annotation'
import { FREEHAND_TOOLS, shouldSample } from './extension/brush'
import { DATA_DRAWING_TOOLS, buildDerivedDrawingData } from './extension/derived'
import {
  ChartType, divergenceIndex, heikinAshi, heikinAshiBar, isBrickType, isLineLockedPeriod, isSynthetic, nativeCandleType, renkoBoxSize, resolveChartTypeForPeriod, transformBars
} from './chartType'

import { DRAWING_GROUP_ID } from './widget'
import type { CursorMode } from './widget/drawing-bar'

import { bindShortcuts, toggleFullScreen } from './shortcuts'
import { DrawingHistory } from './drawingHistory'
import { DrawingManager, DrawingEditor } from './widget/drawing-manager'
import type { DrawingItem } from './widget/drawing-manager/model'
import type { IndicatorSettingParams } from './widget/indicator-setting-modal'
import { plotDefaults } from './widget/indicator-setting-modal/model'
import { presetToOverlayParts } from './widget/drawing-manager/model'

import {
  read, readMigrated, write, drawingsKey, indicatorsKey, indicatorLayoutChanges, indicatorType, nextIndicatorId, symbolKey,
  toStoredDrawing, toStoredIndicator, toStoredIndicatorLayout,
  readIndicatorFavorites, writeIndicatorFavorites, readIndicatorTemplates, writeIndicatorTemplates,
  readToolbarFavorites, writeToolbarFavorites, readDrawingPresets, readDefaultDrawingPresets, writeDefaultDrawingPresets,
  readSymbolRecents, writeSymbolRecents, readSymbolPeriods, writeSymbolPeriod,
  SETTINGS_KEY, VIEWPORT_KEY, StoredDrawing, StoredIndicator, StoredIndicatorLayout, StoredSettings,
  StoredIndicatorTemplate, StoredSymbolRecent, PlotStyle, StoredCompareTarget
} from './persist'

import { parseSymbolName, qualifiedSymbolName, snapPeriod, effectivePeriods as intersectPeriods, periodDurationMs } from './symbolSelect'
import GoToDateModal from './widget/go-to-date-modal'
import IntervalBuilderModal from './widget/interval-builder-modal'
import { mapHtfBuckets } from './indicator/timeframe'
import { compareTooltipValues } from './indicator/compare'
import type { CompareMode } from './compare'
import { alignSeries, fillLeadingGaps, nextCompareColor, normalizeCompareValues } from './compare'

import { translateTimezone } from './widget/timezone-modal/data'

import { parsePeriodText } from './aggregate'
import type { AggregatingDatafeed } from './datafeeds/aggregate'

import i18n from './i18n'

import { SymbolInfo, Period, ChartProOptions, ChartPro, DatafeedConfiguration, SymbolResolveError, SymbolSearchResult } from './types'

export interface ChartProComponentProps extends Required<Omit<ChartProOptions, 'container' | 'onSymbolResolveError'>> {
  ref: (chart: ChartPro) => void
  onSymbolResolveError?: (error: SymbolResolveError) => void
}

interface ChartSnapshot {
  drawings: DrawingItem[]
  indicators: StoredIndicatorLayout
  chartType: ChartType
  settings: { styles: Record<string, unknown> | null, timezone: string }
}

interface PrevSymbolPeriod {
  symbol: SymbolInfo
  period: Period
}

function createIndicator (
  widget: Nullable<Chart>,
  indicatorName: string,
  isStack?: boolean,
  paneOptions?: PaneOptions,
  stored?: StoredIndicator
): Nullable<string> {
  if (indicatorType(indicatorName) === 'VOL') {
    paneOptions = { gap: { bottom: 2 }, ...paneOptions }
  }
  return widget?.createIndicator({
    name: indicatorName,
    calcParams: stored?.calcParams,
    visible: stored?.visible,
    // @ts-expect-error
    styles: stored?.plots ? { plots: stored.plots } : undefined,
    // IND-002 calculation inputs (source / offset / higher timeframe)
    ...(stored?.source !== undefined ? { source: stored.source } : {}),
    ...(stored?.offset !== undefined ? { offset: stored.offset } : {}),
    ...(stored?.timeframe !== undefined ? { timeframe: stored.timeframe } : {}),
    // M5: compare target rides extendData; the manager fills values after fetch.
    // Restored layouts keep their stored scale mode (pre-independent saves stay
    // pinned); 'independent' also flags the instance as own-scale.
    ...(stored?.compare !== undefined
      ? {
          extendData: { symbol: stored.compare, mode: stored.compare.mode ?? 'pinned', values: [] },
          ownScale: (stored.compare.mode ?? 'pinned') === 'independent' || undefined
        }
      : {}),
    createTooltipDataSource: params => {
      const { indicator, defaultStyles } = params
      const icons = []
      if (indicator.visible) {
        icons.push(defaultStyles.tooltip.icons[1])
        icons.push(defaultStyles.tooltip.icons[2])
        icons.push(defaultStyles.tooltip.icons[3])
      } else {
        icons.push(defaultStyles.tooltip.icons[0])
        icons.push(defaultStyles.tooltip.icons[2])
        icons.push(defaultStyles.tooltip.icons[3])
      }
      // M5: on a percentage price scale the compare legend rebases to percent
      // (same first-visible-close base the axis and crosshair use).
      if (indicatorType(indicator.name) === 'COMPARE') {
        return { values: compareTooltipValues(params), icons }
      }
      return { icons }
    }
  }, isStack, paneOptions) ?? null
}

const ChartProComponent: Component<ChartProComponentProps> = props => {
  let widgetRef: HTMLDivElement | undefined = undefined
  let widget: Nullable<Chart> = null

  let chartActionsRef: HTMLDivElement | undefined = undefined

  let contextMenuRef: HTMLDivElement | undefined = undefined

  let priceUnitDom: HTMLElement

  let candlePricePrecision = props.symbol?.pricePrecision ?? 2
  let candleVolumePrecision = props.symbol?.volumePrecision ?? 0

  const buildDateTimeFormat = (timezone?: string): Intl.DateTimeFormat => {
    const options: Intl.DateTimeFormatOptions = {
      hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }
    if (timezone) {
      options.timeZone = timezone
    }
    try {
      return new Intl.DateTimeFormat('en', options)
    } catch (e) {
      return new Intl.DateTimeFormat('en')
    }
  }

  let candleDateTimeFormat = buildDateTimeFormat(props.timezone)

  const candleTooltipLegends = (data: { current: KLineData }, candleStyles: CandleStyle) => {
    const k = data.current
    const labelColor = candleStyles?.tooltip?.text?.color ?? '#76808F'
    const titleColor = theme() === 'dark' ? '#DEDEDE' : '#1B1B1B'
    const bar = candleStyles?.bar
    const valueColor = k.close > k.open
      ? (bar?.upColor ?? '#10B981')
      : (k.close < k.open ? (bar?.downColor ?? '#ba4a4a') : (bar?.noChangeColor ?? '#888888'))
    const s = symbol()
    const name = s?.shortName ?? s?.name ?? s?.ticker ?? ''
    const price = (v: number) => utils.formatPrecision(v, candlePricePrecision)
    const timeFormat = period().timespan === 'second' ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD HH:mm'
    return [
      { title: '', value: { text: name, color: titleColor } },
      { title: { text: 'Time: ', color: labelColor }, value: { text: utils.formatDate(candleDateTimeFormat, k.timestamp, timeFormat), color: labelColor } },
      { title: { text: 'O: ', color: labelColor }, value: { text: price(k.open), color: valueColor } },
      { title: { text: 'H: ', color: labelColor }, value: { text: price(k.high), color: valueColor } },
      { title: { text: 'L: ', color: labelColor }, value: { text: price(k.low), color: valueColor } },
      { title: { text: 'C: ', color: labelColor }, value: { text: price(k.close), color: valueColor } },
      { title: { text: 'V: ', color: labelColor }, value: { text: utils.formatBigNumber(utils.formatPrecision(k.volume ?? candleStyles?.tooltip?.defaultValue ?? 'n/a', candleVolumePrecision)), color: valueColor } }
    ]
  }

  let loadingMore = false
  let reqId = 0
  let unbindShortcuts: Nullable<() => void> = null

  const [theme, setTheme] = createSignal(props.theme)
  const [styles, setStyles] = createSignal(props.styles)
  const [locale, setLocale] = createSignal(props.locale)

  const [symbol, setSymbol] = createSignal(props.symbol)
  const [period, setPeriod] = createSignal(props.period)
  const [indicatorModalVisible, setIndicatorModalVisible] = createSignal(false)

  const [feedConfig, setFeedConfig] = createSignal<DatafeedConfiguration | null>(null)
  const [symbolSearchVisible, setSymbolSearchVisible] = createSignal(false)
  const [symbolSearchMode, setSymbolSearchMode] = createSignal<'symbol' | 'compare'>('symbol')
  const [symbolRecents, setSymbolRecents] = createSignal<StoredSymbolRecent[]>(readSymbolRecents())
  // Name → resolved SymbolInfo, in-memory for this chart's lifetime only.
  const resolveCache = new Map<string, SymbolInfo>()

  // Period-bar universe: host options ∩ symbol intervals ∩ feed config intervals,
  // plus intervals built at runtime through the interval builder (UX-002).
  // Builder-made periods bypass the symbol/feed constraints — an aggregating
  // feed can serve them for any symbol, so a symbol's native grid must not
  // hide them. They are inserted by duration to keep the menu ascending.
  const [customPeriods, setCustomPeriods] = createSignal<Period[]>([])
  const effectivePeriods = createMemo(() => {
    const base = intersectPeriods([...props.periods], [symbol()?.intervals, feedConfig()?.intervals])
    const list = [...base]
    for (const period of customPeriods()) {
      if (list.some(candidate => candidate.multiplier === period.multiplier && candidate.timespan === period.timespan)) continue
      const duration = periodDurationMs(period)
      const index = list.findIndex(candidate => periodDurationMs(candidate) > duration)
      if (index < 0) list.push(period)
      else list.splice(index, 0, period)
    }
    return list
  })

  /**
   * Register a builder-made interval: declared to an aggregating datafeed so it
   * can actually serve the series, added to the selectable universe and
   * persisted so a reload restores it. An interval the feed already offers
   * (or no aggregating feed) just switches the period.
   */
  const addCustomInterval = (period: Period): void => {
    if (effectivePeriods().some(candidate => candidate.multiplier === period.multiplier && candidate.timespan === period.timespan)) {
      changePeriod(period)
      return
    }
    ;(props.datafeed as unknown as Partial<AggregatingDatafeed>).declareInterval?.(period)
    setCustomPeriods(current => [...current, period])
    changePeriod(period)
  }

  const searchAvailable = (): boolean =>
    typeof props.datafeed.searchSymbols === 'function' && feedConfig()?.supportsSearch !== false

  /** setSymbol with the additive string overload: resolves through the datafeed. */
  const applySymbol = (input: SymbolInfo | string): void => {
    if (typeof input !== 'string') {
      setSymbol(input)
      return
    }
    const name = input
    const cached = resolveCache.get(name)
    if (cached) {
      setSymbol(cached)
      return
    }
    const parsed = parseSymbolName(name)
    const resolve = props.datafeed.resolveSymbol
    if (!resolve) {
      // Degraded feeds have no resolver: derive the symbol from the parsed
      // name on top of the current one.
      setSymbol({
        ...untrack(symbol),
        ticker: parsed.ticker,
        ...(parsed.exchange !== undefined ? { exchange: parsed.exchange } : {})
      })
      return
    }
    resolve(name).then(info => {
      resolveCache.set(name, info)
      setSymbol(info)
    }).catch(error => {
      props.onSymbolResolveError?.({
        name,
        code: error?.code === 'unknown_exchange' ? 'unknown_exchange' : 'unknown_symbol'
      })
    })
  }

  // A string constructor symbol resolves through the feed exactly like
  // setSymbol(name): the load effect must never fetch against a bare name.
  if (typeof props.symbol === 'string') applySymbol(props.symbol)

  const openSymbolSearch = (mode: 'symbol' | 'compare' = 'symbol'): void => {
    if (!searchAvailable()) return
    setSymbolSearchMode(mode)
    setSymbolSearchVisible(true)
  }

  const pushSymbolRecent = (result: SymbolSearchResult): void => {
    const recent: StoredSymbolRecent = { exchange: result.exchange, ticker: result.ticker }
    if (result.symbol !== undefined) recent.symbol = result.symbol
    if (result.description !== undefined) recent.description = result.description
    if (result.market !== undefined) recent.market = result.market
    if (result.type !== undefined) recent.type = result.type
    const next = [
      recent,
      ...symbolRecents().filter(item => !(item.exchange.toUpperCase() === recent.exchange.toUpperCase() && item.ticker === recent.ticker))
    ].slice(0, 10)
    setSymbolRecents(next)
    writeSymbolRecents(next)
  }

  /** Period selection from the UI: also remembered per symbol (SQ-4). */
  const changePeriod = (next: Period): void => {
    // Persist BEFORE updating the signal: the period-memory effect below runs
    // on the signal flush and reads this map — writing first keeps what it
    // reads in sync with the click.
    writeSymbolPeriod(symbolKey(untrack(symbol)), next.text)
    setPeriod(next)
  }

  // ---- IND-002: higher-timeframe studies --------------------------------
  // The vendor computes each study over `instance.timeframeData` when it is an
  // array aligned with the chart data; we own fetching/subscribing the HTF
  // series and mapping its buckets onto chart bars.
  const htfSeries = new Map<string, KLineData[]>()
  const htfSubs = new Map<string, { period: Period, symbol: SymbolInfo }>()

  const periodForTimeframe = (tf: string): Period | undefined =>
    props.periods.find(period => period.text === tf)

  const ensureHtfBars = async (ticker: string, period: Period): Promise<KLineData[]> => {
    const key = `${ticker}|${period.text}`
    let bars = htfSeries.get(key)
    if (bars === undefined) {
      const now = Date.now()
      const [from, to] = adjustFromTo(period, now, 2000)
      bars = await props.datafeed.getHistoryKLineData(untrack(symbol), period, from, to)
      htfSeries.set(key, bars)
    }
    if (!htfSubs.has(key)) {
      const subSymbol = untrack(symbol)
      htfSubs.set(key, { period, symbol: subSymbol })
      props.datafeed.subscribe(subSymbol, period, bar => {
        const current = htfSeries.get(key)
        if (current === undefined || current.length === 0) return
        const last = current[current.length - 1]
        if (bar.timestamp === last.timestamp) current[current.length - 1] = bar
        else if (bar.timestamp > last.timestamp) current.push(bar)
        void refreshHtfIndicators()
      })
    }
    return bars
  }

  /** Re-align every higher-timeframe study and recalculate it. */
  const refreshHtfIndicators = async (): Promise<void> => {
    const chart = widget
    if (!chart) return
    const chartData = chart.getDataList()
    if (chartData.length === 0) return
    const jobs: Promise<unknown>[] = []
    const consider = (name: string, paneId: string): void => {
      const indicator = chart.getIndicatorByPaneId(paneId, name) as Nullable<{ timeframe?: string, timeframeData?: KLineData[] }>
      if (!indicator?.timeframe) return
      const period = periodForTimeframe(indicator.timeframe)
      if (!period) return
      const ticker = symbolKey(untrack(symbol))
      jobs.push(ensureHtfBars(ticker, period).then(bars => {
        indicator.timeframeData = mapHtfBuckets(chartData, bars)
        return chart.calcInstance(name, paneId)
      }))
    }
    mainIndicators().forEach(name => consider(name, 'candle_pane'))
    Object.entries(subIndicators()).forEach(([name, paneId]) => consider(name, paneId))
    await Promise.all(jobs).catch(() => {})
  }

  /** Drop HTF fetch/subscription state that no live study references. */
  const pruneHtfState = (): void => {
    const used = new Set<string>()
    const scan = (name: string, paneId: string): void => {
      const indicator = widget?.getIndicatorByPaneId(paneId, name) as Nullable<{ timeframe?: string }>
      if (indicator?.timeframe) used.add(`${symbolKey(symbol())}|${indicator.timeframe}`)
    }
    mainIndicators().forEach(name => scan(name, 'candle_pane'))
    Object.entries(subIndicators()).forEach(([name, paneId]) => scan(name, paneId))
    ;[...htfSubs.entries()].forEach(([key, sub]) => {
      if (!used.has(key)) {
        props.datafeed.unsubscribe(sub.symbol, sub.period)
        htfSubs.delete(key)
        htfSeries.delete(key)
      }
    })
  }

  // ---- M5 increment 1: compare symbols on the main pane ------------------
  // COMPARE instances carry their target in extendData; this manager fetches
  // and live-subscribes each target series, aligns it onto the chart's
  // timestamps, normalizes it (pinned to the main series' first close) and
  // swaps extendData + recalcs. See docs/m5-compare.md.
  const compareBars = new Map<string, KLineData[]>()
  const compareSubs = new Map<string, { symbol: SymbolInfo, period: Period }>()
  // Compare trades stream at trade frequency; each refresh re-aligns the whole
  // series and recalculates the instance, so live refreshes are coalesced to
  // the same cadence as the main line's realtime updates.
  const COMPARE_REFRESH_INTERVAL = 120
  let compareRefreshTimer: Nullable<ReturnType<typeof setTimeout>> = null
  // History backfill bookkeeping: one settled fetch per compare key, with
  // throttled retries when the first attempt fails.
  const COMPARE_HISTORY_RETRY_MS = 5000
  const compareHistoryDone = new Set<string>()
  const compareHistoryTried = new Map<string, number>()

  const scheduleCompareRefresh = (): void => {
    if (compareRefreshTimer !== null) return
    compareRefreshTimer = setTimeout(() => {
      compareRefreshTimer = null
      void refreshCompares()
    }, COMPARE_REFRESH_INTERVAL)
  }

  const compareTargets = (): Array<{ name: string, target: StoredCompareTarget, mode: CompareMode }> => {
    const chart = widget
    if (!chart) return []
    const out: Array<{ name: string, target: StoredCompareTarget, mode: CompareMode }> = []
    mainIndicators().forEach(name => {
      if (indicatorType(name) !== 'COMPARE') return
      const instance = chart.getIndicatorByPaneId('candle_pane', name) as Nullable<{ extendData?: { symbol?: StoredCompareTarget, mode?: CompareMode } }>
      const target = instance?.extendData?.symbol
      if (target) out.push({ name, target, mode: instance?.extendData?.mode ?? 'pinned' })
    })
    return out
  }

  const addCompare = async (result: SymbolSearchResult): Promise<void> => {
    const chart = widget
    if (!chart) return
    // Comparing the same symbol twice is a no-op; the existing series refreshes.
    const existing = compareTargets().find(entry =>
      entry.target.ticker === result.ticker &&
      (entry.target.exchange ?? '').toUpperCase() === result.exchange.toUpperCase())
    if (existing) {
      void refreshCompares()
      return
    }
    const taken = compareTargets().map(entry => {
      const instance = chart.getIndicatorByPaneId('candle_pane', entry.name) as any
      return instance?.styles?.plots?.compare?.color ?? ''
    }).filter(Boolean)
    const id = nextIndicatorId('COMPARE', [...mainIndicators(), ...Object.keys(subIndicators())])
    const shortName = result.symbol ?? result.ticker
    const target: StoredCompareTarget = {
      ticker: result.ticker,
      exchange: result.exchange,
      market: result.market,
      shortName,
      // WORK-001: new compares draw in their own scale so differently-priced
      // symbols never stretch the main chart's candles.
      mode: 'independent'
    }
    const created = createIndicator(chart, id, true, { id: 'candle_pane' }, {
      name: id,
      compare: target,
      plots: { compare: { color: nextCompareColor(taken) } }
    })
    if (!created) return
    setMainIndicators([...mainIndicators(), id])
    persistIndicators(activeIndicatorTicker, historyLabel('history_add_compare', shortName))
    void refreshCompares()
  }

  const ensureCompareBars = async (target: StoredCompareTarget, period: Period): Promise<KLineData[]> => {
    const key = `${symbolKey(target)}|${period.text}`
    let bars = compareBars.get(key)
    if (bars === undefined) {
      // The live subscription is registered BEFORE the history fetch: if the
      // fetch fails (rate limit, network hiccup), streaming trades still grow
      // the series and a later refresh pass retries the backfill — the
      // compare used to die completely until a layout change re-ran it.
      bars = []
      compareBars.set(key, bars)
    }
    if (!compareSubs.has(key)) {
      const subSymbol: SymbolInfo = {
        ticker: target.ticker,
        exchange: target.exchange,
        market: target.market,
        shortName: target.shortName,
        name: target.name
      }
      compareSubs.set(key, { symbol: subSymbol, period })
      props.datafeed.subscribe(subSymbol, period, bar => {
        const current = compareBars.get(key)
        if (current === undefined) return
        const last = current[current.length - 1]
        // An empty series (thin 1s seeds start before the fetch window) grows
        // from its first live bar instead of staying empty forever.
        if (last === undefined || bar.timestamp > last.timestamp) current.push(bar)
        else if (bar.timestamp === last.timestamp) current[current.length - 1] = bar
        else return
        scheduleCompareRefresh()
      })
    }
    // Backfill history once per key, merged into whatever live bars have
    // accumulated (deduped by timestamp). A failed backfill is retried on a
    // later refresh pass instead of taking the series down.
    if (!compareHistoryDone.has(key) && Date.now() - (compareHistoryTried.get(key) ?? 0) > COMPARE_HISTORY_RETRY_MS) {
      compareHistoryTried.set(key, Date.now())
      try {
        const now = Date.now()
        const [from, to] = adjustFromTo(period, now, 500)
        const fetched = await props.datafeed.getHistoryKLineData(
          { ticker: target.ticker, exchange: target.exchange, market: target.market, shortName: target.shortName, name: target.name },
          period, from, to
        )
        compareHistoryDone.add(key)
        const byTimestamp = new Map<number, KLineData>()
        for (const bar of fetched) byTimestamp.set(bar.timestamp, bar)
        for (const bar of bars) if (!byTimestamp.has(bar.timestamp)) byTimestamp.set(bar.timestamp, bar)
        const merged = [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp)
        compareBars.set(key, merged)
        bars = merged
      } catch {
        // Keep the live-grown bars; the backfill retries after the window.
      }
    }
    return bars
  }

  /** Re-align every compare instance against the current chart data. */
  const refreshCompares = async (): Promise<void> => {
    const chart = widget
    if (!chart) return
    const chartData = chart.getDataList()
    if (chartData.length === 0) return
    const anchorClose = chartData[0].close
    const timestamps = chartData.map(bar => bar.timestamp)
    const jobs: Promise<unknown>[] = []
    compareTargets().forEach(({ name, target, mode }) => {
      jobs.push(ensureCompareBars(target, untrack(period)).then(bars => {
        const aligned = fillLeadingGaps(alignSeries(timestamps, bars))
        const values = normalizeCompareValues(aligned, anchorClose, mode)
        if (!values) return
        const instance = chart.getIndicatorByPaneId('candle_pane', name) as any
        const existing = instance?.extendData ?? {}
        chart.overrideIndicator({
          name,
          extendData: {
            ...existing,
            symbol: target,
            mode,
            values
          },
          ownScale: mode === 'independent',
          ...(instance?.shortName === 'COMPARE' && target.shortName ? { shortName: target.shortName } : {})
        } as any, 'candle_pane')
      }))
    })
    await Promise.all(jobs).catch(() => {})
  }

  /** Drop compare fetch/subscription state whose instance disappeared. */
  const pruneCompareState = (): void => {
    const used = new Set<string>()
    compareTargets().forEach(({ target }) => used.add(`${symbolKey(target)}|${untrack(period).text}`))
    ;[...compareSubs.entries()].forEach(([key, sub]) => {
      if (!used.has(key)) {
        props.datafeed.unsubscribe(sub.symbol, sub.period)
        compareSubs.delete(key)
        compareBars.delete(key)
        compareHistoryDone.delete(key)
        compareHistoryTried.delete(key)
      }
    })
  }

  const [indicatorFavorites, setIndicatorFavorites] = createSignal(readIndicatorFavorites())
  const [toolbarFavorites, setToolbarFavorites] = createSignal(readToolbarFavorites())
  const [drawingPresets] = createSignal(readDrawingPresets())
  const [defaultDrawingPresets, setDefaultDrawingPresets] = createSignal(readDefaultDrawingPresets())

  const toggleToolbarFavorite = (name: string): void => {
    const next = toolbarFavorites().includes(name)
      ? toolbarFavorites().filter(item => item !== name)
      : [...toolbarFavorites(), name]
    setToolbarFavorites(next)
    writeToolbarFavorites(next)
  }

  const setDefaultDrawingPreset = (tool: string, name: string | null): void => {
    const next = { ...defaultDrawingPresets() }
    if (name === null) delete next[tool]
    else next[tool] = name
    setDefaultDrawingPresets(next)
    writeDefaultDrawingPresets(next)
  }
  const [indicatorTemplates, setIndicatorTemplates] = createSignal(readIndicatorTemplates())

  const toggleIndicatorFavorite = (name: string): void => {
    const next = indicatorFavorites().includes(name)
      ? indicatorFavorites().filter(item => item !== name)
      : [...indicatorFavorites(), name]
    setIndicatorFavorites(next)
    writeIndicatorFavorites(next)
  }

  const addIndicatorFromTemplate = (template: StoredIndicatorTemplate, placement: 'main' | 'sub'): void => {
    const id = nextIndicatorId(template.typeId, [...mainIndicators(), ...Object.keys(subIndicators())])
    const stored: StoredIndicator = {
      name: template.typeId,
      calcParams: template.calcParams,
      plots: template.plots,
      source: template.source,
      offset: template.offset,
      timeframe: template.timeframe
    }
    if (placement === 'main') {
      if (createIndicator(widget, id, true, { id: 'candle_pane' }, stored)) setMainIndicators([...mainIndicators(), id])
    } else {
      const paneId = createIndicator(widget, id, true, undefined, stored)
      if (paneId) setSubIndicators({ ...subIndicators(), [id]: paneId })
    }
    persistIndicators(activeIndicatorTicker, historyLabel('history_add_indicator', id))
  }

  // IND-004: relocate a study — onto the candles, stacked into another
  // existing pane, or into a fresh sub-pane — keeping params, styles, inputs
  // and compare wiring (and the pane height for sub-pane moves).
  const moveIndicatorToPane = (name: string, fromPaneId: string, targetId: string): void => {
    const chart = widget
    if (!chart || targetId === fromPaneId) return
    const onMain = fromPaneId === 'candle_pane'
    const stored = snapshotIndicator(name, fromPaneId, true)
    chart.removeIndicator(fromPaneId, name)
    if (onMain) {
      setMainIndicators(mainIndicators().filter(item => item !== name))
    } else {
      const next = { ...subIndicators() }
      delete next[name]
      setSubIndicators(next)
    }
    let created: Nullable<string> = null
    let finalPaneId = targetId
    if (targetId === 'candle_pane') {
      created = createIndicator(chart, name, true, { id: 'candle_pane' }, stored)
    } else if (targetId === '__new__' || (chart as any).getPaneById?.(targetId) == null) {
      // A stale target id (panes are re-created on symbol switches) degrades
      // to a fresh pane rather than a silent candle-pane fallback.
      created = createIndicator(chart, name, true, undefined, stored)
      finalPaneId = created ?? ''
    } else {
      created = createIndicator(chart, name, true, { id: targetId }, stored)
    }
    if (!created) {
      // Creation failed — put the study back where it was instead of losing it.
      const restored = createIndicator(chart, name, true, onMain ? { id: 'candle_pane' } : undefined, stored)
      if (onMain) setMainIndicators([...mainIndicators(), name])
      else if (restored) setSubIndicators({ ...subIndicators(), [name]: restored })
      return
    }
    if (finalPaneId === 'candle_pane') {
      setMainIndicators([...mainIndicators(), name])
    } else {
      setSubIndicators({ ...subIndicators(), [name]: finalPaneId })
      if (stored.height !== undefined) {
        chart.setPaneOptions({ id: finalPaneId, height: stored.height } as any)
      }
    }
    void refreshHtfIndicators()
    void refreshCompares()
    persistIndicators(activeIndicatorTicker, historyLabel('history_move_indicator', name))
  }

  const saveIndicatorTemplate = (name: string, template: { typeId: string, calcParams?: number[], plots?: Record<string, PlotStyle>, source?: string, offset?: number, timeframe?: string }): void => {
    const next: StoredIndicatorTemplate[] = [
      ...readIndicatorTemplates().filter(item => item.name !== name),
      {
        id: `tpl_${Date.now().toString(36)}`,
        name,
        typeId: template.typeId,
        calcParams: template.calcParams,
        plots: template.plots,
        source: template.source,
        offset: template.offset,
        timeframe: template.timeframe
      }
    ]
    writeIndicatorTemplates(next)
    setIndicatorTemplates(next)
  }

  const deleteIndicatorTemplate = (id: string): void => {
    const next = readIndicatorTemplates().filter(item => item.id !== id)
    writeIndicatorTemplates(next)
    setIndicatorTemplates(next)
  }

  const renameIndicatorTemplate = (id: string, name: string): void => {
    const next = readIndicatorTemplates().map(item => item.id === id ? { ...item, name } : item)
    writeIndicatorTemplates(next)
    setIndicatorTemplates(next)
  }
  const [mainIndicators, setMainIndicators] = createSignal([...(props.mainIndicators!)])
  const [subIndicators, setSubIndicators] = createSignal<Record<string, string>>({})

  const storedSettings = read<StoredSettings>(SETTINGS_KEY) ?? {}

  const [timezoneModalVisible, setTimezoneModalVisible] = createSignal(false)
  const [goToDateVisible, setGoToDateVisible] = createSignal(false)
  const [intervalBuilderVisible, setIntervalBuilderVisible] = createSignal(false)
  const initialTimezone = storedSettings.timezone ?? props.timezone
  const [timezone, setTimezone] = createSignal<SelectDataSourceItem>({ key: initialTimezone, text: translateTimezone(initialTimezone, props.locale) })

  const [settingModalVisible, setSettingModalVisible] = createSignal(false)
  const [widgetDefaultStyles, setWidgetDefaultStyles] = createSignal<Styles>()

  const [screenshotUrl, setScreenshotUrl] = createSignal('')

  const [drawingBarVisible, setDrawingBarVisible] = createSignal(storedSettings.drawingBarVisible ?? props.drawingBarVisible)

  const initialCursorMode: CursorMode = storedSettings.cursorMode === 'arrow' ? 'arrow' : 'crosshair'
  const [cursorMode, setCursorMode] = createSignal<CursorMode>(initialCursorMode)

  const [storedStyles, setStoredStyles] = createSignal(storedSettings.styles ?? null)

  const storedCandleType = (storedSettings.chartType ?? storedSettings.styles?.['candle.type'] ?? props.styles?.candle?.type ?? CandleType.CandleSolid) as ChartType
  // preSecondChartType is set whenever a 1s session locked the chart to a line;
  // it is the user's real preference, so it wins on restore.
  const initialCandleType = resolveChartTypeForPeriod(props.period,
    (storedSettings.preSecondChartType as ChartType | undefined) ?? storedCandleType)
  const [candleType, setCandleType] = createSignal<ChartType>(initialCandleType)
  let rawData: KLineData[] = []
  let boxSize = 0
  let preSecondCandleType: Nullable<ChartType> = null

  const [contextMenu, setContextMenu] = createSignal({ visible: false, x: 0, y: 0, price: '' })

  const [loadingVisible, setLoadingVisible] = createSignal(false)

  // Auto-follow live edge: pinned while the last bar is on screen, released
  // the moment the user scrolls it off.
  let followLive = true

  const [barCountdownVisible, setBarCountdownVisible] = createSignal(storedSettings.barCountdown ?? false)
  const toggleBarCountdown = (): void => {
    setBarCountdownVisible(visible => !visible)
    closeContextMenu()
  }

  // Performance mode caps canvas backing stores at DPR 1: quarter the pixels
  // of a hidpi screen, same layout and data. The cap is global (every chart on
  // the page) because it models one hardware trade-off, not a per-chart style.
  const [performanceMode, setPerformanceMode] = createSignal(storedSettings.performanceMode ?? false)
  const applyPerformanceMode = (enabled: boolean): void => {
    setMaxPixelRatio(enabled ? 1 : undefined)
    // _paintLayer re-scales a canvas whenever its effective ratio changes, so
    // a plain repaint is enough to apply (or lift) the cap mid-session.
    widget?.resize()
  }
  const togglePerformanceMode = (): void => {
    const next = !performanceMode()
    setPerformanceMode(next)
    applyPerformanceMode(next)
    closeContextMenu()
  }

  const [dataState, setDataState] = createSignal<'ok' | 'empty' | 'error'>('ok')
  const [retryTick, setRetryTick] = createSignal(0)

  const [keyHint, setKeyHint] = createSignal('')

  const [activeTool, setActiveTool] = createSignal('')
  const [continuousDrawing, setContinuousDrawing] = createSignal(false)

  const closedIndicatorSettings = { visible: false, indicatorName: '', paneId: '', calcParams: [], plots: [] }
  const [indicatorSettingModalParams, setIndicatorSettingModalParams] = createSignal<IndicatorSettingParams & { visible: boolean }>(closedIndicatorSettings)

  let activeIndicatorTicker: Nullable<string> = null
  let indicatorsReady = false
  let restoringIndicators = false

  const snapshotIndicator = (name: string, paneId: string, withHeight = false): StoredIndicator => {
    const indicator = widget?.getIndicatorByPaneId(paneId, name) as Nullable<Indicator>
    return toStoredIndicator({
      name,
      calcParams: indicator?.calcParams,
      visible: indicator?.visible,
      plots: (indicator?.styles as any)?.plots,
      height: withHeight ? widget?.getSize(paneId)?.height : undefined,
      source: (indicator as any)?.source,
      offset: (indicator as any)?.offset,
      timeframe: (indicator as any)?.timeframe,
      compare: (indicator as any)?.extendData?.symbol
    }) ?? { name }
  }

  const indicatorLayout = (withHeights = false): StoredIndicatorLayout => ({
    main: mainIndicators().map(name => snapshotIndicator(name, 'candle_pane')),
    sub: Object.entries(subIndicators()).map(([name, paneId]) => snapshotIndicator(name, paneId, withHeights))
  })

  const historyLabel = (key: string, name?: string): string =>
    i18n(key, props.locale).replace('{name}', name ? indicatorType(name) : '')

  const persistIndicators = (ticker: Nullable<string> = activeIndicatorTicker, label = ''): void => {
    if (!indicatorsReady || restoringIndicators || ticker === null) {
      return
    }
    write(indicatorsKey(ticker), indicatorLayout(true))
    if (label && ticker === activeIndicatorTicker) recordHistory(label)
  }

  const applyIndicatorLayout = (next: StoredIndicatorLayout): void => {
    if (!widget) return
    const { remove, add, update } = indicatorLayoutChanges(indicatorLayout(), next)
    const main = new Set(mainIndicators())
    const sub = { ...subIndicators() }
    remove.forEach(({ main: onMain, item }) => {
      widget!.removeIndicator(onMain ? 'candle_pane' : sub[item.name], item.name)
      if (onMain) main.delete(item.name)
      else delete sub[item.name]
    })
    update.forEach(({ main: onMain, item }) => {
      widget!.overrideIndicator({
        name: item.name, calcParams: item.calcParams, visible: item.visible, styles: { plots: item.plots ?? {} }
      } as any, onMain ? 'candle_pane' : sub[item.name])
    })
    add.forEach(({ main: onMain, item }) => {
      if (onMain) {
        if (createIndicator(widget, item.name, true, { id: 'candle_pane' }, item)) main.add(item.name)
      } else {
        // ponytail: a re-added study gets a new bottom pane; restoring its old pane position needs pane reordering (IND-004)
        const paneId = createIndicator(widget, item.name, true, undefined, item)
        if (paneId) sub[item.name] = paneId
      }
    })
    setMainIndicators(next.main.map(item => item.name).filter(id => main.has(id)))
    setSubIndicators(sub)
  }

  const restoreIndicators = (ticker: string, legacyTicker: string): void => {
    if (!widget) return
    restoringIndicators = true

    mainIndicators().forEach(name => { widget?.removeIndicator('candle_pane', name) })
    Object.entries(subIndicators()).forEach(([name, paneId]) => {
      widget?.removeIndicator(paneId, name)
    })

    const layout = toStoredIndicatorLayout(readMigrated<unknown>(indicatorsKey(ticker), indicatorsKey(legacyTicker))) ??
      toStoredIndicatorLayout({ main: props.mainIndicators, sub: props.subIndicators }) ??
      { main: [], sub: [] }
    const nextMain: string[] = []
    const nextSub: Record<string, string> = {}

    layout.main.forEach(item => {
      if (createIndicator(widget, item.name, true, { id: 'candle_pane' }, item)) {
        nextMain.push(item.name)
      }
    })
    layout.sub.forEach(item => {
      const paneId = createIndicator(widget, item.name, true, item.height ? { height: item.height } : undefined, item)
      if (paneId) nextSub[item.name] = paneId
    })

    setMainIndicators(nextMain)
    setSubIndicators(nextSub)
    restoringIndicators = false
  }

  const [drawingManagerVisible, setDrawingManagerVisible] = createSignal(false)
  const [drawingEditor, setDrawingEditor] = createSignal<DrawingItem | null>(null)
  const [drawingItems, setDrawingItems] = createSignal<DrawingItem[]>([])
  const [historyState, setHistoryState] = createSignal({ canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' })
  const drawingHistory = new DrawingHistory<ChartSnapshot>()
  drawingHistory.reset({ drawings: [], indicators: { main: [], sub: [] }, chartType: initialCandleType, settings: { styles: storedStyles(), timezone: timezone().key } })
  let drawingTransaction = false

  const [textEditor, setTextEditor] = createSignal<Nullable<{ id: string, text: string, isNew: boolean }>>(null)

  const modalVisible = () => (
    indicatorModalVisible() || timezoneModalVisible() || goToDateVisible() || intervalBuilderVisible() || settingModalVisible() ||
    screenshotUrl().length > 0 || indicatorSettingModalParams().visible || textEditor() !== null || drawingEditor() !== null ||
    symbolSearchVisible()
  )

  const applyCursorMode = (mode: CursorMode) => {
    const paneIds = ['candle_pane', ...Object.values(subIndicators())]
    if (!widget) {
      return
    }
    widget.setStyles({ crosshair: { show: mode === 'crosshair' } })
    const cursor = mode === 'arrow' ? 'default' : 'crosshair'
    const doms = [widget.getDom(), ...paneIds.map(paneId => widget!.getDom(paneId, DomPosition.Main))]
    doms.forEach(dom => { if (dom) dom.style.cursor = cursor })
  }

  const applyCandleType = (type: ChartType) => {
    widget?.setStyles({ candle: { type: nativeCandleType(type) } })
  }

  const presentData = () => {
    const type = untrack(candleType)
    if (type === 'renko') boxSize = renkoBoxSize(rawData)
    widget?.applyNewData(transformBars(type, rawData, boxSize), !isBrickType(type) && rawData.length > 0)
  }

  const syncBricks = (next: KLineData[]) => {
    if (!widget) return
    const list = widget.getDataList()
    const start = divergenceIndex(list, next)
    if (start === null) return
    // ponytail: klinecharts has no remove API; trimming its live array and re-pushing avoids applyNewData snapping the viewport to realtime
    list.splice(start)
    next.slice(start).forEach(item => widget!.updateData(item))
  }

  // Trade streams fire per trade — dozens of times per second on liquid
  // pairs, doubled when a compare symbol streams alongside — and every chart
  // update clears + repaints all panes. The data list is mutated immediately
  // while the canvas catches up on a fixed cadence: the line stays stable and
  // the last price advances smoothly instead of strobing the whole chart.
  const REALTIME_UPDATE_INTERVAL = 120
  let realtimeUpdateTimer: Nullable<ReturnType<typeof setTimeout>> = null
  let realtimeUpdateDirty = false
  let realtimeScrollPending = false

  const flushRealtimeUpdate = () => {
    realtimeUpdateTimer = null
    if (!realtimeUpdateDirty || !widget) return
    realtimeUpdateDirty = false
    const last = rawData[rawData.length - 1]
    if (last) widget.updateData(last)
    if (realtimeScrollPending) {
      realtimeScrollPending = false
      // Keep the right edge pinned while the user is following it; scrolling
      // away has already cleared followLive via OnVisibleRangeChange.
      if (followLive) widget.scrollToRealTime()
    }
    refreshDataDrawings()
  }

  const scheduleRealtimeUpdate = () => {
    realtimeUpdateDirty = true
    if (realtimeUpdateTimer !== null) return
    realtimeUpdateTimer = setTimeout(flushRealtimeUpdate, REALTIME_UPDATE_INTERVAL)
  }

  /** Drop queued realtime updates (stale bars must never land on a new dataset). */
  const resetRealtimeQueue = () => {
    realtimeUpdateDirty = false
    realtimeScrollPending = false
    if (realtimeUpdateTimer !== null) {
      clearTimeout(realtimeUpdateTimer)
      realtimeUpdateTimer = null
    }
    flowBaseGap = null
  }

  // ---- 1s flow: the line walks the chart in real time ---------------------
  // On second periods the right edge glides continuously. Each frame grows
  // the series to the current second (carry-forward closes — a straight line
  // when no trades print, curving when they do) and slides the right gap
  // through the fraction of the second elapsed, so the newest point travels
  // smoothly into its slot instead of popping once per bucket.
  let flowFrame: number | null = null
  let flowBaseGap: number | null = null
  let flowStyleActive = false

  const flowTick = () => {
    flowFrame = requestAnimationFrame(flowTick)
    if (!widget) return
    const active = isLineLockedPeriod(untrack(period)) && followLive && !document.hidden
    if (active !== flowStyleActive) {
      flowStyleActive = active
      // Tells the vendor's candle-area view to draw the line past the newest
      // bar toward the right margin (the virtual pen tip).
      widget.setStyles({ flowLine: active })
    }
    if (!active) return
    const timeScale = (widget as unknown as { getChartStore: () => { getTimeScaleStore: () => { getOffsetRightDistance: () => number } } }).getChartStore().getTimeScaleStore()
    const barSpace = widget.getBarSpace()
    const frac = (Date.now() % 1000) / 1000
    if (flowBaseGap === null) {
      // Fresh dataset: settle the walking edge on a clean margin (a fraction
      // of the pane width, clamped) so the flow starts composed.
      const mainSize = widget.getSize?.('candle_pane', DomPosition.Main)
      flowBaseGap = mainSize?.width ? Math.max(48, Math.min(120, mainSize.width * 0.09)) : timeScale.getOffsetRightDistance()
      return
    }
    // Grow walking bars to the current second (carry-forward closes — the
    // straight-line walk when no trades print). The vendor extends the drawn
    // line to the margin through the second, so the tip paints continuously.
    // Compare series align onto these bars, so let their manager refresh too.
    const nowBucket = Math.floor(Date.now() / 1000) * 1000
    let last = rawData[rawData.length - 1]
    let grewWalkingBars = false
    if (last && nowBucket > last.timestamp) {
      let guard = 0
      while (last.timestamp < nowBucket && guard++ < 90) {
        const carry: KLineData = { timestamp: last.timestamp + 1000, open: last.close, high: last.close, low: last.close, close: last.close, volume: 0 }
        rawData.push(carry)
        widget.updateData(carry)
        last = carry
        grewWalkingBars = true
      }
    }
    if (grewWalkingBars) scheduleCompareRefresh()
    // Slide the right gap through the fraction of the second elapsed: the
    // walking bar departs the margin slot and the pen tip stays pinned at
    // the margin, painting the segment between them.
    widget.setOffsetRightDistance(flowBaseGap + barSpace * frac)
  }

  const applyRealtimeBar = (data: KLineData) => {
    // A 1s series can start with an empty history page (thin trade seed); the
    // first live bar means the chart is alive, so clear empty/error states.
    if (dataState() !== 'ok') setDataState('ok')
    const last = rawData[rawData.length - 1]
    const isNewBar = last === undefined || data.timestamp > last.timestamp
    if (last && data.timestamp < last.timestamp) return
    if (last && data.timestamp === last.timestamp) rawData[rawData.length - 1] = data
    else rawData.push(data)
    const type = untrack(candleType)
    if (!isSynthetic(type)) {
      scheduleRealtimeUpdate()
      // On second periods the flow loop owns the edge (its offset glide is
      // the scroll), so the realtime path must not also snap to realtime.
      if (isNewBar && !isLineLockedPeriod(untrack(period))) realtimeScrollPending = true
    } else if (type === 'heikin_ashi') {
      const list = widget?.getDataList() ?? []
      const tail = list[list.length - 1]
      const previous = tail?.timestamp === data.timestamp ? list[list.length - 2] : tail
      widget?.updateData(heikinAshiBar(data, previous))
    } else {
      syncBricks(transformBars(type, rawData, boxSize))
    }
  }

  const reapplyChartModes = () => {
    untrack(() => {
      applyCursorMode(cursorMode())
      applyCandleType(candleType())
      applyLastPriceLineForPeriod(untrack(period))
    })
  }

  // 1s presentation: the walking line pins the newest price, so the horizontal
  // last-price line is noise on second periods — hide the line, keep the axis
  // badge (priceMark.last.text draws it, independent of .line.show).
  const applyLastPriceLineForPeriod = (p: Period): void => {
    widget?.setStyles({ candle: { priceMark: { last: { line: { show: !isLineLockedPeriod(p) } } } } })
  }

  const closeIndicatorSettings = () => {
    setIndicatorSettingModalParams(closedIndicatorSettings)
  }

  const overrideIndicatorAndPersist = (override: { name: string, visible?: boolean, calcParams?: number[], styles?: any, source?: string, offset?: number, timeframe?: string }, paneId: string, label: string) => {
    const ticker = activeIndicatorTicker
    widget?.overrideIndicator(override as any, paneId, () => {
      if (ticker === activeIndicatorTicker) persistIndicators(ticker, label)
    })
  }

  const closeModals = (): boolean => {
    if (!modalVisible()) {
      return false
    }
    cancelTextEditor()
    setDrawingEditor(null)
    setIndicatorModalVisible(false)
    setTimezoneModalVisible(false)
    setGoToDateVisible(false)
    setIntervalBuilderVisible(false)
    setSettingModalVisible(false)
    setScreenshotUrl('')
    setSymbolSearchVisible(false)
    closeIndicatorSettings()
    return true
  }

  props.ref({
    setTheme,
    getTheme: () => theme(),
    setStyles,
    getStyles: () => widget!.getStyles(),
    setLocale,
    getLocale: () => locale(),
    setTimezone: (timezone: string) => { setTimezone({ key: timezone, text: translateTimezone(props.timezone, locale()) }) },
    getTimezone: () => timezone().key,
    setSymbol: applySymbol,
    getSymbol: () => symbol(),
    resolvedSymbol: () => symbol(),
    setPeriod: changePeriod,
    getPeriod: () => period(),
    getChart: () => widget
  })

  const syncChartActionsWidth = () => {
    if (!widget || !chartActionsRef) {
      return
    }
    const yAxisDom = widget.getDom('candle_pane', DomPosition.YAxis)
    const width = yAxisDom?.clientWidth ?? 0
    if (width > 0) {
      chartActionsRef.style.width = `${width}px`
    }
  }

  const handleResize = () => {
    widget?.resize()
    syncChartActionsWidth()
  }

  let resizeObserver: Nullable<ResizeObserver> = null

  let menuOpenedAt = 0

  const closeContextMenu = () => {
    // The pointerup/click that ends a long press lands right after the menu
    // opens; without this it would close the menu it just opened.
    if (contextMenu().visible && Date.now() - menuOpenedAt > 300) {
      setContextMenu({ visible: false, x: 0, y: 0, price: '' })
    }
  }

  let longPressTimer = 0
  let longPressOrigin: Nullable<{ x: number, y: number }> = null

  const cancelLongPress = () => {
    if (longPressTimer) {
      window.clearTimeout(longPressTimer)
      longPressTimer = 0
    }
    longPressOrigin = null
  }

  const handlePointerDown = (e: PointerEvent) => {
    cancelLongPress()
    if (e.pointerType === 'mouse') {
      return
    }
    const x = e.clientX
    const y = e.clientY
    longPressOrigin = { x, y }
    longPressTimer = window.setTimeout(() => {
      longPressTimer = 0
      longPressOrigin = null
      openContextMenu(x, y)
    }, 500)
  }

  const handlePointerMove = (e: PointerEvent) => {
    if (!longPressOrigin) {
      return
    }
    // A finger never holds perfectly still; only a real drag should cancel.
    if (Math.abs(e.clientX - longPressOrigin.x) > 10 || Math.abs(e.clientY - longPressOrigin.y) > 10) {
      cancelLongPress()
    }
  }

  const openContextMenu = (clientX: number, clientY: number) => {
    if (!widget || !widgetRef) {
      return
    }
    const rect = widgetRef.getBoundingClientRect()
    const y = clientY - rect.top
    const point = widget.convertFromPixel([{ y }], { paneId: 'candle_pane', absolute: true })
    const value = Array.isArray(point) ? point[0]?.value : point?.value
    let price = ''
    if (typeof value === 'number' && isFinite(value)) {
      price = utils.formatPrecision(value, candlePricePrecision)
    }
    menuOpenedAt = Date.now()
    setContextMenu({ visible: true, x: clientX, y: clientY, price })
  }

  const handleWidgetContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    openContextMenu(e.clientX, e.clientY)
  }

  let selectedOverlayId: Nullable<string> = null
  let pendingOverlayId: Nullable<string> = null

  // Ids of every overlay this component created. createOverlay returns the id
  // synchronously, so membership never depends on a callback firing.
  const drawingIds = new Set<string>()
  const dataDrawingIds = new Set<string>()
  let restoredTicker: Nullable<string> = null
  let restoring = false
  let lastDrawing: Nullable<OverlayCreate> = null

  const refreshDataDrawing = (overlay: Nullable<Overlay>) => {
    if (!widget || !overlay || !DATA_DRAWING_TOOLS.has(overlay.name)) {
      return
    }
    const extendData = buildDerivedDrawingData(overlay.name, widget.getDataList(), overlay.points)
    if (extendData) {
      widget.overrideOverlay({ id: overlay.id, extendData })
    }
  }

  const refreshDataDrawings = () => {
    dataDrawingIds.forEach(id => {
      const overlay = widget?.getOverlayById(id)
      if (overlay) {
        refreshDataDrawing(overlay)
      } else {
        dataDrawingIds.delete(id)
      }
    })
  }

  const snapshotDrawings = (): DrawingItem[] => {
    const out: DrawingItem[] = []
    drawingIds.forEach(id => {
      const overlay = widget?.getOverlayById(id)
      if (!overlay || overlay.currentStep !== -1 || (textEditor()?.isNew && textEditor()?.id === id)) return
      const stored = toStoredDrawing(overlay, DRAWING_GROUP_ID)
      if (stored) out.push({ ...stored, id })
    })
    return lodashClone(out)
  }

  const updateHistoryState = () => setHistoryState({
    canUndo: drawingHistory.canUndo,
    canRedo: drawingHistory.canRedo,
    undoLabel: drawingHistory.undoLabel,
    redoLabel: drawingHistory.redoLabel
  })

  const snapshotChart = (drawings = snapshotDrawings()): ChartSnapshot =>
    ({
      drawings,
      indicators: indicatorLayout(true),
      chartType: untrack(candleType),
      settings: { styles: storedStyles(), timezone: timezone().key }
    })

  const recordHistory = (label: string, drawings?: DrawingItem[]) => {
    drawingHistory.record(snapshotChart(drawings), label)
    updateHistoryState()
  }

  const persistDrawings = (label = historyLabel('history_drawing')) => {
    if (restoring || drawingTransaction || !widget) return
    const out = snapshotDrawings()
    // Use the owner of the rendered drawings, even while the next symbol loads.
    write(drawingsKey(restoredTicker ?? symbolKey(symbol())), out.map(({ id, ...drawing }) => drawing))
    recordHistory(label, out)
    setDrawingItems(out)
  }

  const mutateDrawings = (action: () => void, label = historyLabel('history_drawings')) => {
    if (loadingVisible()) return
    drawingTransaction = true
    try { action() } finally { drawingTransaction = false }
    persistDrawings(label)
  }

  const removeDrawing = (id: string) => mutateDrawings(() => { widget?.removeOverlay(id) }, historyLabel('history_remove_drawing'))

  const toggleDrawing = (id: string, field: 'visible' | 'lock') => mutateDrawings(() => {
    const overlay = widget?.getOverlayById(id)
    if (overlay?.groupId === DRAWING_GROUP_ID) widget?.overrideOverlay({ id, [field]: !overlay[field] })
  }, historyLabel('history_edit_drawing'))

  const duplicateDrawing = (id: string) => mutateDrawings(() => {
    const original = snapshotDrawings().find(drawing => drawing.id === id)
    if (!original) return
    const { id: originalId, ...copy } = original
    // Rehydrate complete points; do not enter the interactive drawing mode.
    restoring = true
    try { createDrawing({ ...copy, lock: false, visible: true } as OverlayCreate) } finally { restoring = false }
    pendingOverlayId = null
    refreshDataDrawings()
  }, historyLabel('history_duplicate_drawing'))

  const saveDrawing = (drawing: DrawingItem) => {
    mutateDrawings(() => {
      if (widget?.getOverlayById(drawing.id)?.groupId !== DRAWING_GROUP_ID) return
      widget.overrideOverlay(drawing as OverlayCreate)
      refreshDataDrawing(widget.getOverlayById(drawing.id))
    }, historyLabel('history_edit_drawing'))
    setDrawingEditor(null)
  }

  const travelHistory = (direction: 'undo' | 'redo') => {
    if (loadingVisible() || modalVisible()) return
    if (cancelDrawing()) return
    const state = drawingHistory[direction]()
    if (state === null) return
    if (JSON.stringify(state.drawings) !== JSON.stringify(snapshotDrawings())) {
      replaceDrawings(state.drawings)
      write(drawingsKey(restoredTicker ?? symbolKey(symbol())), state.drawings.map(({ id, ...drawing }) => drawing))
    }
    applyIndicatorLayout(state.indicators)
    if (activeIndicatorTicker !== null) write(indicatorsKey(activeIndicatorTicker), indicatorLayout(true))
    if (state.chartType !== untrack(candleType)) changeCandleType(state.chartType, false)
    if (state.settings) {
      if (JSON.stringify(state.settings.styles) !== JSON.stringify(storedStyles())) setStoredStyles(state.settings.styles)
      if (state.settings.timezone !== timezone().key) {
        setTimezone({ key: state.settings.timezone, text: translateTimezone(state.settings.timezone, props.locale) })
      }
    }
    // pane heights ride along in every snapshot; re-apply them after a layout travel
    state.indicators.sub.forEach(item => {
      const paneId = subIndicators()[item.name]
      if (paneId !== undefined && item.height !== undefined) {
        widget?.setPaneOptions({ id: paneId, height: item.height } as any)
      }
    })
    updateHistoryState()
  }

  const historyTitle = (key: string, label: string): string =>
    i18n(key, props.locale).replace('{action}', label ? `${label} ` : '')

  const persistChartState = () => {
    persistDrawings()
    persistIndicators()
    if (widget) write(VIEWPORT_KEY, { barSpace: widget.getBarSpace() })
  }

  const firstOf = <T,>(value: T | T[]): T | undefined => Array.isArray(value) ? value[0] : value

  const rearmTool = () => {
    if (continuousDrawing() && lastDrawing) {
      createDrawing(lastDrawing)
    } else {
      setActiveTool('')
    }
  }

  // Manual double-click: klinecharts 9 has no overlay double-click event.
  let lastDrawingClick = { id: '', at: 0 }

  const drawingEvents = {
    onPressedMoveEnd: (event: { overlay: Overlay }) => {
      refreshDataDrawing(event.overlay)
      persistDrawings()
      return false
    },
    onRemoved: (event: { overlay: Overlay }) => {
      if (selectedOverlayId === event.overlay.id) {
        selectedOverlayId = null
      }
      dataDrawingIds.delete(event.overlay.id)
      if (drawingIds.delete(event.overlay.id)) {
        persistDrawings()
      }
      return false
    },
    onSelected: (event: { overlay: Overlay }) => {
      selectedOverlayId = event.overlay.id
      return false
    },
    onDeselected: (event: { overlay: Overlay }) => {
      if (selectedOverlayId === event.overlay.id) {
        selectedOverlayId = null
      }
      return false
    },
    onClick: (event: { overlay: Overlay }) => {
      const { id, name } = event.overlay
      if (TEXT_TOOLS.has(name)) {
        const now = Date.now()
        if (lastDrawingClick.id === id && now - lastDrawingClick.at < 400) {
          lastDrawingClick = { id: '', at: 0 }
          openTextEditor(id, false)
        } else {
          lastDrawingClick = { id, at: now }
        }
      }
      return false
    }
  }

  // A position is placed with one click; the target and stop are derived from
  // the pane size and bar width so the default box reads well at any zoom.
  const placePosition = (drawn: Overlay) => {
    if (!widget || drawn.points.length !== 1) {
      return
    }
    const entry = drawn.points[0]
    const px = firstOf(widget.convertToPixel(entry, { paneId: 'candle_pane' }))
    const size = widget.getSize('candle_pane', DomPosition.Main)
    if (px?.x === undefined || px.y === undefined || !size) {
      return
    }
    const [, target, stop] = getPositionCoordinates(drawn.name as PositionSide, { x: px.x, y: px.y }, size.height, widget.getBarSpace())
    const converted = widget.convertFromPixel([target, stop], { paneId: 'candle_pane' })
    const [t, s] = Array.isArray(converted) ? converted : [converted, converted]
    const edge = { timestamp: t?.timestamp, dataIndex: t?.dataIndex }
    widget.overrideOverlay({ id: drawn.id, points: [entry, { ...edge, value: t?.value }, { ...edge, value: s?.value }] })
  }

  // Measure is a throwaway read-out: never stored, gone on the next press or Esc.
  let measureId: Nullable<string> = null

  const clearMeasure = (): boolean => {
    widgetRef?.removeEventListener('mousedown', clearMeasure, true)
    widgetRef?.removeEventListener('touchstart', clearMeasure, true)
    if (!measureId) {
      return false
    }
    widget?.removeOverlay(measureId)
    measureId = null
    return true
  }

  const showMeasure = (id: string) => {
    clearMeasure()
    measureId = id
    widgetRef?.addEventListener('mousedown', clearMeasure, true)
    widgetRef?.addEventListener('touchstart', clearMeasure, { capture: true, passive: true })
  }

  const openTextEditor = (id: string, isNew: boolean) => {
    const overlay = widget?.getOverlayById(id)
    if (overlay) {
      setTextEditor({ id, text: getText(overlay), isNew })
    }
  }

  const confirmTextEditor = (text: string) => {
    const editor = textEditor()
    setTextEditor(null)
    if (!editor) {
      return
    }
    if (text.trim() === '') {
      widget?.removeOverlay(editor.id)
    } else {
      widget?.overrideOverlay({ id: editor.id, extendData: { text } })
      persistDrawings()
    }
    if (editor.isNew) {
      rearmTool()
    }
  }

  const cancelTextEditor = () => {
    const editor = textEditor()
    setTextEditor(null)
    if (editor?.isNew) {
      widget?.removeOverlay(editor.id)
      setActiveTool('')
    }
  }

  const createDrawing = (overlay: OverlayCreate): Nullable<string> => {
    if (!restoring && loadingVisible()) return null
    if (!restoring) {
      freehandTool = null
      if (FREEHAND_TOOLS.has(overlay.name)) {
        cancelDrawing()
        freehandTool = overlay
        lastDrawing = overlay
        setActiveTool(overlay.name)
        return null
      }
    }
    const defaultPresetName = defaultDrawingPresets()[overlay.name]
    const preset = defaultPresetName !== undefined
      ? drawingPresets().find(item => item.name === defaultPresetName)
      : undefined
    const presetParts = preset ? presetToOverlayParts(preset.draft, overlay.name) : {}
    const id = widget?.createOverlay({
      ...overlay,
      ...presetParts,
      groupId: DRAWING_GROUP_ID,
      ...drawingEvents,
      onDrawEnd: event => {
        pendingOverlayId = null
        const drawn = event.overlay
        if (drawn.name === 'measure') {
          showMeasure(drawn.id)
          setActiveTool('')
          return false
        }
        drawingIds.add(drawn.id)
        refreshDataDrawing(drawn)
        if (POSITION_TOOLS.has(drawn.name)) {
          placePosition(drawn)
        }
        if (!TEXT_TOOLS.has(drawn.name)) persistDrawings()
        if (restoring) {
          return false
        }
        if (TEXT_TOOLS.has(drawn.name)) {
          openTextEditor(drawn.id, true)
        } else {
          rearmTool()
        }
        return false
      }
    })
    pendingOverlayId = id ?? null
    if (id && overlay.name !== 'measure') {
      drawingIds.add(id)
      if (DATA_DRAWING_TOOLS.has(overlay.name)) {
        dataDrawingIds.add(id)
      }
    }
    if (!restoring) {
      lastDrawing = overlay
      setActiveTool(overlay.name)
    }
    return pendingOverlayId
  }

  // klinecharts builds drawings click by click, so freehand strokes are
  // captured here: the press is taken before the chart sees it (no panning),
  // points are sampled every few pixels, and the overlay is created with the
  // whole path and refreshed at most once per frame.
  let freehandTool: Nullable<OverlayCreate> = null
  let stroke: Nullable<{
    name: string
    id: Nullable<string>
    points: Array<Partial<Point>>
    dx: number[]
    last: Nullable<Coordinate>
    rect: DOMRect
    frame: number
  }> = null

  const flushStroke = () => {
    if (!stroke || !widget || stroke.points.length < 2) {
      return
    }
    const points = stroke.points.slice()
    const extendData = { dx: stroke.dx.slice() }
    if (stroke.id) {
      widget.overrideOverlay({ id: stroke.id, points, extendData })
    } else {
      stroke.id = widget.createOverlay({ ...freehandTool, name: stroke.name, groupId: DRAWING_GROUP_ID, points, extendData, ...drawingEvents })
    }
  }

  const sampleStroke = (clientX: number, clientY: number) => {
    if (!stroke || !widget) {
      return
    }
    const { rect } = stroke
    const next = {
      x: Math.min(Math.max(clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(clientY - rect.top, 0), rect.height)
    }
    if (!shouldSample(stroke.last, next)) {
      return
    }
    const point = firstOf(widget.convertFromPixel([next], { paneId: 'candle_pane' }))
    if (point?.dataIndex === undefined) {
      return
    }
    const center = firstOf(widget.convertToPixel({ dataIndex: point.dataIndex }, { paneId: 'candle_pane' }))
    const barSpace = widget.getBarSpace()
    stroke.points.push({ timestamp: point.timestamp, dataIndex: point.dataIndex, value: point.value })
    stroke.dx.push(center?.x === undefined || barSpace <= 0 ? 0 : Math.round((next.x - center.x) / barSpace * 1000) / 1000)
    stroke.last = next
    if (!stroke.frame) {
      stroke.frame = requestAnimationFrame(() => {
        if (stroke) {
          stroke.frame = 0
          flushStroke()
        }
      })
    }
  }

  const pointerOf = (e: MouseEvent | TouchEvent): { clientX: number, clientY: number } | undefined =>
    'touches' in e ? (e.touches[0] ?? e.changedTouches[0]) : e

  const onStrokeMove = (e: MouseEvent | TouchEvent) => {
    const p = pointerOf(e)
    if (!stroke || !p) {
      return
    }
    e.preventDefault()
    sampleStroke(p.clientX, p.clientY)
  }

  const onStrokeEnd = () => {
    window.removeEventListener('mousemove', onStrokeMove)
    window.removeEventListener('mouseup', onStrokeEnd)
    window.removeEventListener('touchmove', onStrokeMove)
    window.removeEventListener('touchend', onStrokeEnd)
    window.removeEventListener('touchcancel', onStrokeEnd)
    if (!stroke) {
      return
    }
    cancelAnimationFrame(stroke.frame)
    flushStroke()
    const id = stroke.id
    stroke = null
    if (id) {
      drawingIds.add(id)
      persistDrawings()
    }
    if (!continuousDrawing()) {
      freehandTool = null
      setActiveTool('')
    }
  }

  const onStrokeStart = (e: MouseEvent | TouchEvent) => {
    if (!freehandTool || !widget || stroke || ('button' in e && e.button !== 0)) {
      return
    }
    const p = pointerOf(e)
    const paneDom = widget.getDom('candle_pane', DomPosition.Main)
    if (!p || !paneDom) {
      return
    }
    const rect = paneDom.getBoundingClientRect()
    if (p.clientX < rect.left || p.clientX > rect.right || p.clientY < rect.top || p.clientY > rect.bottom) {
      return
    }
    e.stopPropagation()
    e.preventDefault()
    stroke = { name: freehandTool.name, id: null, points: [], dx: [], last: null, rect, frame: 0 }
    sampleStroke(p.clientX, p.clientY)
    window.addEventListener('mousemove', onStrokeMove)
    window.addEventListener('mouseup', onStrokeEnd)
    window.addEventListener('touchmove', onStrokeMove, { passive: false })
    window.addEventListener('touchend', onStrokeEnd)
    window.addEventListener('touchcancel', onStrokeEnd)
  }

  const flushDrawings = () => {
    if (document.visibilityState === 'hidden') {
      persistDrawings()
    }
  }

  const replaceDrawings = (drawings: StoredDrawing[]) => {
    restoring = true
    try {
      widget?.removeOverlay({ groupId: DRAWING_GROUP_ID })
      drawingIds.clear()
      dataDrawingIds.clear()
      drawings.forEach(item => { createDrawing(item as OverlayCreate) })
      refreshDataDrawings()
      pendingOverlayId = null
      selectedOverlayId = null
      setActiveTool('')
      setDrawingEditor(null)
    } finally { restoring = false }
    setDrawingItems(snapshotDrawings())
  }

  const restoreDrawings = (ticker: string, legacyTicker: string) => {
    const stored = readMigrated<StoredDrawing[]>(drawingsKey(ticker), drawingsKey(legacyTicker))
    replaceDrawings(Array.isArray(stored) ? stored : [])
    drawingHistory.reset(snapshotChart())
    updateHistoryState()
  }

  const cancelDrawing = (): boolean => {
    if (freehandTool) {
      freehandTool = null
      setActiveTool('')
      return true
    }
    if (!pendingOverlayId) {
      return false
    }
    widget?.removeOverlay(pendingOverlayId)
    pendingOverlayId = null
    setActiveTool('')
    return true
  }

  const removeSelectedDrawing = () => {
    if (!selectedOverlayId) {
      return
    }
    removeDrawing(selectedOverlayId)
    selectedOverlayId = null
  }

  const resetChart = () => {
    if (!widget) {
      return
    }
    widget.setBarSpace(6)
    const panes = (widget as any).getAllPanes?.()
    panes?.forEach((pane: any) => {
      const yAxis = pane?.getAxisComponent?.()
      if (yAxis && typeof yAxis.getAutoCalcTickFlag === 'function' && !yAxis.getAutoCalcTickFlag()) {
        yAxis.setAutoCalcTickFlag(true)
      }
    })
    widget.scrollToRealTime()
    ;(widget as any).adjustPaneViewport(false, true, true, true)
    closeContextMenu()
  }

  const changeCursorMode = (mode: CursorMode) => {
    cancelDrawing()
    setActiveTool('')
    setCursorMode(mode)
  }

  const changeCandleType = (rawType: ChartType, record = true) => {
    // Second periods render as lines only; any other type resolves to Line there.
    const type = resolveChartTypeForPeriod(untrack(period), rawType)
    const previous = candleType()
    setCandleType(type)
    // While line-locked the user's own chart-type preference stays untouched.
    if (!isLineLockedPeriod(untrack(period))) {
      setStoredStyles({ ...(storedStyles() ?? {}), 'candle.type': nativeCandleType(type) })
    }
    if (previous !== type && (isSynthetic(previous) || isSynthetic(type))) {
      presentData()
      refreshDataDrawings()
    }
    if (record && previous !== type) recordHistory(historyLabel('history_chart_type'))
  }

  const copyPrice = () => {
    const price = contextMenu().price
    const clipboard = (window as Window & {
      HLClipboard?: { copy: (text: string, options?: { message?: string }) => Promise<boolean> }
    }).HLClipboard
    if (price && clipboard?.copy) {
      clipboard.copy(price, { message: 'Price copied to clipboard' }).catch(() => {})
    }
    closeContextMenu()
  }

  // CSV of exactly what the user sees on screen right now.
  const exportVisibleCsv = () => {
    closeContextMenu()
    if (!widget) return
    const list = widget.getDataList()
    if (list.length === 0) return
    const range = (widget as any).getVisibleRange?.() ?? { from: 0, to: list.length - 1 }
    const from = Math.max(0, Math.floor(range.from))
    const to = Math.min(list.length - 1, Math.ceil(range.to))
    const price = (value: number): string => utils.formatPrecision(value, candlePricePrecision)
    const chart = widget
    // UX-004: one column per visible indicator figure (MA5, RSI, compare
    // prices, …), ordered main pane first, values at indicator precision.
    const indicatorColumns: Array<{ title: string, read: (dataIndex: number) => string }> = []
    const addIndicatorColumns = (name: string, paneId: string): void => {
      const indicator = chart.getIndicatorByPaneId(paneId, name) as Nullable<Indicator & { result?: Array<Record<string, number | undefined>> }>
      if (!indicator || indicator.visible === false) return
      const base = indicator.shortName || name
      ;(indicator.figures ?? []).forEach(figure => {
        if (!figure?.key) return
        let title = (indicator.figures ?? []).length > 1 ? `${base}.${figure.key}` : base
        let suffix = 2
        while (indicatorColumns.some(column => column.title === title)) title = `${base}~${suffix++}.${figure.key}`
        indicatorColumns.push({
          title,
          read: dataIndex => {
            const value = indicator.result?.[dataIndex]?.[figure.key]
            return typeof value === 'number' && Number.isFinite(value) ? utils.formatPrecision(value, indicator.precision) : ''
          }
        })
      })
    }
    mainIndicators().forEach(name => addIndicatorColumns(name, 'candle_pane'))
    Object.entries(subIndicators()).forEach(([name, paneId]) => addIndicatorColumns(name, paneId))
    const rows = [
      ['time,open,high,low,close,volume', ...indicatorColumns.map(column => column.title)].filter(part => part !== '').join(',')
    ]
    for (let index = from; index <= to; index++) {
      const bar = list[index]
      if (!bar) continue
      rows.push([
        [
          new Date(bar.timestamp).toISOString(),
          price(bar.open), price(bar.high), price(bar.low), price(bar.close),
          typeof bar.volume === 'number' ? String(bar.volume) : ''
        ].join(','),
        ...indicatorColumns.map(column => column.read(index))
      ].filter(part => part !== '').join(','))
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${symbolKey(symbol()).replace(/:/g, '-')}-${period().text}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  // UX-001 go-to-date: page older history in through the same applyMoreData
  // path the wheel uses until the loaded series covers the target (bounded —
  // a venue with no more pages ends the loop), then jump to it.
  let goingToHistory = false
  const goToTimestamp = async (target: number): Promise<void> => {
    if (!widget || goingToHistory) return
    if (isBrickType(untrack(candleType))) {
      // Synthetic brick series are seeded per session; there is no older
      // venue history to page through.
      widget.scrollToTimestamp(target, 0)
      return
    }
    goingToHistory = true
    loadingMore = true
    try {
      for (let attempt = 0; attempt < 60; attempt++) {
        const list = widget.getDataList()
        if (list.length === 0 || list[0].timestamp <= target) break
        const p = untrack(period)
        const [to] = adjustFromTo(p, list[0].timestamp - 1, 1)
        const [from] = adjustFromTo(p, to, 500)
        let older: KLineData[] = []
        try {
          older = await props.datafeed.getHistoryKLineData(untrack(symbol), p, from, to)
        } catch {
          break
        }
        if (older.length === 0) break
        rawData = older.concat(rawData)
        const type = untrack(candleType)
        widget.applyMoreData(type === 'heikin_ashi' ? heikinAshi(older) : older, older.length > 0)
        refreshDataDrawings()
        void refreshHtfIndicators()
        void refreshCompares()
      }
      widget.scrollToTimestamp(target, 0)
    } finally {
      loadingMore = false
      goingToHistory = false
    }
  }

  // Bar-close countdown label riding the y axis at the last close price.
  let countdownDom: Nullable<HTMLElement> = null
  let countdownTimer: Nullable<ReturnType<typeof setInterval>> = null

  const formatCountdown = (remainingMs: number): string => {
    const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000))
    const seconds = totalSeconds % 60
    const minutes = Math.floor(totalSeconds / 60) % 60
    const hours = Math.floor(totalSeconds / 3600)
    const twoDigits = (value: number): string => value.toString().padStart(2, '0')
    return hours > 0
      ? `${hours}:${twoDigits(minutes)}:${twoDigits(seconds)}`
      : `${twoDigits(minutes)}:${twoDigits(seconds)}`
  }

  const updateBarCountdown = () => {
    if (!countdownDom) return
    const hide = () => { countdownDom!.style.display = 'none' }
    // Second periods roll every second (and the flow walks them) — a bar
    // countdown there is noise, so it stays hidden regardless of the toggle.
    if (!barCountdownVisible() || !widget || loadingVisible() || isBrickType(untrack(candleType)) || isLineLockedPeriod(untrack(period))) {
      hide()
      return
    }
    const list = widget.getDataList()
    const last = list[list.length - 1]
    if (!last) {
      hide()
      return
    }
    const remaining = last.timestamp + periodDurationMs(untrack(period)) - Date.now()
    if (remaining > periodDurationMs(untrack(period))) {
      hide()
      return
    }
    const pixel = firstOf(widget.convertToPixel([{ dataIndex: list.length - 1, value: last.close }], { paneId: 'candle_pane' }))
    if (pixel?.y === undefined) {
      hide()
      return
    }
    countdownDom.textContent = formatCountdown(remaining)
    countdownDom.style.top = `${Math.round(pixel.y)}px`
    countdownDom.style.display = 'flex'
  }

  const adjustFromTo = (period: Period, toTimestamp: number, count: number) => {
    let to = toTimestamp
    let from = to
    switch (period.timespan) {
      case 'second': {
        to = to - (to % 1000)
        from = to - count * period.multiplier * 1000
        break
      }
      case 'minute': {
        to = to - (to % (60 * 1000))
        from = to - count * period.multiplier * 60 * 1000
        break
      }
      case 'hour': {
        to = to - (to % (60 * 60 * 1000))
        from = to - count * period.multiplier * 60 * 60 * 1000
        break
      }
      case 'day': {
        to = to - (to % (60 * 60 * 1000))
        from = to - count * period.multiplier * 24 * 60 * 60 * 1000
        break
      }
      case 'week': {
        const date = new Date(to)
        const week = date.getDay()
        const dif = week === 0 ? 6 : week - 1
        to = to - dif * 60 * 60 * 24
        const newDate = new Date(to)
        to = new Date(`${newDate.getFullYear()}-${newDate.getMonth() + 1}-${newDate.getDate()}`).getTime()
        from = count * period.multiplier * 7 * 24 * 60 * 60 * 1000
        break
      }
      case 'month': {
        const date = new Date(to)
        const year = date.getFullYear()
        const month = date.getMonth() + 1
        to = new Date(`${year}-${month}-01`).getTime()
        from = count * period.multiplier * 30 * 24 * 60 * 60 * 1000
        const fromDate = new Date(from)
        from = new Date(`${fromDate.getFullYear()}-${fromDate.getMonth() + 1}-01`).getTime()
        break
      }
      case 'year': {
        const date = new Date(to)
        const year = date.getFullYear()
        to = new Date(`${year}-01-01`).getTime()
        from = count * period.multiplier * 365 * 24 * 60 * 60 * 1000
        const fromDate = new Date(from)
        from = new Date(`${fromDate.getFullYear()}-01-01`).getTime()
        break
      }
    }
    return [from, to]
  }

  onMount(() => {
    // Before init: the first paint reads the ratio, so the cap must already
    // be in place when the setting is on.
    if (performanceMode()) setMaxPixelRatio(1)
    widget = init(widgetRef!, {
      customApi: {
        formatDate: (dateTimeFormat: Intl.DateTimeFormat, timestamp, format: string, type: FormatDateType) => {
          const p = period()
          switch (p.timespan) {
            case 'second': {
              if (type === FormatDateType.XAxis) {
                return utils.formatDate(dateTimeFormat, timestamp, 'HH:mm:ss')
              }
              return utils.formatDate(dateTimeFormat, timestamp, 'YYYY-MM-DD HH:mm:ss')
            }
            case 'minute': {
              if (type === FormatDateType.XAxis) {
                return utils.formatDate(dateTimeFormat, timestamp, 'HH:mm')
              }
              return utils.formatDate(dateTimeFormat, timestamp, 'YYYY-MM-DD HH:mm')
            }
            case 'hour': {
              if (type === FormatDateType.XAxis) {
                return utils.formatDate(dateTimeFormat, timestamp, 'MM-DD HH:mm')
              }
              return utils.formatDate(dateTimeFormat, timestamp, 'YYYY-MM-DD HH:mm')
            }
            case 'day':
            case 'week': return utils.formatDate(dateTimeFormat, timestamp, 'YYYY-MM-DD')
            case 'month': {
              if (type === FormatDateType.XAxis) {
                return utils.formatDate(dateTimeFormat, timestamp, 'YYYY-MM')
              }
              return utils.formatDate(dateTimeFormat, timestamp, 'YYYY-MM-DD')
            }
            case 'year': {
              if (type === FormatDateType.XAxis) {
                return utils.formatDate(dateTimeFormat, timestamp, 'YYYY')
              }
              return utils.formatDate(dateTimeFormat, timestamp, 'YYYY-MM-DD')
            }
          }
          return utils.formatDate(dateTimeFormat, timestamp, 'YYYY-MM-DD HH:mm')
        }
      }
    })

    if (widget) {
      const priceUnitContainer = widget.getDom('candle_pane', DomPosition.YAxis)
      priceUnitDom = document.createElement('span')
      priceUnitDom.className = 'klinecharts-pro-price-unit'
      priceUnitContainer?.appendChild(priceUnitDom)
      countdownDom = document.createElement('span')
      countdownDom.className = 'klinecharts-pro-countdown'
      countdownDom.style.display = 'none'
      priceUnitContainer?.appendChild(countdownDom)
    }

    syncChartActionsWidth()

    if (widgetRef) {
      resizeObserver = new ResizeObserver(handleResize)
      resizeObserver.observe(widgetRef)
    }

    // Feed capabilities (search filters, period fallback); optional.
    props.datafeed.config?.().then(config => { setFeedConfig(config) }).catch(() => {})

    // Restore builder-made intervals before the first period resolve so a
    // saved custom period (persisted per symbol) can re-declare itself to the
    // aggregating feed.
    const storedIntervals = (storedSettings.customIntervals ?? [])
      .map(text => parsePeriodText(text))
      .filter((period): period is Period => period !== null)
    if (storedIntervals.length > 0) {
      storedIntervals.forEach(period => {
        (props.datafeed as unknown as Partial<AggregatingDatafeed>).declareInterval?.(period)
      })
      setCustomPeriods(storedIntervals)
    }

    // Release the live-edge pin as soon as the user scrolls the last bar away.
    widget?.subscribeAction(ActionType.OnVisibleRangeChange, (range: { from: number, to: number }) => {
      const total = widget?.getDataList().length ?? 0
      if (total === 0) return
      followLive = range.to >= total - 1
    })

    countdownTimer = setInterval(updateBarCountdown, 500)
    flowFrame = requestAnimationFrame(flowTick)

    widgetRef?.addEventListener('mousedown', onStrokeStart, true)
    widgetRef?.addEventListener('touchstart', onStrokeStart, { capture: true, passive: false })
    widgetRef?.addEventListener('contextmenu', handleWidgetContextMenu)
    widgetRef?.addEventListener('pointerdown', handlePointerDown)
    widgetRef?.addEventListener('pointerup', cancelLongPress)
    widgetRef?.addEventListener('pointermove', handlePointerMove)
    widgetRef?.addEventListener('pointercancel', cancelLongPress)
    document.addEventListener('click', closeContextMenu)
    document.addEventListener('scroll', closeContextMenu, true)
    document.addEventListener('visibilitychange', flushDrawings)
    window.addEventListener('pagehide', persistChartState)

    unbindShortcuts = bindShortcuts({
      periods: () => props.periods,
      isBlocked: () => modalVisible() || loadingVisible(),
      isActive: () => {
        const root = widgetRef?.closest('.klinecharts-pro')
        return !!root && (root.contains(document.activeElement) ||
          (document.activeElement === document.body && root.matches(':hover')))
      },
      onPeriod: changePeriod,
      onSearch: () => openSymbolSearch('symbol'),
      onBufferChange: setKeyHint,
      onEscape: () => {
        if (contextMenu().visible) {
          closeContextMenu()
          return true
        }
        if (cancelDrawing() || clearMeasure()) {
          return true
        }
        if (closeModals()) return true
        if (drawingManagerVisible()) { setDrawingManagerVisible(false); return true }
        return false
      },
      onDelete: removeSelectedDrawing,
      onUndo: () => travelHistory('undo'),
      onRedo: () => travelHistory('redo'),
      onDraw: name => {
        createDrawing({ name, visible: true, lock: false })
      },
      onFullScreen: () => { toggleFullScreen(widgetRef?.closest('.klinecharts-pro') as Nullable<HTMLElement>) },
      onReset: resetChart,
      onScroll: direction => {
        const barSpace = widget?.getBarSpace() ?? 6
        widget?.scrollByDistance(direction * barSpace * 3, 100)
      },
      onZoom: direction => {
        const bounding = widget?.getSize('candle_pane', DomPosition.Main)
        widget?.zoomAtCoordinate(
          direction > 0 ? 1.12 : 1 / 1.12,
          { x: (bounding?.width ?? 0) / 2, y: (bounding?.height ?? 0) / 2 },
          180
        )
      }
    })

    activeIndicatorTicker = symbolKey(symbol())
    restoreIndicators(activeIndicatorTicker, symbol().ticker)
    indicatorsReady = true
    const barSpace = read<{ barSpace?: unknown }>(VIEWPORT_KEY)?.barSpace
    if (typeof barSpace === 'number' && barSpace >= 1 && barSpace <= 50) widget?.setBarSpace(barSpace)
    widget?.loadMore(timestamp => {
      if (loadingMore) {
        return
      }
      loadingMore = true
      const get = async () => {
        const p = period()
        const [to] = adjustFromTo(p, timestamp!, 1)
        const [from] = adjustFromTo(p, to, 500)
        try {
          const kLineDataList = await props.datafeed.getHistoryKLineData(symbol(), p, from, to)
          rawData = kLineDataList.concat(rawData)
          const type = untrack(candleType)
          if (isBrickType(type)) {
            widget?.applyMoreData([], false)
          } else {
            // ponytail: older HA bars are seeded independently, so the first few bars at the page seam differ slightly from a full recompute (error halves each bar)
            widget?.applyMoreData(type === 'heikin_ashi' ? heikinAshi(kLineDataList) : kLineDataList, kLineDataList.length > 0)
          }
          refreshDataDrawings()
          void refreshHtfIndicators()
          void refreshCompares()
        } catch (e) {
          // ponytail: a failed page ends paging for this dataset rather than retrying.
          // klinecharts re-fires loadMore whenever the left edge is visible, so retrying
          // here loops while the user sits at the edge. Switching period resets it.
          widget?.applyMoreData([], false)
        }
        loadingMore = false
      }
      get()
    })
    widget?.subscribeAction(ActionType.OnTooltipIconClick, (data) => {
      if (data.indicatorName) {
        switch (data.iconId) {
          case 'visible':
          case 'invisible': {
            overrideIndicatorAndPersist({ name: data.indicatorName, visible: data.iconId === 'visible' }, data.paneId, historyLabel('history_indicator_visibility', data.indicatorName))
            break
          }
          case 'setting': {
            const indicator = widget?.getIndicatorByPaneId(data.paneId, data.indicatorName) as Indicator
            setIndicatorSettingModalParams({
              visible: true,
              indicatorName: data.indicatorName,
              paneId: data.paneId,
              calcParams: indicator.calcParams,
              plots: plotDefaults(indicator, widget?.getStyles().indicator, widget?.getDataList() ?? []),
              plotStyles: (indicator.styles as any)?.plots,
              source: (indicator as any).source,
              offset: (indicator as any).offset,
              timeframe: (indicator as any).timeframe
            })
            break
          }
          case 'close': {
            if (data.paneId === 'candle_pane') {
              widget?.removeIndicator('candle_pane', data.indicatorName)
              setMainIndicators(mainIndicators().filter(name => name !== data.indicatorName))
            } else {
              const newIndicators = { ...subIndicators() }
              widget?.removeIndicator(data.paneId, data.indicatorName)
              delete newIndicators[data.indicatorName]
              setSubIndicators(newIndicators)
            }
            persistIndicators(activeIndicatorTicker, historyLabel('history_remove_indicator', data.indicatorName))
          }
        }
      }
    })
  })

  onCleanup(() => {
    resizeObserver?.disconnect()
    resizeObserver = null
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
    resetRealtimeQueue()
    if (compareRefreshTimer !== null) {
      clearTimeout(compareRefreshTimer)
      compareRefreshTimer = null
    }
    if (flowFrame !== null) {
      cancelAnimationFrame(flowFrame)
      flowFrame = null
    }
    cancelLongPress()
    onStrokeEnd()
    clearMeasure()
    widgetRef?.removeEventListener('mousedown', onStrokeStart, true)
    widgetRef?.removeEventListener('touchstart', onStrokeStart, true)
    widgetRef?.removeEventListener('contextmenu', handleWidgetContextMenu)
    widgetRef?.removeEventListener('pointerdown', handlePointerDown)
    widgetRef?.removeEventListener('pointerup', cancelLongPress)
    widgetRef?.removeEventListener('pointermove', handlePointerMove)
    widgetRef?.removeEventListener('pointercancel', cancelLongPress)
    document.removeEventListener('click', closeContextMenu)
    document.removeEventListener('scroll', closeContextMenu, true)
    document.removeEventListener('visibilitychange', flushDrawings)
    window.removeEventListener('pagehide', persistChartState)
    unbindShortcuts?.()
    unbindShortcuts = null
    persistChartState()
    // dispose(widgetRef) would hit an upstream klinecharts bug: dispose(element)
    // treats the truthy element as the registry id, so the lookup always misses.
    // Disposing the chart instance takes the `instanceof ChartImp` path.
    if (widget !== null) dispose(widget)
  })

  createEffect(() => {
    const s = symbol()
    if (s?.priceCurrency) {
      priceUnitDom.innerHTML = s?.priceCurrency.toLocaleUpperCase()
      priceUnitDom.style.display = 'flex'
    } else {
      priceUnitDom.style.display = 'none'
    }
    candlePricePrecision = s?.pricePrecision ?? 2
    // minPriceDelta (TV pricescale/minmov) narrows displayed decimals when the
    // tick is coarser than pricePrecision suggests.
    if (typeof s?.minPriceDelta === 'number' && s.minPriceDelta > 0) {
      candlePricePrecision = Math.min(candlePricePrecision, Math.max(0, Math.round(-Math.log10(s.minPriceDelta))))
    }
    candleVolumePrecision = s?.volumePrecision ?? 0
    widget?.setPriceVolumePrecision(candlePricePrecision, candleVolumePrecision)
  })

  createEffect(() => {
    const s = symbol()
    const ticker = symbolKey(s)
    if (!widget || !indicatorsReady || ticker === activeIndicatorTicker) {
      return
    }
    untrack(() => {
      persistIndicators(activeIndicatorTicker)
      setIndicatorModalVisible(false)
      closeIndicatorSettings()
      activeIndicatorTicker = ticker
      restoreIndicators(ticker, s.ticker)
    })
  })

  // Per-symbol period memory (SQ-4): a symbol's stored choice wins when the
  // resolved symbol still supports it. Deliberately reacts to SYMBOL and
  // supported-set changes only — the live period is read untracked, so a
  // manual switch never fights the stored value mid-flush.
  createEffect(() => {
    const s = symbol()
    if (!s) return
    const storedText = readSymbolPeriods()[symbolKey(s)]
    if (storedText === undefined) return
    const stored = effectivePeriods().find(candidate => candidate.text === storedText)
    const current = untrack(period)
    if (stored && stored.text !== current.text) setPeriod(stored)
  })

  // Snap the period when it is not supported by the resolved symbol/venue.
  createEffect(() => {
    const current = period()
    const periods = effectivePeriods()
    if (periods.some(candidate => candidate.text === current.text)) return
    const snapped = snapPeriod(current, periods)
    if (snapped && snapped.text !== current.text) setPeriod(snapped)
  })

  // 1s charts are trade-derived and always render as a line: entering a second
  // period forces Line and remembers the user's chart type for the way back;
  // leaving restores it. Declared before the settings effect so persisted state
  // never records the lock's line as a preference.
  createEffect((prevSecond?: boolean) => {
    const isSecond = isLineLockedPeriod(period())
    if (isSecond && !prevSecond) {
      preSecondCandleType = untrack(candleType)
      changeCandleType(CandleType.Line, false)
    } else if (!isSecond && prevSecond) {
      const restore = preSecondCandleType
      preSecondCandleType = null
      if (restore !== null) changeCandleType(restore, false)
    }
    return isSecond
  })

  // IND-002 + M5: keep higher-timeframe studies and compare series aligned
  // with the chart data, and drop fetch/subscription state no live instance
  // references. Reacts to study layout, symbol and period changes.
  createEffect(() => {
    void [mainIndicators(), subIndicators(), symbol(), period()]
    void refreshHtfIndicators().then(() => { pruneHtfState() })
    void refreshCompares().then(() => { pruneCompareState() })
  })

  createEffect((prev?: PrevSymbolPeriod) => {
    if (prev) {
      props.datafeed.unsubscribe(prev.symbol, prev.period)
    }
    const s = symbol()
    const p = period()
    // DRAW-007: drawings restricted to specific timeframes hide on other periods.
    widget?.setPeriodTag(p.text)
    if (prev && symbolKey(prev.symbol) !== symbolKey(s)) {
      cancelTextEditor()
      onStrokeEnd()
      cancelDrawing()
      setDrawingEditor(null)
      persistDrawings()
    }
    retryTick()
    const id = ++reqId
    resetRealtimeQueue()
    setLoadingVisible(true)
    const get = async () => {
      const [from, to] = adjustFromTo(p, new Date().getTime(), isBrickType(untrack(candleType)) ? 2000 : 500)
      try {
        const kLineDataList = await props.datafeed.getHistoryKLineData(s, p, from, to)
        if (id !== reqId) {
          return
        }
        rawData = kLineDataList.slice()
        presentData()
        if (symbolKey(s) !== restoredTicker) {
          restoredTicker = symbolKey(s)
          restoreDrawings(restoredTicker, s.ticker)
        } else {
          refreshDataDrawings()
        }
        void refreshHtfIndicators()
        void refreshCompares()
        props.datafeed.subscribe(s, p, data => {
          applyRealtimeBar(data)
          refreshDataDrawings()
        })
        setDataState(kLineDataList.length > 0 ? 'ok' : 'empty')
      } catch (e) {
        if (id !== reqId) {
          return
        }
        setDataState('error')
      }
      setLoadingVisible(false)
      syncChartActionsWidth()
    }
    get()
    return { symbol: s, period: p }
  })

  createEffect(() => {
    const t = theme()
    widget?.setStyles(t)
    const color = t === 'dark' ? '#929AA5' : '#76808F'
    widget?.setStyles({
      candle: {
        tooltip: {
          custom: candleTooltipLegends
        }
      },
      indicator: {
        tooltip: {
          icons: [
            {
              id: 'visible',
              position: TooltipIconPosition.Middle,
              marginLeft: 8,
              marginTop: 7,
              marginRight: 0,
              marginBottom: 0,
              paddingLeft: 0,
              paddingTop: 0,
              paddingRight: 0,
              paddingBottom: 0,
              icon: '\ue903',
              fontFamily: 'icomoon',
              size: 14,
              color: color,
              activeColor: color,
              backgroundColor: 'transparent',
              activeBackgroundColor: 'rgba(22, 119, 255, 0.15)'
            },
            {
              id: 'invisible',
              position: TooltipIconPosition.Middle,
              marginLeft: 8,
              marginTop: 7,
              marginRight: 0,
              marginBottom: 0,
              paddingLeft: 0,
              paddingTop: 0,
              paddingRight: 0,
              paddingBottom: 0,
              icon: '\ue901',
              fontFamily: 'icomoon',
              size: 14,
              color: color,
              activeColor: color,
              backgroundColor: 'transparent',
              activeBackgroundColor: 'rgba(22, 119, 255, 0.15)'
            },
            {
              id: 'setting',
              position: TooltipIconPosition.Middle,
              marginLeft: 6,
              marginTop: 7,
              marginBottom: 0,
              marginRight: 0,
              paddingLeft: 0,
              paddingTop: 0,
              paddingRight: 0,
              paddingBottom: 0,
              icon: '\ue902',
              fontFamily: 'icomoon',
              size: 14,
              color: color,
              activeColor: color,
              backgroundColor: 'transparent',
              activeBackgroundColor: 'rgba(22, 119, 255, 0.15)'
            },
            {
              id: 'close',
              position: TooltipIconPosition.Middle,
              marginLeft: 6,
              marginTop: 7,
              marginRight: 0,
              marginBottom: 0,
              paddingLeft: 0,
              paddingTop: 0,
              paddingRight: 0,
              paddingBottom: 0,
              icon: '\ue900',
              fontFamily: 'icomoon',
              size: 14,
              color: color,
              activeColor: color,
              backgroundColor: 'transparent',
              activeBackgroundColor: 'rgba(22, 119, 255, 0.15)'
            }
          ]
        }
      }
    })
    reapplyChartModes()
  })

  createEffect(() => {
    widget?.setLocale(locale())
  })

  createEffect(() => {
    const tz = timezone().key
    candleDateTimeFormat = buildDateTimeFormat(tz)
    widget?.setTimezone(tz)
  })

  createEffect(() => {
    if (styles()) {
      widget?.setStyles(styles())
      setWidgetDefaultStyles(lodashClone(widget!.getStyles()))
      reapplyChartModes()
    }
  })

  // Declared after the props.styles effect so a user's saved settings win over
  // host defaults on any key they both set. Stored flat as dotted paths, so
  // accumulating one more setting is a spread rather than a deep merge.
  createEffect(() => {
    const flat = storedStyles()
    if (flat) {
      const style = {}
      Object.keys(flat).forEach(key => { lodashSet(style, key, flat[key]) })
      // The 1s line lock wins over stored state: a stale stored 'candle.type'
      // (kept from before a 1s session) must never put candles back on a
      // walking line chart.
      if (isLineLockedPeriod(untrack(period))) {
        lodashSet(style, 'candle.type', CandleType.Line)
      }
      widget?.setStyles(style)
      reapplyChartModes()
    }
  })

  createEffect(() => {
    applyCursorMode(cursorMode())
  })

  createEffect(() => {
    applyCandleType(candleType())
  })

  createEffect(() => {
    applyLastPriceLineForPeriod(period())
  })

  createEffect(() => {
    write(SETTINGS_KEY, {
      styles: storedStyles() ?? undefined,
      timezone: timezone().key,
      drawingBarVisible: drawingBarVisible(),
      cursorMode: cursorMode(),
      // While line-locked the stored chart type keeps the user's pre-1s
      // preference rather than the lock's line; preSecondChartType marks the
      // lock so the restore knows to prefer it.
      chartType: isLineLockedPeriod(period()) ? (preSecondCandleType ?? storedCandleType) : candleType(),
      preSecondChartType: preSecondCandleType ?? undefined,
      barCountdown: barCountdownVisible(),
      performanceMode: performanceMode() || undefined,
      customIntervals: customPeriods().length > 0 ? customPeriods().map(period => period.text) : undefined
    })
  })

  return (
    <>
      <i class="icon-close klinecharts-pro-load-icon"/>
      <Show when={indicatorModalVisible()}>
        <IndicatorModal
          locale={props.locale}
          favorites={indicatorFavorites()}
          templates={indicatorTemplates()}
          onToggleFavorite={toggleIndicatorFavorite}
          onAddTemplate={addIndicatorFromTemplate}
          onDeleteTemplate={deleteIndicatorTemplate}
          onRenameTemplate={renameIndicatorTemplate}
          mainIndicators={mainIndicators()}
          subIndicators={subIndicators()}
          onClose={() => { setIndicatorModalVisible(false) }}
          onAdd={(name, placement) => {
            const id = nextIndicatorId(name, [...mainIndicators(), ...Object.keys(subIndicators())])
            if (placement === 'main') {
              if (createIndicator(widget, id, true, { id: 'candle_pane' })) setMainIndicators([...mainIndicators(), id])
            } else {
              const paneId = createIndicator(widget, id)
              if (paneId) setSubIndicators({ ...subIndicators(), [id]: paneId })
            }
            persistIndicators(activeIndicatorTicker, historyLabel('history_add_indicator', id))
          }}/>
      </Show>
      <Show when={symbolSearchVisible()}>
        <SymbolSearchModal
          locale={props.locale}
          config={feedConfig()}
          recents={symbolRecents()}
          mode={symbolSearchMode()}
          onSearch={(query, filters) => props.datafeed.searchSymbols!(query, filters)}
          onSelect={result => {
            pushSymbolRecent(result)
            if (symbolSearchMode() === 'compare') {
              void addCompare(result)
            } else {
              applySymbol(`${result.exchange}:${result.ticker}`)
            }
          }}
          onClose={() => { setSymbolSearchVisible(false) }}/>
      </Show>
      <Show when={timezoneModalVisible()}>
        <TimezoneModal
          locale={props.locale}
          timezone={timezone()}
          onClose={() => { setTimezoneModalVisible(false) }}
          onConfirm={tz => {
            setTimezone(tz)
            recordHistory(historyLabel('history_timezone', translateTimezone(tz.key, props.locale)))
          }}
        />
      </Show>
      <Show when={goToDateVisible()}>
        <GoToDateModal
          locale={props.locale}
          onClose={() => { setGoToDateVisible(false) }}
          onConfirm={target => { void goToTimestamp(target) }}
        />
      </Show>
      <Show when={intervalBuilderVisible()}>
        <IntervalBuilderModal
          locale={props.locale}
          onClose={() => { setIntervalBuilderVisible(false) }}
          onConfirm={addCustomInterval}
        />
      </Show>
      <Show when={settingModalVisible()}>
        <SettingModal
          locale={props.locale}
          currentStyles={utils.clone(widget!.getStyles())}
          onClose={() => { setSettingModalVisible(false) }}
          onChange={(style, key, value) => {
            widget?.setStyles(style)
            setStoredStyles({ ...(storedStyles() ?? {}), [key]: value })
            recordHistory(historyLabel('history_chart_settings'))
          }}
          onRestoreDefault={(options: SelectDataSourceItem[]) => {
            const style = {}
            const remaining = { ...(storedStyles() ?? {}) }
            options.forEach(option => {
              const key = option.key
              lodashSet(style, key, utils.formatValue(widgetDefaultStyles(), key))
              delete remaining[key]
            })
            widget?.setStyles(style)
            recordHistory(historyLabel('history_chart_settings'))
            setStoredStyles(Object.keys(remaining).length > 0 ? remaining : null)
          }}
        />
      </Show>
      <Show when={screenshotUrl().length > 0}>
        <ScreenshotModal
          locale={props.locale}
          url={screenshotUrl()}
          onClose={() => { setScreenshotUrl('') }}
        />
      </Show>
      <Show when={textEditor()} keyed>
        {editor => (
          <TextEditorModal
            locale={props.locale}
            text={editor.text}
            onConfirm={confirmTextEditor}
            onClose={cancelTextEditor}
          />
        )}
      </Show>
      <Show when={indicatorSettingModalParams().visible}>
        <IndicatorSettingModal
          locale={props.locale}
          periods={props.periods}
          params={indicatorSettingModalParams()}
          onClose={closeIndicatorSettings}
          onSaveTemplate={saveIndicatorTemplate}
          moveTargets={(() => {
            const current = indicatorSettingModalParams()
            const targets: Array<{ id: string, label: string }> = []
            if (current.paneId !== 'candle_pane') {
              targets.push({ id: 'candle_pane', label: i18n('indicator_on_chart', props.locale) })
            }
            Object.entries(subIndicators()).forEach(([name, paneId]) => {
              // Pane ids can go stale after symbol switches (panes are
              // re-created); only offer targets that still exist.
              if (paneId === current.paneId || name === current.indicatorName) return
              if ((widget as any)?.getPaneById?.(paneId) == null) return
              targets.push({ id: paneId, label: indicatorType(name) })
            })
            targets.push({ id: '__new__', label: i18n('indicator_new_pane', props.locale) })
            return targets
          })()}
          onMovePane={targetPaneId => {
            const current = indicatorSettingModalParams()
            moveIndicatorToPane(current.indicatorName, current.paneId, targetPaneId)
          }}
          onConfirm={(params, plots, inputs) => {
            const modalParams = indicatorSettingModalParams()
            overrideIndicatorAndPersist({
              name: modalParams.indicatorName,
              styles: { plots: plots ?? {} },
              source: inputs.source,
              offset: inputs.offset,
              timeframe: inputs.timeframe,
              ...(params ? { calcParams: params } : {})
            }, modalParams.paneId, historyLabel('history_indicator_settings', modalParams.indicatorName))
            void refreshHtfIndicators()
          }}
        />
      </Show>
      <Show when={drawingEditor()} keyed>{drawing => <DrawingEditor
        locale={props.locale} drawing={drawing} periods={effectivePeriods()} defaultPreset={defaultDrawingPresets()[drawing.name]} onSetDefaultPreset={name => setDefaultDrawingPreset(drawing.name, name)} onSave={saveDrawing} onClose={() => setDrawingEditor(null)}/>
      }</Show>
      <PeriodBar
        locale={props.locale}
        period={period()}
        periods={effectivePeriods()}
        quickPeriods={props.quickPeriods}
        candleType={candleType()}
        onPeriodChange={changePeriod}
        onCandleTypeChange={changeCandleType}
        onIntervalBuilderClick={() => { setIntervalBuilderVisible(true) }}
        onIndicatorClick={() => { setIndicatorModalVisible((visible => !visible)) }}
        onSettingClick={() => { setSettingModalVisible((visible => !visible)) }}
        onScreenshotClick={() => {
          if (widget) {
            const url = widget.getConvertPictureUrl(true, 'jpeg', props.theme === 'dark' ? '#151517' : '#ffffff')
            setScreenshotUrl(url)
          }
        }}
        symbolLabel={searchAvailable() ? qualifiedSymbolName(symbol()) : ''}
        onSymbolClick={() => openSymbolSearch('symbol')}
        compareEnabled={searchAvailable()}
        onCompareClick={() => openSymbolSearch('compare')}
        canUndo={!loadingVisible() && historyState().canUndo}
        canRedo={!loadingVisible() && historyState().canRedo}
        undoTitle={historyTitle('undo_action', historyState().undoLabel)}
        redoTitle={historyTitle('redo_action', historyState().redoLabel)}
        onUndo={() => travelHistory('undo')}
        onRedo={() => travelHistory('redo')}
        onObjects={() => { cancelDrawing(); setDrawingManagerVisible(value => !value) }}
        objectsVisible={drawingManagerVisible()}
      />
      <div
        class="klinecharts-pro-content">
        <Show when={drawingManagerVisible() && !loadingVisible()}>
          <DrawingManager locale={props.locale} drawings={drawingItems()}
            onEdit={setDrawingEditor} onToggle={toggleDrawing} onDuplicate={duplicateDrawing}
            onRemove={removeDrawing} onClose={() => setDrawingManagerVisible(false)}/>
        </Show>
        <Show when={loadingVisible()}>
          <Loading/>
        </Show>
        <Show when={keyHint().length > 0}>
          <div class="klinecharts-pro-key-hint">{keyHint()}</div>
        </Show>
        <Show when={!loadingVisible() && dataState() !== 'ok'}>
          <Empty text={i18n(dataState() === 'error' ? 'load_failed' : 'no_data', props.locale)}>
            <Show when={dataState() === 'error'}>
              <Button onClick={() => { setRetryTick(tick => tick + 1) }}>
                {i18n('retry', props.locale)}
              </Button>
            </Show>
          </Empty>
        </Show>
        <div
          class="klinecharts-pro-drawing-toggle"
          role="button"
          tabIndex={0}
          aria-expanded={drawingBarVisible()}
          classList={{ 'is-open': drawingBarVisible() }}
          title={drawingBarVisible() ? 'Hide Drawings Toolbar' : 'Show Drawings Toolbar'}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click() } }}
          onClick={() => {
            startTransition(() => setDrawingBarVisible(!drawingBarVisible())).catch(() => {})
          }}>
          <svg viewBox="0 0 24 24">
            <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <Show when={drawingBarVisible()}>
          <DrawingBar
            locale={props.locale}
            favorites={toolbarFavorites()}
            onToggleFavorite={toggleToolbarFavorite}
            activeName={activeTool()}
            cursorMode={cursorMode()}
            continuous={continuousDrawing()}
            onCursorModeChange={changeCursorMode}
            onContinuousChange={setContinuousDrawing}
            onDrawingItemClick={createDrawing}
            onModeChange={mode => mutateDrawings(() => { widget?.overrideOverlay({ groupId: DRAWING_GROUP_ID, mode: mode as OverlayMode }) })}
            onLockChange={lock => mutateDrawings(() => { widget?.overrideOverlay({ groupId: DRAWING_GROUP_ID, lock }) })}
            onVisibleChange={visible => mutateDrawings(() => { widget?.overrideOverlay({ groupId: DRAWING_GROUP_ID, visible }) })}
            onRemoveClick={groupId => mutateDrawings(() => { widget?.removeOverlay({ groupId }) })}/>
        </Show>
        <div
          ref={widgetRef}
          class='klinecharts-pro-widget'
          tabIndex={0}
          onPointerDown={() => widgetRef?.focus({ preventScroll: true })}
          data-drawing-bar-visible={drawingBarVisible()}/>
        <div
          ref={chartActionsRef}
          class="klinecharts-pro-chart-actions">
          <span
            class="chart-action"
            role="button"
            tabIndex={0}
            aria-label={i18n('reset_chart', props.locale)}
            title={i18n('reset_chart', props.locale)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click() } }}
            onClick={resetChart}>
            <svg viewBox="0 0 20 20">
              <path d="M10 3.5a6.5 6.5 0 1 0 6.29 8.14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              <path d="M10 1.2v4.6l3.2-2.3z" stroke="none"/>
            </svg>
          </span>
          <span
            class="chart-action"
            role="button"
            tabIndex={0}
            aria-label={i18n('timezone', props.locale)}
            title={i18n('timezone', props.locale)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click() } }}
            onClick={() => { setTimezoneModalVisible((visible => !visible)) }}>
            <svg viewBox="0 0 20 20">
              <path d="M18.5446,9.09091C18.3333,6.61616,17.2887,4.31818,15.5751,2.63889C13.8498,0.94697,11.6197,0,9.28404,0C8.02817,0,6.81925,0.265151,5.66901,0.782828C5.65728,0.782828,5.65728,0.795454,5.64554,0.795454C5.6338,0.795454,5.6338,0.808081,5.62207,0.808081C4.53052,1.31313,3.55634,2.0202,2.71127,2.92929C1.85446,3.85101,1.18545,4.91162,0.715963,6.11111C0.246479,7.33586,0,8.64899,0,10C0,10.8712,0.105634,11.7172,0.305164,12.5379C0.305164,12.5631,0.316901,12.5884,0.328638,12.6136C0.739437,14.2298,1.51408,15.7197,2.62911,16.9571C4.07277,18.548,5.92723,19.5581,7.93427,19.8737C7.95775,19.8737,7.96948,19.8864,7.99296,19.8864C8.3216,19.9369,8.66197,19.9747,9.00235,19.9747L9.21362,19.9747C9.61268,19.9747,10.3756,19.9369,11.0094,19.697C11.1737,19.6338,11.3028,19.5076,11.3732,19.3434C11.4437,19.1793,11.4554,18.9899,11.3967,18.8131C11.3028,18.5354,11.0563,18.346,10.7864,18.346C10.716,18.346,10.6338,18.3586,10.5634,18.3838C10.0939,18.5606,9.46009,18.5859,9.20188,18.5859L9.09624,18.5859C9.20188,18.2702,9.23709,17.9167,9.15493,17.5505C9.00235,16.8939,8.50939,16.3384,7.58216,15.7955L7.19484,15.5682C6.57277,15.2146,6.23239,15.0253,6.03286,14.7348C5.83333,14.4444,5.69249,13.9899,5.51643,12.9798C5.38732,12.298,5.04695,11.7677,4.50704,11.4646C4.14319,11.2626,3.70892,11.149,3.19249,11.149C2.82864,11.149,2.42958,11.1995,2.00704,11.3005C1.79578,11.351,1.59624,11.4141,1.42019,11.4646C1.33803,10.9848,1.30282,10.4798,1.30282,9.97475C1.30282,6.93182,2.76995,4.26768,4.98826,2.72727C5,3.00505,5.05869,3.29545,5.17606,3.57323C5.48122,4.26768,6.10329,4.7096,7.01878,4.89899C7.06573,4.91162,7.10094,4.91162,7.13615,4.91162L7.1831,4.91162C7.26526,4.91162,7.57042,4.92424,7.88732,5.0505C8.3216,5.2399,8.56808,5.55555,8.65023,6.04798C8.84977,7.61364,9.07277,10.4293,8.79108,11.3384C8.76761,11.4141,8.75587,11.4899,8.75587,11.5657C8.75587,11.9444,9.0493,12.2601,9.40141,12.2601C9.57747,12.2601,9.74179,12.1843,9.85915,12.0581C9.97653,11.9318,12.6174,9.05303,13.3216,8.09343C13.4038,7.97979,13.4859,7.87878,13.5798,7.76515C13.9202,7.33586,14.2723,6.90656,14.4014,6.26262C14.554,5.56818,14.4014,4.79798,13.9437,3.85101C13.615,3.16919,13.5563,2.86616,13.5446,2.75252C13.5563,2.7399,13.5798,2.72727,13.6033,2.71464C15.6221,4.10353,17.0188,6.43939,17.2535,9.19192C17.2887,9.55808,17.5587,9.82323,17.8991,9.82323L17.9577,9.82323C18.3099,9.8106,18.5681,9.48232,18.5446,9.09091ZM3.19249,12.5631C3.48592,12.5631,3.72066,12.6136,3.89671,12.7146C4.08451,12.8283,4.19014,12.9924,4.23709,13.2702C4.43662,14.3434,4.61268,15.0631,5,15.6061C5.37559,16.1364,5.85681,16.4015,6.58451,16.8182L6.60798,16.8308C6.71362,16.8939,6.84272,16.9571,6.96009,17.0328C7.69953,17.4621,7.86385,17.7525,7.89906,17.8914C7.93427,18.0303,7.85211,18.2323,7.74648,18.4343C4.91784,17.8535,2.65258,15.6944,1.73709,12.8283C2.15962,12.702,2.71127,12.5631,3.19249,12.5631ZM12.7934,4.5202C13.4272,5.83333,13.1455,6.18687,12.5822,6.89394C12.4883,7.00758,12.3944,7.12121,12.3005,7.24747C11.9484,7.72727,11.0211,8.77525,10.2113,9.68434C10.2113,9.24242,10.1878,8.73737,10.1526,8.19444C10.0704,6.95707,9.92958,5.90909,9.92958,5.87121L9.92958,5.83333C9.75352,4.83586,9.20188,4.11616,8.3216,3.76263C7.82864,3.56061,7.37089,3.53535,7.19484,3.53535C6.73709,3.43434,6.4554,3.24495,6.33803,2.99242C6.19718,2.68939,6.29108,2.24747,6.38498,1.9697C7.28873,1.59091,8.26291,1.37626,9.28404,1.37626C10.3873,1.37626,11.4437,1.61616,12.4061,2.04545C12.3357,2.18434,12.277,2.34848,12.2535,2.5505C12.2066,3.04293,12.3709,3.64899,12.7934,4.5202Z" />
              <path d="M15.22299772857666,9.722223632261718C12.59389772857666,9.722223632261718,10.44600772857666,12.020201374511718,10.44600772857666,14.861111374511719C10.44600772857666,17.70202137451172,12.58215772857666,20.000021374511718,15.223007728576661,20.000021374511718C17.86384772857666,20.000021374511718,19.99999772857666,17.70202137451172,19.99999772857666,14.861111374511719C19.99999772857666,12.020201374511718,17.85211772857666,9.72222212709572,15.22299772857666,9.722223632261718ZM15.22299772857666,18.598491374511717C13.30985772857666,18.598491374511717,11.737087728576661,16.91919137451172,11.737087728576661,14.848481374511719C11.737087728576661,12.777781374511719,13.29811772857666,11.098491374511719,15.22299772857666,11.098491374511719C17.14787772857666,11.098491374511719,18.708917728576658,12.777781374511719,18.708917728576658,14.848481374511719C18.708917728576658,16.91919137451172,17.13614772857666,18.59848137451172,15.22299772857666,18.598491374511717Z"/>
              <path d="M15.692486288146974,15.050496970825195L15.692486288146974,12.676760970825196C15.692486288146974,12.297972970825196,15.399058288146973,11.982316970825195,15.046945288146972,11.982316970825195C14.694833288146972,11.982316970825195,14.401406288146973,12.297972970825196,14.401406288146973,12.676760970825196L14.401406288146973,15.340896970825195C14.401406288146973,15.530296970825194,14.471829288146973,15.694436970825196,14.589200288146973,15.833326970825196L15.751176288146972,17.095956970825195C15.868546288146973,17.222216970825194,16.032866288146973,17.297976970825196,16.208916288146973,17.297976970825196C16.384976288146973,17.297976970825196,16.537556288146973,17.222216970825194,16.666666288146974,17.095956970825195C16.78403628814697,16.969686970825194,16.854456288146974,16.792916970825196,16.854456288146974,16.603526970825193C16.854456288146974,16.414136970825197,16.78403628814697,16.237366970825196,16.666666288146974,16.111106970825197L15.692486288146974,15.050496970825195Z"/>
            </svg>
          </span>
                  </div>
        <Show when={contextMenu().visible}>
          <div
            ref={contextMenuRef}
            class="klinecharts-pro-context-menu"
            style={{
              left: `${Math.min(contextMenu().x, window.innerWidth - 188)}px`,
              top: `${Math.min(contextMenu().y, window.innerHeight - 188)}px`
            }}
            onContextMenu={e => { e.preventDefault() }}>
            <span class="context-menu-item" onClick={resetChart}>{i18n('reset_chart', props.locale)}</span>
            <Show when={contextMenu().price !== ''}>
              <span class="context-menu-item" onClick={copyPrice}>
                <span>{i18n('copy_price', props.locale)}</span>
                <span class="context-menu-item-value">{contextMenu().price}</span>
              </span>
            </Show>
            <span class="context-menu-item" onClick={() => { closeContextMenu(); setGoToDateVisible(true) }}>{i18n('go_to_date', props.locale)}</span>
            <span class="context-menu-item" onClick={exportVisibleCsv}>{i18n('export_csv', props.locale)}</span>
            <span
              class="context-menu-item"
              role="menuitemcheckbox"
              aria-checked={barCountdownVisible()}
              onClick={toggleBarCountdown}>
              <span>{i18n('bar_countdown', props.locale)}</span>
              <span class="context-menu-item-value">{barCountdownVisible() ? '✓' : ''}</span>
            </span>
            <span
              class="context-menu-item"
              role="menuitemcheckbox"
              aria-checked={performanceMode()}
              onClick={togglePerformanceMode}>
              <span>{i18n('performance_mode', props.locale)}</span>
              <span class="context-menu-item-value">{performanceMode() ? '✓' : ''}</span>
            </span>
          </div>
        </Show>
      </div>
    </>
  )
}

export default ChartProComponent
