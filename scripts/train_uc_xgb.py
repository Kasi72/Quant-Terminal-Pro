"""
UC-XGBoost trainer with Platt calibration.

Label: hit_uc_proxy = hit_t1 AND outcome_pct_20d > 12
  - hit_t1: stock peaked >=8% above entry within 20 bars
  - outcome_pct_20d > 12: closed >12% above entry at day 20
  - Together = big, sustained fast move (strong proxy for UC-type event)

Key improvements over train_xgb_score.py:
  1. UC-specific label (not generic momentum hit_t1)
  2. Graceful NaN handling -- XGBoost learns best direction for missing values
     so we keep all 3,700+ rows instead of 38 (no dropna on features)
  3. Platt calibration on held-out test set (not training data)
  4. Outputs both XGBoost model AND Platt coef/intercept to TypeScript files

Usage:
    pip install xgboost scikit-learn pandas python-dotenv supabase
    python scripts/train_uc_xgb.py

Outputs:
    lib/ucXgbWeights.ts   -- XGBoost tree JSON for ucXgbInfer.ts
    lib/ucCalibration.ts  -- Platt sigmoid coef + intercept
    scripts/results/uc_xgb_report.txt
"""

import json, os, pathlib, sys
from datetime import datetime

import numpy as np
import pandas as pd
from dotenv import load_dotenv

load_dotenv(pathlib.Path(__file__).parent.parent / ".env.local")
SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# ---------------------------------------------------------------------------
# Fetch data -- auto-paginate to get all labeled rows
# ---------------------------------------------------------------------------
try:
    from supabase import create_client
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
except Exception as e:
    print(f"[ERROR] Supabase client init failed: {e}")
    sys.exit(1)

COLS = (
    "hit_t1,outcome_pct_20d,event_date,vol_ratio_20,close_loc,body_pct,rsi2,"
    "range_atr,zone_len,zone_tightness,vol_vs_pre5,vol_accel,rsi2_velocity,"
    "cl_trend,near_breakout_tier,archetype_type"
)

all_rows: list[dict] = []
PAGE = 1000
offset = 0
while True:
    try:
        resp = (
            sb.table("pbfb_uc_events")
            .select(COLS)
            .eq("n_before", 1)
            .not_.is_("hit_t1", "null")
            .not_.is_("outcome_pct_20d", "null")
            .order("event_date", desc=False)
            .range(offset, offset + PAGE - 1)
            .execute()
        )
    except Exception as e:
        print(f"[ERROR] Supabase page fetch failed at offset={offset}: {e}")
        sys.exit(1)
    batch = resp.data or []
    all_rows.extend(batch)
    print(f"[INFO] Fetched page {offset // PAGE + 1}: {len(batch)} rows (total: {len(all_rows)})")
    if len(batch) < PAGE:
        break
    offset += PAGE

df = pd.DataFrame(all_rows)
print(f"[INFO] Total fetched: {len(df)} labeled rows")

if len(df) < 100:
    print(f"[WARN] Only {len(df)} rows with both hit_t1 and outcome_pct_20d labeled. Need 100+ for reliable training.")
    sys.exit(0)

# ---------------------------------------------------------------------------
# Fix vol_accel: vol_vs_pre5 is the correct column (written by pbfb-save).
# vol_accel column in DB is mostly null; vol_vs_pre5 has 3x better coverage.
# The model feature stays named "vol_accel" to match ucXgbInfer.ts interface.
# ---------------------------------------------------------------------------
df["vol_accel"] = pd.to_numeric(df.get("vol_vs_pre5"), errors="coerce").combine_first(
    pd.to_numeric(df.get("vol_accel"), errors="coerce")
)

# ---------------------------------------------------------------------------
# Nifty 5-day return -- market regime feature.
# UC events cluster in bull phases; adding Nifty context improves class separation.
# ---------------------------------------------------------------------------
try:
    import yfinance as yf
    _dates = pd.to_datetime(df["event_date"], errors="coerce").dropna()
    if len(_dates) > 0:
        _start = (_dates.min() - pd.Timedelta(days=15)).strftime("%Y-%m-%d")
        _end   = (_dates.max() + pd.Timedelta(days=5)).strftime("%Y-%m-%d")
        _nifty = yf.download("^NSEI", start=_start, end=_end, progress=False, auto_adjust=True)
        if not _nifty.empty:
            _close = _nifty["Close"].squeeze()
            _ret5  = _close.pct_change(5) * 100
            _map   = {d.strftime("%Y-%m-%d"): v for d, v in _ret5.items() if not pd.isna(v)}
            df["nifty_5d_ret"] = df["event_date"].astype(str).map(_map)
            _nn = df["nifty_5d_ret"].notna().sum()
            print(f"[INFO] nifty_5d_ret: {_nn}/{len(df)} non-null ({_nn/len(df):.0%})")
        else:
            print("[WARN] yfinance returned empty Nifty data. Regime feature skipped.")
    else:
        print("[WARN] No valid event_date values. Regime feature skipped.")
