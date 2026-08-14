# Changelog

All notable changes to Quant Terminal Pro are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Versions map to meaningful capability milestones, not semver.

---

## [Unreleased] — post-v9.1

### Added
- **n8n Docker stack** (`D:\Claude code\n8n-docker\`) — n8n 2.34.5 + Postgres 16, IST timezone, AI nodes enabled, 64 MB payload limit. Foundation for agent workflow automation and screener webhook integration.

---

## [9.1.0] — 2026-08-12 · UC Data Pipeline Hardening

The biggest quality unlock since v9.0: the UC precision tracker was silently
polluting its own training data with sentinel values, missing features, and
weekend noise. This release fixes all three and makes the `^NSEI`/`^INDIAVIX`
regime pipeline truly real-time during market hours.

### Fixed
- **`^NSEI` / `^INDIAVIX` live price staleness** (`fetch-ohlcv/route.ts`):
  `updateTodayWithMeta` (meta.regularMarketPrice refresh) was only applied to
  `.NS` stocks. Index symbols fell through to the raw Yahoo snapshot, which
  could be 5–15 min stale during market hours. Now index symbols prefixed with
  `^` also get the intraday meta refresh, keeping the Nifty close and VIX
  accurate on every scan.

- **UC logger: RSI2/body sentinel nulling** (`page.tsx`):
  91 % of logger rows had `rsi2=50` and `body_pct=0` simultaneously — not real
  values but Wilder-EMA decay artefacts from locked-at-UC stocks whose price
  hasn't moved in 20+ days (`avgGain = avgLoss = 0 → RSI2 = 50`; candle
  `range = 0 → ZERO_CANDLE_ARCH → bodyPct = 0`). These sentinel values were
  being treated as real signal in Cohen's d regression, suppressing RSI2's
  computed effect size to near zero. Fix: detect locked candle
  (`bodyPct === 0 AND upperWickPct === 0`) and store `NULL` for `rsi2`,
  `body_pct`, `upper_wick_pct` — excluded from regression, not misclassified.

- **UC logger: weekend gate** (`page.tsx`):
  Logger was firing on Saturdays and Sundays (IST-aware check was missing),
  producing 1330 rows across 2026-08-08/09 with zero UC hits. These inflated
  the false-positive denominator and depressed measured precision. Gate now
  checks IST day-of-week and returns early on weekends.

- **UC logger: sector was always `null`** (`page.tsx`):
  `(r as any).sector ?? null` always resolved null because `sector` is not a
  typed property on `AnalysisResult`. Fixed to call `getSectorTag(r.symbol)`
  directly — now populated for all 6381+ historical rows going forward.

### Added
- **UC logger: `morph_type` field** — `coiled_spring` / `gravestone` / `null`
  from `r.morphType`, enabling morph phenotype as a precision feature in live_v2.
- **UC logger: `market_regime` field** — `BULL MARKET` / `STRONG BULL` / etc.
  from `marketRegime?.label`, enabling regime-conditional precision analysis.
- **`morph_type` column** in `pbfb_uc_logger` Supabase table (DDL applied).
- **`marketRegime` added to `useEffect` dependency array** — logger always
  reflects the regime computed during the same scan, never a stale prior value.

### Changed
- **`log-uc-scan/route.ts` interface**: all optional numeric fields typed as
  `number | null` (previously bare `number`), matching Supabase nullable columns.

### Data impact
- Next `uc_precision_analysis.js` run (≥ 2026-09-16, after 30 more labeled
  trading days) will have 6 clean features instead of 2:
  `vol_pre5`, `range_atr`, `cl_trend`, `rsi2_velocity`, `morph_type`, `sector`.
  `rsi2` and `body_pct` will have meaningful Cohen's d now that sentinels are nulled.

---

## [9.0.0] — 2026-08-08 · Full Intelligence Stack (agent merge)

Major milestone: merge of 6-week agent branch into master, taking the screener
from v7.3 to a full quantitative trading terminal with ML, survival analysis,
Brain V2 intelligence, and a live UC precision pipeline.

### Added — Brain V2 / UC Intelligence
- **Brain V2 stage-aware UC column** in live screener: shows ucScore,
  ucElite/ucStrong/ucGoldmine tiers, PBFB detection rate, Brain similarity,
  and morphology badges inline per stock.
- **UC score feature set 2**: `volDry`, `volSurge`, `weeklyResonance`,
  `magnetFlag` added to ucScore formula.
- **Candle morphology k-means scoring** (`morphType`): classifies candles as
  `coiled_spring` / `gravestone` / `null` using k-means on body/wick geometry.
- **UC score live_v1 weight recalibration** from 6381 forward-labeled rows
  (8 trading days, 90 UC true positives):
  - `volAccel_pts`: 5 → 10 (+100 %) — Cohen's d = 1.21
  - `rangeATR_pts`: 5 → 10 (+100 %) — Cohen's d = 1.05
  - `rsi2_pts`: 16 → 10 (−38 %) — Cohen's d = 0.02 (near-zero signal)
  - `closeLoc_pts`: 22 → 20 (−9 %) — Cohen's d = 0.20
- **`pbfb_uc_logger` precision pipeline**: logs ucScore ≥ 35 candidates daily,
  `label-uc-outcomes` cron labels next-day UC events from `pbfb_uc_events`,
  `uc_precision_analysis.js` computes Cohen's d per feature.
- **`backfill_uc_labels.js`**: backfilled 6381 rows with 90 true positives
  from historical `pbfb_uc_events`.
- **`label-uc-outcomes` cron timing fix**: moved from `30 11 * * 2-6` →
  `30 14 * * 2-6` UTC (was running before `nightly-update` populated the
  events table — zero hits every run).
- **ucElite / ucStrong tier refinement** using goldmine-validated thresholds.
- **PBFB detection rate uplift** — `PRE_BREAKOUT`/`CW` actionable, `EI` rsi2
  gate, thin_lock denominator fix, multi-tier ucScore promotions.

### Added — Stop Engine
- **Wyckoff spring/sweep-aware stop placement**: detects 2-bar spring or sweep
  below structure and sets stop below the wick, not the close.
- **sw10Low structural anchor** for all production archetypes — uses 10-bar
  swing low as the hard structural floor for stop placement.
- **Disaster-stop guard**: secondary stop at 3× ATR below entry, triggers
  position exit regardless of other stop logic.
- **G9 sw5Low fallback**: uses 5-bar swing low when 10-bar is unavailable.

### Added — Entry & Risk
- **Surgical entry gate**: blocks `PRE_BREAKOUT + EXPLOSION + conviction < 60`
  combinations that have historically negative expectancy.
- **Macro-sensitive badge**: labels trades entering into VIX spikes or
  regime-unfavourable conditions.
- **Quick-sizer fix**: now uses `priceEngine.riskPerShare` (enforces 1 % floor)
  instead of raw stop distance.

### Added — Exit Optimization (t1_optimizer / maxprofit_optimizer 2026-08-08)
- **T1 ATR-mult optimization**: 0.5× ATR for VF/CC/PS/EMA (reduces T1
  premature exits vs prior 0.8×).
- **Fine-grid T1 sweet spots**: cliff-detected optima per archetype from
  500-simulation grid.
- **Max-profit T1/T2/T3 targets**: maxprofit_optimizer applied to all
  production archetypes — T3 raised for VF/PS where data supports it.
- **v2 optimised params** for VF/CC/PS/EMA archetypes committed.

### Added — Validation Page (7 pro-trader improvements)
- **Expectancy curve** (SVG): cumulative expectancy over time with area fill,
  endpoint label, regression trend line.
- **Rolling win rate** (20-trade window): shows momentum in system performance.
- **Streak tracker**: current consecutive wins/losses with historical context.
- **Equity curve** (SVG): R-based equity from trade sequence.
- **Archetype breakdown**: per-paramSetKey win rate, trade count, avg R.
- **Monthly performance table**: month × year heatmap of P&L / trade count.
- **Open risk %**: live aggregate risk across all open positions.
- **Tier × target breakdown table**: per tier (ucElite/Strong/Goldmine) shows
  T1/T2/T3 hit rates, 5/7/10 % ever-crossed, stopped, and win rate.

### Added — Trade Quality Flags
- **Deep early MAE badge** (`Lever 3`): flags trades that went into > 2 % MAE
  within the first 3 bars — poor entries even if they recovered.
- **Stagnation flag**: open trades held 7 + days with < 2 % MFE tagged as
  stagnant — candidates for early exit.
- **Low-vol screener warning**: flags entries in low-volatility regimes where
  UC stocks tend not to expand.

### Added — Market Regime (9-factor)
- Full 9-factor regime engine in `tradeOps.ts`:
  momentum (20d), breadth (% green days), realized vol, acceleration (10d
  vs prior 10d), distance from EMA200, today's return, VIX level, VIX 5d ROC,
  VIX vs 20d SMA.
- CUSUM crash early-warning (50-candle rolling window, 3σ threshold).
- Black Swan 4-level system (elevated / high / severe / extreme) backtested on
  10yr Nifty + VIX data, caught COVID crash 25 days early (Feb 26, 2020).
- Position sizing multiplier: 1.25× (strong bull) → 1.0× → 0.75× → 0.25× →
  0× (strong bear).

### Added — ML Pipeline
- **UC-XGBoost v2** (`train_uc_xgb.py`): trained on pbfb_uc_events with
  Platt calibration (AUC = 0.6476 after 2026-08-08 retrain, test set).
- **XGBoost score** in screener: blended with ucScore formula (Tier 2 gating).
- **Survival analysis** (`run_survival_analysis.py`): KM + CoxPH curves for
  time-to-5% from entry; written to `lib/survivalCurves.ts`.
- **Bayesian Win Rate** (`archetype_bayes_wr` table): Beta-Binomial posterior
  per archetype; displayed in Validation.
- **Monthly ML refresh** (`monthly_refresh.ps1` + `StockScreener-MLRefresh`
  Windows Task): chains bulk-label → XGBoost train → survival analysis →
  git commit → Vercel deploy on 1st of each month.
- **Auto-retrain UC-XGBoost** (`auto_retrain_uc_xgb.ps1` + `UC_XGB_AutoRetrain`
  Windows Task): fires 2026-09-16 and every 30 trading days; includes AUC
  sanity gate (abort if AUC < 0.52) and precision analysis `--apply` pass.

### Added — Security & Infrastructure
- **`pbfb-intelligence` route**: switched from anon key to service role key —
  anon key cannot read RLS-protected tables.
- **Owner token gate** (`OWNER_TOKEN` in Vercel env): blocks friend/read-only
  users from tracking trades or triggering writes.
- **IP ownership commit**: established Kasi Krishnaraja Paldurai as author.

### Fixed
- **`autoValidator` gate check**: guarded against corporate action dates
  returning `null` prices from Yahoo Finance.
- **KS drift detector**: tightened to p = 0.01 threshold, minimum n = 20;
  now shows direction and magnitude of drift.
- **`BrainData.ksDrift` type**: extended to include `meanRecent` / `meanPrior`
  fields needed by drift display.
- **Quick-select date buttons**: dates were captured at render time (stale);
  now computed at click time.
- **Orphaned `hit_t3` trades**: trades with `hit_t3=true` but missing
  `closedDate` were breaking win-rate aggregation; healed via repair script.
- **Nightly cron perpetual partial status**: fixed state machine that left
  cron stuck in `partial` across days.
- **False T1/stop Telegram alerts**: alerts were firing for trades already in
  `hit_t1` or `hit_t2` status; suppressed by status gate.
- **Tier table empty-string stage**: fallback message shown instead of null
  rows when stage field is empty.
- **Expectancy curve overlapping labels**: full SVG rewrite with proper left
  Y-axis labels, area fill, non-overlapping endpoint dot+label.
- **Edge trend chart**: SVG line chart with zoomed Y-axis and regression trend.
- **Live `daysHeld` for stagnant/deepMAE trades**: `getLiveDaysHeld` now
  counts weekdays from `entryDate` to today (not calendar days).
- **Validation WR alignment**: applied surgical gate filter so Validation WR
  matches Trade Log WR exactly.

### Changed
- `nightly-update` cron: dual schedule (19:30 + 21:00 IST) for NSE data
  finalization reliability.

---

## [8.x] — 2026-08 (pre-merge features, partial history)

### Added
- **30-day UC precision tracker** (`pbfb_uc_logger`, `log-uc-scan` route,
  `label-uc-outcomes` route): end-to-end pipeline from candidate logging to
  forward-label outcome to Cohen's d analysis.
- **`total_scan_count`** logged per UC scan batch.
- **NSE F&O stocks preset** in screener dropdown.
- **MFE % hit filters** in Trade Log and Validation dropdowns.
- **Filter dropdown** in trade log sidebar.
- **Guppy Spring / Guppy Primed** tier: detects `Spring(T-1) → CoiledRelease(T)`
  2-bar sequence with 🔥 badge.
- **ORS-Prime tightening**: RSI14 ≤ 35 and score ≥ 68; `maxHoldBars` 25 → 12
  based on horizon decay analysis.
- **Archetype phase promotions** (tpsl_optimizer v2): VF / MP / SNIPER → active;
  CC held at WATCHLIST_ONLY pending OOS data.
- **EMAStack promoted** to active after `ema_prescreen_tuner` champion applied.
- **CompressionCoil promoted** after `cc_archetype_tuner` champion applied.
- **Stage classification scientific overhaul** (7-stage spectrum):
  `NO_SIGNAL → COMPRESSION_WATCH → EARLY_INFLECTION → PRE_BREAKOUT →
  BREAKOUT_EXPLOSION → USB → BREAKOUT_CONFIRMED`.
- **ucScore-driven synthesis** for `EARLY_INFLECTION` / `COMPRESSION_WATCH`
  stages.
- **ML pipeline scripts**: `bulk_label_outcomes.py`, `train_xgb_score.py`,
  `compute_survival_times.py`, `run_survival_analysis.py`.
- **XGBoost + survival KM + Bayesian WR** wired into screener columns.
- **UC-XGBoost v1** + Platt calibration (AUC 0.857 on 2026-08-07 dataset).
- **`archetype_bayes_wr` Supabase table**: Bayesian Beta-Binomial win-rate
  posteriors per archetype, updated by monthly refresh.
- **v3 ucScore weights** from 1000-event backtest (AUC 0.846).
- **ucStrong triple-lock tier**: requires ucElite + ucGoldmine + ucScore ≥ 60.
- **Sortable/filterable/selectable trade log table**.
- **Watch/Track/Remove UI** gated behind `isOwner` flag.

---

## [7.3.0] — 2026-08-08 (baseline before agent merge)

Starting point for v9.0 agent branch work. Included:
- Core screener with VF / PS / EMA / CB archetypes
- Basic UC detection (v2 score)
- Trade log with Supabase persistence
- Nightly update cron
- Telegram alerts

---

*Maintained by Kasi Krishnaraja Paldurai. Each entry written at commit time —
not reconstructed after the fact.*
