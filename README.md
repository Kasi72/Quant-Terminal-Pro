# Quant Terminal Pro v9.0

> **Professional-grade AI-augmented stock momentum screener for NSE markets.**
> Built by a quant trader, for serious position traders. Not a toy.

**Live:** [stock-screener-tau-fawn.vercel.app](https://stock-screener-tau-fawn.vercel.app)
&nbsp;·&nbsp;
**Author:** Kasi Krishnaraja Paldurai
&nbsp;·&nbsp;
**License:** Proprietary — All Rights Reserved

---

## What This Is

Quant Terminal Pro screens 1,900+ NSE stocks through a multi-layer signal pipeline combining classical technical analysis, statistical modelling, AI vector similarity, and real-time market regime detection — then produces trade-ready execution plans with scientifically computed stops, targets, and position sizing.

It is not a charting tool. It is a **decision engine**.

---

## Core Capabilities at a Glance

| Layer | What it does |
|---|---|
| **Screening Engine** | 4 param-sets × 22 conditions per stock, 24-step pipeline |
| **UC Score™** | 9-feature proprietary conviction score (0–100), ML-recalibrated |
| **Brain AI** | Cloudflare Vectorize similarity search — finds historically similar setups |
| **Bulk Deal Intelligence** | Real-time NSE bulk/block deal flow integrated as a signal |
| **Sector Flow** | NSE sector momentum breadth score per scan result |
| **Market Regime Gate** | Nifty 5-day return multiplies UC Score ×1.10 / ×1.00 / ×0.85 |
| **Trade Engine** | 5-method consensus stop, hybrid ATR+Fib targets, R:R verdict |
| **Auto-Validation** | Bar-by-bar MFE/MAE tracking, auto-close at T1/T2/T3/stop |
| **Trade Log** | Cloud-persisted (Supabase), owner-gated write access |
| **Brain Narration** | Llama 3.3 70B on-edge AI narrative for each screened setup |

---

## Version History

| Version | Date | Highlights |
|---------|------|-----------|
| **v9.0** | 2026-08-08 | UC Score v4 dynamic weights, Brain Vectorize re-blend, Nifty regime gate, owner-gating, NSE F&O preset, MFE% hit filters, proprietary IP licensing |
| **v8.5** | 2026-08-01 | Brain Worker Sprint 2: Cloudflare Vectorize 32-dim fingerprinting, Llama 3.3 narration, nightly ingest cron, hit_uc_proxy labelling |
| **v8.2** | 2026-07-20 | Bulk deal flow pipeline v2/v3, edge function cold-start scoring, crossref scoring on bulk signals |
| **v8.0** | 2026-07-10 | Supabase cloud persistence for tracked trades, screener session auth, owner token architecture |
| **v7.5** | 2026-06-28 | Sector flow scores, RS vs Nifty scoring, PBFBAnalyzer component, UC event logging to Supabase |
| **v7.3** | 2026-06-21 | 53 candle patterns, Focus tab, Validation tab, auto-validation engine, market regime, 43-bug hardening sprint, light theme, v4 param sets, Fibonacci targets, R:R verdicts |
| **v7.1** | 2026-06-18 | 4-param screening, compression zone detection, trade engine v5, 90+ preset indices |
| **v1.0** | 2026-06-15 | Initial release: CSV upload, basic screening, sortable table |

---

## Screening Engine

### 4 Parameter Sets

| Set | Signal Level | Key Thresholds |
|-----|-------------|----------------|
| Deployable 20+ | `BUY` | 22 conditions, ATR Pctl ≤85, UPS ≥60 |
| HighPrecision 15+ | `STRONG_BUY` | 21 conditions + closeAboveZone ≤8% |
| Elite 10+ | `ULTRA_STRONG_BUY` | 22 conditions, turnover ≥2Cr, ATR Pctl ≤60 |
| UltraSelective 8+ | `ULTRA_STRONG_BUY` | 22 conditions, zone tightness ≤8%, RSI2 ≥55 |

**Multi-param scan mode:** all 4 sets run simultaneously, best result per stock wins.

### 24-Step Analysis Pipeline
Per-stock: ATR14 (Wilder smoothing) → RSI2 → compression zone detection (proximity-first) → UPS scoring → CQS → inflection score → stage classification → UC Score → Brain similarity fetch → regime gate application.

### Stage Classification
```
≥100% conditions met  →  ULTRA_STRONG_BUY
≥75%                  →  STRONG_BUY
≥60%                  →  BUY
≥50%                  →  PRE_BREAKOUT
≥35%                  →  EARLY_INFLECTION
≥20%                  →  COMPRESSION_WATCH
<20%                  →  NO_SIGNAL
```

---

## UC Score™ — Proprietary Conviction Engine

The UC Score is a 9-feature weighted scoring system (0–100) that quantifies how convincingly a stock is set up for a momentum breakout. Every weight is empirically calibrated using Cohen's d effect-size analysis on labeled trade outcomes.

### Features Scored
| Feature | Max Points | What it measures |
|---------|-----------|-----------------|
| Close location in day's range | 22 | Intraday conviction — did buyers hold close near high? |
| RSI(2) absolute level | 16 | Short-term oversold → ripe for expansion |
| Close-to-close trend | 18 | Multi-day directional drift |
| RSI(2) velocity | 13 | Rate of change — acceleration, not just level |
| Range vs ATR | 5 | Range expansion before breakout |
| Body percentage | 5 | Candle body strength |
| Zone tightness | 6 | How coiled the consolidation is |
| Volume acceleration | 5 | Smart-money entry confirmation |
| Volume bonus (3×, 2×, 1.5×) | 12 | Surge magnitude bonus |
| Near-breakout proximity | 5 | Distance to resistance pivot |
| Candle archetype bonus | 4 | Pattern quality (VF, MP, CC, etc.) |

### UC Tier Levels
| Tier | Score Range | Interpretation |
|------|------------|----------------|
| **UC Goldmine** | ≥80 | Rare, highest-conviction setups |
| **UC Strong** | 65–79 | High-confidence — trade with full size |
| **UC Elite** | 50–64 | Solid signal — standard position |
| Below | <50 | Signal exists, UC not compelling |

### Brain Similarity Re-blend (v9.0)
After scanning, the top 30 BUY signals are submitted in batches to the Brain Vectorize API. Each signal fetches `neighborHitRate` (% of similar historical setups that hit +20% in 20 days). The UC Score is then re-blended:

```
finalUCScore = 0.75 × ucScore + 0.25 × neighborHitRate × 100
```

### Market Regime Gate (v9.0)
Nifty 50 5-day return is computed from already-fetched candle data:

```
ret5d > +2%   →  niftyRegimeMult = 1.10  (bull — boost all UC Scores)
-2% ≤ ret5d ≤ +2%  →  1.00  (neutral)
ret5d < -2%   →  0.85  (bear — dampen all UC Scores)
```

### Dynamic Weight Recalibration
`lib/ucScoreWeights.ts` holds all constants. `scripts/uc_precision_analysis.js` fetches labeled `pbfb_uc_events` from Supabase, computes Cohen's d per feature, and rewrites weights automatically via `--apply` flag. A Windows Task Scheduler task (`UC_XGB_AutoRetrain`) runs this every 30 days and auto-deploys.

---

## Brain AI Layer — Cloudflare Workers + Vectorize

The Brain is a Cloudflare Worker (`pbfb-brain-worker.drkasi-044.workers.dev`) running at the edge with:

- **Cloudflare Vectorize** (32-dimensional embeddings) — stores UC event fingerprints
- **Llama 3.3 70B** via Workers AI — generates natural-language setup narratives
- **Nightly ingest cron** — pulls labeled trades from Supabase, upserts vectors, labels `hit_uc_proxy` (hit_t1 = true AND outcome_pct_20d > 20)

### Endpoints
| Route | Function |
|-------|---------|
| `POST /ingest` | Pull Supabase events, upsert to Vectorize with metadata |
| `POST /similar` | 9-feature vector → top-5 nearest neighbours + neighborHitRate |
| `POST /narrate` | Symbol + indicators → Llama narration paragraph |
| `GET /health` | Worker health check |

---

## Trade Execution Engine

### 5-Method Consensus Stop Loss
1. **Kase DevStop** — 2σ True Range deviation from entry
2. **Elder SafeZone** — directional noise filtering (lowest low minus ATR × noise floor)
3. **Weinstein structural** — zone low minus ATR buffer
4. **Signal candle low** — raw candle reference
5. **Second-lowest consensus** — conservative pick from above

### Hybrid Target System
```
T1 = MIN(ATR-based 2.0×, Fibonacci 1.0×)
T2 = MAX(ATR-based 3.5×, Fibonacci 1.618×)
T3 = MAX(ATR-based 5.5×, Fibonacci 2.618×)
```

### R:R Verdict System
| Verdict | Threshold | Color |
|---------|----------|-------|
| Elite | ≥3.5:1 | Neon green |
| Very Good | ≥2.5:1 | Orange |
| Good | ≥2.0:1 | Yellow |
| Acceptable | ≥1.5:1 | Dim yellow |
| Rejected | <1.5:1 | Red — trade invalid |

### Risk Parameters
| Metric | Value | Source |
|--------|-------|--------|
| Min R:R | 1.5:1 | Van Tharp |
| Max risk (ULTRA_STRONG) | 2.5% | Minervini |
| Max risk (STRONG_BUY) | 3.0% | Elder |
| Max risk (BUY) | 3.5% | Professional standard |
| Disaster stop cap | 8.0% | Schwager |
| Account risk per trade | 1.0% | Larry Hite |

---

## Bulk Deal Flow Intelligence

Real-time NSE bulk/block deal data is fetched and crossreferenced against screened stocks. Stocks with institutional activity score a `bulkFlowScore` that is factored into the signal conviction display. Edge function pipeline handles cold-start scoring and NSE path crossref.

---

## Sector Flow Scores

For each scan result, the sector's aggregate 5-day momentum breadth is computed across all tracked stocks in that sector and overlaid as a sector flow badge. Bull sector flow provides an additional conviction boost.

---

## Statistical Engine (25+ features)

- Z-Score volume anomaly, Bollinger Band squeeze, Keltner squeeze
- TTM Squeeze (John Carter) with Donchian + SMA midline momentum
- RSI(14) Wilder's method, CCI(34) Lambert's method
- GARCH(1,1) volatility forecast with variance floor (1e-10)
- Hurst exponent (proper R/S linear regression, not autocorrelation shortcut)
- Shannon entropy, CUSUM regime change detection
- Guppy GMMA (12 EMAs: 3,5,8,10,12,15,30,35,40,45,50,60)
- EMA/SMA levels (10, 21, 55, 200) with crossover detection
- 52-week high drawdown, 52-week low distance, 20-day Sharpe ratio

---

## Candlestick Pattern Recognition (53 patterns)

| Category | Patterns |
|----------|---------|
| Single candle (15) | Marubozu, Hammer, Shooting Star, Doji variants, Belt Hold, High Wave, Spinning Top, Shaven Head/Bottom |
| Two candle (18) | Engulfing, Kicking, Piercing, Dark Cloud, Harami, Tweezer, Counterattack, Separating/Meeting Lines, In-Neck, On-Neck, Thrusting, Matching Low, Homing Pigeon |
| Three+ candle (20) | Morning/Evening Star, Abandoned Baby, Three White Soldiers/Black Crows, Three Inside Up/Down, Three-Line Strike, Rising/Falling Three Methods, Tri-Star, Tasuki Gap, Mat Hold, Deliberation, Advance Block, Two Crows, Unique Three River, Concealing Baby Swallow |

---

## Trade Log & Validation

### Cloud Persistence (Supabase)
All tracked trades sync to `tracked_trades` table (Supabase, ap-northeast-1). Writes are protected by server-side `requireOwnerToken` middleware — the viewer role can read but never mutate.

### Auto-Validation Engine
- Bar-by-bar sequential validation: checks stop BEFORE target on each candle (conservative worst-case)
- MFE/MAE tracking in both % and R-multiples
- Auto-closes: `hit_t1` / `hit_t2` / `hit_t3` / `stopped` / `expired`
- 10-day expiry on unresolved trades
- Entry-day exclusion: validates from day after entry

### Trade Log Filters (v9.0)
Both the validation page and journal support fine-grained status + MFE filters:
- Status: Open, T1 Hit, T2 Hit, T3 Hit, Stopped, Expired, Manual Close, Early Exit
- MFE thresholds: ≥5% Hit, ≥7% Hit, ≥10% Hit (based on Maximum Favorable Excursion)

---

## Stock Universe Presets

| Preset | Symbols |
|--------|--------|
| Clean NSE 2026 | 1,908 |
| NSE F&O Stocks | ~225 |
| Nifty 50 / 100 / 200 / 500 | Standard indices |
| Sectoral (30 indices) | Bank, IT, Pharma, Auto, FMCG, Metal, Energy… |
| Thematic (40+ indices) | Momentum, Quality, Value, Dividend, ESG… |
| NSE F&O Eligible | ~225 derivatives-eligible stocks (new v9.0) |

---

## Application Tabs

| Tab | Purpose |
|-----|---------|
| **Scanner** | Main screening table — 6 sub-tabs (Overview, Screening, Trade Plan, Momentum, Statistics, All). 60+ sortable columns. Detail sidebar. |
| **Performance** | Equity curve, monthly P&L, win-rate dashboard (10 KPIs), scan favorites |
| **Trade Desk** | Position sizing, open/closed positions with MFE/MAE, watchlist, notifications |
| **Journal** | Post-trade reviews, status/MFE filters, Newest-first sort |
| **Focus** | Zero-clutter decision view: top 5 signals by conviction, one-click Track/Watch/Details |
| **Validation** | Full trade log (22 columns), KPI dashboard, outcome breakdown, rolling performance, MFE% filters |

### UI Features
- Dark/light theme toggle with 150+ CSS overrides
- Keyboard navigation: arrow keys for rows, `T` to track (owner only), `W` to watchlist (owner only), `Esc` to close
- Owner-gated UI: viewer can see everything, only the owner can add/remove trades and watchlist entries
- Auto-refresh every 15 min during market hours (9:15 AM – 3:30 PM IST)
- Session management: auto-save scans, compare sessions, import/export
- Export: CSV, XLSX, PDF (landscape A3), Zerodha basket format

---

## Architecture

```
quant-terminal-pro/
├── app/
│   ├── page.tsx                      # Main UI (~10,000 lines) — all state, 6 tabs
│   ├── layout.tsx                    # Root layout
│   ├── globals.css                   # Theme system, 150+ light-mode overrides
│   └── api/
│       ├── fetch-ohlcv/              # Yahoo Finance proxy (retry, browser headers)
│       ├── trades/                   # Cloud trade CRUD (owner-gated PUT/DELETE)
│       ├── brain-similar/            # Brain Vectorize similarity proxy
│       ├── brain-narrate/            # Llama narration proxy
│       ├── log-uc-scan/              # UC event logger → Supabase
│       ├── pbfb-intelligence/        # Intelligence aggregation
│       ├── pbfb-save/                # Brain event persistence
│       ├── nightly-update/           # Nightly label updater
│       ├── label-uc-outcomes/        # Outcome labelling (hit_t1, outcome_pct_20d)
│       ├── chartink-scan/            # Chartink data bridge
│       ├── cmp/                      # Current market price feed
│       ├── uc-hitters/               # UC Goldmine/Strong hitter aggregation
│       ├── screener-auth/            # Session token auth
│       ├── trade-log/                # Trade log endpoint
│       └── telegram/                 # Telegram alert push
├── lib/
│   ├── stockEngine.ts                # Core engine: param sets, analyzeStock(), trade engine
│   ├── tradeOps.ts                   # Trade analytics, win-rate, MFE/MAE, expectancy
│   ├── ucScoreWeights.ts             # ML-calibrated UC Score weight constants
│   ├── niftyPresets.ts               # 90+ index presets incl. NSE F&O, Clean NSE 2026
│   ├── bulkFlow.ts                   # Bulk/block deal flow intelligence
│   ├── sectorFlow.ts                 # Sector momentum breadth scoring
│   ├── validationAnalytics.ts        # Deep analytics: MFE scatter, edge decay, regime perf
│   ├── supabaseServer.ts             # Supabase service-role client
│   ├── screenerSession.ts            # HMAC-signed session token auth
│   ├── fetchClient.ts                # Client OHLCV fetch with OHLC sanity checks
│   ├── autoValidator.ts              # Bar-by-bar trade validation
│   ├── tradeCodec.ts                 # Supabase row ↔ TrackedTrade serialisation
│   ├── spreadsheetExport.ts          # XLSX workbook export
│   └── tearSheet.ts                  # Trader tear sheet PDF generation
├── cloudflare/
│   └── brain-worker/
│       └── src/index.ts              # Edge worker: Vectorize ingest, similarity, Llama narration
├── scripts/
│   ├── uc_precision_analysis.js      # Cohen's d weight recalibration (--apply rewrites weights)
│   └── auto_retrain_uc_xgb.ps1      # PowerShell: precision analysis → git → Vercel deploy
└── LICENSE                           # Proprietary — All Rights Reserved
```

### Data Flow
```
User selects preset (or uploads CSV)
  → Symbols deduplicated
  → 6 concurrent workers fetch OHLCV via /api/fetch-ohlcv proxy
  → Yahoo Finance v8 (.NS then .BO fallback, exponential retry on 429)
  → analyzeStock() runs 24-step pipeline entirely in browser
  → UC Score computed with calibrated weights from ucScoreWeights.ts
  → Nifty 5d regime gate applied (× 0.85 / 1.00 / 1.10)
  → BUY signals (≤30) batched to /api/brain-similar for Vectorize lookup
  → neighborHitRate blended into UC Score (75/25 mix)
  → Bulk deal flow and sector flow overlaid on results
  → React state flushed (300ms debounce)
  → Open tracked trades auto-validated against fresh candle data
  → Session auto-saved; trade changes synced to Supabase
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 App Router, TypeScript |
| Styling | Tailwind CSS v4 |
| Data | Yahoo Finance v8 API (server-side proxy) |
| Cloud DB | Supabase (PostgreSQL, ap-northeast-1) |
| Edge AI | Cloudflare Workers + Vectorize + Workers AI (Llama 3.3 70B) |
| Export | SheetJS (xlsx), jsPDF + autoTable |
| Deployment | Vercel (production), Cloudflare Workers (Brain) |
| Auth | HMAC-SHA256 signed session tokens + owner token middleware |
| State | React useState/useRef + localStorage |

---

## Running Locally

### Prerequisites
- Node.js 18+, npm 10+
- Supabase project with `tracked_trades` table
- Cloudflare account (for Brain Worker, optional)

### Environment Variables (`.env.local`)
```
SCREENER_PASSWORD=your_password
SCREENER_SESSION_SECRET=random_32_char_secret
OWNER_TOKEN=your_owner_secret
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
BRAIN_WORKER_URL=https://pbfb-brain-worker.your-subdomain.workers.dev
BRAIN_WORKER_SECRET=your_worker_secret
```

### Install & Run
```bash
git clone https://github.com/Kasi72/Quant-Terminal-Pro.git
cd Quant-Terminal-Pro
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

### Deploy
```bash
vercel deploy --prod --yes
```

---

## Quality & Hardening

### 6 Enterprise Bug Hunts (43 bugs fixed)
- **Hunt 1:** 12 bugs — crashes, NaN propagation, stale closures, formula errors
- **Hunt 2:** 8 bugs — CSS inversion, stopped count, Hurst regression, array bounds
- **Hunt 3:** 5 bugs — IST math, blob leaks, abort handling, stale refs
- **Hunt 4:** 9 bugs — off-by-one turnover, Fibonacci below entry, dual scan race, session validation
- **Hunt 5:** 2 bugs — scanningRef lock-out on crash, Zerodha BSE exchange mapping
- **Hunt 6:** 7 bugs — scanning guard dead code, entry-day false stop-out, MFE edge cases

### Defensive Guards
- `safe()` handles NaN, Infinity, −0, extreme outliers (>1e10)
- `Number.isFinite()` on all external data and computed outputs
- OHLC sanity validation (h≥l, h≥o/c) with auto-correction
- GARCH variance floor (1e-10) prevents log(0)
- `try/finally` on scan lifecycle — scanningRef never gets stuck
- Input validation on all API routes (length, charset, schema)
- Blob URL revocation on all exports (no memory leaks)
- Server-side owner token check on every write route (defence in depth)

---

## Methodology Credits

| Practitioner | Contribution |
|---|---|
| Mark Minervini | SEPA methodology, tight stop discipline, stage analysis |
| Cynthia Kase | DevStop — True Range standard deviation stop method |
| Alexander Elder | SafeZone directional noise filtering, Triple Screen framework |
| Stan Weinstein | Stage analysis, structural support, Weinstein stop |
| Chuck LeBeau | Chandelier Exit trailing stop system |
| Perry Kaufman | Adaptive Moving Average, Efficiency Ratio entry buffer |
| Van Tharp | R-multiples, position sizing, expectancy framework |
| Jack Schwager | Risk management principles, disaster stop theory |
| John Carter | TTM Squeeze indicator |
| John Bollinger | Bollinger Bands |
| Chester Keltner | Keltner Channels |
| Daryl Guppy | GMMA 12-EMA multiple moving average system |

---

## Intellectual Property

Copyright © 2024–2026 Kasi Krishnaraja Paldurai. All Rights Reserved.

This software is **proprietary and confidential**. The UC Score engine, Brain AI pipeline, bulk-deal flow intelligence, trade analytics framework, and all curated stock universe presets are original works of the author.

Unauthorised copying, distribution, deployment, or reverse engineering is strictly prohibited. See [LICENSE](./LICENSE) for full terms.

Contact: drkasi@gmail.com
