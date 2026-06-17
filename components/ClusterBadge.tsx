interface Props {
  passed: boolean;
  label: string;
}

export default function ClusterBadge({ passed, label }: Props) {
  return passed ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-900/60 text-emerald-300 border border-emerald-700">
      ✓ {label}
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs text-slate-600 border border-slate-700">
      – {label}
    </span>
  );
}