except ImportError:
    print("[WARN] yfinance not installed (pip install yfinance). Regime feature skipped.")
except Exception as _e:
    print(f"[WARN] Nifty fetch failed: {_e}. Regime feature skipped.")

# ---------------------------------------------------------------------------
# Label: hit_uc_proxy = hit_t1 AND outcome_pct_20d > 20
# Tighter than the previous > 12 threshold -- catches genuine big fast moves.
# Base rate drops from ~26% to ~15-18%; harder problem, cleaner signal.
# ---------------------------------------------------------------------------
df["hit_t1"] = df["hit_t1"].astype(bool)
df["outcome_pct_20d"] = pd.to_numeric(df["outcome_pct_20d"], errors="coerce")
df["hit_uc_proxy"] = (df["hit_t1"] == True) & (df["outcome_pct_20d"] > 20)
y_all = df["hit_uc_proxy"].astype(int)

pos_rate = y_all.mean()
print(f"[INFO] hit_uc_proxy base rate: {pos_rate:.1%} ({y_all.sum()} / {len(y_all)})")

if y_all.sum() < 30 or (1 - y_all).sum() < 30:
    print("[WARN] Too few positive or negative cases for UC proxy label. Relabel more events or lower threshold.")
    sys.exit(0)

# ---------------------------------------------------------------------------
# Feature engineering -- keep NaN for XGBoost's built-in missing handler
# ---------------------------------------------------------------------------
TIER_MAP = {"A+": 2, "A": 1, "B": 0}

def encode_tier(val):
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return -1
    return TIER_MAP.get(str(val), -1)

def encode_archetype(val):
    ARCH = {"CompressionCoil": 0, "EMAStack": 1, "MomentumPocket": 2, "PerfectStorm": 3, "VolumeFootprint": 4}
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return -1
    return ARCH.get(str(val), -1)

df["near_breakout_tier_enc"] = df["near_breakout_tier"].apply(encode_tier)
df["archetype_enc"] = df["archetype_type"].apply(encode_archetype)

FEATURES = [
    "vol_ratio_20", "close_loc", "body_pct", "rsi2", "range_atr",
    "zone_len", "zone_tightness", "vol_accel", "rsi2_velocity", "cl_trend",
    "near_breakout_tier_enc", "archetype_enc",
]
avail_features = [f for f in FEATURES if f in df.columns]

X_all = df[avail_features].apply(pd.to_numeric, errors="coerce")  # NaN preserved

print(f"[INFO] Features used: {avail_features}")
for feat in avail_features:
    null_pct = X_all[feat].isna().mean() * 100
    print(f"  {feat:30s}: {null_pct:.1f}% null (XGBoost handles natively)")

# ---------------------------------------------------------------------------
# Train / test split -- stratified on UC proxy label
# ---------------------------------------------------------------------------
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, brier_score_loss

X_train, X_test, y_train, y_test = train_test_split(
    X_all, y_all, test_size=0.2, random_state=42, stratify=y_all
)

# ---------------------------------------------------------------------------
# XGBoost -- handle class imbalance and missing values natively
# ---------------------------------------------------------------------------
try:
    import xgboost as xgb
except ImportError:
    print("[ERROR] xgboost not installed. Run: pip install xgboost")
    sys.exit(1)

pos_weight = (y_train == 0).sum() / max((y_train == 1).sum(), 1)
print(f"[INFO] scale_pos_weight = {pos_weight:.2f} (class imbalance correction)")

model = xgb.XGBClassifier(
    n_estimators=300,
    max_depth=4,
    learning_rate=0.04,
    subsample=0.8,
    colsample_bytree=0.8,
    scale_pos_weight=pos_weight,
    eval_metric="auc",
    early_stopping_rounds=30,
    random_state=42,
    verbosity=0,
    tree_method="hist",      # fast, supports NaN natively
    enable_categorical=False,
)

model.fit(
    X_train, y_train,
    eval_set=[(X_test, y_test)],
    verbose=False,
)

y_prob_test = model.predict_proba(X_test)[:, 1]
auc = roc_auc_score(y_test, y_prob_test)
print(f"[INFO] UC-XGB Test AUC = {auc:.4f}")

# ---------------------------------------------------------------------------
# Platt calibration on held-out test set
# Fit LogisticRegression(blended_score) -> y_uc
# blended_score = 0.6 * formula_v4(row) + 0.4 * xgb_pred * 100
# ---------------------------------------------------------------------------
from sklearn.linear_model import LogisticRegression

