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
| `npm run build` | Library build (ESM/UMD + bundled vendored core + d.ts) |
| `npm run docs:dev` | Docs site (vitepress) |
| `npm run build:demo` | Static demo build → `dist-demo/` (Cloudflare Pages: build command + output dir) |
| `node benchmarks/<name>.mjs` | Performance/behavior harnesses — see [benchmarks/README.md](benchmarks/README.md) |

### Using the library

Once [published](https://www.npmjs.com/package/hypecharts) (`npm install hypecharts`), or
built locally from `dist/` — the vendored patched KLineChart core ships inside the bundle:

```js
import { KLineChartPro, HyperliquidDatafeed } from 'hypecharts'
import 'hypecharts/dist/klinecharts-pro.css'

new KLineChartPro({
  container: 'chart',
  symbol: { ticker: 'BTC', exchange: 'HYPERLIQUID', market: 'perp', pricePrecision: 1 },
  period: { multiplier: 15, timespan: 'minute', text: '15m' },
  datafeed: new HyperliquidDatafeed()
})
```

### Contributing

Bug reports, integration reports and PRs welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md) for setup, commands, conventions and the benchmark
harnesses.

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
