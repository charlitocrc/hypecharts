# Chart benchmarks

Build the production library with `npm run build-core` before running a harness.

## Initial load

```sh
node benchmarks/initial-load.mjs > /tmp/initial-load.json
```

Uses installed Playwright by default; `PLAYWRIGHT_MODULE` can point to another
Playwright module. Runs five samples at each CPU throttle (1× and 4×) for:

- `cold`: fresh browser context, empty storage and cache, no studies.
- `warm`: dispose the priming chart and create another in the same loaded page.
  Measures construction and rendering; this is not a cached page reload.
- `restore`: cold navigation with a saved layout containing MA, VOL, RSI and ten
  drawing lines. Asserts that all studies calculate and all drawings restore.

The local HTTP server serves the production UMD bundle (including the bundled
core) and CSS with gzip, and 1,000 deterministic candles. It adds 100 ms to each
history response. No exchange or trading requests are made.

The JSON includes individual samples and median/p95 summaries. With five samples,
p95 is the maximum sample; increase the run count for meaningful tail analysis.

| Metric | Meaning |
|---|---|
| `readyMs` | Navigation start → ready for cold/restore; constructor start → ready for warm |
| `firstCandleDrawMs` | Same origin → first candle-colored canvas draw command |
| `bundleLoadMs` | Script start → loaded/evaluated; includes local transfer, parse and evaluation; excludes preceding CSS wait |
| `constructorMs` | Synchronous chart constructor duration |
| `historyMs` | Fixture request through JSON parsing |
| `historyToReadyMs` | History available → ready |
| `interactionMs` | Scripted indicator-menu click → modal paint opportunity after ready |
| `longTaskMs` | Total observed long-task duration before ready |
| `assetTransferBytes` | Browser-reported JS/CSS transfer bytes (null for warm) |

Ready requires 1,000 candles, calculated studies, restored drawings where applicable,
no loading overlay, a candle draw, and two animation-frame boundaries. A subsequent
pixel readback verifies candle-colored pixels without adding readback cost to the
timing. These timestamps mark draw commands and paint opportunities, **not actual
compositor presentation**. The menu probe checks a scripted interaction after
readiness; it does not measure real input queuing during startup. Long tasks cover
tasks of at least 50 ms, not all CPU work. No latency budgets are enforced yet.

Configuration:

```sh
LOAD_BENCH_RUNS=20 LOAD_BENCH_RATES=1,4,8 node benchmarks/initial-load.mjs
LOAD_BENCH_KBPS=1600 LOAD_BENCH_LATENCY_MS=80 node benchmarks/initial-load.mjs
LOAD_BENCH_FEED_MS=0 node benchmarks/initial-load.mjs
LOAD_BENCH_RUNS=1 LOAD_BENCH_RATES=4 LOAD_BENCH_PROFILE_DIR=/tmp/chart-profiles node benchmarks/initial-load.mjs
LOAD_BENCH_DIST_DIR=/tmp/preserved-dist node benchmarks/initial-load.mjs
```

Network shaping is optional and applied before navigation, including history
requests. KBPS means decimal kilobits per second. Default networking is localhost,
so default cold results do not represent an internet download. Feed delay is
additional to any network shaping. Compare the same machine, Chromium version,
CPU/network settings and fixture configuration. Repeat a baseline before deciding
whether to optimize bundle size, construction, data fetching or study restoration.

CPU profiles are written for cold/restore samples and include profiler overhead;
do not compare their timings to unprofiled baselines. The dist directory override
lets an earlier build be measured using exactly the same harness.

## Production demo startup

```sh
npm run build:demo
node benchmarks/demo-startup.mjs
```

Runs the production demo in Chromium with fixture exchange HTTP and WebSockets.
A healthy Hyperliquid route must render before a Binance probe delayed by three
seconds completes. It then opens the indicator menu, switches to the late venue,
opens split view and verifies that a reload restores both saved symbols. Fonts
are stubbed; timings use localhost with no CPU/network throttling. This is a
workflow check and one timing sample, not a live exchange benchmark.

See [startup-findings.md](startup-findings.md) for the measured changes and limits.
