import type { NextRequest } from 'next/server';

const SESSION_COOKIE = 'screener_auth';
const SESSION_VERSION = 'v1';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function sessionSecret(): string | null {
  return process.env.SCREENER_SESSION_SECRET || process.env.SCREENER_PASSWORD || null;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomTokenBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function hmacSha256(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return encodeBase64Url(new Uint8Array(sig));
}

function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const max = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < max; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export function getScreenerSessionCookieName(): string {
  return SESSION_COOKIE;
}

export function getScreenerSessionMaxAge(): number {
  return SESSION_MAX_AGE_SECONDS;
}

export function isScreenerAuthConfigured(): boolean {
  return !!process.env.SCREENER_PASSWORD && !!sessionSecret();
}

export function isLegacyPasswordCookie(value: string): boolean {
  const password = process.env.SCREENER_PASSWORD;
  return !!password && constantTimeEqual(value, password);
}

export function isValidScreenerPassword(value: unknown): boolean {
  const password = process.env.SCREENER_PASSWORD;
  return typeof value === 'string' && !!password && constantTimeEqual(value, password);
}

export async function createScreenerSessionToken(nowMs = Date.now()): Promise<string> {
  const secret = sessionSecret();
  if (!secret || !process.env.SCREENER_PASSWORD) {
    throw new Error('Screener auth is not configured');
  }
  const expiresAt = nowMs + SESSION_MAX_AGE_SECONDS * 1000;
  const nonce = encodeBase64Url(randomTokenBytes(18));
  const payload = `${SESSION_VERSION}.${expiresAt}.${nonce}`;
  const sig = await hmacSha256(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyScreenerSessionToken(value: string | undefined | null, nowMs = Date.now()): Promise<boolean> {
  if (!value || !isScreenerAuthConfigured()) return false;
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== SESSION_VERSION) {
    return false;
  }
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return false;
  const payload = `${parts[0]}.${parts[1]}.${parts[2]}`;
  const secret = sessionSecret();
  if (!secret) return false;
  const expected = await hmacSha256(secret, payload);
  return constantTimeEqual(parts[3], expected);
}

export async function isAuthorizedScreenerRequest(req: Pick<NextRequest, 'cookies'>): Promise<boolean> {
  const value = req.cookies.get(SESSION_COOKIE)?.value;
  if (await verifyScreenerSessionToken(value)) return true;

  // Temporary compatibility for users who still have the old password-valued
  // cookie. The next successful login replaces it with a signed opaque token.
  return !!value && isLegacyPasswordCookie(value);
}
