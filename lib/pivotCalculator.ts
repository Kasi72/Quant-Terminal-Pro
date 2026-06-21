// ─── Pivot Point Calculator — 5 Methods + Confluence Detection ───────────────

interface Candle { ts: number; o: number; h: number; l: number; c: number; v: number; }

function tick(p: number): number { return Math.round(p * 20) / 20; }

// ═══════════════════════════════════════════════════════════════════════════════
// PIVOT LEVELS
// ═══════════════════════════════════════════════════════════════════════════════

export interface PivotLevels {
  method: string;
  pp: number;
  r1: number; r2: number; r3: number; r4?: number;
  s1: number; s2: number; s3: number; s4?: number;
}

// #1: Classic / Floor (most widely used globally)
export function classicPivots(h: number, l: number, c: number): PivotLevels {
  const pp = tick((h + l + c) / 3);
  return {
    method: 'Classic',
    pp,
    r1: tick(2 * pp - l),
    r2: tick(pp + (h - l)),
    r3: tick(h + 2 * (pp - l)),
    s1: tick(2 * pp - h),
    s2: tick(pp - (h - l)),
    s3: tick(l - 2 * (h - pp)),
  };
}

// #2: Fibonacci (institutional — uses Fib ratios from range)
export function fibonacciPivots(h: number, l: number, c: number): PivotLevels {
  const pp = tick((h + l + c) / 3);
  const range = h - l;
  return {
    method: 'Fibonacci',
    pp,
    r1: tick(pp + 0.382 * range),
    r2: tick(pp + 0.618 * range),
    r3: tick(pp + 1.000 * range),
    s1: tick(pp - 0.382 * range),
    s2: tick(pp - 0.618 * range),
    s3: tick(pp - 1.000 * range),
  };
}

// #3: Woodie (gives 2x weight to close — favors trend continuation)
export function woodiePivots(h: number, l: number, c: number): PivotLevels {
  const pp = tick((h + l + 2 * c) / 4);
  return {
    method: 'Woodie',
    pp,
    r1: tick(2 * pp - l),
    r2: tick(pp + (h - l)),
    r3: tick(h + 2 * (pp - l)),
    s1: tick(2 * pp - h),
    s2: tick(pp - (h - l)),
    s3: tick(l - 2 * (h - pp)),
  };
}

// #4: Camarilla (day-trading — tight levels from close)
export function camarillaPivots(h: number, l: number, c: number): PivotLevels {
  const pp = tick((h + l + c) / 3);
  const range = h - l;
  return {
    method: 'Camarilla',
    pp,
    r1: tick(c + 1.1 * range / 12),
    r2: tick(c + 1.1 * range / 6),
    r3: tick(c + 1.1 * range / 4),
    r4: tick(c + 1.1 * range / 2),
    s1: tick(c - 1.1 * range / 12),
    s2: tick(c - 1.1 * range / 6),
    s3: tick(c - 1.1 * range / 4),
    s4: tick(c - 1.1 * range / 2),
  };
}

