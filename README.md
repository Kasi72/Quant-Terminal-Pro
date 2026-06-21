# Quant Terminal Pro v7.3

A professional-grade stock momentum screener for NSE/BSE markets. Screens 1,700+ stocks through 4 optimized parameter sets with 20-22 conditions each, computes 60+ technical/statistical indicators, provides scientifically computed trade execution plans, and auto-validates signal performance.

**Live:** [stock-screener-tau-fawn.vercel.app](https://stock-screener-tau-fawn.vercel.app)

---

## Features

### Core Screening Engine
- **4 Optimized Parameter Sets (v4):**
  - **Deployable 20+** (BUY) -- 22 conditions, ATR Pctl <=85, UPS >=60
  - **HighPrecision 15+** (STRONG_BUY) -- 21 conditions + closeAboveZone <=8%
  - **Elite 10+** (ULTRA_STRONG_BUY) -- 22 conditions, turnover >=2Cr, ATR Pctl <=60
  - **UltraSelective 8+** -- 22 conditions, zone tightness <=8%, RSI2 >=55
- **24-step analysis pipeline** per stock: ATR14 (Wilder), RSI2, compression zone detection (proximity-first), UPS scoring, CQS, inflection score, stage classification
- **7 stage classifications:** NO_SIGNAL -> COMPRESSION_WATCH -> EARLY_INFLECTION -> PRE_BREAKOUT -> BUY -> STRONG_BUY -> ULTRA_STRONG_BUY
- **Multi-param scan mode:** Runs all 4 sets simultaneously, picks best result per stock

### Trade Execution Engine (v5)
- **5-method consensus stop loss:**
  - Kase DevStop (2-sigma True Range deviation)
  - Elder SafeZone (directional noise filtering)
  - Weinstein structural (zone low - ATR buffer)
  - Signal candle low
  - Second-lowest consensus stop
- **Hybrid target system:**
  - ATR-based: T1 = 2.0x ATR, T2 = 3.5x ATR, T3 = 5.5x ATR
  - Fibonacci extension from compression zone: 1.0, 1.618, 2.618
  - Selection: T1 = MIN(ATR, Fib), T2/T3 = MAX(ATR, Fib)
  - Van Tharp 3R reference target
- **Kaufman Adaptive Entry Buffer** based on efficiency ratio
- **R:R verdict system:** Elite (>=3.5), Very Good (>=2.5), Good (>=2.0), Acceptable (>=1.5), Rejected (<1.5)
- **NSE tick size compliance:** All prices rounded to Rs.0.05
- **Risk caps by stage:** ULTRA_STRONG <=2.5%, STRONG <=3.0%, BUY <=3.5%

### Statistical Engine (25+ features)
- Z-Score volume anomaly, Bollinger Band squeeze, Keltner squeeze
- TTM Squeeze (John Carter) with per-bar Donchian+SMA midline momentum
- RSI(14) Wilder's method, CCI(34) Lambert's method
- GARCH(1,1) volatility forecast with variance floor
- Hurst exponent (proper R/S linear regression)
- Shannon entropy, CUSUM regime change detection
- Guppy GMMA (12 EMAs: 3,5,8,10,12,15,30,35,40,45,50,60)
- EMA/SMA levels (10,21,55,200) with crossover detection
- 52-week high drawdown, 52-week low distance, 20-day Sharpe ratio

### Candlestick Pattern Recognition (53 patterns)
- **Single candle (15):** Marubozu, Hammer, Shooting Star, Doji variants, Belt Hold, High Wave, Spinning Top, Shaven Head/Bottom
- **Two candle (18):** Engulfing, Kicking, Piercing, Dark Cloud, Harami, Tweezer, Counterattack, Separating/Meeting Lines, In-Neck, On-Neck, Thrusting, Matching Low, Homing Pigeon
- **Three+ candle (20):** Morning/Evening Star, Abandoned Baby, Three White Soldiers/Black Crows, Three Inside Up/Down, Three-Line Strike, Rising/Falling Three Methods, Tri-Star, Tasuki Gap, Mat Hold, Deliberation, Advance Block, Two Crows, Unique Three River, Concealing Baby Swallow

### Auto-Validation Engine
- **Level 3 bar-by-bar sequential validation:** Checks stop BEFORE target on each candle (conservative worst-case)
- **MFE/MAE tracking:** Maximum Favorable/Adverse Excursion in both % and R-multiples
- **Auto-closes trades:** Marks hit_t1/hit_t2/hit_t3/stopped/expired
- **10-day expiry:** Auto-expires trades without target or stop hit
- **Rolling stats:** Win rate, avg time to target, avg MFE/MAE across last 10, 20, and all trades
- **Entry-day exclusion:** Validates from day AFTER entry to prevent false same-day stop-outs

### Market Regime Detection
- **Auto-fetches Nifty 50 on page load** (^NSEI via Yahoo Finance)
- **Weinstein stage analysis:** CMP vs EMA200, EMA50 vs EMA200
- **3 regimes:** Bull (full size x1.0), Neutral (half size x0.5), Bear (no new trades x0)
- **Displayed in header bar** with tooltip showing Nifty CMP, EMA50, EMA200

---

## UI / Tabs

| Tab | Purpose |
|-----|---------|
| **Scanner** | Main screening table with 6 sub-tabs (Overview, Screening, Trade Plan, Momentum, Statistics, All). 60+ sortable/filterable columns. Detail sidebar on row click. |
| **Performance** | Equity curve, monthly reports, win rate dashboard (10 KPIs), scan favorites |
| **Trade Desk** | Position sizing calculator, open/closed positions with MFE/MAE, watchlist, notifications |
| **Journal** | Post-trade reviews, lessons learned tracker |
| **Focus** | Zero-clutter decision view: top 5 signals ranked by conviction, one-click Track/Watch/Details |
| **Validation** | Complete trade log with 22 columns, KPI dashboard, outcome breakdown, rolling performance |

### Additional UI Features
- **Dark/Light theme toggle** with 150+ CSS overrides
- **Keyboard navigation:** Arrow keys for rows, T to track, W to watchlist, Esc to close
- **Auto-refresh** every 15 min during market hours (9:15 AM - 3:30 PM IST)
- **Session management:** Auto-save scans, compare sessions, import/export
- **Export:** CSV, XLSX, PDF (landscape A3), Zerodha basket format (auto-detects NSE/BSE exchange)
- **90+ preset indices:** 22 broad market, 30 sectoral, 40+ thematic/strategy indices
- **808 industry mappings** from NSE CSV data

---

## Architecture

```
stock-screener/
├── app/
│   ├── page.tsx                    # Main UI (~2900 lines) - 6 tabs, all state management
│   ├── layout.tsx                  # Root layout with fonts
│   ├── globals.css                 # Theme system with 150+ light-mode overrides
│   └── api/
│       └── fetch-ohlcv/route.ts    # Yahoo Finance proxy with retry, browser headers
├── lib/
│   ├── stockEngine.ts              # Core: 4 param sets, analyzeStock(), buildTradeEngine()
│   ├── statsEngine.ts              # 25+ statistical features, TTM Squeeze, GARCH, Hurst
│   ├── candlePatterns.ts           # 53 candlestick pattern recognition
│   ├── autoValidator.ts            # Trade auto-validation with MFE/MAE
│   ├── tradingUtils.ts             # Trade sheet, win rate stats, market regime
│   ├── tradingUtils2.ts            # Zerodha export, signal history
│   ├── tradingUtils3.ts            # Conviction score, sector tags, scan stats
│   ├── performanceEngine.ts        # Equity curve, monthly reports
│   ├── sessionManager.ts           # Session CRUD with compression, 20-session limit
│   ├── fetchClient.ts              # Client-side OHLCV fetch with OHLC sanity checks
│   ├── niftyPresets.ts             # 22 broad market indices (incl. NSE Full Equity 1783 stocks)
│   ├── sectorPresets.ts            # 30 sectoral indices
│   ├── thematicPresets.ts          # 40+ thematic + 36 strategy indices
│   └── industryMap.ts              # 808 symbol-to-industry mappings
└── package.json
```

### Data Flow
```
User selects index/uploads CSV
  -> Symbols deduplicated
  -> 6 concurrent workers fetch OHLCV via /api/fetch-ohlcv proxy
  -> Yahoo Finance v8 API (tries .NS then .BO, retry on 429)
  -> analyzeStock() runs 24-step pipeline in browser
  -> Results rendered in React state with 300ms debounced flush
  -> Auto-validates open tracked trades using freshCandleMap
  -> Session auto-saved to localStorage
```

### Key Design Decisions
- **Client-side screening:** All computation runs in the browser. Server only proxies Yahoo Finance to avoid CORS.
- **No database:** All persistence via localStorage (sessions, trades, watchlist, settings). Max 20 sessions with progressive pruning.
- **Defensive coding:** 43 bugs found and fixed across 6 enterprise-grade bug hunts. Every numeric output wrapped in `safe()` / `Number.isFinite()` guards. try/finally on scan, abort checks after async, ref-based race condition prevention.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 App Router + TypeScript |
| Styling | Tailwind CSS v4 |
| Data Source | Yahoo Finance v8 API (server-side proxy) |
| Export | SheetJS (xlsx), jsPDF + autoTable |
| Deployment | Vercel |
| State | React useState/useRef + localStorage |

---

## Getting Started

### Prerequisites
- Node.js 18+
- npm 10.x

### Install & Run
```bash
git clone https://github.com/kasi72s/quant-terminal-pro.git
cd quant-terminal-pro
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

### Deploy to Vercel
```bash
npx vercel --prod
```

---

## Screening Methodology

### Stage Classification Logic
```
Conditions Met >= 100% of total    -> ULTRA_STRONG_BUY
Conditions Met >= 75% of total     -> STRONG_BUY
Conditions Met >= 60% of total     -> BUY
Conditions Met >= 50%              -> PRE_BREAKOUT
Conditions Met >= 35%              -> EARLY_INFLECTION
Conditions Met >= 20%              -> COMPRESSION_WATCH
Below 20%                          -> NO_SIGNAL
```

### R:R Distribution (Hybrid Target System)
| Stop Tightness | Risk/share | R:R | Color | Verdict |
|---|---|---|---|---|
| Very tight (0.5x ATR) | Small | 4.0:1 | Neon Green | Elite |
| Tight (0.75x ATR) | Medium | 2.7:1 | Orange | Very Good |
| Normal (1.0x ATR) | Normal | 2.0:1 | Yellow | Good |
| Wide (1.3x ATR) | Large | 1.5:1 | Yellow | Acceptable |
| Too wide (1.5x ATR+) | Too large | <1.5 | Rejected | Trade invalid |

### Risk Management Thresholds
| Parameter | Value | Source |
|---|---|---|
| Min R:R | 1.5:1 | Van Tharp |
| Max Risk% (ULTRA_STRONG) | 2.5% | Minervini |
| Max Risk% (STRONG_BUY) | 3.0% | Elder |
| Max Risk% (BUY) | 3.5% | Professional standard |
| Disaster Risk cap | 8.0% | Schwager |
| Account risk per trade | 1.0% | Larry Hite |

---

## Hardening & Quality

### 6 Enterprise Bug Hunts (43 bugs fixed)
- **Hunt 1:** 12 bugs -- crashes, NaN propagation, stale closures, formula errors
- **Hunt 2:** 8 bugs -- CSS inversion, stopped count, Hurst regression, array bounds
- **Hunt 3:** 5 bugs -- IST math, blob leaks, abort handling, stale refs
- **Hunt 4:** 9 bugs -- off-by-one turnover, Fibonacci below entry, dual scan race, session validation
- **Hunt 5:** 2 bugs -- scanningRef lock-out on crash, Zerodha BSE exchange
- **Hunt 6:** 2 bugs -- scanning guard dead code (stale closure), entry-day false stop-out

### Defensive Guards (18 hardening measures)
- `safe()` handles NaN, Infinity, -0, extreme outliers (>1e10)
- `Number.isFinite()` on all external data and computed outputs
- OHLC sanity validation (h>=l, h>=o/c) with auto-correction
- GARCH variance floor (1e-10)
- try/finally on scan lifecycle
- scanningRef for race condition prevention
- Input validation on API route (length, charset)
- Blob URL revocation on all exports

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v7.3 | 2026-06-21 | 53 candle patterns, Focus tab, Validation tab, auto-validation engine, market regime auto-detect, 6 bug hunts (43 fixes), 18 hardening guards, light theme, v4 param sets, hybrid Fibonacci targets, R:R verdict column |
| v7.2 | 2026-06-19 | 7 momentum enhancements (EMA alignment, higher low, vol dry-up, OBV, ADX, gap-adj R:R, RS vs Nifty) |
| v7.1 | 2026-06-18 | 4-param screening, compression zone detection, trade engine v5, 90+ preset indices |
| v1.0 | 2026-06-15 | Initial release: CSV upload, basic screening, sortable table |

---

## License

MIT

---

## Acknowledgments

Built with expertise from:
- **Mark Minervini** -- SEPA methodology, tight stop discipline
- **Cynthia Kase** -- DevStop True Range standard deviation method
- **Alexander Elder** -- SafeZone directional noise filtering, Triple Screen
- **Stan Weinstein** -- Stage analysis, structural support levels
- **Chuck LeBeau** -- Chandelier Exit trailing stop system
- **Perry Kaufman** -- Adaptive Moving Average, Efficiency Ratio
- **Van Tharp** -- Position sizing, R-multiples, expectancy
- **Jack Schwager** -- Risk management principles, disaster stops
- **John Carter** -- TTM Squeeze indicator
- **John Bollinger** -- Bollinger Bands
- **Chester Keltner** -- Keltner Channels
- **Daryl Guppy** -- GMMA multiple moving averages
