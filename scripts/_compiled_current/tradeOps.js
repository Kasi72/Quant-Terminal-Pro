"use strict";
// Copyright (c) 2024–2026 Kasi Krishnaraja Paldurai. All Rights Reserved.
// Proprietary and confidential. Unauthorised use or distribution is prohibited.
// See LICENSE file in the project root for full licence terms.
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUICK_FILTERS = exports.FIVE_PCT_WIN_THRESHOLD = void 0;
exports.generateTradeSheet = generateTradeSheet;
exports.tradeSheetToClipboard = tradeSheetToClipboard;
exports.getTradeHardStop = getTradeHardStop;
exports.getTradeRiskPerShare = getTradeRiskPerShare;
exports.getTradeMfePct = getTradeMfePct;
exports.getTradeMfeR = getTradeMfeR;
exports.getTradeMaePct = getTradeMaePct;
exports.getTradeMaeR = getTradeMaeR;
exports.didReachFivePctTarget = didReachFivePctTarget;
exports.getFivePctObjectivePnlPct = getFivePctObjectivePnlPct;
exports.getFivePctObjectiveR = getFivePctObjectiveR;
exports.isLegacyT1BreakevenTrailExit = isLegacyT1BreakevenTrailExit;
exports.isTerminalTrade = isTerminalTrade;
exports.isTradeResolvedForWinRate = isTradeResolvedForWinRate;
exports.isSurgicallyGateBlocked = isSurgicallyGateBlocked;
exports.getLiveDaysHeld = getLiveDaysHeld;
exports.computeTierTargetBreakdown = computeTierTargetBreakdown;
exports.isStagnantTrade = isStagnantTrade;
exports.isDeepEarlyMaeTrade = isDeepEarlyMaeTrade;
exports.computeRollingWR = computeRollingWR;
exports.computeEquityCurveR = computeEquityCurveR;
exports.computeArchetypeBreakdown = computeArchetypeBreakdown;
exports.computeMonthlyPerf = computeMonthlyPerf;
exports.computeWinRateStats = computeWinRateStats;
exports.computePortfolioRisk = computePortfolioRisk;
exports.detectMarketRegime = detectMarketRegime;
exports.computeParamSensitivity = computeParamSensitivity;
function generateTradeSheet(r, accountSize, riskPct = 1) {
    const entry = r.priceEngine.plannedEntry;
    const reviewStop = r.priceEngine.tacticalStop;
    const disasterStop = r.priceEngine.disasterStop;
    if (!Number.isFinite(entry) || !Number.isFinite(reviewStop) || entry <= 0 || reviewStop <= 0)
        return null;
    const hardStop = Number.isFinite(disasterStop) && disasterStop > 0 && disasterStop < reviewStop
        ? disasterStop
        : reviewStop;
    const riskPerShare = entry - hardStop;
    if (riskPerShare <= 0)
        return null;
    const safeT1 = Number.isFinite(r.priceEngine.target5) ? r.priceEngine.target5 : entry + riskPerShare * 2;
    const safeT2 = Number.isFinite(r.priceEngine.target7) ? r.priceEngine.target7 : entry + riskPerShare * 3;
    const safeT3 = Number.isFinite(r.priceEngine.target10) ? r.priceEngine.target10 : entry + riskPerShare * 5;
    const maxRisk = accountSize * (riskPct / 100);
    const qty = Math.floor(maxRisk / riskPerShare);
    if (qty <= 0)
        return null;
    const beTrigger = safeT1;
    return {
        symbol: r.symbol,
        action: 'BUY',
        entry: Math.round(entry * 100) / 100,
        qty,
        stopLoss: Math.round(hardStop * 100) / 100,
        reviewStop: Math.round(reviewStop * 100) / 100,
        hardStop: Math.round(hardStop * 100) / 100,
        target1: Math.round(safeT1 * 100) / 100,
        target2: Math.round(safeT2 * 100) / 100,
        target3: Math.round(safeT3 * 100) / 100,
        breakEvenTrigger: Math.round(beTrigger * 100) / 100,
        breakEvenStop: Math.round(entry * 100) / 100,
        trailRule: `Review stop exits next session open after a confirmed close. Sell 50% at T1 ₹${safeT1.toFixed(2)}; keep the remaining 50% protected by the review/trail floor until T2, then use the hard chandelier trail.`,
        totalCost: Math.round(qty * entry),
        maxRisk: Math.round(qty * riskPerShare),
        riskPct,
    };
}
function tradeSheetToClipboard(ts) {
    const riskPerShare = ts.entry - ts.hardStop;
    const rr = (target) => riskPerShare > 0
        ? ((target - ts.entry) / riskPerShare).toFixed(2)
        : 'n/a';
    const lines = [
        `═══ TRADE SHEET ═══`,
        `SYMBOL: ${ts.symbol}`,
        `ACTION: ${ts.action}`,
        `ENTRY: ₹${ts.entry.toFixed(2)} (Limit)`,
        `QTY: ${ts.qty} shares`,
        `HARD STOP: ₹${ts.hardStop.toFixed(2)} (broker SL-M; always executes)`,
        `REVIEW STOP: ₹${ts.reviewStop.toFixed(2)} (close-confirmed; exit next session open)`,
        `TARGET 1: ₹${ts.target1.toFixed(2)} (Sell 50%) — hard-risk R:R ${rr(ts.target1)}R`,
        `TARGET 2: ₹${ts.target2.toFixed(2)} (Sell 30%) — hard-risk R:R ${rr(ts.target2)}R`,
        `TARGET 3: ₹${ts.target3.toFixed(2)} (Sell 20%) — hard-risk R:R ${rr(ts.target3)}R`,
        `TRAIL: ${ts.trailRule}`,
        `CAPITAL: ₹${(ts.totalCost / 100000).toFixed(2)}L`,
        `MAX RISK: ₹${ts.maxRisk.toLocaleString('en-IN')}`,
    ];
    if (ts.pivotPP && Number.isFinite(ts.pivotPP)) {
        lines.push('', `═══ PIVOT LEVELS ═══`);
        if (ts.pivotR2 && Number.isFinite(ts.pivotR2))
            lines.push(`R2: ₹${ts.pivotR2.toFixed(2)}`);
        if (ts.pivotR1 && Number.isFinite(ts.pivotR1))
            lines.push(`R1: ₹${ts.pivotR1.toFixed(2)}`);
        lines.push(`PP: ₹${ts.pivotPP.toFixed(2)}`);
        if (ts.pivotS1 && Number.isFinite(ts.pivotS1))
            lines.push(`S1: ₹${ts.pivotS1.toFixed(2)}`);
        if (ts.pivotS2 && Number.isFinite(ts.pivotS2))
            lines.push(`S2: ₹${ts.pivotS2.toFixed(2)}`);
        if (ts.pivotPosition)
            lines.push(`Position: ${ts.pivotPosition}`);
        if (ts.pivotConfluence)
            lines.push(`Confluence: ${ts.pivotConfluence}`);
        if (ts.pivotWarnings?.length) {
            lines.push('', `═══ PIVOT ALERTS ═══`);
            for (const w of ts.pivotWarnings)
                lines.push(w);
        }
    }
    return lines.join('\n');
}
exports.FIVE_PCT_WIN_THRESHOLD = 5;
function getTradeHardStop(t) {
    const reviewStop = t.stopLoss > 0 && t.stopLoss < t.entryPrice ? t.stopLoss : 0;
    const disasterStop = t.disasterStop > 0 && t.disasterStop < t.entryPrice ? t.disasterStop : 0;
    if (disasterStop > 0 && (reviewStop <= 0 || disasterStop < reviewStop))
        return disasterStop;
    return reviewStop;
}
function getTradeRiskPerShare(t) {
    const hardStop = getTradeHardStop(t);
    return hardStop > 0 ? Math.max(0, t.entryPrice - hardStop) : 0;
}
function getTradeMfePct(t) {
    const tracked = (() => {
        if (Number.isFinite(t.mfe) && (t.mfe ?? 0) > 0)
            return t.mfe ?? 0;
        if (t.entryPrice > 0 && t.highestPrice && t.highestPrice > 0) {
            return ((t.highestPrice - t.entryPrice) / t.entryPrice) * 100;
        }
        if (t.entryPrice > 0 && t.currentPrice && t.currentPrice > 0) {
            return Math.max(0, ((t.currentPrice - t.entryPrice) / t.entryPrice) * 100);
        }
        if (t.entryPrice > 0 && t.closedPrice && t.closedPrice > 0) {
            return Math.max(0, ((t.closedPrice - t.entryPrice) / t.entryPrice) * 100);
        }
        return Math.max(0, t.pnlPct ?? 0);
    })();
    // For terminal trades, derive minimum guaranteed MFE from the targets actually hit.
    // t.mfe may only reflect the D-day or T1-exit snapshot, not the lifetime peak.
    if (t.entryPrice > 0) {
        const pct = (p) => (p - t.entryPrice) / t.entryPrice * 100;
        if (t.status === 'hit_t3' && t.target3 > 0)
            return Math.max(tracked, pct(t.target3));
        if (t.status === 'hit_t2' && t.target2 > 0)
            return Math.max(tracked, pct(t.target2));
        if (t.status === 'hit_t1' && t.target1 > 0)
            return Math.max(tracked, pct(t.target1));
    }
    return tracked;
}
function getTradeMfeR(t) {
    if (Number.isFinite(t.mfeR))
        return Math.max(0, t.mfeR ?? 0);
    const riskPerShare = getTradeRiskPerShare(t);
    const mfePct = getTradeMfePct(t);
    return riskPerShare > 0 && t.entryPrice > 0 ? ((mfePct / 100) * t.entryPrice) / riskPerShare : 0;
}
function getTradeMaePct(t) {
    if (Number.isFinite(t.mae))
        return Math.abs(t.mae ?? 0);
    const riskPerShare = getTradeRiskPerShare(t);
    if (Number.isFinite(t.maeR) && riskPerShare > 0 && t.entryPrice > 0) {
        return (Math.abs(t.maeR ?? 0) * riskPerShare / t.entryPrice) * 100;
    }
    const referencePrice = t.closedPrice ?? t.currentPrice ?? 0;
    if (t.entryPrice > 0 && referencePrice > 0 && referencePrice < t.entryPrice) {
        return ((t.entryPrice - referencePrice) / t.entryPrice) * 100;
    }
    return (t.pnlPct ?? 0) < 0 ? Math.abs(t.pnlPct ?? 0) : 0;
}
function getTradeMaeR(t) {
    if (Number.isFinite(t.maeR) && (t.maeR ?? 0) !== 0)
        return -Math.abs(t.maeR ?? 0);
    const riskPerShare = getTradeRiskPerShare(t);
    const maePct = getTradeMaePct(t);
    return riskPerShare > 0 && t.entryPrice > 0 ? -((maePct / 100) * t.entryPrice) / riskPerShare : 0;
}
function didReachFivePctTarget(t) {
    return getTradeMfePct(t) >= exports.FIVE_PCT_WIN_THRESHOLD;
}
// Canonical return for analytics whose stated outcome is "did price reach +5%?".
// Winners are valued at the pre-declared +5% exit, never at their later MFE.
function getFivePctObjectivePnlPct(t) {
    return didReachFivePctTarget(t) ? exports.FIVE_PCT_WIN_THRESHOLD : (t.pnlPct ?? 0);
}
function getFivePctObjectiveR(t) {
    if (!didReachFivePctTarget(t)) {
        if (Number.isFinite(t.pnlR))
            return t.pnlR ?? 0;
        const riskPerShare = getTradeRiskPerShare(t);
        return riskPerShare > 0 && t.entryPrice > 0
            ? (((t.pnlPct ?? 0) / 100) * t.entryPrice) / riskPerShare
            : 0;
    }
    const riskPerShare = getTradeRiskPerShare(t);
    return riskPerShare > 0 && t.entryPrice > 0
        ? (exports.FIVE_PCT_WIN_THRESHOLD / 100 * t.entryPrice) / riskPerShare
        : 0;
}
const ACTIVE_STATUSES = new Set(['open', 'hit_t1', 'hit_t2']);
const TERMINAL_STATUSES = new Set(['hit_t3', 'stopped', 'expired', 'manual_close', 'closed_early']);
function isLegacyT1BreakevenTrailExit(t) {
    if (t.status !== 'hit_t1')
        return false;
    if (typeof t.closedDate !== 'string' || t.closedDate.trim().length === 0)
        return false;
    const entry = Number(t.entryPrice);
    const closed = Number(t.closedPrice);
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(closed) || closed <= 0)
        return false;
    const closedNearEntry = Math.abs(closed - entry) / entry <= 0.0025;
    if (!closedNearEntry)
        return false;
    return (t.gateLog ?? []).some(gate => {
        const gateName = gate.gatesTested?.[0]?.gate ?? '';
        return gate.result === 'STOPPED'
            && (gate.stopKind === 'trail' || /protective trail/i.test(gateName));
    });
}
function isTerminalTrade(t) {
    if (isLegacyT1BreakevenTrailExit(t))
        return false;
    const hasCloseDate = typeof t.closedDate === 'string' && t.closedDate.trim().length > 0;
    if (hasCloseDate)
        return true;
    if (TERMINAL_STATUSES.has(t.status))
        return true;
    if (ACTIVE_STATUSES.has(t.status))
        return false;
    // Unknown status — quarantine: treat as terminal to prevent silent reprocessing
    console.warn(`[isTerminalTrade] unknown status "${t.status}" on trade ${t.symbol ?? '?'} — quarantined`);
    return true;
}
function isTradeResolvedForWinRate(t) {
    return didReachFivePctTarget(t) || isTerminalTrade(t);
}
// Surgical gate: PRE_BREAKOUT in ATR explosion with conviction < 60 → disproportionate stop-out risk.
// Excluded from win-rate/PF analytics so metrics reflect only trades that passed entry criteria.
function isSurgicallyGateBlocked(t) {
    return t.stage === 'PRE_BREAKOUT' && t.atrState === 'EXPLOSION' && (t.conviction ?? 100) < 60;
}
// Live weekday count from entryDate to today for open trades; stored daysHeld for terminal trades.
// Fixes stale-daysHeld bug where autoValidator only updates daysHeld on next revalidation run.
function getLiveDaysHeld(t) {
    if (isTerminalTrade(t))
        return t.daysHeld ?? 0;
    const entry = t.entryDate;
    if (!entry)
        return t.daysHeld ?? 0;
    const start = new Date(entry);
    const end = new Date();
    if (isNaN(start.getTime()))
        return t.daysHeld ?? 0;
    let count = 0;
    const cur = new Date(start);
    while (cur <= end) {
        const d = cur.getDay();
        if (d !== 0 && d !== 6)
            count++;
        cur.setDate(cur.getDate() + 1);
    }
    return Math.max(0, count - 1); // entry day = day 0
}
// ─── Tier × Target breakdown ──────────────────────────────────────────────────
const STAGE_ORDER = ['ULTRA_STRONG_BUY', 'STRONG_BUY', 'BUY', 'PRE_BREAKOUT', 'EARLY_INFLECTION', 'COMPRESSION_WATCH', 'NO_SIGNAL'];
const STAGE_LABELS = {
    ULTRA_STRONG_BUY: 'Ultra Strong Buy',
    STRONG_BUY: 'Strong Buy',
    BUY: 'Buy',
    PRE_BREAKOUT: 'Pre-Breakout',
    EARLY_INFLECTION: 'Early Inflection',
    COMPRESSION_WATCH: 'Compression Watch',
    NO_SIGNAL: 'No Signal',
};
function computeTierTargetBreakdown(trades) {
    const groups = {};
    for (const t of trades) {
        const s = (t.stage && t.stage.trim()) || 'NO_SIGNAL';
        (groups[s] ?? (groups[s] = [])).push(t);
    }
    // also catch any non-STAGE_ORDER values under 'Other'
    const knownSet = new Set(STAGE_ORDER);
    for (const key of Object.keys(groups)) {
        if (!knownSet.has(key)) {
            (groups['NO_SIGNAL'] ?? (groups['NO_SIGNAL'] = [])).push(...(groups[key] ?? []));
            delete groups[key];
        }
    }
    return STAGE_ORDER
        .filter(s => groups[s]?.length)
        .map(s => {
        const ts = groups[s];
        const decided = ts.filter(t => isTradeResolvedForWinRate(t) && !isSurgicallyGateBlocked(t));
        const wins = decided.filter(didReachFivePctTarget);
        return {
            stage: s,
            label: STAGE_LABELS[s] ?? s,
            total: ts.length,
            open: ts.filter(t => t.status === 'open').length,
            atT1: ts.filter(t => t.status === 'hit_t1').length,
            atT2: ts.filter(t => t.status === 'hit_t2').length,
            atT3: ts.filter(t => t.status === 'hit_t3').length,
            hit5: ts.filter(t => t.hit5pct).length,
            hit7: ts.filter(t => t.hit7pct).length,
            hit10: ts.filter(t => t.hit10pct).length,
            stopped: ts.filter(t => t.status === 'stopped').length,
            expired: ts.filter(t => t.status === 'expired' || t.status === 'closed_early' || t.status === 'manual_close').length,
            decided: decided.length,
            wins: wins.length,
            winRate: decided.length > 0 ? (wins.length / decided.length) * 100 : 0,
        };
    });
}
// Stagnation flag: open trade held 7+ trading days with MFE < 2% = no momentum. Display-only; no auto-exit.
function isStagnantTrade(t) {
    if (isTerminalTrade(t))
        return false;
    if (t.status !== 'open')
        return false;
    return getLiveDaysHeld(t) >= 7 && (t.mfe ?? 0) < 2.0;
}
// Deep early MAE: non-terminal trade, first 5 trading days, already dipped 0.65R+. Entry quality flag.
function isDeepEarlyMaeTrade(t) {
    if (isTerminalTrade(t))
        return false;
    if (getLiveDaysHeld(t) > 5)
        return false;
    return getTradeMaeR(t) < -0.65;
}
// ─── Analytics helpers ───────────────────────────────────────────────────────
const PARAM_KEY_LABELS = {
    optimized_deployable_20plus: 'VF',
    optimized_highprecision_15plus: 'CC',
    optimized_ultraselective_8plus: 'EMA',
    sniper_95plus: 'PS',
    optimized_elite_10plus: 'MP',
};
function resolvedSorted(trades) {
    return trades
        .filter(isTradeResolvedForWinRate)
        .filter(t => !isSurgicallyGateBlocked(t))
        .sort((a, b) => (a.closedDate ?? a.entryDate ?? '').localeCompare(b.closedDate ?? b.entryDate ?? ''));
}
function computeRollingWR(trades, n = 10) {
    const last = resolvedSorted(trades).slice(-n);
    const wins = last.filter(didReachFivePctTarget).length;
    return { winRate: last.length > 0 ? (wins / last.length) * 100 : 0, decided: last.length, wins, losses: last.length - wins };
}
function computeEquityCurveR(trades) {
    let cum = 0;
    return resolvedSorted(trades).map((t, i) => {
        const r = getFivePctObjectiveR(t);
        cum = Math.round((cum + r) * 100) / 100;
        return { symbol: t.symbol.replace('.NS', ''), n: i + 1, r, cum };
    });
}
function computeArchetypeBreakdown(trades) {
    const groups = {};
    for (const t of resolvedSorted(trades)) {
        const raw = t.paramSetKey ?? 'Other';
        const arch = PARAM_KEY_LABELS[raw] ?? raw.slice(0, 4).toUpperCase();
        if (!groups[arch])
            groups[arch] = { wins: [], losses: [] };
        (didReachFivePctTarget(t) ? groups[arch].wins : groups[arch].losses).push(t);
    }
    return Object.entries(groups)
        .map(([archetype, g]) => {
        const decided = g.wins.length + g.losses.length;
        const avgWinR = g.wins.length > 0 ? g.wins.reduce((s, t) => s + getFivePctObjectiveR(t), 0) / g.wins.length : 0;
        return { archetype, wins: g.wins.length, losses: g.losses.length, decided, winRate: decided > 0 ? (g.wins.length / decided) * 100 : 0, avgWinR };
    })
        .sort((a, b) => b.decided - a.decided);
}
function computeMonthlyPerf(trades) {
    const groups = {};
    for (const t of resolvedSorted(trades)) {
        const month = (t.closedDate ?? t.entryDate ?? '').slice(0, 7);
        if (!month)
            continue;
        (groups[month] ?? (groups[month] = [])).push(t);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([month, ts]) => {
        const wins = ts.filter(didReachFivePctTarget).length;
        const totalR = ts.reduce((s, t) => s + getFivePctObjectiveR(t), 0);
        return { month, count: ts.length, wins, losses: ts.length - wins, winRate: (wins / ts.length) * 100, totalR };
    });
}
function computeWinRateStats(trades) {
    const closed = trades.filter(isTradeResolvedForWinRate).filter(t => !isSurgicallyGateBlocked(t));
    const wins = closed.filter(didReachFivePctTarget);
    const losses = closed.filter(t => !didReachFivePctTarget(t));
    const totalWinPct = wins.reduce((s, t) => s + getFivePctObjectivePnlPct(t), 0);
    const totalLossPct = Math.abs(losses.reduce((s, t) => s + getFivePctObjectivePnlPct(t), 0));
    const totalWinR = wins.reduce((s, t) => s + getFivePctObjectiveR(t), 0);
    const totalLossR = Math.abs(losses.reduce((s, t) => s + getFivePctObjectiveR(t), 0));
    // Actual avg win: use real blended exit P&L for terminal wins, peak MFE for open wins.
    // profitFactor/expectancy stay model-based (5% objective) for consistency with Brain V2.
    const totalActualWinPct = wins.reduce((s, t) => {
        if (isTerminalTrade(t) && t.pnlPct != null)
            return s + t.pnlPct;
        return s + getTradeMfePct(t);
    }, 0);
    let bestTrade = null;
    let worstTrade = null;
    for (const t of closed) {
        const p = getFivePctObjectivePnlPct(t);
        if (!bestTrade || p > bestTrade.pnlPct)
            bestTrade = { symbol: t.symbol, pnlPct: p };
        if (!worstTrade || p < worstTrade.pnlPct)
            worstTrade = { symbol: t.symbol, pnlPct: p };
    }
    // Current streak
    let streakWins = 0, streakLosses = 0;
    for (let i = closed.length - 1; i >= 0; i--) {
        const isWin = didReachFivePctTarget(closed[i]);
        if (i === closed.length - 1) {
            if (isWin)
                streakWins = 1;
            else
                streakLosses = 1;
        }
        else if (isWin && streakWins > 0)
            streakWins++;
        else if (!isWin && streakLosses > 0)
            streakLosses++;
        else
            break;
    }
    const avgDays = closed.length > 0 ? closed.reduce((s, t) => s + (t.daysHeld ?? 0), 0) / closed.length : 0;
    return {
        total: trades.length,
        decided: closed.length,
        wins: wins.length,
        losses: losses.length,
        fivePctWins: wins.length,
        open: trades.filter(t => !isTerminalTrade(t)).length,
        hitT1: trades.filter(t => t.status === 'hit_t1').length,
        hitT2: trades.filter(t => t.status === 'hit_t2').length,
        hitT3: trades.filter(t => t.status === 'hit_t3').length,
        stopped: trades.filter(t => t.status === 'stopped').length,
        expired: trades.filter(t => t.status === 'expired').length,
        manualClose: trades.filter(t => t.status === 'manual_close').length,
        closedEarly: trades.filter(t => t.status === 'closed_early').length,
        winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
        avgWinPct: wins.length > 0 ? totalActualWinPct / wins.length : 0,
        avgLossPct: losses.length > 0 ? -totalLossPct / losses.length : 0,
        avgWinR: wins.length > 0 ? totalWinR / wins.length : 0,
        avgLossR: losses.length > 0 ? -totalLossR / losses.length : 0,
        profitFactor: totalLossPct > 0 ? Math.min(totalWinPct / totalLossPct, 50) : totalWinPct > 0 ? 50 : 0,
        expectancy: closed.length > 0
            ? (wins.length / closed.length) * (wins.length > 0 ? totalWinPct / wins.length : 0)
                - (losses.length / closed.length) * (losses.length > 0 ? totalLossPct / losses.length : 0)
            : 0,
        bestTrade, worstTrade,
        avgDaysHeld: Math.round(avgDays),
        streakWins, streakLosses,
    };
}
function computePortfolioRisk(trades, accountSize, sectorMap) {
    const open = trades.filter(t => t.status === 'open');
    const totalCap = open.reduce((s, t) => s + t.entryPrice * (t.qty ?? 1), 0);
    const totalRisk = open.reduce((s, t) => s + getTradeRiskPerShare(t) * (t.qty ?? 1), 0);
    const sectorCounts = {};
    for (const t of open) {
        const sym = t.symbol.replace('.NS', '').replace('.BO', '');
        for (const [sector, symbols] of Object.entries(sectorMap)) {
            if (symbols.includes(sym)) {
                sectorCounts[sector] = (sectorCounts[sector] ?? 0) + 1;
                break;
            }
        }
    }
    let maxSector = '', maxCount = 0;
    for (const [s, c] of Object.entries(sectorCounts)) {
        if (c > maxCount) {
            maxSector = s;
            maxCount = c;
        }
    }
    let warning = null;
    if (open.length >= 3 && maxCount >= Math.ceil(open.length * 0.6)) {
        warning = `${maxCount} of ${open.length} positions are in ${maxSector} — high concentration`;
    }
    return {
        totalPositions: open.length,
        totalCapitalDeployed: totalCap,
        totalRiskAmount: totalRisk,
        totalRiskPct: accountSize > 0 ? (totalRisk / accountSize) * 100 : 0,
        sectorConcentration: sectorCounts,
        maxSectorExposure: maxSector,
        maxSectorPct: open.length > 0 ? (maxCount / open.length) * 100 : 0,
        correlationWarning: warning,
    };
}
function detectMarketRegime(niftyCandles, vixCandles) {
    const fallback = { regime: 'neutral', niftyClose: 0, ema200: 0, ema50: 0, aboveEma200: true, ema50Above200: true, label: 'Unknown', emoji: '🟡', sizingMultiplier: 0.75, score: 0, dayChangePct: 0, factors: { momentum: 0, breadth: 0, volatility: 0, acceleration: 0, distEma200: 0, vixLevel: 0, vixROC: 0, vixVsSma: 0 }, vix: 0, cusumAlert: null, blackSwanLevel: 'normal', blackSwanAction: '' };
    if (niftyCandles.length < 200)
        return fallback;
    const n = niftyCandles.length;
    const close = niftyCandles[n - 1].c;
    // EMA50/200 (still computed for display)
    const k50 = 2 / 51, k200 = 2 / 201;
    let ema50 = niftyCandles[0].c, ema200 = niftyCandles[0].c;
    for (let i = 1; i < n; i++) {
        ema50 = niftyCandles[i].c * k50 + ema50 * (1 - k50);
        ema200 = niftyCandles[i].c * k200 + ema200 * (1 - k200);
    }
    // Factor 1: MOMENTUM — 20-day return
    const ret20 = n >= 21 ? (close - niftyCandles[n - 21].c) / niftyCandles[n - 21].c * 100 : 0;
    // Factor 2: BREADTH — % of last 20 days that were green
    let greenDays = 0;
    for (let j = n - 20; j < n; j++)
        if (j > 0 && niftyCandles[j].c > niftyCandles[j - 1].c)
            greenDays++;
    const breadth = greenDays / 20 * 100;
    // Factor 3: VOLATILITY — 20-day realized vol
    const rets = [];
    for (let j = n - 20; j < n; j++)
        if (j > 0)
            rets.push((niftyCandles[j].c - niftyCandles[j - 1].c) / niftyCandles[j - 1].c * 100);
    const retMean = rets.length > 0 ? rets.reduce((s, v) => s + v, 0) / rets.length : 0;
    const vol = rets.length > 0 ? Math.sqrt(rets.reduce((s, v) => s + (v - retMean) ** 2, 0) / rets.length) : 1;
    // Factor 4: ACCELERATION — 10d return minus prev 10d return
    const ret10a = n >= 11 ? (close - niftyCandles[n - 11].c) / niftyCandles[n - 11].c * 100 : 0;
    const ret10b = n >= 21 ? (niftyCandles[n - 11].c - niftyCandles[n - 21].c) / niftyCandles[n - 21].c * 100 : 0;
    const accel = ret10a - ret10b;
    // Factor 9: TODAY'S RETURN — 1-day change anchors regime to current session
    const ret1 = n >= 2 ? (close - niftyCandles[n - 2].c) / niftyCandles[n - 2].c * 100 : 0;
    // Factor 5: DISTANCE FROM EMA200
    const distEma200 = ema200 > 0 ? ((close - ema200) / ema200) * 100 : 0;
    // Composite score (factors 1-5: 82 pts max)
    let score = 0;
    score += ret20 > 5 ? 20 : ret20 > 2 ? 12 : ret20 > 0 ? 4 : ret20 > -2 ? -4 : ret20 > -5 ? -12 : -20;
    score += breadth > 60 ? 18 : breadth > 52 ? 9 : breadth > 45 ? -4 : breadth > 38 ? -12 : -18;
    score += vol < 0.8 ? 12 : vol < 1.2 ? 6 : vol < 1.8 ? 0 : vol < 2.5 ? -6 : -12;
    score += accel > 2 ? 12 : accel > 0.5 ? 6 : accel > -0.5 ? 0 : accel > -2 ? -6 : -12;
    score += distEma200 > 5 ? 12 : distEma200 > 0 ? 6 : distEma200 > -3 ? -4 : distEma200 > -8 ? -8 : -12;
    score += ret1 > 2 ? 8 : ret1 > 0.5 ? 4 : ret1 > -0.5 ? 0 : ret1 > -2 ? -8 : -12;
    // VIX factors (6-8: 28 pts max) — only if VIX data provided
    let vixVal = 0, vixROC = 0, vixVsSma = 0;
    if (vixCandles && vixCandles.length >= 21) {
        const vn = vixCandles.length;
        vixVal = vixCandles[vn - 1].c;
        // Factor 6: VIX Level (with contrarian >45 logic)
        score += vixVal < 12 ? 6 : vixVal < 16 ? 10 : vixVal < 22 ? 4 : vixVal < 30 ? -6 : vixVal < 45 ? -10 : 4;
        // Factor 7: VIX 5-day ROC
        const vix5 = vn >= 6 ? vixCandles[vn - 6].c : vixVal;
        vixROC = vix5 > 0 ? ((vixVal - vix5) / vix5 * 100) : 0;
        score += vixROC < -15 ? 8 : vixROC < -5 ? 4 : vixROC < 5 ? 0 : vixROC < 15 ? -4 : -8;
        // Factor 8: VIX vs 20-day SMA (term structure proxy)
        let vixSma = 0;
        for (let j = vn - 20; j < vn; j++)
            vixSma += vixCandles[j].c;
        vixSma /= 20;
        vixVsSma = vixSma > 0 ? ((vixVal - vixSma) / vixSma) * 100 : 0;
        score += vixVsSma < -15 ? 8 : vixVsSma < -5 ? 3 : vixVsSma < 5 ? 0 : vixVsSma < 15 ? -3 : -8;
    }
    // CUSUM crash early-warning (separate from score)
    let cusumAlert = null;
    if (n >= 55) {
        const cusumRets = [];
        for (let j = n - 50; j < n; j++)
            if (j > 0)
                cusumRets.push((niftyCandles[j].c - niftyCandles[j - 1].c) / niftyCandles[j - 1].c * 100);
        const warmup = cusumRets.slice(0, 30);
        const cMean = warmup.reduce((s, v) => s + v, 0) / warmup.length;
        const cStd = Math.sqrt(warmup.reduce((s, v) => s + (v - cMean) ** 2, 0) / warmup.length) || 0.01;
        let sPlus = 0, sMinus = 0;
        for (const r of cusumRets.slice(30)) {
            sPlus = Math.max(0, sPlus + (r - cMean) / cStd - 0.5);
            sMinus = Math.max(0, sMinus - (r - cMean) / cStd - 0.5);
        }
        if (sMinus > 3.0)
            cusumAlert = 'bearish_shift';
        else if (sPlus > 3.0)
            cusumAlert = 'bullish_shift';
    }
    // 5-state classification
    let regime, label, emoji, mult;
    if (score >= 40) {
        regime = 'strong_bull';
        label = 'Strong Bull';
        emoji = '🟢';
        mult = 1.25;
    }
    else if (score >= 15) {
        regime = 'bull';
        label = 'Bull Market';
        emoji = '🟢';
        mult = 1.0;
    }
    else if (score >= -15) {
        regime = 'neutral';
        label = 'Neutral';
        emoji = '🟡';
        mult = 0.75;
    }
    else if (score >= -40) {
        regime = 'bear';
        label = 'Bear Market';
        emoji = '🔴';
        mult = 0.25;
    }
    else {
        regime = 'strong_bear';
        label = 'Strong Bear';
        emoji = '🔴';
        mult = 0;
    }
    // Black Swan 4-Level Warning (backtested on 10yr Nifty+VIX, caught COVID 25 days early)
    let blackSwanLevel = 'normal';
    let blackSwanAction = '';
    if (vixCandles && vixCandles.length >= 11 && n >= 11) {
        const niftyROC5 = n >= 6 ? (close - niftyCandles[n - 6].c) / niftyCandles[n - 6].c * 100 : 0;
        const niftyROC10 = n >= 11 ? (close - niftyCandles[n - 11].c) / niftyCandles[n - 11].c * 100 : 0;
        if (vixVal >= 45 && niftyROC10 < -10) {
            blackSwanLevel = 'extreme';
            blackSwanAction = 'Stay in cash. Wait for VIX to peak and start declining. COVID-level event.';
        }
        else if (vixVal >= 30 && (vixROC > 30 || (vixCandles.length >= 11 ? ((vixVal - vixCandles[vixCandles.length - 11].c) / vixCandles[vixCandles.length - 11].c * 100) : 0) > 50) && niftyROC5 < -5) {
            blackSwanLevel = 'severe';
            blackSwanAction = 'EXIT all positions. Move to 100% cash. Capital preservation mode.';
        }
        else if (vixVal >= 22 && vixROC > 25 && niftyROC5 < -3) {
            blackSwanLevel = 'high';
            blackSwanAction = 'Stop ALL new entries. Exit weak positions. Institutional selling accelerating.';
        }
        else if (vixVal >= 18 && vixROC > 15 && niftyROC5 < -2) {
            blackSwanLevel = 'elevated';
            blackSwanAction = 'Reduce new positions to 50%. Tighten stops. Fear rising faster than normal.';
        }
    }
    return {
        regime, niftyClose: close, ema200, ema50,
        aboveEma200: close > ema200, ema50Above200: ema50 > ema200,
        label, emoji, sizingMultiplier: mult, score, dayChangePct: ret1,
        factors: { momentum: ret20, breadth, volatility: vol, acceleration: accel, distEma200, vixLevel: vixVal, vixROC, vixVsSma },
        vix: vixVal, cusumAlert, blackSwanLevel, blackSwanAction,
    };
}
function computeParamSensitivity(r) {
    const items = [];
    for (const item of r.checklist) {
        const numMatch = item.value.match(/-?[\d.]+/);
        const threshMatch = item.label.match(/([\d.]+)/);
        if (!numMatch || !threshMatch)
            continue;
        const val = parseFloat(numMatch[0]);
        const thresh = parseFloat(threshMatch[0]);
        if (isNaN(val) || isNaN(thresh) || thresh === 0)
            continue;
        const isUpperBound = item.label.includes('≤');
        const margin = isUpperBound ? ((thresh - val) / thresh) * 100 : ((val - thresh) / thresh) * 100;
        let strength;
        if (!item.pass)
            strength = 'fail';
        else if (margin > 30)
            strength = 'strong';
        else if (margin > 10)
            strength = 'moderate';
        else
            strength = 'marginal';
        items.push({ label: item.label, value: val, threshold: thresh, marginPct: margin, strength });
    }
    return items.sort((a, b) => a.marginPct - b.marginPct);
}
exports.QUICK_FILTERS = [
    {
        key: 'all', label: 'All', emoji: '⊡', description: 'Show all results',
        filter: () => true,
    },
    {
        // FIX: Removed gapAdjustedRR>=2 — T1 is always 0.75×risk so gapAdjustedRR
        // is always ~0.75; the >=2 gate was impossible and returned zero matches.
        // Comment at stockEngine.ts:895 also flags gapRR>=2 as a NEGATIVE predictor
        // (r=−0.005). Replaced with volDryUpScore>=2 (r=+0.014, dominant predictor).
        key: 'ready', label: 'Ready to Trade', emoji: '🎯',
        description: 'BUY+ · valid trade sheet · EMA aligned · Vol dry-up ≥2 (compression backing). Use for same-day entries.',
        filter: r => r.priceEngine.tradeValid &&
            r.momentum.emaAligned &&
            r.momentum.volDryUpScore >= 2,
    },
    {
        // FIX: Removed higherLowConfirmed — it is false in 6/7 param sets (only
        // analyzeMomentumPocket sets it). The old filter returned zero results on
        // all other param set selections. Replaced with tier-based proximity
        // (IMMINENT ≤1% or NEAR ≤2.5%) backed by at least minimal dry-up.
        key: 'tomorrow', label: "Tomorrow's Breakouts", emoji: '⚡',
        description: 'IMMINENT (0–1%) or NEAR (1–2.5%) proximity tier · Vol dry-up ≥1 · Breaks out within 5 days ~43–74% of the time.',
        filter: r => (r.nearBreakoutTier === 'IMMINENT' || r.nearBreakoutTier === 'NEAR') &&
            r.momentum.volDryUpScore >= 1,
    },
    {
        // FIX: Removed rsNifty20>=1.05 — rsNifty20 is hardcoded to 1.0 in every
        // param set (Nifty data unavailable per-stock at scan time) so that
        // condition was ALWAYS false, returning zero results.
        // momentumScore>=70 implies volDryUpScore>=3 AND obvSlope10>=0.5 (the
        // two highest-correlation positive predictors per the 3,806-signal backtest).
        key: 'strongest', label: 'Strongest Momentum', emoji: '🔥',
        description: 'MomScore≥70 (implies Vol dry-up ≥3 + OBV slope ≥0.5) · Not NO_SIGNAL unless MOM badge present.',
        filter: r => r.momentum.momentumScore >= 70 &&
            (r.stage !== 'NO_SIGNAL' || !!r.monster?.badges?.some(b => b.type === 'MOM')),
    },
    {
        // FIX: Removed rewardRisk>=0.9 — tradeValid already requires rewardRisk>=1.5
        // so the 0.9 check was always redundant and dead.
        // Added rewardRisk>=2.0 (genuine quality gate), emaAligned (trend clarity),
        // and volDryUpScore>=2 (compression entry = controlled risk = safer).
        key: 'safe', label: 'Safe Entries', emoji: '🛡',
        description: 'Risk≤5% · R:R≥2.0 · EMA aligned · Vol dry-up ≥2. Tightest risk-adjusted setups only.',
        filter: r => r.priceEngine.tradeValid &&
            r.priceEngine.tacticalRiskPct > 0 &&
            r.priceEngine.tacticalRiskPct <= 5 &&
            r.priceEngine.rewardRisk >= 2.0 &&
            r.momentum.emaAligned &&
            r.momentum.volDryUpScore >= 2,
    },
    {
        // Independent of stage by design — PBFB forensic backtest found the zone
        // engine misses ~70% of monster moves because they're momentum-
        // continuation breakouts on already-elevated-volatility stocks, not
        // quiet compression. This surfaces those even when stage is NO_SIGNAL
        // or COMPRESSION_WATCH. See lib/stockEngine.ts detectMonster() MOM badge.
        // FIX: Added topProbability>0.5 floor — badges below 50% probability
        // are low-conviction signals and generate noise.
        key: 'momAlert', label: 'MOM Alert', emoji: '🚀',
        description: 'MOM badge (momentum-continuation) with P>50% — 53.6% OOS hit rate vs 35% baseline. Independent of stage.',
        filter: r => !!r.monster?.badges?.some(b => b.type === 'MOM') &&
            (r.monster?.topProbability ?? 0) > 0.5,
    },
    {
        // FIX: Expanded from single param set to the full high-conviction tier:
        // ULTRA_STRONG_BUY from any param set (strictly highest grade),
        // STRONG_BUY from the three precision/sniper sets (HiPrec15+, Elite10+, Sniper95+).
        // Original filter only matched HiPrec15+/STRONG_BUY and excluded ULTRA_STRONG_BUY.
        // 940-trade backtest (470 stocks × 5 param sets, 2022-2024):
        // avg P&L +4.10%, median +6.27%, 69% of trades >5%, WR 76%, PF 4.41.
        key: 'eliteSignal', label: 'Elite Signal', emoji: '⭐',
        description: 'ULTRA STRONG BUY (any set) · or STRONG BUY from HiPrec15+, Elite10+, Sniper95+. Backtest avg +4.10%, WR 76%.',
        filter: r => r.stage === 'ULTRA_STRONG_BUY' ||
            (r.stage === 'STRONG_BUY' && (r.paramSetKey === 'optimized_highprecision_15plus' ||
                r.paramSetKey === 'optimized_elite_10plus' ||
                r.paramSetKey === 'sniper_95plus')),
    },
];
