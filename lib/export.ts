import type { ScreeningResult } from './types';

// Allow derived rows (with extra fields like tier, win_rate, stop_loss, target)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExportRow = any;

export function exportCSV(rows: ExportRow[], filename = 'screener_results.csv') {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]) as (keyof ScreeningResult)[];
  const header = keys.join(',');
  const body = rows.map((r) =>
    keys.map((k) => {
      const v = r[k];
      return typeof v === 'string' && v.includes(',') ? `"${v}"` : String(v ?? '');
    }).join(',')
  ).join('\n');
  download(`${header}\n${body}`, filename, 'text/csv');
}

export async function exportXLSX(rows: ExportRow[], filename = 'screener_results.xlsx') {
  const XLSX = (await import('xlsx')).default;
  const wb = XLSX.utils.book_new();

  const clusters: { name: string; filter: (r: ScreeningResult) => boolean }[] = [
    { name: 'All Results', filter: () => true },
    { name: 'Deployable 20+', filter: (r) => r.passed_deployable },
    { name: 'HighPrecision 15+', filter: (r) => r.passed_high_precision },
    { name: 'Elite 10+', filter: (r) => r.passed_elite },
    { name: 'UltraSelective 8+', filter: (r) => r.passed_ultra_selective },
    { name: 'ORS-Prime Reversal', filter: (r) => !!r.passed_ors_prime },
  ];

  for (const { name, filter } of clusters) {
    const data = rows.filter(filter);
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }

  XLSX.writeFile(wb, filename);
}

export async function exportPDF(rows: ExportRow[], filename = 'screener_results.pdf') {
  const jsPDF = (await import('jspdf')).default;
  await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  doc.setFontSize(14);
  doc.text('Stock Momentum Screener Results', 14, 15);
  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toLocaleString()}  |  ${rows.length} stocks`, 14, 22);

  const cols = [
    'Symbol', 'Close', 'Date', 'ZoneLen', 'Tight%', 'Vol/Pre5',
    'CloseLoc', 'UPS', 'RSI2', 'D20+', 'HP15+', 'E10+', 'US8+', 'ORS↩', '#',
  ];

  const body = rows.map((r) => [
    r.symbol,
    r.last_close?.toFixed(2) ?? '-',
    r.last_date ?? '-',
    r.compression_zone_len ?? '-',
    r.zone_tightness_pct?.toFixed(1) ?? '-',
    r.exact_vol_vs_pre5?.toFixed(2) ?? '-',
    r.close_loc?.toFixed(1) ?? '-',
    r.ultra_precision_score?.toFixed(0) ?? '-',
    r.rsi2?.toFixed(1) ?? '-',
    r.passed_deployable ? '✓' : '–',
    r.passed_high_precision ? '✓' : '–',
    r.passed_elite ? '✓' : '–',
    r.passed_ultra_selective ? '✓' : '–',
    r.passed_ors_prime ? (r.ors_confirmed ? '✓✓' : '✓') : '–',
    r.clusters_passed,
  ]);

  // @ts-expect-error jspdf-autotable augments jsPDF prototype
  doc.autoTable({
    head: [cols],
    body,
    startY: 27,
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    didParseCell: (data: { section: string; row: { raw: (string | number)[] }; cell: { styles: { fillColor: number[] | false } } }) => {
      if (data.section === 'body') {
        const cp = Number(data.row.raw[14]);
        if (cp >= 5) data.cell.styles.fillColor = [168, 85, 247];  // purple = ORS+breakout combo
        else if (cp === 4) data.cell.styles.fillColor = [255, 215, 0];
        else if (cp === 3) data.cell.styles.fillColor = [251, 146, 60];
        else if (cp === 2) data.cell.styles.fillColor = [20, 184, 166];
        else if (cp === 1) data.cell.styles.fillColor = [96, 165, 250];
        else data.cell.styles.fillColor = false;
      }
    },
  });

  doc.save(filename);
}

function download(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