// #5: DeMark (trend-aware — different formula based on open vs close relationship)
export function demarkPivots(h: number, l: number, c: number, o: number): PivotLevels {
  let x: number;
  if (c < o) x = h + 2 * l + c;
  else if (c > o) x = 2 * h + l + c;
  else x = h + l + 2 * c;
  const pp = tick(x / 4);
  return {
    method: 'DeMark',
    pp,
    r1: tick(x / 2 - l),
    r2: 0, r3: 0,
    s1: tick(x / 2 - h),
    s2: 0, s3: 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPUTE ALL 5 METHODS FROM CANDLES
// ═══════════════════════════════════════════════════════════════════════════════

export interface AllPivots {
  classic: PivotLevels;
  fibonacci: PivotLevels;
  woodie: PivotLevels;
  camarilla: PivotLevels;
  demark: PivotLevels;
  cmp: number;
  position: string;          // "Between PP and R1", "Above R3", etc.
  nextResistance: { level: string; price: number; distance: number } | null;
  nextSupport: { level: string; price: number; distance: number } | null;
  confluence: ConfluenceZone[];
}

export function computeAllPivots(candles: Candle[]): AllPivots | null {
  if (candles.length < 2) return null;
  const prev = candles[candles.length - 2];
  const curr = candles[candles.length - 1];
  if (!prev || prev.h <= 0) return null;

  const h = prev.h, l = prev.l, c = prev.c, o = prev.o;
  const cmp = curr.c;

  const classic = classicPivots(h, l, c);
  const fibonacci = fibonacciPivots(h, l, c);
  const woodie = woodiePivots(h, l, c);
  const camarilla = camarillaPivots(h, l, c);
  const demark = demarkPivots(h, l, c, o);

  // Determine CMP position relative to classic pivots
  const levels = [
    { label: 'S3', price: classic.s3 },
    { label: 'S2', price: classic.s2 },
    { label: 'S1', price: classic.s1 },
    { label: 'PP', price: classic.pp },
    { label: 'R1', price: classic.r1 },
    { label: 'R2', price: classic.r2 },
    { label: 'R3', price: classic.r3 },
  ];

  let position = 'Below S3';
  let nextResistance: AllPivots['nextResistance'] = null;
  let nextSupport: AllPivots['nextSupport'] = null;

  for (let i = 0; i < levels.length; i++) {
    if (cmp < levels[i].price) {
      position = i === 0 ? 'Below S3' : `Between ${levels[i - 1].label} and ${levels[i].label}`;
      nextResistance = { level: levels[i].label, price: levels[i].price, distance: levels[i].price - cmp };
      if (i > 0) nextSupport = { level: levels[i - 1].label, price: levels[i - 1].price, distance: cmp - levels[i - 1].price };
      break;
    }
    if (i === levels.length - 1) {
      position = 'Above R3';
      nextSupport = { level: levels[i].label, price: levels[i].price, distance: cmp - levels[i].price };
    }
  }

  const confluence = detectConfluence([classic, fibonacci, woodie, camarilla], cmp);

  return { classic, fibonacci, woodie, camarilla, demark, cmp, position, nextResistance, nextSupport, confluence };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFLUENCE DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

export interface ConfluenceZone {
  price: number;
  width: number;           // spread of the cluster
  levels: Array<{ method: string; level: string; price: number }>;
  type: 'resistance' | 'support';
  strength: number;        // number of methods agreeing
  distanceFromCMP: number;
  relevance: 'immediate' | 'near' | 'distant';
}

function detectConfluence(allPivots: PivotLevels[], cmp: number): ConfluenceZone[] {
  // Collect all non-zero levels
  const allLevels: Array<{ method: string; level: string; price: number }> = [];
  for (const p of allPivots) {
    if (p.pp > 0) allLevels.push({ method: p.method, level: 'PP', price: p.pp });
    if (p.r1 > 0) allLevels.push({ method: p.method, level: 'R1', price: p.r1 });
    if (p.r2 > 0) allLevels.push({ method: p.method, level: 'R2', price: p.r2 });
    if (p.r3 > 0) allLevels.push({ method: p.method, level: 'R3', price: p.r3 });
    if (p.r4 && p.r4 > 0) allLevels.push({ method: p.method, level: 'R4', price: p.r4 });
    if (p.s1 > 0) allLevels.push({ method: p.method, level: 'S1', price: p.s1 });
    if (p.s2 > 0) allLevels.push({ method: p.method, level: 'S2', price: p.s2 });
    if (p.s3 > 0) allLevels.push({ method: p.method, level: 'S3', price: p.s3 });
    if (p.s4 && p.s4 > 0) allLevels.push({ method: p.method, level: 'S4', price: p.s4 });
  }

  // Sort by price
  allLevels.sort((a, b) => a.price - b.price);

  // Cluster levels within 0.3% of each other
  const tolerance = cmp * 0.003;
  const clusters: ConfluenceZone[] = [];
  const used = new Set<number>();

  for (let i = 0; i < allLevels.length; i++) {
    if (used.has(i)) continue;
    const cluster: typeof allLevels = [allLevels[i]];
    used.add(i);

    for (let j = i + 1; j < allLevels.length; j++) {
      if (used.has(j)) continue;
      if (Math.abs(allLevels[j].price - allLevels[i].price) <= tolerance) {
        cluster.push(allLevels[j]);
        used.add(j);
      }
    }

    if (cluster.length >= 2) {
      const avgPrice = cluster.reduce((s, l) => s + l.price, 0) / cluster.length;
      const minP = Math.min(...cluster.map(l => l.price));
      const maxP = Math.max(...cluster.map(l => l.price));
      const dist = avgPrice - cmp;
      const absDist = Math.abs(dist);
      const pctDist = cmp > 0 ? (absDist / cmp) * 100 : 0;

      clusters.push({
        price: tick(avgPrice),
        width: tick(maxP - minP),
        levels: cluster,
        type: avgPrice > cmp ? 'resistance' : 'support',
        strength: cluster.length,
        distanceFromCMP: tick(dist),
        relevance: pctDist <= 1 ? 'immediate' : pctDist <= 3 ? 'near' : 'distant',
      });
    }
  }

  return clusters.sort((a, b) => Math.abs(a.distanceFromCMP) - Math.abs(b.distanceFromCMP));
}

// ═══════════════════════════════════════════════════════════════════════════════
// TARGET vs PIVOT WARNING
// ═══════════════════════════════════════════════════════════════════════════════

export interface PivotWarning {
  target: string;      // T1, T2, SL
  targetPrice: number;
  nearestPivot: string;
  pivotPrice: number;
  distance: number;
  warning: string;
}

export function checkTargetPivotConflict(
  entry: number, sl: number, t1: number, t2: number,
  pivots: AllPivots
): PivotWarning[] {
  const warnings: PivotWarning[] = [];
  const tolerance = entry * 0.003;

  // All resistance levels above entry
  const resistances = pivots.confluence
    .filter(c => c.type === 'resistance' && c.price > entry)
    .sort((a, b) => a.price - b.price);

  // All support levels below entry
  const supports = pivots.confluence
    .filter(c => c.type === 'support' && c.price < entry)
    .sort((a, b) => b.price - a.price);

  // Check if T1 is near a resistance confluence
  for (const r of resistances) {
    if (t1 > 0 && Math.abs(t1 - r.price) <= tolerance) {
      warnings.push({
        target: 'T1', targetPrice: t1,
        nearestPivot: r.levels.map(l => `${l.method} ${l.level}`).join(', '),
        pivotPrice: r.price,
        distance: t1 - r.price,
        warning: `T1 near ${r.strength}-method resistance cluster at ₹${r.price} — price may stall`,
      });
    }
    if (t2 > 0 && Math.abs(t2 - r.price) <= tolerance) {
      warnings.push({
        target: 'T2', targetPrice: t2,
        nearestPivot: r.levels.map(l => `${l.method} ${l.level}`).join(', '),
        pivotPrice: r.price,
        distance: t2 - r.price,
        warning: `T2 coincides with resistance at ₹${r.price}`,
      });
    }
  }

  // Check if SL is near/below a support confluence (good — protected)
  for (const s of supports) {
    if (sl > 0 && sl >= s.price - tolerance && sl <= s.price + tolerance) {
      warnings.push({
        target: 'SL', targetPrice: sl,
        nearestPivot: s.levels.map(l => `${l.method} ${l.level}`).join(', '),
        pivotPrice: s.price,
        distance: sl - s.price,
        warning: `Stop protected by ${s.strength}-method support at ₹${s.price}`,
      });
    }
  }

  return warnings;
}
