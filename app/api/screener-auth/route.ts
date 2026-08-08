import { NextRequest, NextResponse } from 'next/server';
import {
  createScreenerSessionToken,
  getScreenerSessionCookieName,
  getScreenerSessionMaxAge,
  isScreenerAuthConfigured,
  isValidScreenerPassword,
} from '@/lib/screenerSession';

export async function POST(req: NextRequest) {
  if (!isScreenerAuthConfigured()) {
    return NextResponse.json({ error: 'Screener auth is not configured' }, { status: 503 });
  }

  let password: unknown;
  try {
    const body = await req.json();
    password = body?.password;
  } catch {
    return NextResponse.json({ error: 'Invalid login payload' }, { status: 400 });
  }

  if (!isValidScreenerPassword(password)) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
  }

  const token = await createScreenerSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(getScreenerSessionCookieName(), token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: getScreenerSessionMaxAge(),
    path: '/',
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(getScreenerSessionCookieName());
  return res;
}
