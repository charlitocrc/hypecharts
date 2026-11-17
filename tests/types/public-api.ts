// Compile this against both the source entry point and the installed package.
import {
  KLineChartPro, createChartSyncGroup, createChartGrid, createCompositeDatafeed, ChartSelectionError,
  type ChartPro, type ChartProOptions, type ChartSelection, type SymbolInfo,
  type Chart, type Styles, type DeepPartial, type Nullable, type Datafeed,
  type CompositeDatafeed, type ChartGrid, type ChartGridOptions, type ChartWorkspaceState,
  type ChartSelectionRequest, type ChartSelectionOptions, type ChartSelectionErrorCode
} from 'hypecharts'
import 'hypecharts/styles.css'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<T extends true> = T
// A newly added class method must also be represented in the public interface.
type SamePublicKeys = Assert<Equal<keyof ChartPro, keyof KLineChartPro>>
type SignatureMismatches = {
  [K in keyof ChartPro]: Equal<ChartPro[K], KLineChartPro[K]> extends true ? never : K
}[keyof ChartPro]
type SamePublicSignatures = Assert<Equal<SignatureMismatches, never>>

const symbol: SymbolInfo = { ticker: 'BTC' }
const feed: Datafeed = {
  async getHistoryKLineData () { return [] },
  subscribe (_symbol, _period, callback) {
    callback({ timestamp: 1_700_000_000_000, open: 1, high: 2, low: 0, close: 1 })
  },
  unsubscribe () {}
}
const options: ChartProOptions = {
  container: 'chart', symbol, period: { multiplier: 1, timespan: 'minute', text: '1m' }, datafeed: feed
}
const instance = new KLineChartPro(options)
const chart: ChartPro = instance
const styles: DeepPartial<Styles> = { grid: { show: false } }
chart.setStyles(styles)
const resolvedStyles: Styles = chart.getStyles()
const core: Nullable<Chart> = chart.getChart()
core?.resize()
const current: ChartSelection | null = chart.getSelection()
const stopSelection: () => void = chart.subscribeSelectionChange(selection => {
  const state: ChartSelection = selection
  const ready: boolean = state.dataReady
  // @ts-expect-error callback state must retain its symbol types
  const wrong: number = state.symbol.ticker
})
const stopDisposal: () => void = chart.subscribeDispose(() => {})
const workspace: ChartWorkspaceState = chart.getWorkspace()
const restored: Promise<void> = chart.applyWorkspace(workspace)
// Legacy setters still return immediately alongside the awaitable selection method.
const symbolResult: void = chart.setSymbol(symbol)
const periodResult: void = chart.setPeriod(options.period)
const selectionRequest: ChartSelectionRequest = { symbol: 'TEST:ETH', period: options.period }
const selectionOptions: ChartSelectionOptions = { signal: new AbortController().signal }
const selected: Promise<ChartSelection> = chart.setSelection(selectionRequest, selectionOptions)
selected.catch((error: unknown) => {
  if (error instanceof ChartSelectionError) {
    const code: ChartSelectionErrorCode = error.code
    const cause: unknown = error.cause
  }
})
chart.setSelection({ period: options.period })
// @ts-expect-error at least one selection field is required
chart.setSelection({})
// @ts-expect-error cancellation uses AbortSignal
chart.setSelection({ symbol }, { signal: 'cancel' })

const group = createChartSyncGroup()
group.add(chart)
group.remove(chart)
const container = document.createElement('div')
const concreteOptions: ChartGridOptions = { container, createChart: cell => new KLineChartPro({ ...options, container: cell }) }
const concreteGrid: ChartGrid = createChartGrid(concreteOptions)
const concreteChart: KLineChartPro = concreteGrid.charts[0]
const interfaceOptions: ChartGridOptions<ChartPro> = { container, createChart: () => chart }
const interfaceGrid: ChartGrid<ChartPro> = createChartGrid(interfaceOptions)
const interfaceChart: ChartPro = interfaceGrid.charts[0]
// An unannotated factory must also infer the interface type.
const inferredInterface: ChartGrid<ChartPro> = createChartGrid({ container, createChart: () => chart })
class CustomChart extends KLineChartPro { customMethod (): void {} }
const customGrid = createChartGrid({ container, createChart: cell => new CustomChart({ ...options, container: cell }) })
customGrid.charts[0].customMethod()
const composite: CompositeDatafeed = createCompositeDatafeed([])
composite.addRoute({ feed, exchanges: ['TEST'] })
composite.destroy()

stopSelection()
stopDisposal()
chart.dispose()
// @ts-expect-error ticker must be a string
const invalid: SymbolInfo = { ticker: 123 }
// @ts-expect-error unknown methods must not silently type-check
chart.noSuchMethod()
// @ts-expect-error selection listeners must accept ChartSelection
chart.subscribeSelectionChange((selection: number) => {})
// @ts-expect-error styles must preserve core field types
chart.setStyles({ grid: { show: 'yes' } })
