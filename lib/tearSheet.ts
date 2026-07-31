// ─── Trade Tear Sheet Generator (PDF + Excel) ───────────────────────────────

import {
  didReachFivePctTarget,
  getFivePctObjectivePnlPct,
  getFivePctObjectiveR,
  getTradeMaePct,
  getTradeHardStop,
  getTradeMfePct,
  getTradeRiskPerShare,
  isTerminalTrade,
  isTradeResolvedForWinRate,
  type TrackedTrade,
} from './tradeOps';
import { downloadSpreadsheetWorkbook } from './spreadsheetExport';

function safe(v: number, f = 0): number { return Number.isFinite(v) ? v : f; }

export interface TearSheetData {
  generatedDate: string;
  accountSize: number;
  riskPerTrade: number;
  // Summary
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  realizedPnlRupees: number;
  realizedPnlPct: number;
  // Trades
  trades: TearSheetTrade[];
  // Outcomes
  t1Hits: number; t1PnlPct: number;
  t2Hits: number; t2PnlPct: number;
  t3Hits: number; t3PnlPct: number;
  stopped: number; stoppedPnlPct: number;
  expired: number; expiredPnlPct: number;
}

export interface TearSheetTrade {
  num: number;
  symbol: string;
  stage: string;
  entryPrice: number;
  entryDate: string;
  stopLoss: number;
  riskPct: number;
  t1Price: number;
  t1HitDate: string;
  t1PnlPct: number;
  t2Price: number;
  t2HitDate: string;
  t2PnlPct: number;
  t3Price: number;
  t3HitDate: string;
  t3PnlPct: number;
  exitPrice: number;
  exitDate: string;
  weightedPnlPct: number;
  rMult: number;
  mfePct: number;
  maePct: number;
  daysHeld: number;
  exitModel: string;
  outcome: string;
  conviction: number;
  sector: string;
}