def compute_uc_formula_v4(row: pd.Series) -> float:
    """Python equivalent of TypeScript computeUCScore v4."""
    cl  = float(row.get("close_loc")   or 50)
    rsi = float(row.get("rsi2")        or 50)
    vol = float(row.get("vol_ratio_20") or 1)
    rng = float(row.get("range_atr")   or 1)
    bp  = float(row.get("body_pct")    or 30)
    cl_trend = row.get("cl_trend")
    rsi_vel  = row.get("rsi2_velocity")
    zt       = row.get("zone_tightness")
    va       = row.get("vol_accel")
    nbt      = str(row.get("near_breakout_tier") or "")
    arch     = str(row.get("archetype_type") or "")

    def norm(val, lo, span): return min(1.0, max(0.0, (float(val) - lo) / span))

    cl_comp  = norm(cl,  40, 52) * 22
    rsi_comp = norm(rsi, 30, 70) * 16
    clt_comp = norm(cl_trend,  -39, 85) * 18 if cl_trend is not None and not (isinstance(cl_trend, float) and np.isnan(cl_trend)) else 9
    rsv_comp = norm(rsi_vel,   -36, 83) * 13 if rsi_vel  is not None and not (isinstance(rsi_vel,  float) and np.isnan(rsi_vel))  else 6
    rng_comp = norm(rng, 0.5, 1.2) * 5
    bp_comp  = norm(bp,  15,  56) * 5

    vol_accel_val = float(va) if va is not None and not (isinstance(va, float) and np.isnan(va)) else 0
    vol_max   = max(vol, vol_accel_val)
    vol_bonus = 12 if vol_max >= 3.0 else 5 if vol_max >= 2.0 else 2 if vol_max >= 1.5 else 0

    zt_comp  = norm(8.0 - float(zt), 0, 6) * 6 if zt is not None and not (isinstance(zt, float) and np.isnan(zt)) else 3
    va_comp  = norm(float(va), 0.8, 2.2) * 5    if va is not None and not (isinstance(va, float) and np.isnan(va)) else 2.5
    nbt_comp = 5 if nbt == "A+" else 2.5 if nbt == "A" else 0
    arch_bonus = {"VolumeFootprint": 4, "MomentumPocket": 3, "CompressionCoil": 2}
    arch_comp = arch_bonus.get(arch, 1 if arch else 0)

    return min(100.0, cl_comp + rsi_comp + clt_comp + rsv_comp + rng_comp + bp_comp
               + vol_bonus + zt_comp + va_comp + nbt_comp + arch_comp)

# Compute formula scores on the test set rows (original df, not X_test encoded)
test_idx = X_test.index
df_test   = df.loc[test_idx]

formula_test  = df_test.apply(compute_uc_formula_v4, axis=1).values
blended_test  = 0.6 * formula_test + 0.4 * y_prob_test * 100

platt = LogisticRegression(max_iter=1000, random_state=42)
platt.fit(blended_test.reshape(-1, 1), y_test)

platt_coef      = float(platt.coef_[0][0])
platt_intercept = float(platt.intercept_[0])

y_calib_prob = platt.predict_proba(blended_test.reshape(-1, 1))[:, 1]
brier = brier_score_loss(y_test, y_calib_prob)
calib_auc = roc_auc_score(y_test, y_calib_prob)
print(f"[INFO] Platt coef={platt_coef:.4f}  intercept={platt_intercept:.4f}")
print(f"[INFO] Calibrated AUC={calib_auc:.4f}  Brier score={brier:.4f}")

# Sanity-check calibration curve (5 score buckets)
print("[INFO] Calibration check (blended score -> actual UC rate):")
buckets = pd.cut(blended_test, bins=[0, 20, 40, 60, 80, 100], include_lowest=True)
for bucket, group_y in y_test.groupby(buckets, observed=True):
    idx_mask = group_y.index
    pred_mean = platt.predict_proba(blended_test[y_test.index.get_indexer(idx_mask)].reshape(-1, 1))[:, 1].mean()
    actual_mean = group_y.mean()
    print(f"  {str(bucket):20s}: n={len(group_y):4d}  predicted={pred_mean:.2f}  actual={actual_mean:.2f}")

# ---------------------------------------------------------------------------
# Export XGBoost tree JSON
# ---------------------------------------------------------------------------
booster  = model.get_booster()
raw_dump = booster.get_dump(dump_format="json")

