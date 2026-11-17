# HypeCharts

**Financial charts for everyone, thats the motto of this library. Hypecharts aims to provide a worldclass experience for financial charting, accessible to anyone.**
Apache-2.0. Built on the work of the giants at [KLineChart](https://github.com/klinecharts/KLineChart)

## Quickstart

```bash
git clone https://github.com/charlitocrc/hypecharts.git
npm install
npm run demo          # marketing demo → http://localhost:5180 (live Hyperliquid data)
```

The demo imports the library straight from source, so every edit hot-reloads on the page.
Other scripts:

| Script | What it does |
|---|---|
| `npm test` | Unit + regression suite (vitest) |
| `npm run test:types` | Check the public TypeScript API against the source entry point |
| `npm run build` | Library build (ESM/CJS/UMD + bundled core + TypeScript declarations) |
| `npm run test:package` | Pack, install offline, type-check and run standalone browser consumers (requires Playwright Chromium) |
| `npm run docs:dev` | Docs site (vitepress) |
| `npm run build:demo` | Static demo build → `dist-demo/` (Cloudflare Pages: build command + output dir) |
| `node benchmarks/<name>.mjs` | Performance/behavior harnesses — see [benchmarks/README.md](benchmarks/README.md) |

### Using the library

Once [published](https://www.npmjs.com/package/hypecharts) (`npm install hypecharts`), or
built locally from `dist/` — the vendored patched KLineChart core ships inside the bundle:

```js
import { KLineChartPro, HyperliquidDatafeed } from 'hypecharts'
import 'hypecharts/styles.css'

const chart = new KLineChartPro({
  container: 'chart',
  locale: 'en-US',
  timezone: 'Etc/UTC',
  symbol: { ticker: 'BTC', exchange: 'HYPERLIQUID', market: 'perp', pricePrecision: 1 },
  period: { multiplier: 15, timespan: 'minute', text: '15m' },
  datafeed: new HyperliquidDatafeed()
})
// chart.dispose() when the host unmounts
```

Create the container before initializing the chart and give it a height:

```html
<div id="chart" style="height: 600px"></div>
```

The package includes its patched chart core and runtime dependencies. No separate
`klinecharts` or framework installation is required. ESM imports and CommonJS
`require('hypecharts')` are supported by browser bundlers, with matching TypeScript
declarations. The library requires a browser DOM at import time; in SSR applications,
load it dynamically on the client after mounting.

`hypecharts/styles.css` is the supported stylesheet entry point. The existing
`hypecharts/dist/klinecharts-pro.css` import remains available. Direct browser script
usage can continue to load `dist/klinecharts-pro.umd.js`, which exposes `klinechartspro`.
The existing ESM file `dist/klinecharts-pro.js` also remains available. Package exports
define the supported entry points; internal source files are not public imports.

`npm pack` and `npm publish` build fresh artifacts automatically through `prepack`.
Before releasing, run `npm run test:package`. It builds the tarball, installs it into
an isolated project with an empty cache and no network, checks strict TypeScript
ESM/CommonJS consumers, and verifies production browser bundles and the legacy UMD
script with fixture data. Install the test browser with `npx playwright install chromium`
or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing Chromium executable.
These checks validate packaging and basic integration, not live exchange behavior.

### TypeScript integration

Use `ChartPro` when passing a chart between application components. It includes the
same public methods as `KLineChartPro`, including selection subscriptions and disposal:

```ts
import type { ChartPro, DeepPartial, Styles } from 'hypecharts'

function connectChart(chart: ChartPro) {
  const styles: DeepPartial<Styles> = { grid: { show: false } }
  chart.setStyles(styles)
  const stop = chart.subscribeSelectionChange(selection => {
    console.log(selection.symbol.ticker, selection.loading, selection.dataReady)
  })
  // Subscriptions receive future changes; read getSelection() for the current state.
  console.log(chart.getSelection())
  return stop
}
```

Remove subscriptions when their consumer unmounts, and call `chart.dispose()` when the
chart's host unmounts. The host owns shared datafeeds. `setSymbol()` and `setPeriod()`
return immediately; selection notifications report loading and data readiness.

Core types `Chart`, `Styles`, `DeepPartial`, `Nullable` and `KLineData`, plus
`CompositeDatafeed`, are available from `hypecharts` without a separate core dependency.
Synchronization groups accept `ChartPro` handles. Grids infer the factory's chart type,
including subclasses; `ChartGrid<ChartPro>` and `ChartGridOptions<ChartPro>` support
factories that return interface-typed handles.

`npm run test:types` checks the source API; `npm run test:package` checks the same
consumer fixture against the packed ESM and CommonJS declarations.

### Await a selection

Use `setSelection` to change a symbol, an interval, or both, and wait for its initial
history to finish. A paired request applies the symbol and interval together, with
the explicit interval taking precedence over a remembered choice:

```ts
import { ChartSelectionError } from 'hypecharts'

const controller = new AbortController()
try {
  const selected = await chart.setSelection({
    symbol: 'HYPERLIQUID:ETH',
    period: { multiplier: 15, timespan: 'minute', text: '15m' }
  }, { signal: controller.signal })
  console.log(selected.symbol, selected.period, selected.dataReady)
} catch (error) {
  if (error instanceof ChartSelectionError &&
      (error.code === 'aborted' || error.code === 'superseded')) {
    // The caller cancelled or a newer selection took over.
  } else {
    throw error
  }
}
// controller.abort() cancels an outstanding wait.
```

Each call loads fresh initial history, including repeated selections. The promise
returns the effective interval after capability checks and snapping. Empty history
is a successful result with `loading: false` and `dataReady: false`; it does not wait
for a live candle. `getSelection()` is updated before the promise resolves. Completion
covers main-series history and subscription setup, not later study requests, ongoing
connection health or future feed capability changes.

`ChartSelectionError.code` distinguishes `invalid_request`, `resolve_failed`,
`load_failed`, `aborted`, `superseded`, and `disposed`. Its `cause` preserves the
original resolver/loading failure or abort reason. Invalid or already aborted requests
leave another caller's pending operation intact.

A newer selection request, legacy setter, symbol/interval UI action, or valid workspace
restoration supersedes the pending wait. Disposal rejects it too. Aborting while a
symbol is resolving prevents that result from committing later. After the selection
commits, abort rejects the wait while the selected dataset continues loading; it does
not roll back the chart or cancel shared datafeed transport. Existing `setSymbol()` and
`setPeriod()` signatures remain unchanged.

### Diagnostics

Provide `onDiagnostic` when constructing a chart to capture startup warnings and
current-operation failures:

```ts
import { KLineChartPro, HyperliquidDatafeed } from 'hypecharts'
import 'hypecharts/styles.css'

const chart = new KLineChartPro({
  container: 'chart',
  locale: 'en-US',
  timezone: 'Etc/UTC',
  symbol: { ticker: 'BTC', exchange: 'HYPERLIQUID', market: 'perp' },
  period: { multiplier: 15, timespan: 'minute', text: '15m' },
  datafeed: new HyperliquidDatafeed(),
  onDiagnostic(diagnostic) {
    console.log(diagnostic.code, diagnostic.operation, diagnostic.scope)
    console.log(diagnostic.symbol, diagnostic.period, diagnostic.retryable)
    console.log(diagnostic.message, diagnostic.cause)
  }
})
```

`ChartDiagnostic` and `ChartDiagnosticCode` are exported types. Each event contains
a stable code, severity, actionable message, operation, timestamp and retry support.
Relevant events also include detached symbol/interval snapshots, a requested symbol
name or interval, and the original error/transport event in `cause`. Handle codes
rather than matching message text.

| Code | Meaning / action |
|---|---|
| `container_not_found` | Create the container before constructing the chart; construction still throws. |
| `stylesheet_missing` | Import `hypecharts/styles.css` before creating the chart. |
| `container_zero_height` | Mount the chart in a visible layout with a nonzero height. |
| `unsupported_period` | Inspect `requestedPeriod` and the effective `period`; configure compatible host/feed intervals. |
| `configuration_failed` | Fix `datafeed.config()` or its return shape; host/symbol capability fallbacks remain available. |
| `symbol_resolve_failed` | Check `symbolName` and the resolver; the existing selection is retained. |
| `history_failed` | Inspect the cause and `scope`: main history, exhausted paging, indicator, compare or profile. |
| `subscription_failed` | Inspect `operation` for subscribe, unsubscribe or connection-event setup failures. |
| `connection_lost` | The matching feed reported a disconnect; inspect its reconnect policy. |
| `recovery_failed` | Reconnect backfill failed; retry or reload the selection, checking retention/window limits. |
| `symbol_search_failed` | Fix the provider/query/filter issue and search again. |

Without a callback, the library uses structured `console.warn`/`console.error` output.
A callback replaces that fallback; use `onDiagnostic: () => {}` to silence it. Delivery
is deferred until state notifications settle, callback exceptions are isolated, and
stale or disposed work is suppressed. There is no retained diagnostic log or replay.

Layout/style warnings occur once per chart. History paging reports its final failure
after retries. Study failures are deduplicated by current source until successful
recovery or a dataset change; disconnect warnings are deduplicated until a matching
connected/reconnected event. `retryable` means retrying the operation is supported,
not that another attempt will succeed. Configuration, cleanup and cached profile
fallback failures require fixing/reconfiguring the provider or changing the profile
range/dataset, rather than blindly retrying the same call.
Failed connection-event setup requires fixing the provider and recreating the chart;
retrying a selection does not reinstall that listener.

Selection promise errors and `onSymbolResolveError` remain available. Normal empty
history, cancellation, supersession and disposal do not emit failure diagnostics.
Diagnostics cover chart-visible failures and optional `subscribeConnection` events;
they cannot reveal errors a custom feed or composite route catches internally.

### Contributing

Bug reports, integration reports and PRs welcome. Use the setup and commands above, and
[benchmarks/README.md](benchmarks/README.md) for behavior and performance harnesses.

## Features and roadmap

The current menus expose **156 indicators, 59 drawing tools and 13 chart styles**.
See the [feature report](feature-parity.md) for implementation evidence and remaining acceptance
criteria, the [roadmap](docs/roadmap.md) for the next-work queue, and the
[API reference](docs/site/en-US/api.md) for datafeeds, custom intervals and synchronized grids.
The maintained ledger is `feature-parity.json`; regenerate with
`node scripts/parity-report.mjs` and verify with `node scripts/parity-report.mjs --check`.
Menu inventory does not establish numerical or rendering equivalence with TradingView.

## Building an exchange integration

One interface to implement — [`src/types.ts`](src/types.ts):

```ts
interface Datafeed {
  getHistoryKLineData (symbol: SymbolInfo, period: Period, from: number, to: number): Promise<KLineData[]>
  subscribe (symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void
  unsubscribe (symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void
}
```

`demo/src/datafeed.ts` is a complete working example (Hyperliquid REST + WebSocket,
reconnect, keepalive, offline fallback). Route new integrations through
[docs/roadmap.md](docs/roadmap.md).

## Repo layout

| Path | What it is |
|---|---|
| `docs/` | Project roadmap, design docs and the docs site (`docs/site/`) |

## License

Apache-2.0. Forked from [klinecharts-pro](https://github.com/klinecharts/klinecharts-pro) and
[KLineChart](https://github.com/klinecharts/KLineChart); local changes remain open source under
the same license. Nothing in this repository is financial advice.