export function buildTearSheetData(trades: TrackedTrade[], accountSize: number): TearSheetData {
  const decided = trades.filter(isTradeResolvedForWinRate);
  const terminal = trades.filter(isTerminalTrade);
  const open = trades.filter(t => !isTerminalTrade(t));
  const wins = decided.filter(didReachFivePctTarget);
  const losses = decided.filter(t => !didReachFivePctTarget(t));
  const winRate = decided.length > 0 ? safe(wins.length / decided.length * 100) : 0;
  const totalWinR = wins.reduce((s, t) => s + safe(getFivePctObjectiveR(t)), 0);
  const totalLossR = losses.reduce((s, t) => s + Math.abs(safe(getFivePctObjectiveR(t))), 0);
  const profitFactor = totalLossR > 0 ? safe(totalWinR / totalLossR) : totalWinR > 0 ? 999 : 0;
  const expectancy = decided.length > 0 ? safe(decided.reduce((s, t) => s + safe(getFivePctObjectivePnlPct(t)), 0) / decided.length) : 0;

  const realizedPnl = terminal.reduce((s, t) => {
    const rps = getTradeRiskPerShare(t);
    const riskAmt = accountSize * 0.01;
    return s + (rps > 0 ? riskAmt * safe(t.pnlR ?? 0) : 0);
  }, 0);

  const t1Hits = trades.filter(t => t.status === 'hit_t1');
  const t2Hits = trades.filter(t => t.status === 'hit_t2');
  const t3Hits = terminal.filter(t => t.status === 'hit_t3');
  const stopped = terminal.filter(t => t.status === 'stopped');
  const expired = terminal.filter(t => t.status === 'expired');

  const tearTrades: TearSheetTrade[] = trades.map((t, i) => {
    const rps = getTradeRiskPerShare(t);
    const riskPct = t.entryPrice > 0 ? safe(rps / t.entryPrice * 100) : 0;
    const mfePct = getTradeMfePct(t);
    const unrealPnl = t.status === 'open' && t.currentPrice ? safe((t.currentPrice - t.entryPrice) / t.entryPrice * 100) : 0;
    const exitModel = t.status === 'hit_t1' ? '50% T1 + 50% BE' : t.status === 'hit_t2' ? '50% T1 + 30% T2 + 20% trail' : t.status === 'hit_t3' ? '50% T1 + 30% T2 + 20% T3' : t.status === 'stopped' ? '100% stop' : t.status === 'open' ? 'Active' : 'Market close';
    const outcome = t.status === 'open' ? 'OPEN' : t.status === 'hit_t1' ? 'T1 HIT' : t.status === 'hit_t2' ? 'T2 HIT' : t.status === 'hit_t3' ? 'T3 HIT' : t.status === 'stopped' ? 'STOPPED' : t.status === 'expired' ? 'EXPIRED' : 'CLOSED';

    return {
      num: i + 1,
      symbol: t.symbol.replace('.NS', '').replace('.BO', ''),
      stage: t.stage.replace(/_/g, ' '),
      entryPrice: t.entryPrice,
      entryDate: t.entryDate,
      stopLoss: getTradeHardStop(t),
      riskPct,
      t1Price: t.target1,
      t1HitDate: t.targetLog?.find(e => e.target === 'T1')?.date
        ?? ((t.status === 'hit_t1' || t.status === 'hit_t2' || t.status === 'hit_t3') ? (t.closedDate ?? '—') : '—'),
      t1PnlPct: t.target1 > 0 && t.entryPrice > 0 ? safe((t.target1 - t.entryPrice) / t.entryPrice * 100) : 0,
      t2Price: t.target2,
      t2HitDate: t.targetLog?.find(e => e.target === 'T2')?.date
        ?? ((t.status === 'hit_t2' || t.status === 'hit_t3') ? (t.closedDate ?? '—') : '—'),
      t2PnlPct: t.target2 > 0 && t.entryPrice > 0 ? safe((t.target2 - t.entryPrice) / t.entryPrice * 100) : 0,
      t3Price: t.target3,
      t3HitDate: t.targetLog?.find(e => e.target === 'T3')?.date
        ?? (t.status === 'hit_t3' ? (t.closedDate ?? '—') : '—'),
      t3PnlPct: t.target3 > 0 && t.entryPrice > 0 ? safe((t.target3 - t.entryPrice) / t.entryPrice * 100) : 0,
      exitPrice: t.closedPrice ?? t.currentPrice ?? 0,
      exitDate: t.closedDate ?? '—',
      weightedPnlPct: safe(t.status === 'open' ? unrealPnl : (t.pnlPct ?? unrealPnl)),
      rMult: safe(t.pnlR ?? 0),
      mfePct,
      maePct: -getTradeMaePct(t),
      daysHeld: t.daysHeld ?? 0,
      exitModel,
      outcome,
      conviction: t.conviction ?? 0,
      sector: t.sector || '—',
    };
  });

  return {
    generatedDate: new Date().toISOString().slice(0, 10),
    accountSize, riskPerTrade: 1.0,
    totalTrades: trades.length, openTrades: open.length, closedTrades: decided.length,
    wins: wins.length, losses: losses.length, winRate, profitFactor, expectancy,
    realizedPnlRupees: safe(realizedPnl), realizedPnlPct: accountSize > 0 ? safe(realizedPnl / accountSize * 100) : 0,
    trades: tearTrades,
    t1Hits: t1Hits.length, t1PnlPct: t1Hits.length > 0 ? safe(t1Hits.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / t1Hits.length) : 0,
    t2Hits: t2Hits.length, t2PnlPct: t2Hits.length > 0 ? safe(t2Hits.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / t2Hits.length) : 0,
    t3Hits: t3Hits.length, t3PnlPct: t3Hits.length > 0 ? safe(t3Hits.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / t3Hits.length) : 0,
    stopped: stopped.length, stoppedPnlPct: stopped.length > 0 ? safe(stopped.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / stopped.length) : 0,
    expired: expired.length, expiredPnlPct: expired.length > 0 ? safe(expired.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / expired.length) : 0,
  };
}

