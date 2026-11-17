import type { ChartDiagnostic, ChartDiagnosticCode, DatafeedConfiguration, Period, SymbolInfo } from './types'

const definitions = {
  container_not_found: ['error', 'initialize', false, 'Chart container was not found. Create the element before constructing the chart and pass its element or ID.'],
  stylesheet_missing: ['warning', 'initialize', false, "Chart stylesheet was not detected. Import 'hypecharts/styles.css' before creating the chart."],
  container_zero_height: ['warning', 'initialize', false, 'Chart container has zero height. Mount it in a visible layout and give it a nonzero height.'],
  unsupported_period: ['warning', 'setPeriod', false, 'The requested interval is unavailable. Use the effective interval in period or configure supported intervals on the chart and datafeed.'],
  configuration_failed: ['warning', 'config', false, 'Datafeed configuration failed. Check config() and its return shape; the chart is using host/symbol capability fallbacks.'],
  symbol_resolve_failed: ['error', 'resolveSymbol', true, 'Symbol resolution failed. Check the venue-qualified name and datafeed resolver, then select the symbol again.'],
  history_failed: ['error', 'getHistoryKLineData', true, 'Market-data history failed. Inspect the original cause, symbol, interval and request scope before retrying.'],
  subscription_failed: ['error', 'subscribe', true, 'Datafeed subscription lifecycle failed. Inspect the original cause and operation; unsubscribe must remove only the supplied listener.'],
  recovery_failed: ['error', 'recovery', true, 'Reconnect history repair failed. Use Retry or reload the selection; check venue retention and recovery-window limits.'],
  connection_lost: ['warning', 'connection', true, 'The datafeed reported a disconnect. Check its reconnect policy; matching reconnect events trigger bounded history repair.'],
  symbol_search_failed: ['warning', 'searchSymbols', true, 'Symbol search failed. Check the query, exchange filters and provider, then search again.']
} as const

export type DiagnosticInput = Pick<ChartDiagnostic, 'code'> & Partial<Pick<ChartDiagnostic,
  'operation' | 'cause' | 'symbol' | 'period' | 'symbolName' | 'requestedPeriod' | 'scope' | 'retryable'>>

/** Per-chart event delivery, intentionally deferred beyond the producer's state-notification microtask. */
export class DiagnosticReporter {
  private stopped = false

  constructor (private listener?: (diagnostic: ChartDiagnostic) => void) {}

  report (input: DiagnosticInput, current: () => boolean = () => true): void {
    if (this.stopped || !current()) return
    const [severity, operation, retryable, message] = definitions[input.code]
    const copySymbol = (symbol: SymbolInfo): SymbolInfo => ({ ...symbol, intervals: symbol.intervals?.map(period => ({ ...period })) })
    const diagnostic: ChartDiagnostic = {
      ...input, severity, operation: input.operation ?? operation, retryable: input.retryable ?? retryable, message, timestamp: Date.now(),
      ...(input.symbol ? { symbol: copySymbol(input.symbol) } : {}),
      ...(input.period ? { period: { ...input.period } } : {}),
      ...(input.requestedPeriod ? { requestedPeriod: { ...input.requestedPeriod } } : {})
    }
    queueMicrotask(() => queueMicrotask(() => {
      if (this.stopped || !current()) return
      if (this.listener) {
        try { this.listener(diagnostic) } catch (error) { console.error('Chart diagnostic listener failed', error) }
      } else {
        console[severity === 'error' ? 'error' : 'warn'](`[HypeCharts:${diagnostic.code}] ${message}`, diagnostic)
      }
    }))
  }

  stop (): void { this.stopped = true }
}

/** Lightweight boundary checks, not a replacement for a datafeed contract test suite. */
export function validDatafeedConfiguration (value: unknown): value is DatafeedConfiguration {
  if (!value || typeof value !== 'object') return false
  const config = value as DatafeedConfiguration
  const periodValid = (period: Period): boolean => !!period && Number.isInteger(period.multiplier) && period.multiplier > 0 &&
    typeof period.timespan === 'string' && !!period.timespan && typeof period.text === 'string' && !!period.text
  return Array.isArray(config.exchanges) && config.exchanges.every(exchange => !!exchange && typeof exchange.key === 'string' && !!exchange.key && typeof exchange.name === 'string') &&
    (config.symbolTypes === undefined || (Array.isArray(config.symbolTypes) && config.symbolTypes.every(type => !!type && typeof type.key === 'string'))) &&
    (config.intervals === undefined || (Array.isArray(config.intervals) && config.intervals.every(periodValid))) &&
    (config.supportsSearch === undefined || typeof config.supportsSearch === 'boolean') &&
    (config.searchDelayMs === undefined || (Number.isFinite(config.searchDelayMs) && config.searchDelayMs >= 0))
}
