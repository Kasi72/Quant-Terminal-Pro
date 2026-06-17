export interface ScreeningSession {
  id: string;
  created_at: string;
  symbol_count: number;
  processed: number;
  status: 'pending' | 'running' | 'done' | 'error';
  error_msg?: string;
}

export interface ScreeningResult {
  id: string;
  session_id: string;
  symbol: string;
  last_close: number;
  last_date: string;
  avg_turnover_20: number;
  atr_pct14_pctl120: number;
  pre10_avg_range_atr: number;
  pre10_expansion_count: number;
  compression_zone_len: number;
  zone_tightness_pct: number;
  pre10_avg_vol_ratio: number;
  pre5_avg_vol_ratio: number;
  pre10_high_vol_count: number;
  pre10_red_vol_bias: number;
  exact_range_atr: number;
  exact_vol_ratio20: number;
  exact_vol_vs_pre5: number;
  close_loc: number;
  upper_wick_pct: number;
  body_pct: number;
  signal_range_pct: number;
  ultra_precision_score: number;
  rsi2: number;
  volatility_expansion_ratio: number;
  candle_quality_score: number;
  passed_deployable: boolean;
  passed_high_precision: boolean;
  passed_elite: boolean;
  passed_ultra_selective: boolean;
  clusters_passed: number;
  error?: string;
}