// ─── Excel Export ────────────────────────────────────────────────────────────

export async function exportTearSheetXLSX(data: TearSheetData) {
  const summary = [
    ['DR KKR QUANT TERMINAL PRO — TRADE TEAR SHEET'],
    [`Generated: ${data.generatedDate}`, `Account: ₹${data.accountSize.toLocaleString('en-IN')}`, `Risk/Trade: ${data.riskPerTrade}%`],
    [],
    ['PORTFOLIO SUMMARY'],
    ['Total Trades', data.totalTrades, 'Active', data.openTrades, '5% Decided', data.closedTrades],
    ['5% Win Rate', `${data.winRate.toFixed(1)}%`, '+5% Hits', data.wins, 'No-Hit Terminal', data.losses],
    ['Profit Factor', data.profitFactor.toFixed(2), 'Expectancy', `${data.expectancy.toFixed(2)}%`],
    ['Realized P&L', `₹${data.realizedPnlRupees.toFixed(0)}`, 'As % of Account', `${data.realizedPnlPct.toFixed(2)}%`],
    [],
    ['OUTCOME BREAKDOWN'],
    ['T1 Hits', data.t1Hits, `Avg P&L: ${data.t1PnlPct.toFixed(1)}%`],
    ['T2 Hits', data.t2Hits, `Avg P&L: ${data.t2PnlPct.toFixed(1)}%`],
    ['T3 Hits', data.t3Hits, `Avg P&L: ${data.t3PnlPct.toFixed(1)}%`],
    ['Stopped', data.stopped, `Avg P&L: ${data.stoppedPnlPct.toFixed(1)}%`],
    ['Expired', data.expired, `Avg P&L: ${data.expiredPnlPct.toFixed(1)}%`],
  ];

  const headers = ['#', 'Symbol', 'Stage', 'Entry ₹', 'Entry Date', 'Hard Stop ₹', 'Risk%', 'T1 ₹', 'T1 Hit Date', 'T1 P&L%', 'T2 ₹', 'T2 Hit Date', 'T2 P&L%', 'T3 ₹', 'T3 Hit Date', 'T3 P&L%', 'Exit ₹', 'Exit Date', 'Weighted P&L%', 'R-Mult', 'MFE%', 'MAE%', 'Days', 'Exit Model', 'Outcome', 'Conviction', 'Sector'];
  const rows = data.trades.map(t => [
    t.num, t.symbol, t.stage, t.entryPrice, t.entryDate, t.stopLoss, t.riskPct,
    t.t1Price, t.t1HitDate, t.t1PnlPct, t.t2Price, t.t2HitDate, t.t2PnlPct,
    t.t3Price, t.t3HitDate, t.t3PnlPct, t.exitPrice, t.exitDate,
    t.weightedPnlPct, t.rMult, t.mfePct, t.maePct, t.daysHeld,
    t.exitModel, t.outcome, t.conviction, t.sector,
  ]);

  downloadSpreadsheetWorkbook(`DrKKR_TearSheet_${data.generatedDate}.xls`, [
    { name: 'Summary', rows: summary },
    { name: 'Trade Log', rows: [headers, ...rows] },
  ]);
}

// ─── PDF Export ──────────────────────────────────────────────────────────────

