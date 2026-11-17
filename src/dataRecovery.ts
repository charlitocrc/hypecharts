import type { KLineData } from 'klinecharts'
import type { Datafeed, Period, SymbolInfo } from './types'
import { normalizeHistory } from './historyPaging'
import { periodDurationMs } from './symbolSelect'

export interface ConnectionEvent {
  status: 'connected' | 'disconnected' | 'reconnected'
  symbol?: SymbolInfo
  exchange?: string
  /** Optional original transport failure or close event for chart diagnostics. */
  cause?: unknown
}
export class ConnectionEvents {
  private listeners = new Set<(event: ConnectionEvent) => void>()
  subscribe = (listener: (event: ConnectionEvent) => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  emit (event: ConnectionEvent): void {
    for (const listener of [...this.listeners]) { try { listener(event) } catch (error) { console.error('Connection listener failed', error) } }
  }
  clear (): void { this.listeners.clear() }
}

/** Serial bounded windows avoid venue candle limits silently dropping an outage. */
export async function fetchRecovery (
  feed: Datafeed, symbol: SymbolInfo, period: Period, from: number, to: number, current: () => boolean
): Promise<KLineData[]> {
  const duration = periodDurationMs(period)
  if (!(duration > 0) || to < from) return []
  const windows = Math.ceil((to - from + 1) / (duration * 499))
  if (windows > 40) throw new Error('Recovery window exceeds 20,000 candles')
  const bars: KLineData[] = []
  for (let cursor = from; cursor <= to && current();) {
    const end = Math.min(to, cursor + duration * 499 - 1)
    const page = await feed.getHistoryKLineData(symbol, period, cursor, end)
    if (!current()) return []
    bars.push(...normalizeHistory(page, cursor, end))
    cursor = end + 1
  }
  return normalizeHistory(bars)
}

/** History repairs closed candles; live revisions received during the fetch win. */
export function mergeRecovered (current: KLineData[], recovered: KLineData[], live: Set<number>): KLineData[] {
  const byTime = new Map(current.map(bar => [bar.timestamp, bar]))
  for (const bar of recovered) if (!live.has(bar.timestamp)) byTime.set(bar.timestamp, bar)
  return normalizeHistory([...byTime.values()])
}
