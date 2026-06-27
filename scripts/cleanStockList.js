const XLSX = require('xlsx');
const https = require('https');
const fs = require('fs');

const wb = XLSX.readFile('C:/Users/drkkr/Downloads/28th june (1).xls');
const ws = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(ws, {header:1});

// Extract all stock symbols from column 1 (skip headers)
const allSymbols = data.slice(2).map(r => r?.[1]).filter(v => v && typeof v === 'string' && v.trim().length > 1).map(v => v.trim().toUpperCase());
console.log(`Total symbols in file: ${allSymbols.length}`);

// Known renamed stocks mapping (old → new)
const RENAMED = {
  'GMRINFRA': 'GMRAIRPORT', 'LTI': 'LTIM', 'PVR': 'PVRINOX', 'MOTHERSUMI': 'MOTHERSON',
  'TATAMETALI': 'TATAMETALIK', 'SRTRANSFIN': 'SHRIRAMFIN', 'MINDAIND': 'UNOMINDA',
  'WABCOINDIA': 'ZAGGLE', 'INOXLEISUR': 'PVRINOX', 'WELSPUNIND': 'WELSPUNLIV',
  'UJJIVAN': 'UJJIVANSFB', 'JUBILANT': 'JUBLFOOD', 'ISEC': 'ABORIGINAL',
  'TATACOFFEE': 'TATACONSUMER', 'ANGELBRKG': 'ANGELONE', 'BURGERKING': 'RBA',
  'SUVENPHAR': 'SUVENPHARM', 'ZOMATO': 'ETERNAL', 'KALPATPOWR': 'KALPATPOWER',
  'PHILIPCARB': 'PCBL', 'STRTECH': 'STLTECH', 'MAHINDCIE': 'CIEINDIA',
  'COSMOFILMS': 'COSMOSFIRST', 'DEEPIND': 'DEEPINDS', 'GATI': 'ALLCARGO',
  'GEPIL': 'GRINFRA', 'TV18BRDCST': 'NW18', 'MAXVIL': 'NEXUSSEL',
  'ORIENTABRA': 'ORIENTBELL', 'INDSWFTLTD': 'INDOSTAR', 'DAAWAT': 'KRBL',
  'INFIBEAM': 'IAGL', 'NIITTECH': 'COFORGE', 'NXTDIGITAL': 'HINDWARE',
  'TATAMTRDVR': 'TATAMOTORS', 'PEL': 'POONAWALLA', 'SWANENERGY': 'SWSOLAR',
  'TATASTLBSL': 'TATASTEEL', 'TATASTLLP': 'TATASTEEL', 'JSLHISAR': 'JSWSTEEL',
  'BOROSIL': 'BOROSILREN', 'LINCPEN': 'LINC', 'IIFLSEC': 'IIFL',
  'IIFLWAM': 'IIFLSEC360', 'PAPERPROD': 'SSPAPER', 'SEQUENT': 'SEQUENTSCIEN',
  'HIL': 'HILTON', 'SMLISUZU': 'SMLISUZU', 'TIPSINDLTD': 'TIPSINDUSTRIES',
  'RBL': 'RBLBANK', 'SELAN': 'SELANEXP', 'MAGMA': 'PNBHOUSING',
  'LAXMIMACH': 'LAXMIMACHI', 'GSCLCEMENT': 'HEIDELBERG', 'GSKCONS': 'HALEON',
  'TCLCONS': 'TATACONSUM', 'TCNSBRANDS': 'TCNS', 'ADORWELD': 'ADORWELDING',
  'SHRIRAMEPC': 'SHRIRAMFIN', 'SHRIRAMCIT': 'SHRIRAMFIN', 'MANGCHEFER': 'MMTC',
  'SUNCLAYLTD': 'SUNDARAM', 'IPAPPM': 'IPCA', 'EXCEL': 'EXCELINDUS',
  'DEEPENR': 'DEEPENERGY', 'GLS': 'GLENMARK', 'ATLANTA': 'ATLANTAINFRA',
  'SATINDLTD': 'SATIA', 'UCALFUEL': 'UCAL',
};

// Known ETF/Index/Forex patterns to exclude
const ETF_PATTERNS = /ETF$|^ICICI[A-Z]{3,}$|^HDFC[A-Z]{3,}ETF$|^UTI[A-Z]{3,}$|^IDBI[A-Z]{3,}$|^KOTAK[A-Z]{3,}$|^NETF|^IBMF|GOLD$|NIFTY|SENSX|SENSEX|^M50$|^M100$|^N100$|NV20$|NXT50$|LOVOL$|MCAP$|NF100$/;
const FOREX_PATTERNS = /^[A-Z]{3}USD|^XAG|^XAU|FOREX/;

// Known delisted (confirmed gone, not renamed)
const DELISTED = new Set(['ALOKTEXT','BINANIIND','CIMMCO','STAMPEDE','IBULISL','JUMPNET','ORTINLABSS','SMSLIFE','SORILINFRA','SPYL','YAARI','WEIZFOREX','MEGASOFT','HOVS','HOTELEELA','GOLDSHARE','GALLISPAT','CHROMATIC','CAREERP','BHAGYAPROP','ARROWTEX','AUTOLITIND','ADHUNIKIND','CESCVENT','CLNINDIA','CNOVAPETRO','DFMFOODS','ESSELPACK','GTNIND','HARITASEAT','JMTAUTOLTD','LSIL','MAXINDIA','MUKANDENGG','NBVENTURES','OISL','OMMETALS','ORIENTBANK','PRESSMN','PRABHAT','RANEENGINE','REVATHI','SELMCL','SEPOWER','SHREYAS','SRIPIPES','SUPPETRO','SUNDARMHLD','TIMESGTY','TWL','BINDALAGRO','GANESHHOUC','SABTN','SONAMCLOCK','URAVI','KBCGLOBAL','PDSMFL','AEGISCHEM','AIONJSW','AKZOINDIA','CENTURYTEX','TATAMTRDVR','MRO-TEK','GODHANJ']);

let cleaned = [];
let removed = { etf: 0, forex: 0, delisted: 0, renamed: 0 };

for (const sym of allSymbols) {
  if (sym === 'STOCK') continue; // header
  if (FOREX_PATTERNS.test(sym)) { removed.forex++; continue; }
  if (ETF_PATTERNS.test(sym)) { removed.etf++; continue; }
  if (DELISTED.has(sym)) { removed.delisted++; continue; }
  if (RENAMED[sym]) {
    cleaned.push(RENAMED[sym]);
    removed.renamed++;
    continue;
  }
  cleaned.push(sym);
}

// Deduplicate
cleaned = [...new Set(cleaned)];

console.log(`\nCleaning summary:`);
console.log(`  ETFs/Index funds removed: ${removed.etf}`);
console.log(`  Forex/Commodity removed: ${removed.forex}`);
console.log(`  Delisted/defunct removed: ${removed.delisted}`);
console.log(`  Renamed → new symbol: ${removed.renamed}`);
console.log(`  Final clean list: ${cleaned.length} stocks`);

// Write clean CSV
const csv = 'Symbol\n' + cleaned.join('\n') + '\n';
fs.writeFileSync('C:/Users/drkkr/Downloads/Clean_NSE_Stocks_2026.csv', csv);
console.log(`\nSaved: C:/Users/drkkr/Downloads/Clean_NSE_Stocks_2026.csv`);
console.log(`First 20: ${cleaned.slice(0, 20).join(', ')}`);
