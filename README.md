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
