import { NextRequest } from 'next/server';

export const runtime = 'edge';

function groqToAnthropicStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buf = '';
  return body.pipeThrough(new TransformStream({
    transform(chunk, ctrl) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6); if (raw === '[DONE]') continue;
        try {
          const j = JSON.parse(raw);
          const text = j.choices?.[0]?.delta?.content;
          if (text) ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`));
        } catch {}
      }
    }
  }));
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }), {
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

  let groqRes: Response;
  try {
    groqRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'stealth/space-bunny-alpha',
        max_tokens: 350,
        stream: true,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Groq request failed' }), { status: 502 });
  }

  if (!groqRes.ok) {
    const errText = await groqRes.text().catch(() => '');
    return new Response(JSON.stringify({ error: errText || 'Groq error' }), { status: groqRes.status });
  }

  return new Response(groqToAnthropicStream(groqRes.body!), {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' },
  });
}
