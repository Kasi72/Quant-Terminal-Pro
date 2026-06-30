"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectCandlePattern = detectCandlePattern;
function body(c) { return Math.abs(c.c - c.o); }
function range(c) { return c.h - c.l; }
function upperWick(c) { return c.h - Math.max(c.o, c.c); }
function lowerWick(c) { return Math.min(c.o, c.c) - c.l; }
function isBull(c) { return c.c > c.o; }
function isBear(c) { return c.c < c.o; }
function bodyMid(c) { return (c.o + c.c) / 2; }
function bodyTop(c) { return Math.max(c.o, c.c); }
function bodyBot(c) { return Math.min(c.o, c.c); }
function isDoji(c) { const r = range(c); return r > 0 && body(c) / r < 0.10; }
function isLargeBody(c) { const r = range(c); return r > 0 && body(c) / r > 0.60; }
function gapUp(a, b) { return b.o > a.h; }
function gapDn(a, b) { return b.o < a.l; }
const P = (name, short, type, strength) => ({ name, short, type, strength });
function detectCandlePattern(candles, endIdx) {
    if (endIdx < 2 || endIdx >= candles.length)
        return P('Unknown', '—', 'neutral', 1);
    const c = candles[endIdx];
    const p = candles[endIdx - 1];
    const pp = candles[endIdx - 2];
    const r = range(c);
    if (r < 0.0001)
        return P('Doji', 'DOJI', 'neutral', 2);
    const b = body(c);
    const uw = upperWick(c);
    const lw = lowerWick(c);
    const bPct = b / r;
    const uwPct = uw / r;
    const lwPct = lw / r;
    const pB = body(p);
    const pR = range(p);
    const ppB = body(pp);
    const ppR = range(pp);
    // ═══════════════════════════════════════════════════════════════════════
    // THREE CANDLE PATTERNS (check first — highest specificity)
    // ═══════════════════════════════════════════════════════════════════════
    // Three White Soldiers
    if (isBull(pp) && isBull(p) && isBull(c) && p.c > pp.c && c.c > p.c && ppB / ppR > 0.50 && pB / pR > 0.50 && bPct > 0.50 && p.o > pp.o && c.o > p.o)
        return P('Three White Soldiers', '3WS', 'bullish', 3);
    // Three Black Crows
    if (isBear(pp) && isBear(p) && isBear(c) && p.c < pp.c && c.c < p.c && ppB / ppR > 0.50 && pB / pR > 0.50 && bPct > 0.50 && p.o < pp.o && c.o < p.o)
        return P('Three Black Crows', '3BC', 'bearish', 3);
    // Morning Star
    if (isBear(pp) && isLargeBody(pp) && body(p) < ppB * 0.35 && isBull(c) && b > ppB * 0.50 && c.c > bodyMid(pp))
        return P('Morning Star', 'MRST', 'bullish', 3);
    // Evening Star
    if (isBull(pp) && isLargeBody(pp) && body(p) < ppB * 0.35 && isBear(c) && b > ppB * 0.50 && c.c < bodyMid(pp))
        return P('Evening Star', 'EVST', 'bearish', 3);
    // Abandoned Baby Bullish (gap down doji then gap up)
    if (isBear(pp) && isDoji(p) && p.h < pp.l && isBull(c) && c.l > p.h)
        return P('Abandoned Baby ↑', 'AB-U', 'bullish', 3);
    // Abandoned Baby Bearish
    if (isBull(pp) && isDoji(p) && p.l > pp.h && isBear(c) && c.h < p.l)
        return P('Abandoned Baby ↓', 'AB-D', 'bearish', 3);
    // Three Inside Up
    if (isBear(pp) && isLargeBody(pp) && isBull(p) && p.o > pp.c && p.c < pp.o && isBull(c) && c.c > pp.o)
        return P('Three Inside Up', '3IU', 'bullish', 3);
    // Three Inside Down
    if (isBull(pp) && isLargeBody(pp) && isBear(p) && p.o < pp.c && p.c > pp.o && isBear(c) && c.c < pp.o)
        return P('Three Inside Down', '3ID', 'bearish', 3);
    // Three-Line Strike Bullish (3 bull + 1 large bear that engulfs all 3)
    if (endIdx >= 3) {
        const ppp = candles[endIdx - 3];
        if (isBull(ppp) && isBull(pp) && isBull(p) && pp.c > ppp.c && p.c > pp.c && isBear(c) && c.o >= p.c && c.c <= ppp.o)
            return P('3-Line Strike ↑', '3LS', 'bullish', 3);
        if (isBear(ppp) && isBear(pp) && isBear(p) && pp.c < ppp.c && p.c < pp.c && isBull(c) && c.o <= p.c && c.c >= ppp.o)
            return P('3-Line Strike ↓', '3LD', 'bearish', 3);
    }
    // Rising Three Methods
    if (endIdx >= 4) {
        const p3 = candles[endIdx - 3];
        const p4 = candles[endIdx - 4];
        const p4B = body(p4);
        if (isBull(p4) && isLargeBody(p4) && body(p3) < p4B * 0.5 && body(pp) < p4B * 0.5 && body(p) < p4B * 0.5 && isBull(c) && c.c > p4.h)
            return P('Rising 3 Methods', 'R3M', 'bullish', 3);
        if (isBear(p4) && isLargeBody(p4) && body(p3) < p4B * 0.5 && body(pp) < p4B * 0.5 && body(p) < p4B * 0.5 && isBear(c) && c.c < p4.l)
            return P('Falling 3 Methods', 'F3M', 'bearish', 3);
    }
    // Tri-Star Bullish (3 consecutive dojis with middle gap down)
    if (isDoji(pp) && isDoji(p) && isDoji(c) && p.h < pp.l)
        return P('Tri-Star ↑', 'TS-U', 'bullish', 3);
    if (isDoji(pp) && isDoji(p) && isDoji(c) && p.l > pp.h)
        return P('Tri-Star ↓', 'TS-D', 'bearish', 3);
    // Deliberation (3 bull, 3rd has small body near high — hesitation)
    if (isBull(pp) && isBull(p) && isBull(c) && isLargeBody(pp) && isLargeBody(p) && bPct < 0.30 && c.o >= p.c * 0.99)
        return P('Deliberation', 'DLBR', 'bearish', 2);
    // Advance Block (3 bull, each with smaller body + longer upper wick)
    if (isBull(pp) && isBull(p) && isBull(c) && pB < ppB && b < pB && upperWick(p) > upperWick(pp) && uw > upperWick(p))
        return P('Advance Block', 'ADVB', 'bearish', 2);
    // Identical Three Crows
    if (isBear(pp) && isBear(p) && isBear(c) && Math.abs(p.o - pp.c) < ppR * 0.05 && Math.abs(c.o - p.c) < pR * 0.05)
        return P('Identical 3 Crows', 'I3C', 'bearish', 3);
    // Mat Hold (bull → 3 small corrections → bull continuation)
    // Simplified: large bull, small bear, small bear, small bear/doji, large bull
    if (endIdx >= 4) {
        const p3 = candles[endIdx - 3];
        const p4 = candles[endIdx - 4];
        if (isBull(p4) && isLargeBody(p4) && !isBull(p3) && !isBull(pp) && body(p3) < body(p4) * 0.4 && body(pp) < body(p4) * 0.4 && isBull(c) && c.c > p4.h)
            return P('Mat Hold', 'MATH', 'bullish', 3);
    }
    // Upside Tasuki Gap
    if (isBull(pp) && isBull(p) && gapUp(pp, p) && isBear(c) && c.o > p.o && c.c < p.o && c.c > pp.c)
        return P('Tasuki Gap ↑', 'TG-U', 'bullish', 2);
    // Downside Tasuki Gap
    if (isBear(pp) && isBear(p) && gapDn(pp, p) && isBull(c) && c.o < p.o && c.c > p.o && c.c < pp.c)
        return P('Tasuki Gap ↓', 'TG-D', 'bearish', 2);
    // Concealing Baby Swallow (4-candle: 2 marubozu bears, then gap-down, then engulf)
    // Simplified to 3-candle version
    if (isBear(pp) && ppR > 0 && ppB / ppR > 0.85 && isBear(p) && pR > 0 && pB / pR > 0.85 && isBear(c) && c.h > p.h)
        return P('Conceal Baby Swal', 'CBS', 'bullish', 3);
    // Unique Three River Bottom
    if (isBear(pp) && isLargeBody(pp) && isBear(p) && p.l < pp.l && p.c > pp.c && isBull(c) && body(c) < body(p) * 0.5)
        return P('Unique 3 River', 'U3R', 'bullish', 2);
    // Two Crows
    if (isBull(pp) && isLargeBody(pp) && isBear(p) && gapUp(pp, p) && isBear(c) && c.o > p.o && c.c < pp.c)
        return P('Two Crows', '2CRW', 'bearish', 2);
    // ═══════════════════════════════════════════════════════════════════════
    // TWO CANDLE PATTERNS
    // ═══════════════════════════════════════════════════════════════════════
    // Bullish Engulfing
    if (isBear(p) && isBull(c) && c.o <= p.c && c.c >= p.o && b > pB * 1.1)
        return P('Bullish Engulfing', 'B-EN', 'bullish', 3);
    // Bearish Engulfing
    if (isBull(p) && isBear(c) && c.o >= p.c && c.c <= p.o && b > pB * 1.1)
        return P('Bearish Engulfing', 'R-EN', 'bearish', 3);
    // Bullish Kicking (bearish marubozu → bullish marubozu with gap up)
    if (isBear(p) && pB / pR > 0.85 && isBull(c) && bPct > 0.85 && c.o > p.o)
        return P('Bullish Kicking', 'B-KK', 'bullish', 3);
    // Bearish Kicking
    if (isBull(p) && pB / pR > 0.85 && isBear(c) && bPct > 0.85 && c.o < p.o)
        return P('Bearish Kicking', 'R-KK', 'bearish', 3);
    // Piercing Line
    if (isBear(p) && isLargeBody(p) && isBull(c) && c.o < p.l && c.c > bodyMid(p) && c.c < p.o)
        return P('Piercing Line', 'PIRC', 'bullish', 2);
    // Dark Cloud Cover
    if (isBull(p) && isLargeBody(p) && isBear(c) && c.o > p.h && c.c < bodyMid(p) && c.c > p.o)
        return P('Dark Cloud Cover', 'DKCC', 'bearish', 2);
    // Bullish Harami
    if (isBear(p) && isLargeBody(p) && isBull(c) && c.o > p.c && c.c < p.o && b < pB * 0.50)
        return P('Bullish Harami', 'B-HR', 'bullish', 2);
    // Bearish Harami
    if (isBull(p) && isLargeBody(p) && isBear(c) && c.o < p.c && c.c > p.o && b < pB * 0.50)
        return P('Bearish Harami', 'R-HR', 'bearish', 2);
    // Tweezer Bottom
    if (isBear(p) && isBull(c) && Math.abs(c.l - p.l) < r * 0.03)
        return P('Tweezer Bottom', 'TWBT', 'bullish', 2);
    // Tweezer Top
    if (isBull(p) && isBear(c) && Math.abs(c.h - p.h) < r * 0.03)
        return P('Tweezer Top', 'TWTP', 'bearish', 2);
    // Bullish Counterattack
    if (isBear(p) && isLargeBody(p) && isBull(c) && isLargeBody(c) && Math.abs(c.c - p.c) < r * 0.05)
        return P('Bull Counterattack', 'B-CA', 'bullish', 2);
    // Bearish Counterattack
    if (isBull(p) && isLargeBody(p) && isBear(c) && isLargeBody(c) && Math.abs(c.c - p.c) < r * 0.05)
        return P('Bear Counterattack', 'R-CA', 'bearish', 2);
    // In-Neck Line
    if (isBear(p) && isLargeBody(p) && isBull(c) && c.o < p.l && Math.abs(c.c - p.l) < pR * 0.05)
        return P('In-Neck Line', 'INNK', 'bearish', 1);
    // On-Neck Line
    if (isBear(p) && isLargeBody(p) && isBull(c) && c.o < p.l && Math.abs(c.c - p.l) < pR * 0.10 && c.c < p.c)
        return P('On-Neck Line', 'ONNK', 'bearish', 1);
    // Thrusting Line
    if (isBear(p) && isLargeBody(p) && isBull(c) && c.o < p.l && c.c > p.c && c.c < bodyMid(p))
        return P('Thrusting Line', 'THRS', 'bearish', 1);
    // Separating Lines Bullish
    if (isBear(p) && isBull(c) && Math.abs(c.o - p.o) < pR * 0.03 && isLargeBody(c))
        return P('Separating Lines ↑', 'SP-U', 'bullish', 2);
    // Separating Lines Bearish
    if (isBull(p) && isBear(c) && Math.abs(c.o - p.o) < pR * 0.03 && isLargeBody(c))
        return P('Separating Lines ↓', 'SP-D', 'bearish', 2);
    // Meeting Lines Bullish
    if (isBear(p) && isLargeBody(p) && isBull(c) && isLargeBody(c) && Math.abs(c.c - p.c) < pR * 0.03)
        return P('Meeting Lines ↑', 'MT-U', 'bullish', 2);
    // Meeting Lines Bearish
    if (isBull(p) && isLargeBody(p) && isBear(c) && isLargeBody(c) && Math.abs(c.c - p.c) < pR * 0.03)
        return P('Meeting Lines ↓', 'MT-D', 'bearish', 2);
    // Matching Low
    if (isBear(p) && isBear(c) && Math.abs(c.c - p.c) < pR * 0.03)
        return P('Matching Low', 'MTLO', 'bullish', 2);
    // Homing Pigeon
    if (isBear(p) && isLargeBody(p) && isBear(c) && c.o < p.o && c.c > p.c && b < pB * 0.50)
        return P('Homing Pigeon', 'HMPG', 'bullish', 2);
    // ═══════════════════════════════════════════════════════════════════════
    // SINGLE CANDLE PATTERNS
    // ═══════════════════════════════════════════════════════════════════════
    // Doji variants
    if (bPct < 0.10) {
        if (lwPct > 0.60 && uwPct < 0.10)
            return P('Dragonfly Doji', 'DGDF', 'bullish', 2);
        if (uwPct > 0.60 && lwPct < 0.10)
            return P('Gravestone Doji', 'GRVD', 'bearish', 2);
        if (uwPct > 0.35 && lwPct > 0.35)
            return P('Rickshaw Man', 'RKMN', 'neutral', 2);
        if (uwPct > 0.30 && lwPct > 0.30)
            return P('Long-Legged Doji', 'LLDO', 'neutral', 2);
        return P('Doji', 'DOJI', 'neutral', 2);
    }
    // Marubozu
    if (bPct > 0.90) {
        if (isBull(c))
            return P('Bullish Marubozu', 'B-MZ', 'bullish', 3);
        return P('Bearish Marubozu', 'R-MZ', 'bearish', 3);
    }
    // Opening Marubozu (no wick on open side)
    if (isBull(c) && lwPct < 0.02 && bPct > 0.70)
        return P('Opening Marubozu ↑', 'OMZ', 'bullish', 2);
    if (isBear(c) && uwPct < 0.02 && bPct > 0.70)
        return P('Opening Marubozu ↓', 'OMD', 'bearish', 2);
    // Closing Marubozu (no wick on close side)
    if (isBull(c) && uwPct < 0.02 && bPct > 0.70)
        return P('Closing Marubozu ↑', 'CMU', 'bullish', 2);
    if (isBear(c) && lwPct < 0.02 && bPct > 0.70)
        return P('Closing Marubozu ↓', 'CMD', 'bearish', 2);
    // Belt Hold
    if (isBull(c) && lwPct < 0.03 && bPct > 0.60 && c.o === c.l)
        return P('Belt Hold ↑', 'BH-U', 'bullish', 2);
    if (isBear(c) && uwPct < 0.03 && bPct > 0.60 && c.o === c.h)
        return P('Belt Hold ↓', 'BH-D', 'bearish', 2);
    // Hammer / Hanging Man
    if (lwPct > 0.60 && uwPct < 0.10 && bPct < 0.35) {
        if (isBull(c))
            return P('Hammer', 'HAMR', 'bullish', 2);
        return P('Hanging Man', 'HNGM', 'bearish', 2);
    }
    // Inverted Hammer / Shooting Star
    if (uwPct > 0.60 && lwPct < 0.10 && bPct < 0.35) {
        if (isBull(c))
            return P('Inverted Hammer', 'IHMR', 'bullish', 2);
        return P('Shooting Star', 'SHST', 'bearish', 2);
    }
    // High Wave (very long wicks both sides, small body)
    if (bPct < 0.20 && uwPct > 0.35 && lwPct > 0.35)
        return P('High Wave', 'HIWA', 'neutral', 2);
    // Spinning Top
    if (bPct < 0.30 && uwPct > 0.25 && lwPct > 0.25)
        return P('Spinning Top', 'SPIN', 'neutral', 1);
    // Shaven Head (no upper wick)
    if (uwPct < 0.02 && bPct > 0.40 && isBear(c))
        return P('Shaven Head', 'SHVH', 'bearish', 1);
    // Shaven Bottom (no lower wick)
    if (lwPct < 0.02 && bPct > 0.40 && isBull(c))
        return P('Shaven Bottom', 'SHVB', 'bullish', 1);
    // ═══════════════════════════════════════════════════════════════════════
    // FALLBACK — basic candle type
    // ═══════════════════════════════════════════════════════════════════════
    if (isBull(c)) {
        if (bPct > 0.65 && lwPct < 0.15)
            return P('Strong Bullish', 'B-ST', 'bullish', 2);
        if (bPct > 0.45)
            return P('Bullish', 'BULL', 'bullish', 1);
        return P('Weak Bullish', 'B-WK', 'bullish', 1);
    }
    else {
        if (bPct > 0.65 && uwPct < 0.15)
            return P('Strong Bearish', 'R-ST', 'bearish', 2);
        if (bPct > 0.45)
            return P('Bearish', 'BEAR', 'bearish', 1);
        return P('Weak Bearish', 'R-WK', 'bearish', 1);
    }
}
