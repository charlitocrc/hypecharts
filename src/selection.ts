import type { ChartSelection, ChartSelectionErrorCode, ChartSelectionRequest } from './types'

/** Validate JavaScript callers before changing the chart or superseding another caller. */
export function isSelectionRequest (value: unknown): value is ChartSelectionRequest {
  if (!value || typeof value !== 'object') return false
  const { symbol, period } = value as ChartSelectionRequest
  if (symbol === undefined && period === undefined) return false
  if (symbol !== undefined && !(typeof symbol === 'string' ? symbol.trim().length > 0 :
    symbol && typeof symbol.ticker === 'string' && symbol.ticker.trim().length > 0)) return false
  if (period !== undefined && (!period || !Number.isInteger(period.multiplier) || period.multiplier <= 0 ||
    !['second', 'minute', 'hour', 'day', 'week', 'month', 'year'].includes(period.timespan) ||
    typeof period.text !== 'string' || !period.text.trim())) return false
  return true
}

const messages: Record<ChartSelectionErrorCode, string> = {
  invalid_request: 'A selection requires a valid symbol or period',
  resolve_failed: 'The selection symbol could not be resolved',
  load_failed: 'The selection market data could not be loaded',
  aborted: 'The selection wait was aborted',
  superseded: 'The selection was superseded by another selection intent',
  disposed: 'The chart was disposed'
}

/** Failure of setSelection. Inspect code for control flow and cause for the original failure or abort reason. */
export class ChartSelectionError extends Error {
  readonly code: ChartSelectionErrorCode
  readonly cause?: unknown

  constructor (code: ChartSelectionErrorCode, cause?: unknown) {
    super(messages[code])
    this.name = 'ChartSelectionError'
    this.code = code
    this.cause = cause
  }
}

interface SelectionOperation {
  promise: Promise<ChartSelection>
  resolve: (selection: ChartSelection) => void
  reject: (error: ChartSelectionError) => void
  release: () => void
  activated: boolean
  requestId?: number
}

/** One explicit selection intent, bound to the current main-history request after its symbol resolves. */
export class SelectionRequests {
  private pending: SelectionOperation | null = null

  constructor (private onResolving: (resolving: boolean) => void) {}

  begin (signal?: AbortSignal): SelectionOperation {
    let resolve!: SelectionOperation['resolve']
    let reject!: SelectionOperation['reject']
    const promise = new Promise<ChartSelection>((yes, no) => { resolve = yes; reject = no })
    const operation: SelectionOperation = { promise, resolve, reject, release: () => {}, activated: false }
    // An already aborted caller must not supersede another caller's work.
    if (signal?.aborted) {
      reject(new ChartSelectionError('aborted', signal.reason))
      return operation
    }
    this.cancel('superseded')
    this.pending = operation
    if (signal) {
      const abort = (): void => { this.fail(operation, new ChartSelectionError('aborted', signal.reason)) }
      signal.addEventListener('abort', abort, { once: true })
      operation.release = () => { signal.removeEventListener('abort', abort) }
    }
    this.onResolving(true)
    return operation
  }

  current (operation: SelectionOperation): boolean { return this.pending === operation }

  activate (operation: SelectionOperation): void {
    if (!this.current(operation)) return
    operation.activated = true
    this.onResolving(false)
  }

  bind (requestId: number): void {
    if (this.pending?.activated) this.pending.requestId = requestId
  }

  complete (requestId: number, selection: ChartSelection, error?: ChartSelectionError): void {
    const operation = this.pending
    if (!operation?.activated || operation.requestId !== requestId || selection.loading) return
    this.finish(operation, selection, error)
  }

  fail (operation: SelectionOperation, error: ChartSelectionError): void {
    if (this.current(operation)) this.finish(operation, undefined, error)
  }

  cancel (code: 'superseded' | 'disposed'): void {
    if (this.pending) this.fail(this.pending, new ChartSelectionError(code))
  }

  private finish (operation: SelectionOperation, selection?: ChartSelection, error?: ChartSelectionError): void {
    this.pending = null
    operation.release()
    this.onResolving(false)
    if (error) operation.reject(error)
    else operation.resolve(selection!)
  }
}
