import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MAX_BODY_SIZE = 10 * 1024; // 10KB

export async function POST(req: NextRequest) {
  try {
    // Guard: reject oversized request bodies
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      return NextResponse.json({ ok: false, error: 'Request body too large (max 10KB)' }, { status: 413 });
    }
    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_SIZE) {
      return NextResponse.json({ ok: false, error: 'Request body too large (max 10KB)' }, { status: 413 });
    }
    const { token, chatId, message, parseMode } = JSON.parse(rawBody);
    if (!token || !chatId || !message) {
      return NextResponse.json({ ok: false, error: 'Missing token, chatId, or message' }, { status: 400 });
    }
    if (typeof token !== 'string' || token.length > 100) {
      return NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 400 });
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: parseMode || 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(5000),
    });

    const data = await res.json();
    if (!data.ok) {
      return NextResponse.json({ ok: false, error: data.description || 'Telegram API error' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });
  }
}
