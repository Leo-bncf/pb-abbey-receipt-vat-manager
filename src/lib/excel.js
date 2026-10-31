// Styled Excel exports (ExcelJS, loaded on demand). Every sheet has a title,
// a subtitle, and a real Excel table: dark header, banded rows, filter buttons,
// a totals row, frozen header, £ and date formats, print set to fit the width.
const INK = 'FF171717';
const GREY = 'FF737373';
const RULE = 'FFE5E5E5';
const WARN = 'FFB45309';
const FONT = 'Arial';

export const FMT = {
  // Quoted £ + escaped minus: understood by Excel AND Apple Numbers (the unquoted
  // form is dropped by Numbers, which then shows "6818" with no pence).
  money: '"£"#,##0.00;[Red]\\-"£"#,##0.00',
  // Euro amounts (Carnas): same quoting rule as money, so Numbers keeps the format.
  eur: '#,##0.00\\ "€";[Red]\\-#,##0.00\\ "€"',
  number: '#,##0.00;[Red]-#,##0.00',
  int: '#,##0',
  rate: '0.00000',
  pct: '0%',
  date: 'dd/mm/yyyy',
};

export async function newWorkbook() {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PB Abbey';
  wb.created = new Date();
  return wb;
}

const toDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10))) : v);
const safeName = (s) => s.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);

function setupSheet(wb, sheet, { title, subtitle, landscape = true }) {
  const ws = wb.addWorksheet(safeName(sheet), {
    properties: { defaultRowHeight: 16 },
    pageSetup: { orientation: landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: `&L&8PB ABBEY LTD · ${title.replace(/&/g, '&&')}&R&8Page &P of &N` },
    views: [{ showGridLines: false }],
  });
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { name: FONT, size: 14, bold: true, color: { argb: INK } };
  ws.getRow(1).height = 22;
  const subs = [].concat(subtitle || []);
  subs.forEach((line, i) => {
    const c = ws.getCell(`A${2 + i}`);
    c.value = line;
    c.font = { name: FONT, size: 9, color: { argb: GREY } };
  });
  return { ws, firstRow: 2 + subs.length + 1 };
}

/**
 * A sheet with one table.
 * columns: [{ header, width, type: 'text'|'money'|'number'|'int'|'rate'|'date'|'link', total: 'sum'|'count'|undefined }]
 * rows: arrays of values in column order. type 'link' takes { text, url }.
 * notes: lines printed under the table (string, or { text, warn: true }).
 */
export function tableSheet(wb, { sheet, title, subtitle, columns, rows, totals = true, notes = [], tableName }) {
  const { ws, firstRow } = setupSheet(wb, sheet, { title, subtitle });
  columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width || 14; });
  const hasTotals = totals && rows.length > 0 && columns.some((c) => c.total);

  if (rows.length === 0) {
    const c = ws.getCell(`A${firstRow}`);
    c.value = 'Nothing for this period.';
    c.font = { name: FONT, size: 10, italic: true, color: { argb: GREY } };
  } else {
    const data = rows.map((r) => r.map((v, i) => {
      const t = columns[i].type;
      if (v === '' || v === undefined) return null;
      if (t === 'date') return toDate(v);
      if (t === 'link') return v?.text ?? null;
      return v;
    }));
    ws.addTable({
      name: (tableName || sheet).replace(/[^A-Za-z0-9]/g, '') + Math.random().toString(36).slice(2, 6),
      ref: `A${firstRow}`,
      headerRow: true,
      totalsRow: hasTotals,
      style: { theme: 'TableStyleMedium1', showRowStripes: true },
      columns: columns.map((c, i) => ({
        name: c.header,
        filterButton: true,
        ...(hasTotals ? (i === 0 ? { totalsRowLabel: 'Total' } : c.total ? { totalsRowFunction: c.total } : {}) : {}),
      })),
      rows: data,
    });
    // Formats, fonts, links.
    const last = firstRow + rows.length + (hasTotals ? 1 : 0);
    for (let r = firstRow; r <= last; r++) {
      const row = ws.getRow(r);
      row.height = r === firstRow ? 20 : 16;
      columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        cell.font = { name: FONT, size: 10, bold: r === firstRow || (hasTotals && r === last), color: r === firstRow ? { argb: 'FFFFFFFF' } : { argb: INK } };
        cell.alignment = { vertical: 'middle', horizontal: ['money', 'eur', 'number', 'int', 'rate'].includes(c.type) ? 'right' : 'left', wrapText: r === firstRow };
        if (r > firstRow && FMT[c.type]) cell.numFmt = c.type === 'int' && hasTotals && r === last ? FMT.int : FMT[c.type];
        if (r > firstRow && r < firstRow + 1 + rows.length && c.type === 'link') {
          const v = rows[r - firstRow - 1][i];
          if (v?.url) { cell.value = { text: v.text || 'Open', hyperlink: v.url }; cell.font = { name: FONT, size: 10, color: { argb: 'FF1D4ED8' }, underline: true }; }
        }
      });
    }
    ws.views = [{ state: 'frozen', ySplit: firstRow, showGridLines: false }];
    ws.pageSetup.printTitlesRow = `${firstRow}:${firstRow}`;
  }

  let n = firstRow + rows.length + (hasTotals ? 1 : 0) + 2;
  notes.forEach((note) => {
    const t = typeof note === 'string' ? { text: note } : note;
    const c = ws.getCell(`A${n++}`);
    c.value = t.text;
    c.font = { name: FONT, size: 9, color: { argb: t.warn ? WARN : GREY }, bold: !!t.warn };
  });
  return ws;
}

