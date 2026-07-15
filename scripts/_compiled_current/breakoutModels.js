"use strict";
// Breakout Level Models — 5 competing definitions of "a breakout", plus a
// confluence scorer. Pure, dependency-free, browser + Node safe.
//
// Each model answers one question at bar `i`: "Given only data BEFORE i, is bar i
// a breakout, and of what level?" The forward-MFE/MAE harness (lib/mfeBacktest.ts)
// then measures which model/params most reliably precede the biggest momentum.
//
// The single-point functions take an optional precomputed `ctx` (rolling arrays).
// The batch harness builds ctx once per symbol so the hot loop is O(1) per bar;
// the app can call the same functions with ctx omitted for a one-off event.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCtx = buildCtx;
exports.modelDonchian = modelDonchian;
exports.modelSwing = modelSwing;
exports.modelVCP = modelVCP;
exports.modelPocketPivot = modelPocketPivot;
exports.modelNewHigh = modelNewHigh;
exports.confluence = confluence;
const NONE = { isBreakout: false, level: 0, distancePct: 0, meta: {} };
// ── ctx builders (used by the harness; safe to call standalone) ───────────────
function buildCtx(candles, hhWindows) {
    const n = candles.length;
    const atr14 = new Array(n).fill(0);
    const avgVol20 = new Array(n).fill(0);
    const ema10 = new Array(n).fill(0);
    const ema50 = new Array(n).fill(0);
    const hh252 = new Array(n).fill(0);
    const maxDownVol10 = new Array(n).fill(0);
    // Wilder ATR14
    let trSum = 0, atr = 0;
    for (let i = 0; i < n; i++) {
        const c = candles[i];
        const pc = i > 0 ? candles[i - 1].c : c.c;
        const tr = Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
        if (i < 14) {
            trSum += tr;
            if (i === 13)
                atr = trSum / 14;
        }
        else
            atr = (atr * 13 + tr) / 14;
        atr14[i] = i >= 14 ? atr : 0; // atr14[i] = ATR using bars up to i-1 is close enough at scale
    }
    // avgVol20 over [i-20, i-1]
    for (let i = 0; i < n; i++) {
        if (i < 20) {
            avgVol20[i] = 0;
            continue;
        }
        let s = 0;
        for (let j = i - 20; j < i; j++)
            s += candles[j].v;
        avgVol20[i] = s / 20;
    }
    // EMAs (standard, seeded with first close)
    const k10 = 2 / (10 + 1), k50 = 2 / (50 + 1);
    let e10 = candles[0].c, e50 = candles[0].c;
    for (let i = 0; i < n; i++) {
        e10 = candles[i].c * k10 + e10 * (1 - k10);
        e50 = candles[i].c * k50 + e50 * (1 - k50);
        ema10[i] = i > 0 ? candles[i - 1].c * k10 + ema10[i - 1] * (1 - k10) : candles[0].c;
        ema50[i] = i > 0 ? candles[i - 1].c * k50 + ema50[i - 1] * (1 - k50) : candles[0].c;
    }
    // 52-week high of [i-252, i-1]
    for (let i = 0; i < n; i++) {
        const from = Math.max(0, i - 252);
        let m = 0;
        for (let j = from; j < i; j++)
            if (candles[j].h > m)
                m = candles[j].h;
        hh252[i] = m;
    }
    // max down-day volume in last 10
    for (let i = 0; i < n; i++) {
        let m = 0;
        for (let j = Math.max(1, i - 10); j < i; j++) {
            if (candles[j].c < candles[j - 1].c && candles[j].v > m)
                m = candles[j].v;
        }
        maxDownVol10[i] = m;
    }
    // rolling highest-high per requested window
    const hh = {};
    for (const N of hhWindows) {
        const arr = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            const from = Math.max(0, i - N);
            let m = 0;
            for (let j = from; j < i; j++)
                if (candles[j].h > m)
                    m = candles[j].h;
            arr[i] = m;
        }
        hh[N] = arr;
    }
    return { atr14, avgVol20, ema10, ema50, hh252, maxDownVol10, hh };
}
// Fallbacks when ctx is absent (single-event app use). Bounded windows.
function hhLocal(candles, i, N) {
    let m = 0;
    for (let j = Math.max(0, i - N); j < i; j++)
        if (candles[j].h > m)
            m = candles[j].h;
    return m;
}
function avgVolLocal(candles, i, N = 20) {
    if (i < N)
        return 0;
    let s = 0;
    for (let j = i - N; j < i; j++)
        s += candles[j].v;
    return s / N;
}
function modelDonchian(candles, i, p, ctx) {
    if (i < 1)
        return NONE;
    const level = ctx?.hh[p.N]?.[i] ?? hhLocal(candles, i, p.N);
    if (level <= 0)
        return NONE;
    const c = candles[i];
    const av = ctx?.avgVol20[i] ?? avgVolLocal(candles, i);
    const volOk = p.volMult <= 0 || (av > 0 && c.v >= p.volMult * av);
    const wasBelow = candles[i - 1].c <= level;
    return {
        isBreakout: c.c > level && wasBelow && volOk,
        level,
        distancePct: (c.c - level) / level * 100,
        meta: { N: p.N, volMult: p.volMult },
    };
}
// Highest CONFIRMED swing-high fractal within lookback (confirmed = k bars on each
// side, all strictly before i). That is the dominant overhead resistance.
function modelSwing(candles, i, p, ctx) {
    if (i < p.k + 1)
        return NONE;
    const start = Math.max(p.k, i - p.lookback);
    let level = 0;
    for (let j = start; j <= i - 1 - p.k; j++) { // j + k must be < i (confirmed with past data)
        let isPivot = true;
        for (let m = 1; m <= p.k; m++) {
            if (candles[j].h <= candles[j - m].h || candles[j].h <= candles[j + m].h) {
                isPivot = false;
                break;
            }
        }
        if (isPivot && candles[j].h > level)
            level = candles[j].h;
    }
    if (level <= 0)
        return NONE;
    const c = candles[i];
    const av = ctx?.avgVol20[i] ?? avgVolLocal(candles, i);
    const volOk = p.volMult <= 0 || (av > 0 && c.v >= p.volMult * av);
    const wasBelow = candles[i - 1].c <= level;
    return {
        isBreakout: c.c > level && wasBelow && volOk,
        level,
        distancePct: (c.c - level) / level * 100,
        meta: { k: p.k, lookback: p.lookback, volMult: p.volMult },
    };
}
function rangeTightness(candles, a, b) {
    let hi = 0, lo = Infinity, cs = 0, n = 0;
    for (let j = a; j <= b; j++) {
        if (candles[j].h > hi)
            hi = candles[j].h;
        if (candles[j].l < lo)
            lo = candles[j].l;
        cs += candles[j].c;
        n++;
    }
    const avgC = n > 0 ? cs / n : 0;
    return avgC > 0 ? (hi - lo) / avgC * 100 : Infinity;
}
function avgVolRange(candles, a, b) {
    let s = 0, n = 0;
    for (let j = a; j <= b; j++) {
        s += candles[j].v;
        n++;
    }
    return n > 0 ? s / n : 0;
}
function modelVCP(candles, i, p, ctx) {
    const maxBase = Math.floor(p.maxBase);
    if (i < maxBase + 1)
        return NONE;
    const a = i - maxBase, b = i - 1; // base window, strictly before i
    let baseHigh = 0, baseLow = Infinity;
    for (let j = a; j <= b; j++) {
        if (candles[j].h > baseHigh)
            baseHigh = candles[j].h;
        if (candles[j].l < baseLow)
            baseLow = candles[j].l;
    }
    if (baseHigh <= 0 || baseLow <= 0)
        return NONE;
    const depthPct = (baseHigh - baseLow) / baseHigh * 100;
    const third = Math.floor(p.maxBase / 3);
    const t1 = rangeTightness(candles, a, a + third - 1);
    const t3 = rangeTightness(candles, b - third + 1, b);
    const contraction = t3 < t1; // recent third tighter than earliest → coiling
    const finalTight = t3 <= p.maxTightPct;
    const volDecline = !p.requireVolDecline ||
        avgVolRange(candles, b - third + 1, b) < avgVolRange(candles, a, a + third - 1);
    const hh252 = ctx?.hh252[i] ?? hhLocal(candles, i, 252);
    const near52w = hh252 > 0 && baseHigh >= (1 - p.near52wPct / 100) * hh252;
    const c = candles[i];
    const av = ctx?.avgVol20[i] ?? avgVolLocal(candles, i);
    const volOk = av > 0 && c.v >= p.minVolMult * av;
    const pivot = baseHigh;
    const structureOk = depthPct <= p.maxDepthPct && contraction && finalTight && volDecline && near52w;
    return {
        isBreakout: c.c > pivot && candles[i - 1].c <= pivot && volOk && structureOk,
        level: pivot,
        distancePct: (c.c - pivot) / pivot * 100,
        meta: { depthPct, finalTightPct: t3, contraction, volDecline, near52w },
    };
}
function modelPocketPivot(candles, i, p, ctx) {
    if (i < 11)
        return NONE;
    const c = candles[i], prev = candles[i - 1];
    const up = c.c > prev.c;
    let maxDownVol = ctx?.maxDownVol10[i] ?? 0;
    if (!ctx)
        for (let j = i - 10; j < i; j++)
            if (candles[j].c < candles[j - 1].c && candles[j].v > maxDownVol)
                maxDownVol = candles[j].v;
    const emaRef = p.emaPeriod === 10 ? (ctx?.ema10[i] ?? c.c) : (ctx?.ema50[i] ?? c.c);
    const aboveMA = emaRef > 0 && c.c >= emaRef;
    const notExtended = emaRef > 0 && c.c <= emaRef * (1 + p.maxExtPct / 100);
    const isPP = up && c.v > maxDownVol && maxDownVol > 0 && aboveMA && notExtended;
    return {
        isBreakout: isPP,
        level: emaRef,
        distancePct: emaRef > 0 ? (c.c - emaRef) / emaRef * 100 : 0,
        meta: { emaPeriod: p.emaPeriod, upDay: up, volVsMaxDown: maxDownVol > 0 ? c.v / maxDownVol : 0 },
    };
}
function modelNewHigh(candles, i, p, ctx) {
    if (i < 1)
        return NONE;
    const level = ctx?.hh[p.N]?.[i] ?? hhLocal(candles, i, p.N);
    if (level <= 0)
        return NONE;
    const c = candles[i];
    const av = ctx?.avgVol20[i] ?? avgVolLocal(candles, i);
    const volOk = p.volMult <= 0 || (av > 0 && c.v >= p.volMult * av);
    const notChasing = c.c <= level * (1 + p.maxAbovePct / 100); // don't count a gap already far above
    return {
        isBreakout: c.c > level && candles[i - 1].c <= level && volOk && notChasing,
        level,
        distancePct: (c.c - level) / level * 100,
        meta: { N: p.N, volMult: p.volMult },
    };
}
const W = { newHigh: 0.30, vcp: 0.30, pocket: 0.15, swing: 0.15, donchian: 0.10 };
function confluence(candles, i, p, ctx) {
    const a = modelDonchian(candles, i, p.donchian, ctx);
    const b = modelSwing(candles, i, p.swing, ctx);
    const c = modelVCP(candles, i, p.vcp, ctx);
    const d = modelPocketPivot(candles, i, p.pocket, ctx);
    const e = modelNewHigh(candles, i, p.newHigh, ctx);
    const fired = { donchian: a.isBreakout, swing: b.isBreakout, vcp: c.isBreakout, pocket: d.isBreakout, newHigh: e.isBreakout };
    const score = (a.isBreakout ? W.donchian : 0) + (b.isBreakout ? W.swing : 0) +
        (c.isBreakout ? W.vcp : 0) + (d.isBreakout ? W.pocket : 0) + (e.isBreakout ? W.newHigh : 0);
    let level = 0;
    for (const s of [a, b, c, d, e])
        if (s.isBreakout && s.level > level)
            level = s.level;
    return { isBreakout: score >= p.minScore, score, level, fired };
}
