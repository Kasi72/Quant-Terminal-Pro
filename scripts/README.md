# scripts/ — Research & Backtesting Harness

Offline research tooling for the Quant Terminal Pro engine. Nothing in this
directory ships to production; the live app uses only `lib/`, `app/`, and
`components/`.

## Layout

| Path | Purpose |
|---|---|
| `*.js` | Backtest, tuning, and analysis scripts (run with `node scripts/<name>.js`) |
| `*.json` (root) | **Live inputs** — param-set configs and overrides that scripts read (`goldenParams.json`, `all_5_optimized_param_sets_final.json`, `*_overrides.json`, etc.). Do not move these. |
| `_compiled_current/` | CommonJS build of the current `lib/` engine, consumed by scripts via `ENGINE_DIR`. Rebuild with `npm run compile` (adjust `--outDir`). |
| `_compiled_proposed/` | CommonJS build of a candidate engine for A/B comparison runs. |
| `_bt_smoke/` | Small OHLCV CSV fixture set for smoke-testing backtests. |
| `results/` | Archived run outputs (timestamped `*_2026-*.json/.txt`, `*_output*.txt` reports). Write-once artifacts; safe to prune. |
| `logs/` | Archived stdout/stderr logs from long tuning runs. Safe to prune. |

## Conventions

- Scripts resolve paths via `__dirname`, so run them from anywhere.
- Long runs write timestamped outputs; move finished artifacts into `results/`
  and logs into `logs/` to keep the root scannable.
- A few summary files stay in the root because other scripts re-read them
  (`backtest1980_results.json`, `backtest1980_summary.txt`, `proposed_results.json`,
  `hangingStocks.json`, `optimizer_results.json`).
- `generateBrainPrior.js` regenerates `lib/brainPrior.json` used by the app UI.
