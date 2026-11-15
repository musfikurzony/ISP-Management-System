// Reports return plain rows. The browser turns them into a table, a printout
// or a CSV file. Large reports are delivered in chunks of 1000 rows ("more: true").
import { HttpError, currentPeriod, lastDayOfPeriod, today, v } from '../util.js';
import { CREDIT_SQL, DUE_SQL } from './customers.js';

const CHUNK = 1000;
function offsetOf(ctx) {
  const o = parseInt(ctx.query.get('offset') || '0', 10);
  return Number.isInteger(o) && o > 0 ? o : 0;
}
async function chunk(ctx, sql, binds) {
  const offset = offsetOf(ctx);
  const res = await ctx.db.prepare(`${sql} LIMIT ? OFFSET ?`).bind(...binds, CHUNK + 1, offset).all();
  const rows = res.results.slice(0, CHUNK);
  return { rows, more: res.results.length > CHUNK, next_offset: offset + rows.length };
}
const qDate = (ctx, name) => v.date({ d: ctx.query.get(name) }, 'd');
const qPeriod = (ctx, name) => v.period({ d: ctx.query.get(name) }, 'd');

async function customers(ctx) {
  const status = ctx.query.get('status');
  const where = ['active', 'suspended', 'inactive'].includes(status) ? 'WHERE c.status = ?' : '';
  return chunk(
    ctx,
    `SELECT c.customer_code, c.name, c.mobile, c.area, c.address, p.name AS package_name, c.monthly_bill,
            c.connection_type, c.username, c.connection_date, c.status, ${DUE_SQL} AS due
       FROM customers c LEFT JOIN packages p ON p.id = c.package_id ${where} ORDER BY c.id`,
    where ? [status] : []
  );
}

async function monthlyBilling(ctx) {
  const period = qPeriod(ctx, 'period') || currentPeriod();
  const data = await chunk(
    ctx,
    `SELECT i.invoice_no, c.customer_code, c.name, c.mobile, c.area, i.kind, i.issue_date, i.due_date,
            i.total, i.paid_amount, i.total - i.paid_amount AS due, i.status
       FROM invoices i JOIN customers c ON c.id = i.customer_id
      WHERE i.status <> 'void' AND (i.billing_period = ?1 OR (i.billing_period IS NULL AND substr(i.issue_date, 1, 7) = ?1))
      ORDER BY i.id`,
    [period]
  );
  return { period, ...data };
}

async function dailyCollection(ctx) {
  const date = qDate(ctx, 'date') || today();
  const data = await chunk(
    ctx,
    `SELECT p.receipt_no, c.customer_code, c.name, c.mobile, p.method, p.reference, p.amount,
            CASE WHEN p.verified = 1 THEN 'yes' ELSE 'no' END AS verified, u.full_name AS collector
       FROM payments p JOIN customers c ON c.id = p.customer_id JOIN users u ON u.id = p.collected_by
      WHERE p.status = 'valid' AND p.payment_date = ? ORDER BY p.id`,
    [date]
  );
  let summary = null;
  if (offsetOf(ctx) === 0) {
    const [m, c] = await ctx.db.batch([
      ctx.db.prepare("SELECT method AS label, COUNT(*) AS n, SUM(amount) AS amount FROM payments WHERE status = 'valid' AND payment_date = ? GROUP BY method").bind(date),
      ctx.db.prepare("SELECT u.full_name AS label, COUNT(*) AS n, SUM(p.amount) AS amount FROM payments p JOIN users u ON u.id = p.collected_by WHERE p.status = 'valid' AND p.payment_date = ? GROUP BY u.id").bind(date),
    ]);
    summary = { by_method: m.results, by_collector: c.results };
  }
  return { date, summary, ...data };
}

async function monthlyCollection(ctx) {
  const month = qPeriod(ctx, 'month') || currentPeriod();
  const res = await ctx.db
    .prepare(
      `SELECT payment_date, COUNT(*) AS payments,
              SUM(CASE WHEN method = 'cash' THEN amount ELSE 0 END) AS cash,
              SUM(CASE WHEN method = 'bkash' THEN amount ELSE 0 END) AS bkash,
              SUM(CASE WHEN method = 'nagad' THEN amount ELSE 0 END) AS nagad,
              SUM(CASE WHEN method = 'rocket' THEN amount ELSE 0 END) AS rocket,
              SUM(CASE WHEN method = 'bank' THEN amount ELSE 0 END) AS bank,
              SUM(CASE WHEN method = 'other' THEN amount ELSE 0 END) AS other,
              SUM(amount) AS total
         FROM payments WHERE status = 'valid' AND payment_date BETWEEN ? AND ?
        GROUP BY payment_date ORDER BY payment_date`
    )
    .bind(`${month}-01`, lastDayOfPeriod(month))
    .all();
  return { month, rows: res.results, more: false };
}

async function outstanding(ctx) {
  const area = ctx.query.get('area');
  const binds = [today()];
  let extra = '';
  if (area) { extra = 'AND c.area = ?'; binds.push(area.slice(0, 80)); }
  return chunk(
    ctx,
    `SELECT c.customer_code, c.name, c.mobile, c.area, c.status, COUNT(i.id) AS unpaid_invoices,
            MIN(i.due_date) AS oldest_due_date,
            CAST(julianday(?) - julianday(MIN(i.due_date)) AS INTEGER) AS days_overdue,
            SUM(i.total - i.paid_amount) AS due
       FROM invoices i JOIN customers c ON c.id = i.customer_id
      WHERE i.status IN ('unpaid','partial') ${extra}
      GROUP BY c.id ORDER BY due DESC`,
    binds
  );
}

async function incomeExpense(ctx) {
  const period = currentPeriod();
  const from = qDate(ctx, 'from') || `${period}-01`;
  const to = qDate(ctx, 'to') || lastDayOfPeriod(period);
  if (to < from) throw new HttpError(400, 'to: must be after the start date');
  const db = ctx.db;
  const [col, inc, exp] = await db.batch([
    db.prepare("SELECT method AS category, COUNT(*) AS entries, SUM(amount) AS amount FROM payments WHERE status = 'valid' AND payment_date BETWEEN ? AND ? GROUP BY method ORDER BY amount DESC").bind(from, to),
    db.prepare("SELECT category, COUNT(*) AS entries, SUM(amount) AS amount FROM income WHERE status = 'valid' AND income_date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC").bind(from, to),
    db.prepare("SELECT category, COUNT(*) AS entries, SUM(amount) AS amount FROM expenses WHERE status = 'valid' AND expense_date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC").bind(from, to),
  ]);
  const sum = (r) => r.results.reduce((s, x) => s + x.amount, 0);
  const rows = [
    ...col.results.map((x) => ({ type: 'collection', ...x })),
    ...inc.results.map((x) => ({ type: 'income', ...x })),
    ...exp.results.map((x) => ({ type: 'expense', ...x })),
  ];
  const totals = { collection: sum(col), other_income: sum(inc), expenses: sum(exp) };
  totals.net = totals.collection + totals.other_income - totals.expenses;
  return { from, to, rows, totals, more: false };
}

export default [
  ['GET', '/reports/customers', 'user', customers],
  ['GET', '/reports/monthly-billing', 'user', monthlyBilling],
  ['GET', '/reports/daily-collection', 'user', dailyCollection],
  ['GET', '/reports/monthly-collection', 'user', monthlyCollection],
  ['GET', '/reports/outstanding', 'user', outstanding],
  ['GET', '/reports/income-expense', 'user', incomeExpense],
];
