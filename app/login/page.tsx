'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const password = formData.get('password');
    if (typeof password !== 'string' || password.length === 0) {
      setError('Enter the password.');
      return;
    }

    setBusy(true);
    setError('');
    const res = await fetch('/api/screener-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.push('/');
    } else {
      setError('Incorrect password.');
      setBusy(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0f172a', fontFamily: 'system-ui, sans-serif',
    }}>
      <form onSubmit={submit} style={{
        background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
        padding: '40px 48px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 320,
      }}>
        <div style={{ color: '#94a3b8', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          Quant Terminal Pro
        </div>
        <div style={{ color: '#f1f5f9', fontSize: 18, fontWeight: 600 }}>Access required</div>
        <input
          name="password"
          type="password"
          placeholder="Password"
          required
          autoComplete="current-password"
          autoFocus
          style={{
            background: '#0f172a', border: '1px solid #334155', borderRadius: 6,
            padding: '10px 14px', color: '#f1f5f9', fontSize: 14, outline: 'none',
          }}
        />
        {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}
        <button
          type="submit"
          disabled={busy}
          style={{
            background: busy ? '#334155' : '#6366f1', color: '#f1f5f9',
            border: 'none', borderRadius: 6, padding: '10px 0',
            fontSize: 14, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Checking…' : 'Enter'}
        </button>
      </form>
    </div>
  );
}