/**
 * Cover / summary sheet: title, subtitle lines, then blocks of label → value.
 * blocks: [{ heading, rows: [[label, value, type?, note?]] }]  type: 'money'|'int'|'text'
 * checks: [{ text, warn }] printed as a "Checks before filing" list.
 */
export function summarySheet(wb, { sheet = 'Summary', title, subtitle, blocks = [], checks = [] }) {
  const { ws, firstRow } = setupSheet(wb, sheet, { title, subtitle, landscape: false });
  ws.getColumn(1).width = 46; ws.getColumn(2).width = 18; ws.getColumn(3).width = 60;
  let r = firstRow;
  const line = (row, color = RULE) => [1, 2, 3].forEach((c) => { ws.getRow(row).getCell(c).border = { bottom: { style: 'thin', color: { argb: color } } }; });
  blocks.forEach((b) => {
    const h = ws.getCell(`A${r}`);
    h.value = b.heading.toUpperCase();
    h.font = { name: FONT, size: 9, bold: true, color: { argb: GREY } };
    line(r, INK); ws.getRow(r).height = 18;
    r++;
    b.rows.forEach(([label, value, type = 'money', note, strong]) => {
      const row = ws.getRow(r);
      row.getCell(1).value = label;
      row.getCell(1).font = { name: FONT, size: 10, bold: !!strong, color: { argb: INK } };
      row.getCell(2).value = value;
      row.getCell(2).font = { name: FONT, size: 10, bold: !!strong, color: { argb: INK } };
      row.getCell(2).alignment = { horizontal: 'right' };
      if (FMT[type]) row.getCell(2).numFmt = FMT[type];
      if (note) { row.getCell(3).value = note; row.getCell(3).font = { name: FONT, size: 9, color: { argb: GREY } }; }
      line(r); row.height = 17;
      r++;
    });
    r++;
  });
  if (checks.length) {
    const h = ws.getCell(`A${r}`);
    h.value = 'CHECKS BEFORE SENDING';
    h.font = { name: FONT, size: 9, bold: true, color: { argb: GREY } };
    line(r, INK); r++;
    checks.forEach((c) => {
      const cell = ws.getCell(`A${r}`);
      cell.value = `${c.warn ? '⚠' : '✓'}  ${c.text}`;
      cell.font = { name: FONT, size: 10, color: { argb: c.warn ? WARN : 'FF047857' } };
      ws.mergeCells(`A${r}:C${r}`);
      cell.alignment = { wrapText: true, vertical: 'top' };
      ws.getRow(r).height = c.text.length > 110 ? 30 : 17;
      r++;
    });
  }
  return ws;
}

export async function download(wb, filename) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