export async function exportTearSheetPDF(data: TearSheetData) {
  let jsPDF: typeof import('jspdf')['default'], autoTable: typeof import('jspdf-autotable')['default'];
  try { jsPDF = (await import('jspdf')).default; autoTable = (await import('jspdf-autotable')).default; } catch { alert('Failed to load PDF library'); return; }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });

  // Header
  doc.setFontSize(16);
  doc.setTextColor(100, 160, 255);
  doc.text('DR KKR QUANT TERMINAL PRO - TRADE TEAR SHEET', 14, 14);
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text(`Generated: ${data.generatedDate} | Account: Rs.${data.accountSize.toLocaleString('en-IN')} | Risk/Trade: ${data.riskPerTrade}%`, 14, 20);

  // Summary KPIs
  doc.setFontSize(10);
  doc.setTextColor(200, 200, 200);
  const y = 28;
  doc.text(`Total: ${data.totalTrades} (${data.openTrades} active, ${data.closedTrades} 5% decided)`, 14, y);
  doc.text(`5% WR: ${data.winRate.toFixed(0)}% (${data.wins} hit/${data.losses} no-hit)`, 100, y);
  doc.text(`PF: ${data.profitFactor.toFixed(2)}`, 180, y);
  doc.text(`Exp: ${data.expectancy.toFixed(2)}%`, 210, y);
  doc.setTextColor(80, 220, 130);
  doc.text(`Realized: Rs.${data.realizedPnlRupees.toFixed(0)} (${data.realizedPnlPct.toFixed(2)}%)`, 250, y);

  // Outcome row
  doc.setTextColor(150, 150, 150);
  doc.setFontSize(8);
  doc.text(`T1: ${data.t1Hits} (avg ${data.t1PnlPct.toFixed(1)}%) | T2: ${data.t2Hits} (avg ${data.t2PnlPct.toFixed(1)}%) | T3: ${data.t3Hits} (avg ${data.t3PnlPct.toFixed(1)}%) | Stopped: ${data.stopped} (avg ${data.stoppedPnlPct.toFixed(1)}%) | Expired: ${data.expired}`, 14, y + 6);

  // Trade log table
  autoTable(doc, {
    startY: y + 12,
    head: [['#', 'Symbol', 'Stage', 'Entry', 'Entry Dt', 'SL', 'Risk%', 'T1', 'T1 Date', 'T1%', 'T2', 'T2 Date', 'T2%', 'Exit', 'Exit Dt', 'P&L%', 'R-Mult', 'MFE%', 'MAE%', 'Days', 'Exit Model', 'Outcome', 'Conv']],
    body: data.trades.map(t => [
      t.num, t.symbol, t.stage.slice(0, 12),
      `Rs.${t.entryPrice.toFixed(0)}`, t.entryDate, `Rs.${t.stopLoss.toFixed(0)}`, `${t.riskPct.toFixed(1)}%`,
      `Rs.${t.t1Price.toFixed(0)}`, t.t1HitDate, `${t.t1PnlPct.toFixed(1)}%`,
      `Rs.${t.t2Price.toFixed(0)}`, t.t2HitDate, `${t.t2PnlPct.toFixed(1)}%`,
      t.exitPrice > 0 ? `Rs.${t.exitPrice.toFixed(0)}` : '-', t.exitDate,
      `${t.weightedPnlPct >= 0 ? '+' : ''}${t.weightedPnlPct.toFixed(2)}%`,
      `${t.rMult >= 0 ? '+' : ''}${t.rMult.toFixed(1)}R`,
      `${t.mfePct.toFixed(1)}%`, `${t.maePct.toFixed(1)}%`, String(t.daysHeld), t.exitModel, t.outcome, String(t.conviction),
    ]),
    styles: { fontSize: 7, cellPadding: 1.5, textColor: [200, 200, 200], fillColor: [15, 23, 42] },
    headStyles: { fillColor: [30, 41, 59], textColor: [148, 163, 184], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [20, 30, 48] },
    theme: 'grid',
  });

  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);
  doc.text('Dr KKR Quant Terminal Pro v9.0 | Partial Exit Model (50% T1, 30% T2, 20% T3) | Level 3 Bar-by-bar Validation', 14, doc.internal.pageSize.getHeight() - 8);

  doc.save(`DrKKR_TearSheet_${data.generatedDate}.pdf`);
}
