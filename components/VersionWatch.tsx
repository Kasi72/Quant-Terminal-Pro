'use client';

import { useEffect, useState } from 'react';

const CHECK_EVERY_MS = 5 * 60 * 1000;

// Next.js never reloads an open tab after a deploy, so fixes stay invisible until a manual
// refresh. Compare this bundle's build id with the server's and offer a reload when they differ.
export default function VersionWatch() {
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    const mine = process.env.NEXT_PUBLIC_BUILD_ID;
    if (!mine) return;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const { buildId } = await res.json() as { buildId: string | null };
        if (buildId && buildId !== mine) setOutdated(true);
      } catch { /* offline: try again later */ }
    };
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', check);
    check();
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', check); };
  }, []);

  if (!outdated) return null;
  return (
    <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 rounded-lg border border-sky-700 bg-slate-900/95 px-4 py-2 text-sm text-sky-200 shadow-lg">
      <span>A new version of the screener is live.</span>
      <button
        onClick={() => window.location.reload()}
        className="rounded bg-sky-600 px-3 py-1 font-semibold text-white hover:bg-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
      >
        Reload
      </button>
    </div>
  );
}
