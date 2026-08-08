"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NSE_SYMBOL_ALIASES = void 0;
exports.splitExchangeSuffix = splitExchangeSuffix;
exports.canonicalNseSymbolBase = canonicalNseSymbolBase;
exports.canonicalNseSymbol = canonicalNseSymbol;
exports.getSymbolAlias = getSymbolAlias;
// NSE symbol changes that can still appear in presets, saved trades, old OHLCV
// filenames, or user-pasted CSVs. Keep this list conservative: only map when NSE
// has an explicit old-symbol -> new-symbol change and the new symbol is active.
exports.NSE_SYMBOL_ALIASES = [
    { from: 'AKZOINDIA', to: 'JSWDULUX', effectiveDate: '2026-04-15', reason: 'Akzo Nobel India Limited -> JSW Dulux Limited' },
    { from: 'AMIORG', to: 'ACUTAAS', effectiveDate: '2025-06-02', reason: 'Ami Organics Limited -> Acutaas Chemicals Limited' },
    { from: 'AMIRCHAND', to: 'AEROPLANE', effectiveDate: '2026-07-20', reason: 'Amir Chand Jagdish Kumar (Exports) Limited -> Aeroplane' },
    { from: 'CREATIVE', to: 'CNL', effectiveDate: '2025-12-10', reason: 'Creative Newtech Limited -> CNL' },
    { from: 'GAL', to: 'SHAH', effectiveDate: '2023-07-03', reason: 'Shah Metacorp Limited' },
    { from: 'GUJGASLTD', to: 'GUJENERGY', effectiveDate: '2026-07-01', reason: 'Gujarat Gas Limited -> Gujarat Energy Limited' },
    { from: 'HSIL', to: 'AGI', effectiveDate: '2022-05-11', reason: 'HSIL Limited -> AGI Greenpac Limited' },
    { from: 'IBREALEST', to: 'EMBDL', effectiveDate: '2024-07-08', reason: 'Indiabulls Real Estate -> Embassy Developments Limited' },
    { from: 'LYPSAGEMS', to: 'AURUS', effectiveDate: '2026-07-14', reason: 'Lypsa Gems -> Aurus Gem Corporation Limited' },
    { from: 'MIRCELECTR', to: 'ONIDA', effectiveDate: '2026-06-19', reason: 'MIRC Electronics Limited -> Onida Electronics Limited' },
    { from: 'SAH', to: 'AERONEU', effectiveDate: '2025-08-22', reason: 'Sah Polymers Limited -> Aeroflex Neu Limited' },
    { from: 'SASTASUNDR', to: 'HEALTHX', effectiveDate: '2026-04-30', reason: 'Sastasundar Ventures Limited -> Health X Platform Limited' },
    { from: 'SEQUENT', to: 'VIYASH', effectiveDate: '2026-01-23', reason: 'Sequent Scientific Limited -> Viyash Scientific Limited' },
    { from: 'SUVENPHAR', to: 'COHANCE', effectiveDate: '2025-05-19', reason: 'Suven Pharmaceuticals Limited -> Cohance Lifesciences Limited' },
    { from: 'TATAMOTORS', to: 'TMPV', effectiveDate: '2025-10-24', reason: 'Tata Motors Limited -> Tata Motors Passenger Vehicles Limited' },
    { from: 'TRIL', to: 'TARIL', effectiveDate: '2024-08-26', reason: 'Transformers And Rectifiers (India) Limited -> TARIL' },
    { from: 'VISASTEEL', to: 'VISACHROME', effectiveDate: '2026-05-20', reason: 'VISA Steel Limited -> VISA Chrome Limited' },
    { from: 'WORTH', to: 'WORTHPERI', effectiveDate: '2025-10-10', reason: 'Worth Peripherals Limited' },
    { from: 'ZOMATO', to: 'ETERNAL', effectiveDate: '2025-04-09', reason: 'Zomato Limited -> Eternal Limited' },
];
const ALIAS_MAP = new Map(exports.NSE_SYMBOL_ALIASES.map(a => [a.from, a.to]));
function splitExchangeSuffix(symbol) {
    const clean = symbol.trim().toUpperCase();
    const match = clean.match(/^(.*?)(\.(?:NS|BO))$/);
    if (!match)
        return { base: clean, suffix: '' };
    return { base: match[1], suffix: match[2] };
}
function canonicalNseSymbolBase(symbol) {
    let current = splitExchangeSuffix(symbol).base;
    const seen = new Set();
    for (let i = 0; i < 8; i++) {
        if (seen.has(current))
            break;
        seen.add(current);
        const next = ALIAS_MAP.get(current);
        if (!next || next === current)
            break;
        current = next;
    }
    return current;
}
function canonicalNseSymbol(symbol) {
    const { base, suffix } = splitExchangeSuffix(symbol);
    if (!base || base.startsWith('^'))
        return symbol.trim().toUpperCase();
    return `${canonicalNseSymbolBase(base)}${suffix}`;
}
function getSymbolAlias(symbol) {
    const base = splitExchangeSuffix(symbol).base;
    return exports.NSE_SYMBOL_ALIASES.find(a => a.from === base);
}
