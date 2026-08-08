/**
 * UC-specific XGBoost inference.
 * Trained on hit_uc_proxy = hit_t1 AND outcome_pct_20d > 12 (strong, fast move = UC-type event).
 * Falls back to null when model not yet trained -- run scripts/train_uc_xgb.py first.
 * Zero runtime dependencies -- pure TypeScript, runs client-side.
 */

import { UC_XGB_MODEL_JSON } from './ucXgbWeights';

interface XgbNode {
  leaf?: number;
  split?: string;
  split_condition?: number;
  yes?: XgbNode;
  no?: XgbNode;
  missing?: XgbNode;
}

interface UcXgbModel {
  generated: string;
  n_train: number;
  test_auc: number;
  base_score: number;
  feature_names: string[];
  trees: XgbNode[];
}

let _model: UcXgbModel | null = null;

if (UC_XGB_MODEL_JSON) {
  _model = UC_XGB_MODEL_JSON as UcXgbModel;
}

function walkTree(node: XgbNode, features: Record<string, number>): number {
  if (node.leaf !== undefined) return node.leaf;
  const val = features[node.split!];
  const child = (val === undefined || val === null)
    ? node.missing!
    : val < node.split_condition!
      ? node.yes!
      : node.no!;
  return walkTree(child, features);
}

function sigmoid(rawSum: number, baseScore: number): number {
  const baseLogit = Math.log(baseScore / (1 - Math.max(0.001, Math.min(0.999, baseScore))));
  return 1 / (1 + Math.exp(-(baseLogit + rawSum)));
}

export interface UCXgbFeatures {
  vol_ratio_20?: number;
  close_loc?: number;
  body_pct?: number;
  rsi2?: number;
  range_atr?: number;
  zone_len?: number;
  zone_tightness?: number;
  vol_accel?: number;
  rsi2_velocity?: number;
  cl_trend?: number;
  near_breakout_tier_enc?: number;
  archetype_enc?: number;
  nifty_5d_ret?: number;
}

/**
 * Infer P(hit_uc_proxy) -- 0 to 1.
 * Returns null when model not yet trained (run scripts/train_uc_xgb.py).
 */
export function inferUCXgb(features: UCXgbFeatures): number | null {
  if (!_model || !_model.trees || _model.trees.length === 0) return null;
  const featureMap = features as Record<string, number>;
  let rawSum = 0;
  for (const tree of _model.trees) {
    rawSum += walkTree(tree, featureMap);
  }
  return sigmoid(rawSum, _model.base_score);
}

export function getUCXgbMeta(): { generated: string; n_train: number; auc: number } | null {
  if (!_model) return null;
  return { generated: _model.generated, n_train: _model.n_train, auc: _model.test_auc };
}
