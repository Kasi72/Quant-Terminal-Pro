import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabaseServer';
import { isAuthorizedScreenerRequest } from '@/lib/screenerSession';
import { isPlausibleTrade, rowToTrade, tradeToRow, TRADE_USER_ID } from '@/lib/tradeCodec';
import type { TrackedTrade } from '@/lib/tradeOps';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2_000_000;
const MAX_TRADES = 500;

async function requireAuth(req: NextRequest): Promise<NextResponse | null> {
  return await isAuthorizedScreenerRequest(req)
    ? null
    : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

async function requireOwnerToken(req: NextRequest): Promise<NextResponse | null> {
  const ownerToken = process.env.OWNER_TOKEN;
  if (!ownerToken) return null; // not configured — no restriction
  const provided = req.headers.get('x-owner-token') ?? '';
  if (provided !== ownerToken) {
    return NextResponse.json({ error: 'Owner token required' }, { status: 403 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  const db = getServiceClient();
  const { data, error } = await db
    .from('tracked_trades')
    .select('*')
    .eq('user_id', TRADE_USER_ID)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trades: (data ?? []).map(rowToTrade) });
}

export async function PUT(req: NextRequest) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  const declaredLength = Number(req.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  let body: { trades?: TrackedTrade[] };
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    body = JSON.parse(raw) as { trades?: TrackedTrade[] };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const trades = body.trades;
  if (!Array.isArray(trades)) return NextResponse.json({ error: 'Invalid trades payload' }, { status: 400 });
  if (trades.length > MAX_TRADES) return NextResponse.json({ error: 'Too many trades' }, { status: 413 });

  // Store every valid trade even when some are invalid: rejecting the whole batch for one bad
  // record silently blocked every later save. Rejected ids are returned so the client keeps them.
  const valid: TrackedTrade[] = [];
  const rejected: { id: string | null; symbol: string | null; reason: string }[] = [];
  for (const t of trades) {
    const reason = !t || typeof t !== 'object' ? 'not an object'
      : typeof t.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(t.id) ? 'missing or invalid id'
      : !isPlausibleTrade(t) ? 'failed validation (prices, dates, targets or stops out of range)'
      : null;
    if (reason) rejected.push({ id: typeof t?.id === 'string' ? t.id : null, symbol: typeof t?.symbol === 'string' ? t.symbol : null, reason });
    else valid.push(t);
  }

  if (valid.length > 0) {
    const db = getServiceClient();
    const { error } = await db
      .from('tracked_trades')
      .upsert(valid.map(tradeToRow), { onConflict: 'id', ignoreDuplicates: false });
    if (error) return NextResponse.json({ error: error.message, rejected }, { status: 500 });
  }

  return NextResponse.json({ ok: rejected.length === 0, stored: valid.map(t => t.id), rejected });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAuth(req);
  if (denied) return denied;
  const ownerDenied = await requireOwnerToken(req);
  if (ownerDenied) return ownerDenied;

  const tradeId = req.nextUrl.searchParams.get('id');
  const symbol = req.nextUrl.searchParams.get('symbol');
  const db = getServiceClient();
  let query = db.from('tracked_trades').delete().eq('user_id', TRADE_USER_ID);
  if (tradeId) {
    if (!/^[0-9a-f-]{36}$/.test(tradeId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    query = query.eq('id', tradeId);
  } else if (symbol) {
    if (!/^[A-Z0-9._&-]{1,30}$/.test(symbol)) {
      return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 });
    }
    query = query.eq('symbol', symbol);
  }

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
