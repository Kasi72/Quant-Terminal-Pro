/**
 * UC Logger XGBoost inference — pure TypeScript, zero runtime deps.
 * Trained on pbfb_uc_logger: label = next_day_chg_pct >= 5.
 * Run scripts/train_uc_xgb_js.js to (re)generate the weights.
 * Returns null when model not yet trained.
 */

import { UC_LOGGER_XGB_MODEL_JSON } from './ucLoggerXgbWeights';

interface XgbNode {
  leaf?: number;
  split?: string;
  split_condition?: number;
  yes?: XgbNode;
  no?: XgbNode;
  missing?: XgbNode;
}

interface UcLoggerXgbModel {
  generated: string;
  n_train: number;
  test_auc: number;
  base_score: number;
  feature_names: string[];
  trees: XgbNode[];
}

let _model: UcLoggerXgbModel | null = null;
try {
  if (UC_LOGGER_XGB_MODEL_JSON) _model = UC_LOGGER_XGB_MODEL_JSON as unknown as UcLoggerXgbModel;
} catch { /* weights not yet generated */ }

function walkTree(node: XgbNode, features: Record<string, number>): number {
  if (node.leaf !== undefined) return node.leaf;
  const val = features[node.split!];
  const child = (val === undefined || val === null || !isFinite(val))
    ? node.missing!
    : val < node.split_condition!
      ? node.yes!
      : node.no!;
  return walkTree(child, features);
}

function sigmoid(rawSum: number, baseScore: number): number {
  const bl = Math.log(Math.max(0.001, Math.min(0.999, baseScore)) / (1 - Math.max(0.001, Math.min(0.999, baseScore))));
  return 1 / (1 + Math.exp(-(bl + rawSum)));
}

export interface UCLoggerXgbFeatures {
  // Raw features from pbfb_uc_logger
  vol_pre5?: number;
  cl_trend?: number;
  inflection_score?: number;
  upper_wick_pct?: number;
  uc_score?: number;
  body_pct?: number;
  close_loc?: number;
  rsi2?: number;
  range_atr?: number;
  momentum_score?: number;
}

/**
 * Predict probability that a stock gains >= 5% next day.
 * Returns null if model not yet trained (run train_uc_xgb_js.js first).
 * Returns 0–1 probability; multiply by 100 for xgbScore display.
 */
export function inferUCLoggerXgb(input: UCLoggerXgbFeatures): number | null {
  if (!_model) return null;

  const vp  = input.vol_pre5        ?? 0;
  const bp  = input.body_pct        ?? 0;
  const uwp = input.upper_wick_pct  ?? 0;
  const cl  = input.close_loc       ?? 0;
  const rsi = input.rsi2            ?? 0;
  const uc  = input.uc_score        ?? 0;

  const features: Record<string, number> = {
    vol_pre5:         vp,
    cl_trend:         input.cl_trend        ?? 0,
    inflection_score: input.inflection_score ?? 0,
    upper_wick_pct:   uwp,
    uc_score:         uc,
    body_pct:         bp,
    close_loc:        cl,
    rsi2:             rsi,
    range_atr:        input.range_atr       ?? 0,
    momentum_score:   input.momentum_score  ?? 0,
    // Interaction features (must match training)
    vol_quality:      vp * bp / 100,
    clean_close:      (100 - uwp) * cl / 100,
    oversold_surge:   vp / Math.max(rsi, 1),
    uc_vol_gate:      uc * vp / 100,
  };

  let rawSum = 0;
  for (const tree of _model.trees) rawSum += walkTree(tree, features);
  return sigmoid(rawSum, _model.base_score);
}

export function getUCLoggerXgbMeta() {
  if (!_model) return null;
  return { generated: _model.generated, testAuc: _model.test_auc, nTrain: _model.n_train };
}
