// ═══════════════════════════════════════════════════════════════════════════
// ADAPTIVE BRAIN v3 — 5-Engine Intelligence System
// Engine 1: Bayesian Feature Learning (existing)
// Engine 2: Thompson Sampling (signal prioritization)
// Engine 3: Anomaly Detection (outlier warning)
// Engine 4: Performance EMA (your current form)
// Engine 5: Multi-Armed Bandit (param set optimization)
// ═══════════════════════════════════════════════════════════════════════════

export function computeBrainInsights(trades) {
  const closed = trades.filter(t => t.status !== 'open');
  const wins = closed.filter(t => t.status === 'hit_t1' || t.status === 'hit_t2' || t.status === 'hit_t3');
  const losses = closed.filter(t => t.status === 'stopped');
  const expired = closed.filter(t => t.status === 'expired');
  const totalDecided = wins.length + losses.length;
  const baseWR = totalDecided > 0 ? wins.length / totalDecided : 0.5;
  const confidence = closed.length < 10 ? 'LOW' : closed.length < 30 ? 'DEVELOPING' : closed.length < 50 ? 'MODERATE' : closed.length < 100 ? 'GOOD' : closed.length < 200 ? 'HIGH' : 'EXPERT';

  // ══════════════════════════════════════════════════════════════════
  // ENGINE 1: BAYESIAN FEATURE LEARNING
  // ══════════════════════════════════════════════════════════════════

  function bayesianWR(featureFn) {
    const withFeature = closed.filter(featureFn);
    const winsWithFeature = withFeature.filter(t => t.status === 'hit_t1' || t.status === 'hit_t2' || t.status === 'hit_t3');
    if (withFeature.length < 2) return { wr: baseWR, count: 0, significant: false };
    return { wr: winsWithFeature.length / withFeature.length, count: withFeature.length, significant: withFeature.length >= 3 };
  }

  function recencyWeightedWR(featureFn) {
    const withFeature = closed.filter(featureFn);
    if (withFeature.length < 2) return { wr: baseWR, count: 0 };
    let weightedWins = 0, totalWeight = 0;
    const now = Date.now();
    for (const t of withFeature) {
      const age = (now - new Date(t.closedDate || t.entryDate || '2024-01-01').getTime()) / (86400000 * 30);
      const weight = age < 1 ? 3 : age < 3 ? 2 : age < 6 ? 1.5 : 1;
      if (t.status === 'hit_t1' || t.status === 'hit_t2' || t.status === 'hit_t3') weightedWins += weight;
      totalWeight += weight;
    }
    return { wr: totalWeight > 0 ? weightedWins / totalWeight : baseWR, count: withFeature.length };
  }

  const winConvAvg = wins.length > 0 ? wins.reduce((s, t) => s + (t.conviction || 0), 0) / wins.length : 50;
  const lossConvAvg = losses.length > 0 ? losses.reduce((s, t) => s + (t.conviction || 0), 0) / losses.length : 50;
  const optimalConviction = Math.round((winConvAvg + lossConvAvg) / 2 + 5);

  // Sector performance
  const sectorStats = {};
  for (const t of closed) {
    const sec = t.sector || 'Unknown';
    if (!sectorStats[sec]) sectorStats[sec] = { wins: 0, losses: 0, total: 0 };
    sectorStats[sec].total++;
    if (t.status?.includes('hit')) sectorStats[sec].wins++;
    else if (t.status === 'stopped') sectorStats[sec].losses++;
  }
  const sectorScorecard = Object.entries(sectorStats).map(([sector, s]) => ({
    sector, ...s, wr: s.total > 0 ? Math.round(s.wins / s.total * 100) : 0,
    status: s.total >= 2 ? (s.wins / s.total >= 0.7 ? 'HOT' : s.wins / s.total >= 0.4 ? 'NEUTRAL' : 'COLD') : 'INSUFFICIENT'
  })).sort((a, b) => b.wr - a.wr);

  // Stock memory
  const stockMemory = {};
  for (const t of closed) {
    const sym = t.symbol;
    if (!stockMemory[sym]) stockMemory[sym] = { wins: 0, stops: 0, expired: 0, consecutiveStops: 0, lastOutcome: '' };
    const m = stockMemory[sym];
    if (t.status?.includes('hit')) { m.wins++; m.consecutiveStops = 0; m.lastOutcome = 'win'; }
    else if (t.status === 'stopped') { m.stops++; m.consecutiveStops++; m.lastOutcome = 'stop'; }
    else { m.expired++; m.lastOutcome = 'expired'; }
  }
  const stockWarnings = Object.entries(stockMemory)
    .filter(([, m]) => m.consecutiveStops >= 2 || (m.stops >= 2 && m.wins === 0))
    .map(([sym, m]) => ({ symbol: sym, stops: m.stops, consecutiveStops: m.consecutiveStops, badge: m.consecutiveStops >= 3 ? 'AVOID' : 'CAUTION' }));
  const stockStars = Object.entries(stockMemory)
    .filter(([, m]) => m.wins >= 2 && m.stops === 0)
    .map(([sym, m]) => ({ symbol: sym, wins: m.wins, badge: 'RELIABLE' }));

  // Pattern scorecard
  const patternStats = {};
  for (const t of closed) {
    const pat = t.candlePattern || 'Unknown';
    if (!patternStats[pat]) patternStats[pat] = { wins: 0, total: 0 };
    patternStats[pat].total++;
    if (t.status?.includes('hit')) patternStats[pat].wins++;
  }
  const patternScorecard = Object.entries(patternStats)
    .filter(([, s]) => s.total >= 2)
    .map(([pattern, s]) => ({ pattern, ...s, wr: Math.round(s.wins / s.total * 100) }))
    .sort((a, b) => b.wr - a.wr);
  const bestPattern = patternScorecard[0] || null;
  const worstPattern = patternScorecard[patternScorecard.length - 1] || null;

  // Streak detection
  const recentOutcomes = closed.slice(-10).map(t => t.status?.includes('hit') ? 'W' : t.status === 'stopped' ? 'L' : 'E');
  let currentStreak = 0, streakType = '';
  for (let i = recentOutcomes.length - 1; i >= 0; i--) {
    if (i === recentOutcomes.length - 1) { streakType = recentOutcomes[i]; currentStreak = 1; }
    else if (recentOutcomes[i] === streakType) currentStreak++;
    else break;
  }
  const streakAdvice = streakType === 'W' && currentStreak >= 3 ? 'HOT streak — maintain discipline, don\'t oversize'
    : streakType === 'L' && currentStreak >= 3 ? 'COLD streak — consider pausing for 1-2 signals'
    : streakType === 'L' && currentStreak >= 2 ? 'COLD streak — reduce size to 50% until next win'
    : 'Normal — trade as planned';

  // Regime performance
  const regimeStats = {};
  for (const t of closed) {
    const reg = t.regimeAtEntry || 'unknown';
    if (!regimeStats[reg]) regimeStats[reg] = { wins: 0, total: 0 };
    regimeStats[reg].total++;
    if (t.status?.includes('hit')) regimeStats[reg].wins++;
  }
  const regimeScorecard = Object.entries(regimeStats)
    .filter(([, s]) => s.total >= 2)
    .map(([regime, s]) => ({ regime, ...s, wr: Math.round(s.wins / s.total * 100) }))
    .sort((a, b) => b.wr - a.wr);

  // Time-to-T1 analysis
  const t1Times = wins.filter(t => t.daysHeld > 0).map(t => t.daysHeld);
  const avgDaysToWin = t1Times.length > 0 ? t1Times.reduce((s, v) => s + v, 0) / t1Times.length : 0;
  const fastWins = t1Times.filter(d => d <= 3).length;
  const slowWins = t1Times.filter(d => d > 7).length;
  const avgMFE = wins.length > 0 ? wins.reduce((s, t) => s + (t.mfe || 0), 0) / wins.length : 0;
  const avgMAE = closed.length > 0 ? closed.reduce((s, t) => s + (t.mae || 0), 0) / closed.length : 0;
  const mfeCapture = avgMFE > 0 && wins.length > 0 ? wins.reduce((s, t) => s + (t.pnlPct || 0), 0) / wins.length / avgMFE * 100 : 0;

  // Feature interaction discovery
  const interactions = [];
  if (closed.length >= 10) {
    const features = [
      { name: 'Conv≥70', fn: t => (t.conviction || 0) >= 70 },
      { name: 'VolThrust', fn: t => t.volumeBadge === 'HIGH_CONVICTION' || t.volumeBadge === 'THRUST' },
      { name: 'INFLECT', fn: t => t.atrState === 'INFLECT' || t.atrState === 'SWEET_SPOT' },
      { name: 'DW align', fn: t => t.tfAlignment === 'DW' },
      { name: 'RS≥60', fn: t => (t.rsRank || 0) >= 60 },
    ];
    for (let a = 0; a < features.length; a++) {
      for (let b = a + 1; b < features.length; b++) {
        const combo = closed.filter(t => features[a].fn(t) && features[b].fn(t));
        if (combo.length < 3) continue;
        const comboWins = combo.filter(t => t.status?.includes('hit')).length;
        const comboWR = comboWins / combo.length;
        if (Math.abs(comboWR - baseWR) > 0.15) {
          interactions.push({ name: `${features[a].name} + ${features[b].name}`, trades: combo.length, wins: comboWins, wr: Math.round(comboWR * 100), type: comboWR > baseWR ? 'GOLDEN' : 'WEAK' });
        }
      }
    }
    interactions.sort((a, b) => b.wr - a.wr);
  }

  // Decay detection
  const decayAlerts = [];
  if (closed.length >= 10) {
    const recentHalf = closed.slice(-Math.floor(closed.length / 2));
    const olderHalf = closed.slice(0, Math.floor(closed.length / 2));
    for (const [sec, stats] of Object.entries(sectorStats)) {
      if (stats.total < 3) continue;
      const recentSec = recentHalf.filter(t => (t.sector || 'Unknown') === sec);
      const olderSec = olderHalf.filter(t => (t.sector || 'Unknown') === sec);
      if (recentSec.length < 2 || olderSec.length < 2) continue;
      const recentWR = recentSec.filter(t => t.status?.includes('hit')).length / recentSec.length;
      const olderWR = olderSec.filter(t => t.status?.includes('hit')).length / olderSec.length;
      if (olderWR - recentWR > 0.3) {
        decayAlerts.push({ type: 'sector', name: sec, oldWR: Math.round(olderWR * 100), newWR: Math.round(recentWR * 100), drop: Math.round((olderWR - recentWR) * 100) });
      }
    }
  }

  // Emotional pattern detection
  let emotionalAlert = null;
  if (closed.length >= 6) {
    for (let i = 2; i < closed.length; i++) {
      const prev2 = [closed[i - 2], closed[i - 1]];
      if (prev2.every(t => t.status === 'stopped' || t.status === 'expired')) {
        const afterLossConv = closed[i].conviction || 0;
        if (afterLossConv < winConvAvg - 15 && !(closed[i].status?.includes('hit'))) {
          emotionalAlert = { pattern: 'revenge_trade', message: `After losses, you entered at conviction ${Math.round(afterLossConv)} (your avg winner: ${Math.round(winConvAvg)}). These entries tend to fail.`, advice: 'After 2 losses, wait for conviction ≥ ' + Math.round(winConvAvg) };
        }
      }
    }
  }

  // Optimal holding period
  const holdingInsight = { avgHold: 0, t2CaptureRate: 0, advice: '' };
  if (wins.length >= 3) {
    const holdDays = wins.map(t => t.daysHeld || 0).filter(d => d > 0);
    holdingInsight.avgHold = holdDays.length > 0 ? Math.round(holdDays.reduce((s, v) => s + v, 0) / holdDays.length * 10) / 10 : 0;
    const t2Hits = closed.filter(t => t.status === 'hit_t2' || t.status === 'hit_t3').length;
    holdingInsight.t2CaptureRate = wins.length > 0 ? Math.round(t2Hits / wins.length * 100) : 0;
    holdingInsight.advice = holdingInsight.t2CaptureRate < 40
      ? `Only ${holdingInsight.t2CaptureRate}% T1→T2. Hold 50% position 2 days longer.`
      : `${holdingInsight.t2CaptureRate}% T2 capture — partial exit working well.`;
  }

  // Day-of-week learning
  const dayOfWeekStats = {};
  for (const t of closed) {
    const d = new Date(t.entryDate || '2024-01-01');
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] || 'Unknown';
    if (!dayOfWeekStats[day]) dayOfWeekStats[day] = { wins: 0, total: 0 };
    dayOfWeekStats[day].total++;
    if (t.status?.includes('hit')) dayOfWeekStats[day].wins++;
  }
  const dayScorecard = Object.entries(dayOfWeekStats)
    .filter(([, s]) => s.total >= 2)
    .map(([day, s]) => ({ day, ...s, wr: Math.round(s.wins / s.total * 100) }))
    .sort((a, b) => b.wr - a.wr);
  const bestDay = dayScorecard[0] || null;
  const worstDay = dayScorecard[dayScorecard.length - 1] || null;

  // Confidence intervals
  function confidenceInterval(score, tradeCount) {
    const halfWidth = tradeCount < 5 ? 25 : tradeCount < 10 ? 20 : tradeCount < 20 ? 15 : tradeCount < 50 ? 12 : tradeCount < 100 ? 8 : 5;
    return { low: Math.max(0, score - halfWidth), high: Math.min(100, score + halfWidth), width: halfWidth * 2 };
  }

  // ══════════════════════════════════════════════════════════════════
  // ENGINE 2: THOMPSON SAMPLING — Signal Prioritization
  // Uses Beta distribution sampling to rank multiple signals
  // by probability of success. Naturally balances exploration
  // vs exploitation.
  // ══════════════════════════════════════════════════════════════════

  // Simple Beta distribution sampling using Box-Muller approximation
  function sampleBeta(alpha, beta) {
    // For small alpha/beta, use the mean + noise approach
    const mean = alpha / (alpha + beta);
    const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
    const stddev = Math.sqrt(variance);
    // Box-Muller transform for normal random
    const u1 = Math.random(), u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1 || 0.001)) * Math.cos(2 * Math.PI * u2);
    const sample = mean + z * stddev;
    return Math.max(0.01, Math.min(0.99, sample));
  }

  function thompsonRank(signals, extraDataMap) {
    if (signals.length === 0) return [];
    // For each signal, compute alpha (wins) and beta (losses) from similar past trades
    const ranked = signals.map(signal => {
      const extra = extraDataMap?.[signal.symbol] || {};
      const sec = signal.sector || extra.sector || 'Unknown';
      const secData = sectorStats[sec];
      // Prior: start with 1 win, 1 loss (uninformative prior)
      let alpha = 1, beta = 1;
      // Add sector data
      if (secData && secData.total >= 2) { alpha += secData.wins; beta += secData.total - secData.wins; }
      // Add stock-specific data
      const mem = stockMemory[signal.symbol];
      if (mem) { alpha += mem.wins; beta += mem.stops; }
      // Draw Thompson sample
      const samples = [];
      for (let i = 0; i < 100; i++) samples.push(sampleBeta(alpha, beta));
      const avgSample = samples.reduce((s, v) => s + v, 0) / samples.length;
      return { symbol: signal.symbol, thompsonScore: Math.round(avgSample * 100), alpha, beta, expectedWR: Math.round(alpha / (alpha + beta) * 100) };
    });
    ranked.sort((a, b) => b.thompsonScore - a.thompsonScore);
    return ranked.map((r, i) => ({ ...r, priority: i + 1, badge: i === 0 ? '#1 PRIORITY' : i === 1 ? '#2' : i === 2 ? '#3' : `#${i + 1}` }));
  }

  // ══════════════════════════════════════════════════════════════════
  // ENGINE 3: ANOMALY DETECTION — Outlier Warning
  // Checks if a signal's features are OUTSIDE the normal range
  // of your past winners. Warns about untested territory.
  // ══════════════════════════════════════════════════════════════════

  // Build winner profile from past trades
  const winnerProfile = { conviction: { min: 100, max: 0, mean: 0 }, count: 0 };
  const winnerSectors = new Set();
  const winnerAtrStates = new Set();
  const winnerPatterns = new Set();
  if (wins.length >= 3) {
    winnerProfile.count = wins.length;
    const convs = wins.map(t => t.conviction || 0).filter(c => c > 0);
    if (convs.length > 0) {
      winnerProfile.conviction.min = Math.min(...convs);
      winnerProfile.conviction.max = Math.max(...convs);
      winnerProfile.conviction.mean = Math.round(convs.reduce((s, v) => s + v, 0) / convs.length);
    }
    for (const t of wins) {
      if (t.sector) winnerSectors.add(t.sector);
      if (t.atrState) winnerAtrStates.add(t.atrState);
      if (t.candlePattern) winnerPatterns.add(t.candlePattern);
    }
  }

  function detectAnomalies(signal, extraData) {
    if (wins.length < 3) return { anomalyCount: 0, anomalies: [], verdict: 'INSUFFICIENT_DATA' };
    const anomalies = [];
    const conv = signal.conviction || 0;
    if (conv > 0 && (conv < winnerProfile.conviction.min - 10 || conv > winnerProfile.conviction.max + 10)) {
      anomalies.push({ feature: 'Conviction', value: conv, range: `${winnerProfile.conviction.min}-${winnerProfile.conviction.max}`, note: conv < winnerProfile.conviction.min ? 'Below your winner range' : 'Above (unusual but not bad)' });
    }
    const sec = signal.sector || extraData?.sector;
    if (sec && winnerSectors.size > 0 && !winnerSectors.has(sec)) {
      anomalies.push({ feature: 'Sector', value: sec, range: [...winnerSectors].join(', '), note: 'You\'ve never won in this sector' });
    }
    const atr = signal.atrState || extraData?.atrState;
    if (atr && winnerAtrStates.size > 0 && !winnerAtrStates.has(atr)) {
      anomalies.push({ feature: 'ATR State', value: atr, range: [...winnerAtrStates].join(', '), note: 'Untested ATR state for you' });
    }
    const pat = signal.candlePattern || extraData?.candlePattern;
    if (pat && winnerPatterns.size > 0 && !winnerPatterns.has(pat)) {
      anomalies.push({ feature: 'Candle pattern', value: pat, range: [...winnerPatterns].join(', '), note: 'You\'ve never won with this pattern' });
    }
    const verdict = anomalies.length === 0 ? 'NORMAL' : anomalies.length <= 1 ? 'MINOR' : anomalies.length <= 2 ? 'UNUSUAL' : 'OUTLIER';
    return { anomalyCount: anomalies.length, anomalies, verdict };
  }

  // ══════════════════════════════════════════════════════════════════
  // ENGINE 4: PERFORMANCE EMA — Your Current Form
  // Exponentially weighted moving average of recent outcomes.
  // Like a batsman's form — are you in rhythm or struggling?
  // ══════════════════════════════════════════════════════════════════

  let performanceEMA = 0.5; // default neutral
  let performanceTrend = 'NEUTRAL';
  if (closed.length >= 3) {
    const alpha = 0.2; // smoothing factor — higher = more reactive to recent
    let ema = 0.5; // start neutral
    for (const t of closed) {
      const outcome = t.status?.includes('hit') ? 1 : t.status === 'stopped' ? 0 : 0.3; // expired = slight negative
      ema = alpha * outcome + (1 - alpha) * ema;
    }
    performanceEMA = Math.round(ema * 100) / 100;
    // Trend: compare last 5 vs previous 5
    if (closed.length >= 6) {
      const recent5 = closed.slice(-5);
      const prev5 = closed.slice(-10, -5);
      const recentWR = recent5.filter(t => t.status?.includes('hit')).length / recent5.length;
      const prevWR = prev5.length > 0 ? prev5.filter(t => t.status?.includes('hit')).length / prev5.length : 0.5;
      performanceTrend = recentWR > prevWR + 0.1 ? 'RISING' : recentWR < prevWR - 0.1 ? 'FALLING' : 'STABLE';
    }
  }
  const formLabel = performanceEMA >= 0.75 ? 'ON FIRE' : performanceEMA >= 0.6 ? 'GOOD FORM' : performanceEMA >= 0.45 ? 'NEUTRAL' : performanceEMA >= 0.3 ? 'COLD' : 'ICE COLD';
  const formSizingAdj = performanceEMA >= 0.7 ? +5 : performanceEMA >= 0.55 ? +2 : performanceEMA <= 0.3 ? -10 : performanceEMA <= 0.4 ? -5 : 0;

  // ══════════════════════════════════════════════════════════════════
  // ENGINE 5: MULTI-ARMED BANDIT — Param Set Optimization
  // Uses Upper Confidence Bound (UCB1) to learn which of
  // your 4 param sets (D20+, HP15+, E10+, US8+) works best
  // for YOU personally. Auto-boosts signals from your best set.
  // ══════════════════════════════════════════════════════════════════

  const paramSetStats = {};
  for (const t of closed) {
    const ps = t.paramSet || t.passedSets || 'unknown';
    // A trade might pass multiple sets — track each
    const sets = Array.isArray(ps) ? ps : typeof ps === 'string' ? ps.split(',').map(s => s.trim()) : ['unknown'];
    for (const s of sets) {
      if (!paramSetStats[s]) paramSetStats[s] = { wins: 0, total: 0, totalReward: 0 };
      paramSetStats[s].total++;
      if (t.status?.includes('hit')) { paramSetStats[s].wins++; paramSetStats[s].totalReward += (t.pnlPct || 3); }
      else if (t.status === 'stopped') { paramSetStats[s].totalReward += (t.pnlPct || -2); }
    }
  }

  // UCB1 score for each param set
  const totalPlays = Object.values(paramSetStats).reduce((s, p) => s + p.total, 0) || 1;
  const paramSetScorecard = Object.entries(paramSetStats)
    .filter(([, s]) => s.total >= 2)
    .map(([name, s]) => {
      const avgReward = s.totalReward / s.total;
      const exploration = Math.sqrt(2 * Math.log(totalPlays) / s.total);
      const ucb = avgReward + exploration;
      const wr = Math.round(s.wins / s.total * 100);
      return { name, ...s, wr, avgReward: Math.round(avgReward * 10) / 10, ucb: Math.round(ucb * 10) / 10, rank: 0 };
    })
    .sort((a, b) => b.ucb - a.ucb);
  paramSetScorecard.forEach((p, i) => { p.rank = i + 1; });
  const bestParamSet = paramSetScorecard[0] || null;
  const worstParamSet = paramSetScorecard[paramSetScorecard.length - 1] || null;

  function getParamSetBoost(paramSets) {
    if (!bestParamSet || !paramSets) return { adj: 0, reason: '' };
    const sets = Array.isArray(paramSets) ? paramSets : typeof paramSets === 'string' ? paramSets.split(',').map(s => s.trim()) : [];
    if (sets.includes(bestParamSet.name) && bestParamSet.wr > baseWR * 100 + 10) {
      return { adj: +4, reason: `${bestParamSet.name} is your best set (${bestParamSet.wr}% WR, UCB ${bestParamSet.ucb})` };
    }
    if (worstParamSet && sets.length === 1 && sets[0] === worstParamSet.name && worstParamSet.wr < baseWR * 100 - 10) {
      return { adj: -4, reason: `${worstParamSet.name} is your weakest set (${worstParamSet.wr}% WR)` };
    }
    return { adj: 0, reason: '' };
  }

  // ══════════════════════════════════════════════════════════════════
  // DYNAMIC POSITION SIZING
  // ══════════════════════════════════════════════════════════════════

  function getRecommendedRisk(brainScore) {
    if (brainScore >= 90) return { risk: 1.5, label: 'A+ setup — max size' };
    if (brainScore >= 75) return { risk: 1.0, label: 'Good setup — normal size' };
    if (brainScore >= 60) return { risk: 0.75, label: 'Average — slight reduction' };
    if (brainScore >= 45) return { risk: 0.5, label: 'Below average — half size' };
    return { risk: 0.25, label: 'Weak — quarter size or skip' };
  }

  // ══════════════════════════════════════════════════════════════════
  // COMBINED SCORE — All 5 engines feed into final brain score
  // ══════════════════════════════════════════════════════════════════

  function adjustScore(signal, extraData) {
    let score = signal.conviction || 50;
    const adjustments = [];

    // ENGINE 1: Bayesian adjustments
    const sec = signal.sector || extraData?.sector || 'Unknown';
    const secData = sectorStats[sec];
    if (secData && secData.total >= 2) {
      const adj = Math.round((secData.wins / secData.total - baseWR) * 30);
      score += adj;
      if (Math.abs(adj) >= 3) adjustments.push({ factor: `Sector ${sec}`, adj, reason: `${Math.round(secData.wins / secData.total * 100)}% WR for you`, engine: 'Bayesian' });
    }
    const mem = stockMemory[signal.symbol];
    if (mem) {
      if (mem.consecutiveStops >= 2) { score -= 15; adjustments.push({ factor: 'Stock CAUTION', adj: -15, reason: `${mem.consecutiveStops} consecutive stops`, engine: 'Bayesian' }); }
      else if (mem.wins >= 2 && mem.stops === 0) { score += 8; adjustments.push({ factor: 'Stock RELIABLE', adj: +8, reason: `${mem.wins} wins, 0 stops`, engine: 'Bayesian' }); }
    }
    if (streakType === 'L' && currentStreak >= 2) { score -= 5; adjustments.push({ factor: 'Cold streak', adj: -5, reason: `${currentStreak} consecutive losses`, engine: 'Bayesian' }); }
    if (streakType === 'W' && currentStreak >= 3) { score += 3; adjustments.push({ factor: 'Hot streak', adj: +3, reason: `${currentStreak} consecutive wins`, engine: 'Bayesian' }); }
    if (closed.length >= 5 && signal.conviction < optimalConviction - 10) {
      const adj = -Math.round((optimalConviction - signal.conviction) * 0.3);
      score += adj;
      adjustments.push({ factor: 'Below threshold', adj, reason: `Winners avg ${Math.round(winConvAvg)} conviction`, engine: 'Bayesian' });
    }
    if (extraData?.clenowScore != null) {
      if (extraData.clenowScore >= 80) { score += 5; adjustments.push({ factor: 'Clenow strong', adj: +5, reason: `Score ${extraData.clenowScore.toFixed(0)}, smooth trend`, engine: 'Bayesian' }); }
      else if (extraData.clenowScore < 0) { score -= 5; adjustments.push({ factor: 'Clenow negative', adj: -5, reason: `Score ${extraData.clenowScore.toFixed(0)}, no trend`, engine: 'Bayesian' }); }
    }
    if (extraData?.hasFlag) { score += 5; adjustments.push({ factor: '🚩 Flag pattern', adj: +5, reason: 'Double conviction', engine: 'Bayesian' }); }
    if (extraData?.hasCoiled) { score += 5; adjustments.push({ factor: '💎 Guppy coiled', adj: +5, reason: 'Max stored energy', engine: 'Bayesian' }); }
    for (const da of decayAlerts) {
      if (da.type === 'sector' && (signal.sector || extraData?.sector) === da.name) {
        score -= 8; adjustments.push({ factor: `Decay: ${da.name}`, adj: -8, reason: `Was ${da.oldWR}% → now ${da.newWR}%`, engine: 'Bayesian' });
      }
    }
    if (emotionalAlert && streakType === 'L' && currentStreak >= 2 && (signal.conviction || 0) < winConvAvg - 10) {
      score -= 10; adjustments.push({ factor: 'Revenge trade risk', adj: -10, reason: emotionalAlert.advice, engine: 'Bayesian' });
    }
    if (worstDay && worstDay.wr < baseWR * 100 - 20) {
      const today = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];
      if (today === worstDay.day) { score -= 5; adjustments.push({ factor: `${today} worst day`, adj: -5, reason: `${worstDay.wr}% WR`, engine: 'Bayesian' }); }
    }
    if (bestDay && bestDay.wr > baseWR * 100 + 15) {
      const today = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];
      if (today === bestDay.day) { score += 3; adjustments.push({ factor: `${today} best day`, adj: +3, reason: `${bestDay.wr}% WR`, engine: 'Bayesian' }); }
    }

    // ENGINE 3: Anomaly detection adjustment
    const anomalyResult = detectAnomalies(signal, extraData);
    if (anomalyResult.anomalyCount >= 2) {
      const adj = -Math.min(10, anomalyResult.anomalyCount * 4);
      score += adj;
      adjustments.push({ factor: `⚠ ${anomalyResult.anomalyCount} anomalies`, adj, reason: anomalyResult.anomalies.map(a => a.feature).join(', ') + ' outside your winner range', engine: 'Anomaly' });
    }

    // ENGINE 4: Performance EMA adjustment
    if (formSizingAdj !== 0) {
      score += formSizingAdj;
      adjustments.push({ factor: `Form: ${formLabel}`, adj: formSizingAdj, reason: `EMA ${performanceEMA.toFixed(2)}, trend ${performanceTrend}`, engine: 'Form' });
    }

    // ENGINE 5: Param set bandit adjustment
    const psBoost = getParamSetBoost(extraData?.paramSets);
    if (psBoost.adj !== 0) {
      score += psBoost.adj;
      adjustments.push({ factor: 'Param set', adj: psBoost.adj, reason: psBoost.reason, engine: 'Bandit' });
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const sizing = getRecommendedRisk(score);
    const ci = confidenceInterval(score, closed.length);

    return { originalScore: signal.conviction || 50, brainScore: score, adjustments, sizing, confidence, confidenceInterval: ci, anomalies: anomalyResult, form: { ema: performanceEMA, label: formLabel, trend: performanceTrend } };
  }

  // Pre-mortem analysis
  function premortem(signal, extraData) {
    if (closed.length < 3) return null;
    const similar = closed.map(t => {
      let similarity = 0;
      if (t.sector === (signal.sector || extraData?.sector)) similarity += 2;
      if (Math.abs((t.conviction || 0) - (signal.conviction || 0)) < 15) similarity += 2;
      if (t.stage === signal.stage) similarity += 1;
      return { ...t, similarity };
    }).filter(t => t.similarity >= 3).sort((a, b) => b.similarity - a.similarity).slice(0, 5);
    if (similar.length === 0) return null;
    const simWins = similar.filter(t => t.status?.includes('hit')).length;
    return {
      matches: similar.map(t => ({ symbol: t.symbol, conviction: t.conviction, status: t.status, pnlPct: t.pnlPct, similarity: t.similarity })),
      winRate: Math.round(simWins / similar.length * 100),
      verdict: simWins / similar.length >= 0.6 ? 'FAVORABLE' : simWins / similar.length >= 0.4 ? 'MIXED' : 'UNFAVORABLE'
    };
  }

  return {
    // Meta
    totalTrades: closed.length, wins: wins.length, losses: losses.length, expired: expired.length,
    baseWinRate: Math.round(baseWR * 100), confidence,
    // Engine 1: Bayesian
    optimalConviction, winConvAvg: Math.round(winConvAvg), lossConvAvg: Math.round(lossConvAvg),
    sectorScorecard, patternScorecard, bestPattern, worstPattern, regimeScorecard,
    goldenSetups: interactions.filter(i => i.type === 'GOLDEN'),
    weakSetups: interactions.filter(i => i.type === 'WEAK'),
    stockWarnings, stockStars, stockMemory,
    currentStreak, streakType, streakAdvice, recentOutcomes,
    avgDaysToWin: Math.round(avgDaysToWin * 10) / 10, fastWins, slowWins,
    avgMFE: Math.round(avgMFE * 10) / 10, avgMAE: Math.round(avgMAE * 10) / 10, mfeCapture: Math.round(mfeCapture),
    decayAlerts, emotionalAlert, holdingInsight,
    dayScorecard, bestDay, worstDay, confidenceInterval,
    // Engine 2: Thompson Sampling
    thompsonRank,
    // Engine 3: Anomaly Detection
    winnerProfile, winnerSectors: [...winnerSectors], winnerAtrStates: [...winnerAtrStates], winnerPatterns: [...winnerPatterns],
    detectAnomalies,
    // Engine 4: Performance EMA
    performanceEMA, performanceTrend, formLabel, formSizingAdj,
    // Engine 5: Param Set Bandit
    paramSetScorecard, bestParamSet, worstParamSet, getParamSetBoost,
    // Combined functions
    adjustScore, premortem, getRecommendedRisk,
  };
}
