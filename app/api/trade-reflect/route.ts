import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { symbol, status, pnlPct, stage, entryDate, closedDate, daysHeld, mfePct, maePct } =
    body as {
      symbol?: string; status?: string; pnlPct?: number; stage?: string;
      entryDate?: string; closedDate?: string; daysHeld?: number;
      mfePct?: number; maePct?: number;
    };

  const userPrompt = `You are a trading coach reviewing a completed trade. Give a concise, actionable reflection in 3-4 sentences: what likely drove the outcome, what this setup's statistical edge looks like, and one key process lesson for next time.

Trade details:
- Symbol: ${symbol ?? 'N/A'}, Setup stage: ${stage ?? 'N/A'}
- Entry: ${entryDate ?? '?'}, Exit: ${closedDate ?? 'still open'}
- Days held: ${daysHeld ?? 'N/A'}, Outcome: ${status ?? '?'}
- P&L: ${pnlPct != null ? (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(1) + '%' : 'N/A'}
- MFE (max gain): ${mfePct != null ? '+' + mfePct.toFixed(1) + '%' : 'N/A'}, MAE (max loss): ${maePct != null ? maePct.toFixed(1) + '%' : 'N/A'}

Be direct. Focus on process and edge, not just outcome.`;

  let anthropicRes: Response;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 350,
        stream: true,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Anthropic request failed' }), { status: 502 });
  }

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text().catch(() => '');
    return new Response(JSON.stringify({ error: errText || 'Anthropic error' }), {
      status: anthropicRes.status,
    });
  }

  return new Response(anthropicRes.body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    },
  });
}