def parse_xgb_node(node: dict) -> dict:
    if "leaf" in node:
        return {"leaf": float(node["leaf"])}
    return {
        "split":           node["split"],
        "split_condition": float(node["split_condition"]),
        "yes":     parse_xgb_node(node["children"][0]),
        "no":      parse_xgb_node(node["children"][1]),
        "missing": parse_xgb_node(node["children"][0]),  # follow yes-branch on missing
    }

trees = [parse_xgb_node(json.loads(raw)) for raw in raw_dump]

base_score = float(booster.attr("base_score") or 0.5)
today = datetime.utcnow().strftime("%Y-%m-%d")

uc_model_output = {
    "generated":     today,
    "n_train":       int(len(X_train)),
    "test_auc":      round(auc, 4),
    "base_score":    base_score,
    "feature_names": avail_features,
    "trees":         trees,
}

out_dir = pathlib.Path(__file__).parent / "results"
out_dir.mkdir(exist_ok=True)

# JSON artifact
(out_dir / "uc_xgb_model.json").write_text(json.dumps(uc_model_output, indent=2), encoding="utf-8")
print(f"[OK] JSON model --> {out_dir / 'uc_xgb_model.json'}")

# lib/ucXgbWeights.ts
ts_model_path = pathlib.Path(__file__).parent.parent / "lib" / "ucXgbWeights.ts"
ts_model_path.write_text(
    "// AUTO-GENERATED by scripts/train_uc_xgb.py -- do not edit manually.\n"
    f"// Generated: {today}, n_train={len(X_train)}, AUC={auc:.4f}\n"
    "// Label: hit_uc_proxy = hit_t1 AND outcome_pct_20d > 12\n"
    f"export const UC_XGB_MODEL_JSON: unknown = {json.dumps(uc_model_output)};\n",
    encoding="utf-8",
)
print(f"[OK] ucXgbWeights.ts --> {ts_model_path}")

# lib/ucCalibration.ts
ts_calib_path = pathlib.Path(__file__).parent.parent / "lib" / "ucCalibration.ts"
ts_calib_path.write_text(
    "// AUTO-GENERATED by scripts/train_uc_xgb.py -- do not edit manually.\n"
    f"// Generated: {today}, n_train={len(X_train)}, Brier={brier:.4f}, AUC={calib_auc:.4f}\n"
    "// Platt sigmoid: blended ucScore (0-100) -> P(hit_uc_proxy)%\n"
    "\n"
    f"export const UC_PLATT_COEF      = {platt_coef:.6f};\n"
    f"export const UC_PLATT_INTERCEPT = {platt_intercept:.6f};\n"
    "export const UC_CALIBRATION_META = {\n"
    f"  coef:       {platt_coef:.6f},\n"
    f"  intercept:  {platt_intercept:.6f},\n"
    "  label:      'hit_uc_proxy (hit_t1 AND outcome_pct_20d > 12)',\n"
    f"  generated:  '{today}',\n"
    f"  n_train:    {int(len(X_train))},\n"
    f"  val_brier:  {round(brier, 4)} as number | null,\n"
    "};\n"
    "\n"
    "/**\n"
    " * Convert raw blended ucScore (0-100) to calibrated probability %.\n"
    " * Output: 0-100 integer = P(hit_uc_proxy) in percent.\n"
    " */\n"
    "export function calibrateUCScore(rawScore: number): number {\n"
    "  const logit = UC_PLATT_COEF * rawScore + UC_PLATT_INTERCEPT;\n"
    "  return Math.round(100 / (1 + Math.exp(-logit)));\n"
    "}\n",
    encoding="utf-8",
)
print(f"[OK] ucCalibration.ts --> {ts_calib_path}")

# Feature importance report
fi      = booster.get_score(importance_type="gain")
fi_sort = sorted(fi.items(), key=lambda x: x[1], reverse=True)

report = [
    f"UC-XGBoost -- {today}",
    f"Label: hit_uc_proxy = hit_t1 AND outcome_pct_20d > 12",
    f"n_train={len(X_train)}, n_test={len(X_test)}, pos_rate={pos_rate:.1%}",
    f"Test AUC={auc:.4f}  Calibrated AUC={calib_auc:.4f}  Brier={brier:.4f}",
    f"Platt: coef={platt_coef:.4f}  intercept={platt_intercept:.4f}",
    "",
    "Feature importances (gain):",
    *[f"  {feat:30s}  {imp:.1f}" for feat, imp in fi_sort],
]
report_path = out_dir / "uc_xgb_report.txt"
report_path.write_text("\n".join(report), encoding="utf-8")
print(f"[OK] Report --> {report_path}")
print("\n" + "\n".join(report))
print("\n[NEXT] Commit lib/ucXgbWeights.ts + lib/ucCalibration.ts and deploy to Vercel.")
