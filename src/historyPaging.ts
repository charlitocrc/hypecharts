import type { KLineData } from 'klinecharts'

export function validHistoryCandle (bar: KLineData): boolean {
  return [bar.timestamp, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite) &&
    bar.high >= Math.max(bar.open, bar.close, bar.low) && bar.low <= Math.min(bar.open, bar.close) &&
    (bar.volume === undefined || (Number.isFinite(bar.volume) && bar.volume >= 0))
}

/** Feed order/overlap must never corrupt the engine's timestamp-index mapping. */
export function normalizeHistory (bars: KLineData[], from = -Infinity, to = Infinity): KLineData[] {
  const byTime = new Map<number, KLineData>()
  for (const bar of bars) if (validHistoryCandle(bar) && bar.timestamp >= from && bar.timestamp <= to) byTime.set(bar.timestamp, bar)
  return [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp)
}

/** Wheel paging and go-to-date share one request per dataset. Invalidated jobs cannot commit or unlock new work. */
export class HistoryPager {
  private generation = 0
  private pending: Promise<boolean> | null = null
  private waits = new Set<() => void>()

  reset (): void { this.generation++; this.pending = null; this.waits.forEach(cancel => cancel()); this.waits.clear() }

  request (
    fetchPage: () => Promise<KLineData[]>,
    commit: (page: KLineData[]) => boolean,
    onError: (cause: unknown) => void,
    retry: { attempts: number, delayMs: number } = { attempts: 1, delayMs: 0 }
  ): Promise<boolean> {
    if (this.pending) return this.pending
    const generation = this.generation
    const current = (): boolean => generation === this.generation
    const fetch = async (): Promise<KLineData[]> => {
      for (let attempt = 0; current(); attempt++) {
        try { return await fetchPage() } catch (error) {
          if (!current() || attempt + 1 >= retry.attempts) throw error
          await new Promise<void>(resolve => {
            const cancel = (): void => { clearTimeout(timer); this.waits.delete(cancel); resolve() }
            const timer = setTimeout(cancel, retry.delayMs * 2 ** attempt)
            this.waits.add(cancel)
          })
        }
      }
      return []
    }
    const job = Promise.resolve().then(fetch).then(page => {
      if (!current()) return false
      // applyMoreData can synchronously ask for the next page. Release before
      // committing, or the engine can leave its loading flag stuck with no job.
      if (this.pending === job) this.pending = null
      return commit(page)
    }).catch(cause => {
      if (!current()) return false
      if (this.pending === job) this.pending = null
      onError(cause)
      return false
    })
    this.pending = job
    return job
  }
}
