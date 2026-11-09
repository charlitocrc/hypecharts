# Initial-load findings — 2026-11-08

The largest avoidable delay was in demo venue discovery. The demo previously
waited for both exchange probes before constructing any chart; each probe can
take five seconds to time out. A healthy selected venue now starts independently
of an unrelated pending probe. Full venue discovery continues, and config/search
wait for the complete route set so interval aggregation and available symbols
retain both venues. A saved split workspace still waits for both required venues.

The production demo browser fixture rendered the primary in **124 ms**, while its
secondary probe took **3,000 ms**. It also verified the indicator menu, switching
to the late venue, opening split view and restoring the saved Binance/Hyperliquid
cells after reload. This is one localhost fixture sample with fonts stubbed;
there is no claim of equivalent real-exchange latency or compositor timing.

Restoration initially exposed a resolution race: a cell started resolving its
default symbol and then its saved symbol. Whichever response finished last won.
Each demo cell now resolves exactly one initial target, giving the saved symbol
priority. Failed required probes still wait for discovery before choosing a live
fallback, and the simulated fallback remains when neither venue is reachable.

## Library measurements

Five samples per scenario; Apple M4, Chromium 156.0.8078.4, 4× CPU throttle,
1,600 kilobits/s, 80 ms network latency, gzip HTTP, 1,000 candles and an additional
100 ms fixture history delay. Before/after used preserved production builds and
the same harness, with no concurrent benchmark runs.

| Metric | Before | After |
|---|---:|---:|
| Standalone UMD JavaScript, gzip | 192,778 bytes | 184,661 bytes |
| Cold ready, median | 1,677.0 ms | 1,611.8 ms |
| Cold ready, p95 (maximum of five) | 1,677.8 ms | 1,627.8 ms |
| Restored ready, median | 1,676.3 ms | 1,626.6 ms |
| Restored ready, p95 (maximum of five) | 1,692.1 ms | 1,643.5 ms |
| Warm creation ready, median | 296.7 ms | 295.8 ms |
| Cold indicator-menu interaction, median | 43.6 ms | 43.1 ms |

The UMD bundle is 4.2% smaller over the wire. Cold readiness improved about 65 ms
(3.9%); warm creation and the first menu interaction were effectively unchanged.
Small samples support a directional result, not a performance guarantee.

Changes:

- Apply two-pass Terser compression to UMD output and the demo. Keep Vite's ESM
  compression and pure annotations intact for downstream tree shaking. Vite's
  global library Terser option was rejected because it enlarged ESM output.
- Skip chart-mode style setters when their effective values already match.
  Cursor DOM updates still run, and changed modes still recalculate normally.
- Avoid constructing a tooltip date formatter that the initial timezone effect
  immediately replaces. Keep a fallback for an early tooltip invocation.
- Preserve eager feature availability: all indicators, drawings and dialogs ship
  in the initial bundle. There are no new feature-download waits on first click.

Readiness includes data, calculated studies, restored drawings, a candle draw and
two animation-frame boundaries. Pixel readback verifies candles after timing.
It measures a paint opportunity, not actual screen presentation. The scripted
menu probe starts after readiness and does not measure input queuing during load.
CPU profiles also found DOM-template parsing and layout work; those costs were
not removed by weakening rendering, reducing data or delaying controls.

## Validation

- Library build and declarations; production demo build; strict TypeScript check
  including demo sources.
- Existing 344 unit tests plus six discovery tests covering healthy/slow venues,
  saved selected venues, split layouts, timeouts and both fallback paths.
- Indicator and drawing browser workflows, plus the demo startup workflow.
- Local feature ledger updated without changing the reference review date.
  The package has no `parity:update` or `parity:check` npm scripts; both commands
  were attempted, then the existing `scripts/parity-report.mjs` generator and its
  `--check` mode passed directly. The ledger/report and generator are already
  ignored by this repository and remain local files.

For further reduction, benchmark an ESM consumer and real hosting separately.
The network-shaped library run still spends about 920 ms loading/evaluating the
bundle; a larger gain needs fewer initial bytes or earlier host-owned data
fetching. Deferring dialogs or studies would need explicit first-use latency
checks before it could meet the same user-experience constraint.
