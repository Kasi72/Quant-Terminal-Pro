type SpreadsheetCell = string | number | boolean | null | undefined;

export interface SpreadsheetSheet {
  name: string;
  rows: SpreadsheetCell[][];
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sheetName(name: string): string {
  return xmlEscape(name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet');
}

function cellXml(value: SpreadsheetCell): string {
  if (value == null || value === '') return '<Cell><Data ss:Type="String"></Data></Cell>';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  if (typeof value === 'boolean') {
    return `<Cell><Data ss:Type="Boolean">${value ? 1 : 0}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${xmlEscape(String(value))}</Data></Cell>`;
}

export function downloadSpreadsheetWorkbook(filename: string, sheets: SpreadsheetSheet[]) {
  const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
${sheets.map(sheet => `<Worksheet ss:Name="${sheetName(sheet.name)}"><Table>
${sheet.rows.map(row => `<Row>${row.map(cellXml).join('')}</Row>`).join('\n')}
</Table></Worksheet>`).join('\n')}
</Workbook>`;

  const blob = new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.xls') ? filename : filename.replace(/\.xlsx$/i, '.xls');
  a.click();
  URL.revokeObjectURL(a.href);
}
