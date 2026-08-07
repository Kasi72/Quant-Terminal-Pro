"""
XGBoost Phase-2 score trainer.
Pulls labeled pbfb_uc_events from Supabase, trains on entry features → hit_t1,
exports a simplified JSON tree model that lib/xgbInfer.ts can walk without any
runtime dependencies.

Usage:
    pip install xgboost pandas python-dotenv supabase-py
    python scripts/train_xgb_score.py

Output:
    scripts/results/xgb_model.json        — simplified tree for TypeScript
    scripts/results/xgb_report.txt        — feature importances + test AUC
"""

import json, os, pathlib, sys
from datetime import datetime

import pandas as pd
import numpy as np
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Load env
# ---------------------------------------------------------------------------
load_dotenv(pathlib.Path(__file__).parent.parent / ".env.local")
SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# ---------------------------------------------------------------------------
# Fetch data
# ---------------------------------------------------------------------------
try:
    from supabase import create_client
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    resp = (
        sb.table("pbfb_uc_events")
        .select(
            "hit_t1,stopped_out,vol_ratio_20,close_loc,body_pct,rsi2,"
            "range_atr,zone_len,zone_tightness,vol_accel,rsi2_velocity,"
            "cl_trend,near_breakout_tier,archetype_type,move_pct"
        )
        .eq("n_before", 1)
        .not_.is_("hit_t1", "null")
        .limit(10000)
        .execute()
    )
    rows = resp.data
except Exception as e:
    print(f"[ERROR] Supabase fetch failed: {e}")
    sys.exit(1)

df = pd.DataFrame(rows)
print(f"[INFO] Fetched {len(df)} labeled rows")

if len(df) < 50:
    print("[WARN] Fewer than 50 labeled rows — cannot train reliably. Run after more labeling.")
    sys.exit(0)

# ---------------------------------------------------------------------------
# Feature engineering
# ---------------------------------------------------------------------------
TIER_MAP = {"A+": 2, "A": 1, "B": 0, None: -1}

df["near_breakout_tier_enc"] = df["near_breakout_tier"].map(TIER_MAP).fillna(-1).astype(int)
df["archetype_enc"] = df["archetype_type"].astype("category").cat.codes

FEATURES = [
    "vol_ratio_20", "close_loc", "body_pct", "rsi2", "range_atr",
    "zone_len", "zone_tightness", "vol_accel", "rsi2_velocity", "cl_trend",
    "near_breakout_tier_enc", "archetype_enc",
]

df_clean = df.dropna(subset=["hit_t1"] + [f for f in FEATURES if f in df.columns])
df_clean = df_clean.copy()

X = df_clean[[f for f in FEATURES if f in df_clean.columns]].astype(float)
y = df_clean["hit_t1"].astype(int)

print(f"[INFO] Training on {len(X)} rows, {X.shape[1]} features, WR={y.mean():.1%}")

# ---------------------------------------------------------------------------
# Train / eval split
# ---------------------------------------------------------------------------
from sklearn.model_selection import train_test_split  # type: ignore
from sklearn.metrics import roc_auc_score  # type: ignore

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

try:
    import xgboost as xgb  # type: ignore
except ImportError:
    print("[ERROR] xgboost not installed. Run: pip install xgboost scikit-learn")
    sys.exit(1)

pos_weight = (y_train == 0).sum() / max((y_train == 1).sum(), 1)

model = xgb.XGBClassifier(
    n_estimators=200,
    max_depth=4,
    learning_rate=0.05,
    subsample=0.8,
    colsample_bytree=0.8,
    scale_pos_weight=pos_weight,
    eval_metric="auc",
    early_stopping_rounds=20,
    random_state=42,
    verbosity=0,
)
model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

y_prob = model.predict_proba(X_test)[:, 1]
auc = roc_auc_score(y_test, y_prob)
print(f"[INFO] Test AUC = {auc:.4f}")

# ---------------------------------------------------------------------------
# Export simplified tree JSON for TypeScript walker
# ---------------------------------------------------------------------------
booster = model.get_booster()
raw_dump = booster.get_dump(dump_format="json")

def parse_xgb_node(node: dict) -> dict:
    """Recursively flatten an XGBoost JSON node to a serialisable structure."""
    if "leaf" in node:
        return {"leaf": float(node["leaf"])}
    return {
        "split": node["split"],
        "split_condition": float(node["split_condition"]),
        "yes": parse_xgb_node(node["children"][0]),
        "no":  parse_xgb_node(node["children"][1]),
        "missing": parse_xgb_node(node["children"][0]),  # follow yes on missing
    }

trees = []
for raw in raw_dump:
    tree_obj = json.loads(raw)
    trees.append(parse_xgb_node(tree_obj))

feature_names = list(X.columns)
base_score = float(booster.attr("base_score") or 0.5)

output = {
    "generated":    datetime.utcnow().strftime("%Y-%m-%d"),
    "n_train":      int(len(X_train)),
    "test_auc":     round(auc, 4),
    "base_score":   base_score,
    "feature_names": feature_names,
    "trees":        trees,
}

out_dir = pathlib.Path(__file__).parent / "results"
out_dir.mkdir(exist_ok=True)

model_path = out_dir / "xgb_model.json"
model_path.write_text(json.dumps(output, indent=2))
print(f"[OK] Model written → {model_path}")

# Also write TypeScript weights file for zero-runtime-dep client-side inference
ts_weights_path = pathlib.Path(__file__).parent.parent / "lib" / "xgbModelWeights.ts"
ts_weights_path.write_text(
    "// AUTO-GENERATED by scripts/train_xgb_score.py — do not edit manually.\n"
    f"// Generated: {datetime.utcnow().strftime('%Y-%m-%d')}, n_train={len(X_train)}, AUC={auc:.4f}\n"
    f"export const XGB_MODEL_JSON: unknown = {json.dumps(output)};\n"
)
print(f"[OK] TypeScript weights → {ts_weights_path}")

# Feature importances report
fi = booster.get_score(importance_type="gain")
fi_sorted = sorted(fi.items(), key=lambda x: x[1], reverse=True)

report_lines = [
    f"XGBoost Phase-2 Score — {datetime.utcnow().strftime('%Y-%m-%d')}",
    f"n_train={len(X_train)}, n_test={len(X_test)}, test_AUC={auc:.4f}",
    "",
    "Feature importances (gain):",
]
for feat, imp in fi_sorted:
    report_lines.append(f"  {feat:30s}  {imp:.1f}")

report_path = out_dir / "xgb_report.txt"
report_path.write_text("\n".join(report_lines))
print(f"[OK] Report written → {report_path}")
print("\n".join(report_lines))
