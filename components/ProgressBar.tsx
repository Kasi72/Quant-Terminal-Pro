'use client';

interface Props {
  processed: number;
  total: number;
  status: string;
}

export default function ProgressBar({ processed, total, status }: Props) {
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-300 font-medium">
          {status === 'done' ? '✅ Scan complete' : status === 'error' ? '❌ Error' : `Scanning stocks…`}
        </span>
        <span className="text-indigo-300 font-mono font-semibold">
          {processed} / {total} &nbsp;({pct}%)
        </span>
      </div>
      <div className="h-2.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
