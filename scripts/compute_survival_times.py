"""
Survival time computation — time-to-5% for each pbfb_uc_events signal.

For every labeled event in pbfb_uc_events (n_before=1), finds the first bar
in the corresponding OHLCV CSV where high >= close_price * 1.05, yielding
the "days_to_5pct" duration. Also records whether the event was censored
(5% was never reached within the CSV history = censored observation for KM).

Output:
    scripts/results/survival_times.csv
    Columns: symbol, event_date, archetype_type, close_price, days_to_5pct, reached_5pct

Usage:
    pip install pandas python-dotenv supabase-py
    python scripts/compute_survival_times.py
"""

import csv, os, pathlib, sys
from datetime import datetime, timedelta

import pandas as pd
from dotenv import load_dotenv

CSV_DIR = pathlib.Path("C:/Users/drkkr/Downloads/NIFTY ALL1783")
OUT_DIR  = pathlib.Path(__file__).parent / "results"
OUT_DIR.mkdir(exist_ok=True)

load_dotenv(pathlib.Path(__file__).parent.parent / ".env.local")
SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# ---------------------------------------------------------------------------
# Fetch events
# ---------------------------------------------------------------------------
try:
    from supabase import create_client
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    resp = (
        sb.table("pbfb_uc_events")
        .select("symbol,event_date,archetype_type,close_price")
        .eq("n_before", 1)
        .not_.is_("event_date", "null")
        .not_.is_("close_price", "null")
        .not_.is_("archetype_type", "null")
        .limit(5000)
        .execute()
    )
    events = resp.data
except Exception as e:
    print(f"[ERROR] Supabase fetch failed: {e}")
    sys.exit(1)

print(f"[INFO] {len(events)} events to process")

# ---------------------------------------------------------------------------
# Build a symbol → sorted DataFrame cache to avoid re-reading the same file
# ---------------------------------------------------------------------------
_csv_cache: dict[str, pd.DataFrame] = {}

def load_csv(symbol: str) -> pd.DataFrame | None:
    if symbol in _csv_cache:
        return _csv_cache[symbol]
    stem = symbol.replace(".", "_")
    candidates = (
        list(CSV_DIR.glob(f"{stem}_OHLCV.csv")) +
        list(CSV_DIR.glob(f"{stem}.csv")) +
        list(CSV_DIR.glob(f"{stem}_*.csv"))
    )
    if not candidates:
        return None
    df = pd.read_csv(candidates[0])
    # Normalise column names
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    date_col = next((c for c in df.columns if "date" in c), None)
    high_col = next((c for c in df.columns if c in ("high", "h")), None)
    if date_col is None or high_col is None:
        return None
    df = df.rename(columns={date_col: "date", high_col: "high"})
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)
    _csv_cache[symbol] = df
    return df

# ---------------------------------------------------------------------------
# Process each event
# ---------------------------------------------------------------------------
results = []
missing = 0

for ev in events:
    symbol      = ev["symbol"]
    event_date  = ev["event_date"]
    arch        = ev["archetype_type"]
    close_price = float(ev["close_price"])
    target      = close_price * 1.05

    df = load_csv(symbol)
    if df is None:
        missing += 1
        continue

    event_dt = pd.Timestamp(event_date)
    future   = df[df["date"] > event_dt].reset_index(drop=True)
    if future.empty:
        missing += 1
        continue

    hit_idx = future[future["high"] >= target].index
    if len(hit_idx) > 0:
        days_to_5pct = int(hit_idx[0]) + 1   # 1-indexed calendar bars
        reached_5pct = True
    else:
        days_to_5pct = len(future)             # censored at available horizon
        reached_5pct = False

    results.append({
        "symbol":        symbol,
        "event_date":    event_date,
        "archetype_type": arch,
        "close_price":   close_price,
        "days_to_5pct":  days_to_5pct,
        "reached_5pct":  reached_5pct,
    })

out_path = OUT_DIR / "survival_times.csv"
pd.DataFrame(results).to_csv(out_path, index=False)
print(f"[OK] {len(results)} events written → {out_path}")
print(f"[WARN] {missing} events had no matching CSV")
