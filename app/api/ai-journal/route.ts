import { NextRequest } from 'next/server';

export const runtime = 'edge';

async function streamFromAnthropic(apiKey: string, prompt: string, maxTokens = 500): Promise<Response> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      stream: true,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    return new Response(JSON.stringify({ error: err || 'Anthropic error' }), { status: res.status });
  }
  return new Response(res.body, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' },
  });
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), { status: 503 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }); }

  const mode = body.mode as string;

  // ── Coach Report ──────────────────────────────────────────────────────────
  if (mode === 'coach_report') {
    const stats = body.stats as { totalTrades: number; wr: number; pf: number; avgPnl: number; avgWin: number; avgLoss: number; streakInfo: string; topSector: string; worstSector: string; bestStage: string; avgHold: number };
    const recentTrades = (body.recentTrades as { symbol: string; stage: string; status: string; pnlPct: number; daysHeld: number }[]) ?? [];
    const period = body.period as string ?? 'last 30 days';

    const tradeSummary = recentTrades.slice(0, 20).map(t =>
      `${t.symbol} [${t.stage}] → ${t.status} ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(1)}% (${t.daysHeld}d)`
    ).join('\n');

    const prompt = `You are an elite trading coach reviewing a trader's journal for ${period}.

PERFORMANCE SUMMARY:
- Total trades: ${stats.totalTrades}, Win rate: ${(stats.wr * 100).toFixed(1)}%
- Profit factor: ${stats.pf.toFixed(2)}, Avg P&L: ${stats.avgPnl.toFixed(2)}%
- Avg winner: +${stats.avgWin.toFixed(1)}%, Avg loser: ${stats.avgLoss.toFixed(1)}%
- Current streak: ${stats.streakInfo}
- Best sector: ${stats.topSector}, Worst sector: ${stats.worstSector}
- Best stage: ${stats.bestStage}, Avg hold: ${stats.avgHold.toFixed(1)}d

RECENT TRADES:
${tradeSummary || 'No recent trades.'}

Write a concise coaching report with:
1. **Overall Assessment** (2 sentences on performance quality)
2. **Top 2 Strengths** (bullet points with specific evidence from the data)
3. **Top 2 Weaknesses** (bullet points — be direct, name the problem clearly)
4. **Process Adjustments** (2-3 actionable changes for next month)
5. **One Key Focus** (the single most important thing to improve)

Be direct, evidence-based. No fluff.`;

    return streamFromAnthropic(apiKey, prompt, 700);
  }

  // ── Synthesize Lessons ────────────────────────────────────────────────────
  if (mode === 'synthesize_lessons') {
    const notes = (body.notes as string[]) ?? [];
    const reviews = (body.reviews as { symbol: string; outcome: string; lessons: string }[]) ?? [];

    const reviewText = reviews.map(r => `${r.symbol} (${r.outcome}): ${r.lessons}`).join('\n');
    const notesText = notes.filter(Boolean).join('\n');

    const prompt = `You are a trading coach synthesizing a trader's journal entries into key lessons.

TRADE NOTES:
${notesText || '(none)'}

TRADE REVIEWS:
${reviewText || '(none)'}

Analyze ALL entries and output:
1. **Top 5 Recurring Lessons** (patterns that appear multiple times — rank by frequency)
2. **2 Blind Spots** (things the trader keeps doing wrong but hasn't explicitly identified)
3. **1 Contrarian Insight** (something positive hiding in what looks negative, or vice versa)

Be surgical. Reference specific patterns you see. Under 350 words.`;

    return streamFromAnthropic(apiKey, prompt, 500);
  }

  // ── Grade Trade ───────────────────────────────────────────────────────────
  if (mode === 'grade_trade') {
    const t = body.trade as { symbol: string; stage: string; status: string; pnlPct: number; daysHeld: number; mfePct: number; maePct: number; conviction: number; notes: string };

    const prompt = `Grade this trade on PROCESS quality (A/B/C/D) — not outcome.

Trade: ${t.symbol} [${t.stage}]
Entry conviction: ${t.conviction ?? 'N/A'}/10
Result: ${t.status}, P&L: ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct?.toFixed(1)}%
MFE: +${t.mfePct?.toFixed(1)}%, MAE: ${t.maePct?.toFixed(1)}%
Days held: ${t.daysHeld}d
Notes: ${t.notes || 'none'}

Grading criteria:
- A: Good entry, held through volatility, exited near optimal, matches setup stage
- B: Good entry OR good exit, but not both; minor process slip
- C: Entered late, exited early/late, poor conviction alignment
- D: Broke process rules, revenge trade signals, ignored MAE warning

Reply in EXACTLY this format:
GRADE: [A/B/C/D]
REASON: [one sentence on the decisive process factor]
EDGE_USED: [yes/no — did they use their statistical edge correctly?]`;

    return streamFromAnthropic(apiKey, prompt, 150);
  }

  // ── Explain Missed Signal ─────────────────────────────────────────────────
  if (mode === 'explain_missed') {
    const sig = body.signal as { symbol: string; event_date: string; uc_score: number; best_stage: string; outcome_pct_5d: number | null; hit_t1: boolean | null };

    const prompt = `A trading system flagged this as a strong UC (Umbrella Candle) breakout signal that was NOT taken:

Symbol: ${sig.symbol}
Date: ${sig.event_date}
UC Score: ${sig.uc_score?.toFixed(1)}/100
Best Stage: ${sig.best_stage}
5-day outcome: ${sig.outcome_pct_5d != null ? (sig.outcome_pct_5d >= 0 ? '+' : '') + sig.outcome_pct_5d.toFixed(1) + '%' : 'unknown'}
T1 target hit: ${sig.hit_t1 === true ? 'Yes' : sig.hit_t1 === false ? 'No' : 'Unknown'}

As a trading coach:
1. Explain in 2 sentences WHY this signal was statistically strong (what the UC score and stage imply)
2. Give ONE specific chart characteristic to look for on future ${sig.symbol} signals
3. If outcome was positive and signal was missed: what was the opportunity cost lesson?

Under 150 words.`;

    return streamFromAnthropic(apiKey, prompt, 250);
  }

  // ── Natural Language Search ───────────────────────────────────────────────
  if (mode === 'search_trades') {
    const query = body.query as string;
    const tradeSummaries = (body.trades as { symbol: string; stage: string; status: string; pnlPct: number; daysHeld: number; sector: string; entryDate: string; mfePct: number; maePct: number; notes: string }[]) ?? [];

    const tradeList = tradeSummaries.map((t, i) =>
      `[${i}] ${t.symbol} ${t.entryDate} [${t.stage}/${t.sector}] ${t.status} ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct?.toFixed(1)}% MFE:+${t.mfePct?.toFixed(1)}% MAE:${t.maePct?.toFixed(1)}% ${t.daysHeld}d${t.notes ? ' "' + t.notes.slice(0, 60) + '"' : ''}`
    ).join('\n');

    const prompt = `A trader wants to find specific trades using natural language. Answer the query using ONLY the trade data provided.

QUERY: "${query}"

TRADES:
${tradeList || '(no trades)'}

Return ONLY a JSON array of matching trade indices (e.g. [0, 3, 7]) with a one-line explanation.
Format: {"indices": [0, 3], "reason": "Trades where MFE exceeded 5% but P&L was negative — exit too early pattern"}

If no matches: {"indices": [], "reason": "No trades match this criteria"}`;

    return streamFromAnthropic(apiKey, prompt, 200);
  }

  // ── Streak Advisor ────────────────────────────────────────────────────────
  if (mode === 'streak_advice') {
    const streak = body.streak as number;
    const streakTrades = (body.streakTrades as { symbol: string; stage: string; status: string; pnlPct: number; daysHeld: number; maePct: number }[]) ?? [];

    const tradeList = streakTrades.map(t =>
      `${t.symbol} [${t.stage}] ${t.status} ${t.pnlPct.toFixed(1)}% MAE:${t.maePct?.toFixed(1)}% (${t.daysHeld}d)`
    ).join('\n');

    const prompt = `A trader is on a ${Math.abs(streak)}-trade losing streak. As their risk manager, analyse the streak and give protective guidance.

LOSING TRADES:
${tradeList}

Provide:
1. **Pattern in the losses** (1 sentence — what's going wrong: timing, stage selection, sector, hold time?)
2. **Immediate action** (1 specific rule change: position sizing, stage filter, or pause threshold)
3. **Recovery checklist** (3 bullet points to run before the next trade)

Be firm. Under 200 words. No fluff.`;

    return streamFromAnthropic(apiKey, prompt, 350);
  }

  return new Response(JSON.stringify({ error: `Unknown mode: ${mode}` }), { status: 400 });
}
