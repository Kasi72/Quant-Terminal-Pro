'use client';

import { Download } from 'lucide-react';
import { exportCSV, exportXLSX, exportPDF } from '@/lib/export';
import type { ScreeningResult } from '@/lib/types';

interface Props {
  rows: ScreeningResult[];
}

export default function ExportButtons({ rows }: Props) {
  if (!rows.length) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-slate-400 text-sm mr-1">Export:</span>
      <button
        onClick={() => exportCSV(rows)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium rounded-lg transition-colors"
      >
        <Download size={13} /> CSV
      </button>
      <button
        onClick={() => exportXLSX(rows)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 text-emerald-100 text-xs font-medium rounded-lg transition-colors"
      >
        <Download size={13} /> XLSX
      </button>
      <button
        onClick={() => exportPDF(rows)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900 hover:bg-red-800 text-red-100 text-xs font-medium rounded-lg transition-colors"
      >
        <Download size={13} /> PDF
      </button>
    </div>
  );
}
