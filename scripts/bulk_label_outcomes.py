"""
Bulk outcome labeler — runs locally against NIFTY ALL1783 CSVs.
Replaces nightly brain-worker /label-outcomes for historical backfill.
Auto-paginates until all unlabeled rows are processed.

Labels pbfb_uc_events (n_before=1) with:
  hit_t1          — high >= close_price * 1.08 within 20 bars
  hit_t2          — high >= close_price * 1.15 within 20 bars
  stopped_out     — low  <= close_price * 0.95 before hit_t1
  outcome_pct_20d — (close[day20] - base) / base * 100

Usage:
    python scripts/bulk_label_outcomes.py [--batch 500] [--dry-run] [--limit N]
"""

import argparse, os, pathlib, sys, time
from datetime import datetime

import pandas as pd
from dotenv import load_dotenv

# ── Constants (must match brain-worker) ──────────────────────────────────────
HIT_T1_MULT = 1.08
HIT_T2_MULT = 1.15
STOP_MULT   = 0.95
LABEL_DAYS  = 20
CSV_DIR     = pathlib.Path("C:/Users/drkkr/Downloads/NIFTY ALL1783")

load_dotenv(pathlib.Path(__file__).parent.parent / ".env.local")
SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

parser = argparse.ArgumentParser()
parser.add_argument("--batch",   type=int, default=500,   help="Rows per Supabase write batch")
parser.add_argument("--dry-run", action="store_true",     help="Compute labels, do not write")
parser.add_argument("--limit",   type=int, default=0,     help="Max rows per page (0 = 1000)")
args = parser.parse_args()

from supabase import create_client
sb = create_client(SUPABASE_URL, SUPABASE_KEY)

PAGE   = args.limit if args.limit > 0 else 1000
today  = datetime.utcnow().strftime("%Y-%m-%d")
cutoff = (pd.Timestamp.utcnow() - pd.Timedelta(days=30)).strftime("%Y-%m-%d")

# ── CSV cache ─────────────────────────────────────────────────────────────────
_csv_cache: dict[str, pd.DataFrame | None] = {}

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
        _csv_cache[symbol] = None
        return None
    df = pd.read_csv(candidates[0])
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    date_col  = next((c for c in df.columns if "date"  in c), None)
    high_col  = next((c for c in df.columns if c in ("high",  "h")), None)
    low_col   = next((c for c in df.columns if c in ("low",   "l")), None)
    close_col = next((c for c in df.columns if c in ("close", "c")), None)
    if not all([date_col, high_col, low_col, close_col]):
        _csv_cache[symbol] = None
        return None
    df = df.rename(columns={date_col: "date", high_col: "high", low_col: "low", close_col: "close"})
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)
    _csv_cache[symbol] = df
    return df

# ── Pagination loop ───────────────────────────────────────────────────────────
grand_labeled = 0
grand_written = 0
grand_wins    = 0
page_num      = 0

while True:
    page_num += 1
    print(f"\n[PAGE {page_num}] Fetching up to {PAGE} unlabeled rows …")

    resp = (
        sb.table("pbfb_uc_events")
        .select("id,symbol,event_date,close_price")
        .eq("n_before", 1)
        .is_("hit_t1", "null")
        .is_("outcome_labeled_at", "null")
        .lte("event_date", cutoff)
        .order("event_date", desc=False)
        .limit(PAGE)
        .execute()
    )
    rows = resp.data
    if not rows:
        print("[INFO] No more unlabeled rows — pagination complete.")
        break
    print(f"[INFO] {len(rows)} rows fetched")

    # Label
    labeled_ok  = 0
    csv_missing = 0
    no_fwd      = 0
    updates: list[dict] = []

    for row in rows:
        if not row.get("event_date"):
            continue
        symbol     = row["symbol"]
        event_date = row["event_date"]
        row_id     = row["id"]

        df = load_csv(symbol)
        if df is None:
            csv_missing += 1
            updates.append({"id": row_id, "outcome_labeled_at": today, "_skip": True})
            continue

        # Resolve base close — backfill from CSV when null in Supabase
        if row.get("close_price"):
            base = float(row["close_price"])
        else:
            event_dt = pd.Timestamp(event_date)
            on_date  = df[df["date"] == event_dt]
            if on_date.empty:
                on_date = df[df["date"] <= event_dt].tail(1)
            if on_date.empty:
                no_fwd += 1
                continue
            base = float(on_date.iloc[-1]["close"])

        fwd = df[df["date"] > pd.Timestamp(event_date)].head(LABEL_DAYS).reset_index(drop=True)
        if len(fwd) < 5:
            no_fwd += 1
            continue

        hit_t1      = False
        hit_t2      = False
        stopped_out = False
        for _, bar in fwd.iterrows():
            if float(bar["high"]) >= base * HIT_T1_MULT:
                hit_t1 = True
            if float(bar["high"]) >= base * HIT_T2_MULT:
                hit_t2 = True
            if not hit_t1 and float(bar["low"]) <= base * STOP_MULT:
                stopped_out = True

        outcome_pct_20d = round((float(fwd.iloc[-1]["close"]) - base) / base * 100, 2)
        updates.append({
            "id": row_id,
            "hit_t1": hit_t1, "hit_t2": hit_t2, "stopped_out": stopped_out,
            "outcome_pct_20d": outcome_pct_20d,
            "outcome_labeled_at": today,
        })
        labeled_ok += 1

    wins = sum(1 for u in updates if u.get("hit_t1") is True)
    print(f"[INFO] Labeled: {labeled_ok}, CSV missing: {csv_missing}, no fwd: {no_fwd}, WR: {wins}/{labeled_ok} = {wins/max(labeled_ok,1):.1%}")

    if args.dry_run:
        print(f"[DRY RUN] Would write {len(updates)} rows. Stopping after 1 page.")
        break

    # Write to Supabase
    written = 0
    for i in range(0, len(updates), args.batch):
        chunk = updates[i : i + args.batch]
        for u in chunk:
            row_id = u.pop("id")
            skip   = u.pop("_skip", False)
            try:
                sb.table("pbfb_uc_events").update(
                    {"outcome_labeled_at": today} if skip else u
                ).eq("id", row_id).execute()
                if not skip:
                    written += 1
            except Exception as e:
                print(f"  [WARN] id={row_id}: {e}")
        print(f"  … wrote {min(i + args.batch, len(updates))} / {len(updates)}")
        time.sleep(0.2)

    grand_labeled += labeled_ok
    grand_written += written
    grand_wins    += wins
    print(f"[PAGE {page_num} DONE] written={written}  running total: {grand_labeled} labeled, {grand_written} written")

    if len(rows) < PAGE:
        print("[INFO] Last page reached.")
        break

print(f"\n{'='*50}")
print(f"[COMPLETE] Total labeled: {grand_labeled}, written: {grand_written}")
print(f"           Overall hit_t1 WR: {grand_wins}/{grand_labeled} = {grand_wins/max(grand_labeled,1):.1%}")
print("Now run: python scripts/train_xgb_score.py")
