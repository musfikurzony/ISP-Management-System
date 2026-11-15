// Display helpers. Money is stored in paisa (1 Taka = 100 paisa).

export function money(paisa, symbol = '৳') {
  const n = (Number(paisa) || 0) / 100;
  return symbol + ' ' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
export function plainMoney(paisa) {
  return ((Number(paisa) || 0) / 100).toFixed(2);
}
// "800" or "800.50" typed by a person -> paisa. Returns null when not a valid amount.
export function toPaisa(text) {
  if (text === '' || text === null || text === undefined) return null;
  const n = Number(String(text).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
export function fromPaisa(paisa) {
  if (paisa === null || paisa === undefined) return '';
  const n = paisa / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  bn: ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে'],
};
export function fmtDate(d, lang = 'en') {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day} ${MONTHS[lang][Number(m) - 1]} ${y}`;
}
export function fmtPeriod(p, lang = 'en') {
  if (!p) return '';
  const [y, m] = p.split('-');
  return `${MONTHS[lang][Number(m) - 1]} ${y}`;
}
// Stored timestamps are UTC; show them in Bangladesh time.
export function fmtDateTime(utc, lang = 'en') {
  if (!utc) return '';
  const d = new Date(utc.replace(' ', 'T') + 'Z');
  const local = new Date(d.getTime() + 6 * 3600 * 1000).toISOString();
  return `${fmtDate(local, lang)} ${local.slice(11, 16)}`;
}
export function todayDhaka() {
  return new Date(Date.now() + 6 * 3600 * 1000).toISOString().slice(0, 10);
}
export function monthStart(d = todayDhaka()) {
  return d.slice(0, 7) + '-01';
}
export function monthEnd(period = todayDhaka().slice(0, 7)) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// Creates and downloads a CSV file that opens correctly in Excel (including Bangla text).
export function downloadCsv(filename, columns, rows) {
  const esc = (val) => {
    let s = val === null || val === undefined ? '' : String(val);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => esc(c.csv ? c.csv(r) : r[c.key])).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
