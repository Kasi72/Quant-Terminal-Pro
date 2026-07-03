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
  const avgWinPnl = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnlPct || 0), 0) / wins.length : 0;
  const mfeCapture = avgMFE > 0 && wins.length > 0 ? avgWinPnl / avgMFE * 100 : 0;

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

  // Decay detection — P3: generalized so sector, pattern, AND param-set
  // decay all surface, not just sector. A once-good setup can degrade
  // without ever clustering by sector, and that decay was previously
  // invisible.
  const decayAlerts = [];
  const recentHalf = closed.length >= 10 ? closed.slice(-Math.floor(closed.length / 2)) : [];
  const olderHalf = closed.length >= 10 ? closed.slice(0, Math.floor(closed.length / 2)) : [];
  function detectDecay(type, groupKeyFn, statsObj, minTotal) {
    if (closed.length < 10) return;
    for (const [key, stats] of Object.entries(statsObj)) {
      if (stats.total < minTotal) continue;
      const recentG = recentHalf.filter(t => groupKeyFn(t) === key);
      const olderG = olderHalf.filter(t => groupKeyFn(t) === key);
      if (recentG.length < 2 || olderG.length < 2) continue;
      const recentWR = recentG.filter(t => t.status?.includes('hit')).length / recentG.length;
      const olderWR = olderG.filter(t => t.status?.includes('hit')).length / olderG.length;
      if (olderWR - recentWR > 0.3) {
        decayAlerts.push({ type, name: key, oldWR: Math.round(olderWR * 100), newWR: Math.round(recentWR * 100), drop: Math.round((olderWR - recentWR) * 100) });
      }
    }
  }
  detectDecay('sector', t => t.sector || 'Unknown', sectorStats, 3);
  detectDecay('pattern', t => t.candlePattern || 'Unknown', patternStats, 3);

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

  // P1: Wilson score interval (not a hand-picked heuristic half-width).
  // tradeCount here is the count backing this specific score (sector/stock
  // sample size where available), falling back to total closed trades.
  // z=1.96 for 95% confidence, matches the Wilson-LB convention used
  // throughout this codebase's other backtests this session.
  function wilsonInterval(wr, n, z = 1.96) {
    if (n <= 0) return { low: 0, high: 100 };
    const p = Math.max(0, Math.min(1, wr));
    const denom = 1 + z * z / n;
    const center = (p + z * z / (2 * n)) / denom;
    const halfWidth = (z * Math.sqrt((p * (1 - p) / n) + (z * z / (4 * n * n)))) / denom;
    return { low: Math.max(0, (center - halfWidth) * 100), high: Math.min(100, (center + halfWidth) * 100) };
  }

  function confidenceInterval(score, tradeCount) {
    const n = Math.max(1, tradeCount);
    const { low, high } = wilsonInterval(score / 100, n);
    return { low: Math.round(low), high: Math.round(high), width: Math.round(high - low) };
  }

  // ══════════════════════════════════════════════════════════════════
  // ENGINE 2: THOMPSON SAMPLING — Signal Prioritization
  // Uses Beta distribution sampling to rank multiple signals
  // by probability of success. Naturally balances exploration
  // vs exploitation.
  // ══════════════════════════════════════════════════════════════════

  // P1: real Gamma(shape,1) sampler via Marsaglia-Tsang (shape>=1), with the
  // standard boosting trick (Gamma(a) = Gamma(a+1)*U^(1/a)) for shape<1.
  // Beta(a,b) = X/(X+Y) where X~Gamma(a,1), Y~Gamma(b,1) — exact, not a
  // normal approximation, which matters most exactly when alpha/beta are
  // small (early trade counts) and a Gaussian is the worst fit to a skewed
  // Beta shape — i.e. precisely when ranking matters most.
  function randNormal() {
    const u1 = Math.random() || 1e-9, u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  function sampleGamma(shape) {
    if (shape < 1) {
      const u = Math.random() || 1e-9;
      return sampleGamma(shape + 1) * Math.pow(u, 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (let i = 0; i < 100; i++) {
      let x, v;
      do { x = randNormal(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = Math.random();
      const x2 = x * x;
      if (u < 1 - 0.0331 * x2 * x2) return d * v;
      if (Math.log(u) < 0.5 * x2 + d * (1 - v + Math.log(v))) return d * v;
    }
    return d; // fallback, practically unreachable
  }
  function sampleBeta(alpha, beta) {
    const x = sampleGamma(Math.max(alpha, 1e-3));
    const y = sampleGamma(Math.max(beta, 1e-3));
    if (x + y <= 0) return 0.5;
    return Math.max(0.01, Math.min(0.99, x / (x + y)));
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
      // Draw single Thompson sample (averaging defeats exploration/exploitation balance)
      const thompsonSample = sampleBeta(alpha, beta);
      return { symbol: signal.symbol, thompsonScore: Math.round(thompsonSample * 100), alpha, beta, expectedWR: Math.round(alpha / (alpha + beta) * 100) };
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
    // P0 follow-up: `signal` is the raw screener AnalysisResult, which has
    // no top-level conviction/sector/atrState/candlePattern fields — those
    // only exist via extraData (or signal.stats.* for candlePattern). The
    // `signal.X ||` reads below were always dead; extraData is now primary.
    const conv = extraData?.conviction ?? signal.conviction ?? 0;
    if (conv > 0 && (conv < winnerProfile.conviction.min - 10 || conv > winnerProfile.conviction.max + 10)) {
      anomalies.push({ feature: 'Conviction', value: conv, range: `${winnerProfile.conviction.min}-${winnerProfile.conviction.max}`, note: conv < winnerProfile.conviction.min ? 'Below your winner range' : 'Above (unusual but not bad)' });
    }
    const sec = extraData?.sector || signal.sector;
    if (sec && winnerSectors.size > 0 && !winnerSectors.has(sec)) {
      anomalies.push({ feature: 'Sector', value: sec, range: [...winnerSectors].join(', '), note: 'You\'ve never won in this sector' });
    }
    const atr = extraData?.atrState || signal.atrState;
    if (atr && winnerAtrStates.size > 0 && !winnerAtrStates.has(atr)) {
      anomalies.push({ feature: 'ATR State', value: atr, range: [...winnerAtrStates].join(', '), note: 'Untested ATR state for you' });
    }
    const pat = extraData?.candlePattern || signal.stats?.candlePattern || signal.candlePattern;
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
    // P0 follow-up: TrackedTrade only ever stores paramSetKey — t.paramSet
    // and t.passedSets never existed, so this scorecard silently bucketed
    // everything into 'unknown' before this fix.
    const ps = t.paramSetKey || t.paramSet || t.passedSets || 'unknown';
    // A trade might pass multiple sets — track each
    const sets = Array.isArray(ps) ? ps : typeof ps === 'string' ? ps.split(',').map(s => s.trim()) : ['unknown'];
    for (const s of sets) {
      if (!paramSetStats[s]) paramSetStats[s] = { wins: 0, total: 0, totalReward: 0 };
      paramSetStats[s].total++;
      if (t.status?.includes('hit')) { paramSetStats[s].wins++; paramSetStats[s].totalReward += (t.pnlPct || 3); }
      else if (t.status === 'stopped') { paramSetStats[s].totalReward += (t.pnlPct || -2); }
    }
  }
  detectDecay('paramSet', t => t.paramSetKey || 'unknown', paramSetStats, 3);

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
    // P0 follow-up — the single most consequential wiring bug found: `signal`
    // is the raw screener AnalysisResult, which has NO top-level `.conviction`
    // field (it only exists via computeConviction(r) in page.tsx). This line
    // was silently starting EVERY brain score from a flat 50, discarding the
    // actual screener conviction entirely unless the caller passes it via
    // extraData. extraData.conviction is now required for this to work as
    // designed — both call sites in page.tsx have been updated to pass it.
    const baseConviction = extraData?.conviction ?? signal.conviction ?? 50;
    let score = baseConviction;
    const adjustments = [];

    // ENGINE 1: Bayesian adjustments
    const sec = extraData?.sector || signal.sector || 'Unknown';
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
    if (closed.length >= 5 && baseConviction < optimalConviction - 10) {
      const adj = -Math.round((optimalConviction - baseConviction) * 0.3);
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
      if (da.type === 'sector' && sec === da.name) {
        score -= 8; adjustments.push({ factor: `Decay: ${da.name}`, adj: -8, reason: `Was ${da.oldWR}% → now ${da.newWR}%`, engine: 'Bayesian' });
      }
      // P3: pattern and param-set decay now penalize too, not just sector
      if (da.type === 'pattern' && (extraData?.candlePattern || signal.stats?.candlePattern) === da.name) {
        score -= 8; adjustments.push({ factor: `Pattern decay: ${da.name}`, adj: -8, reason: `Was ${da.oldWR}% → now ${da.newWR}%`, engine: 'Bayesian' });
      }
      if (da.type === 'paramSet' && (extraData?.paramSetKey || signal.paramSetKey) === da.name) {
        score -= 8; adjustments.push({ factor: `Param-set decay: ${da.name}`, adj: -8, reason: `Was ${da.oldWR}% → now ${da.newWR}%`, engine: 'Bandit' });
      }
    }
    if (emotionalAlert && streakType === 'L' && currentStreak >= 2 && baseConviction < winConvAvg - 10) {
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
    // P0 follow-up: extraData.paramSets (plural) was never populated by any
    // caller — falls back to the single paramSetKey now passed in extraData.
    const psBoost = getParamSetBoost(extraData?.paramSets || extraData?.paramSetKey || signal.paramSetKey);
    if (psBoost.adj !== 0) {
      score += psBoost.adj;
      adjustments.push({ factor: 'Param set', adj: psBoost.adj, reason: psBoost.reason, engine: 'Bandit' });
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const sizing = getRecommendedRisk(score);
    const ci = confidenceInterval(score, closed.length);

    return { originalScore: baseConviction, brainScore: score, adjustments, sizing, confidence, confidenceInterval: ci, anomalies: anomalyResult, form: { ema: performanceEMA, label: formLabel, trend: performanceTrend } };
  }

  // Pre-mortem analysis
  function premortem(signal, extraData) {
    if (closed.length < 3) return null;
    // P0 follow-up: same dead-field issue — extraData is now primary.
    const sigSector = extraData?.sector || signal.sector;
    const sigConviction = extraData?.conviction ?? signal.conviction ?? 0;
    const similar = closed.map(t => {
      let similarity = 0;
      if (t.sector === sigSector) similarity += 2;
      if (Math.abs((t.conviction || 0) - sigConviction) < 15) similarity += 2;
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

// ═══════════════════════════════════════════════════════════════════════════════
// BRAIN v2 — BACKTEST PRIOR INTELLIGENCE
// These functions accept the brainPrior JSON (generated by generateBrainPrior.js)
// and provide statistically-grounded signal quality lookup and ranking.
// ═══════════════════════════════════════════════════════════════════════════════

const PARAM_SHORT = {
  'optimized_deployable_20plus':    'Deploy20+',
  'optimized_highprecision_15plus': 'HiPrec15+',
  'optimized_elite_10plus':         'Elite10+',
  'optimized_ultraselective_8plus': 'UltraSel8+',
  'sniper_95plus':                  'Sniper95+',
};

/**
 * getSetupQuality — looks up expected P&L for a given stage × paramSetKey
 * from the 719-trade backtest prior.
 * Returns: { expectedPnl, wr, n, tier, sizeMultiplier, label, color }
 */
export function getSetupQuality(prior, stage, paramSetKey) {
  if (!prior || !stage) return null;

  // Look up stage × paramSet combo
  const spKey = `${stage}::${paramSetKey}`;
  const combo = prior.byStageParamSet?.[spKey];
  const stageOnly = prior.byStage?.[stage];
  const paramOnly = prior.byParamSet?.[paramSetKey];

  // Cascade: combo → stage-only → global
  const ref = (combo?.n >= 3 ? combo : null) || (stageOnly?.n >= 3 ? stageOnly : null);
  if (!ref) return null;

  const expectedPnl = ref.avgPnl;
  const wr = ref.wr;
  const n = ref.n;
  const medPnl = ref.medPnl;

  // Tier classification — calibrated to 719-trade backtest range (global avg +2.98%)
  let tier, color, sizeMultiplier;
  if (expectedPnl >= 3.8 && wr >= 70) {
    tier = 'ELITE'; color = '#39FF14'; sizeMultiplier = 1.5;
  } else if (expectedPnl >= 2.8 && wr >= 65) {
    tier = 'STRONG'; color = '#22d3ee'; sizeMultiplier = 1.25;
  } else if (expectedPnl >= 1.8 && wr >= 55) {
    tier = 'GOOD'; color = '#facc15'; sizeMultiplier = 1.0;
  } else if (expectedPnl >= 0.5) {
    tier = 'AVERAGE'; color = '#fb923c'; sizeMultiplier = 0.75;
  } else {
    tier = 'WEAK'; color = '#ef4444'; sizeMultiplier = 0.5;
  }

  const label = `${(expectedPnl >= 0 ? '+' : '')}${expectedPnl.toFixed(2)}% avg · ${wr}% WR · n=${n}`;

  return { expectedPnl, wr, n, medPnl, tier, color, sizeMultiplier, label, combo: !!combo };
}

/**
 * getSymbolReliability — checks if the symbol has backtest history in the prior
 */
export function getSymbolReliability(prior, symbol) {
  if (!prior?.bySymbol) return null;
  // Try with and without suffix
  const clean = symbol.replace(/\.(NS|BO)$/, '');
  return prior.bySymbol[clean] || prior.bySymbol[symbol] || null;
}

/**
 * rankSignalsByBrainV2 — sorts scan signals by combined brain score
 * Incorporates: setup quality from prior + live brain score + symbol reliability
 */
export function rankSignalsByBrainV2(signals, brainScores, prior) {
  if (!signals?.length) return [];

  return signals.map(sig => {
    const bs = brainScores?.[sig.symbol];
    const quality = getSetupQuality(prior, sig.stage, sig.paramSetKey);
    const reliability = getSymbolReliability(prior, sig.symbol);

    // Composite score: 60% brain score + 40% setup quality
    const brainS = bs?.brain ?? 50;
    const qualityS = quality ? Math.min(100, Math.max(0, 50 + quality.expectedPnl * 5)) : 50;
    const compositeScore = Math.round(0.6 * brainS + 0.4 * qualityS);

    return {
      symbol: sig.symbol,
      stage: sig.stage,
      paramSetKey: sig.paramSetKey,
      compositeScore,
      brainScore: brainS,
      riskLabel: bs?.riskLabel ?? '',
      riskPct: bs?.riskPct ?? 1,
      quality,
      reliability,
      priceEngine: sig.priceEngine,
    };
  }).sort((a, b) => b.compositeScore - a.compositeScore);
}

/**
 * getSetupQualityMatrix — returns the full stage × paramSet matrix for display
 */
export function getSetupQualityMatrix(prior) {
  if (!prior?.byStageParamSet) return null;

  const stages = ['ULTRA_STRONG_BUY', 'STRONG_BUY', 'BUY'];
  const params  = [
    'optimized_highprecision_15plus',
    'optimized_deployable_20plus',
    'optimized_elite_10plus',
    'optimized_ultraselective_8plus',
    'sniper_95plus',
  ];

  const matrix = [];
  for (const stage of stages) {
    const row = { stage, cells: [] };
    for (const param of params) {
      const key = `${stage}::${param}`;
      const data = prior.byStageParamSet?.[key];
      row.cells.push({
        param,
        label: PARAM_SHORT[param] || param,
        data: data?.n >= 2 ? data : null,
      });
    }
    matrix.push(row);
  }
  return matrix;
}
