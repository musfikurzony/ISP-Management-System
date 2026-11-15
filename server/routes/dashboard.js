import { currentPeriod, lastDayOfPeriod, today, v } from '../util.js';
import { runAutoBillingIfDue } from '../billing.js';

async function dashboard(ctx) {
  // Fallback for the monthly cron job: if this month's bills are due and were
  // not generated yet, generate them now. Idempotent, so it can never double-bill.
  let autoBilling = null;
  try {
    autoBilling = await runAutoBillingIfDue(ctx.db);
  } catch (e) {
    console.error('auto billing failed:', e.message);
  }

  const period = currentPeriod();
  const from = v.date({ d: ctx.query.get('from') }, 'd') || `${period}-01`;
  const to = v.date({ d: ctx.query.get('to') }, 'd') || lastDayOfPeriod(period);
  const t = today();
  // first day of the month, 11 months ago -> 12 month trend
  const d = new Date(period + '-01T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - 11);
  const trendFrom = d.toISOString().slice(0, 10);

  const db = ctx.db;
  const r = await db.batch([
    db.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(status = 'active'), 0) AS active,
              COALESCE(SUM(status = 'suspended'), 0) AS suspended,
              COALESCE(SUM(status = 'inactive'), 0) AS inactive
         FROM customers`
    ),
    db.prepare("SELECT COALESCE(SUM(total - paid_amount), 0) AS outstanding, COUNT(*) AS n FROM invoices WHERE status IN ('unpaid','partial')"),
    db.prepare("SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS n FROM payments WHERE status = 'valid' AND payment_date = ?").bind(t),
    db.prepare("SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS n FROM payments WHERE status = 'valid' AND payment_date BETWEEN ? AND ?").bind(from, to),
    db.prepare("SELECT COALESCE(SUM(amount), 0) AS amount FROM income WHERE status = 'valid' AND income_date BETWEEN ? AND ?").bind(from, to),
    db.prepare("SELECT COALESCE(SUM(amount), 0) AS amount FROM expenses WHERE status = 'valid' AND expense_date BETWEEN ? AND ?").bind(from, to),
    db.prepare("SELECT COALESCE(SUM(total), 0) AS amount, COUNT(*) AS n FROM invoices WHERE status <> 'void' AND issue_date BETWEEN ? AND ?").bind(from, to),
    db.prepare(
      `SELECT p.id, p.receipt_no, p.amount, p.method, p.payment_date, c.name AS customer_name, c.id AS customer_id, u.full_name AS collector
         FROM payments p JOIN customers c ON c.id = p.customer_id JOIN users u ON u.id = p.collected_by
        WHERE p.status = 'valid' ORDER BY p.id DESC LIMIT 8`
    ),
    db.prepare("SELECT substr(payment_date, 1, 7) AS month, SUM(amount) AS amount FROM payments WHERE status = 'valid' AND payment_date >= ? GROUP BY month").bind(trendFrom),
    db.prepare("SELECT substr(expense_date, 1, 7) AS month, SUM(amount) AS amount FROM expenses WHERE status = 'valid' AND expense_date >= ? GROUP BY month").bind(trendFrom),
    db.prepare("SELECT substr(income_date, 1, 7) AS month, SUM(amount) AS amount FROM income WHERE status = 'valid' AND income_date >= ? GROUP BY month").bind(trendFrom),
    db.prepare("SELECT substr(issue_date, 1, 7) AS month, SUM(total) AS amount FROM invoices WHERE status <> 'void' AND issue_date >= ? GROUP BY month").bind(trendFrom),
    db.prepare("SELECT method, SUM(amount) AS amount FROM payments WHERE status = 'valid' AND payment_date BETWEEN ? AND ? GROUP BY method").bind(from, to),
  ]);
  const one = (i) => r[i].results[0];
  const byMonth = (i) => Object.fromEntries(r[i].results.map((x) => [x.month, x.amount]));
  const col = byMonth(8), exp = byMonth(9), inc = byMonth(10), bill = byMonth(11);
  const trend = [];
  for (let i = 0; i < 12; i++) {
    const m = new Date(d);
    m.setUTCMonth(d.getUTCMonth() + i);
    const key = m.toISOString().slice(0, 7);
    trend.push({ month: key, collection: col[key] || 0, other_income: inc[key] || 0, expenses: exp[key] || 0, billed: bill[key] || 0 });
  }

  const collection = one(3).amount;
  const otherIncome = one(4).amount;
  return {
    range: { from, to },
    customers: one(0),
    outstanding: one(1).outstanding,
    outstanding_invoices: one(1).n,
    today_collection: one(2).amount,
    today_payments: one(2).n,
    collection,
    collection_count: one(3).n,
    other_income: otherIncome,
    income: collection + otherIncome, // bill collection + other income
    expenses: one(5).amount,
    billed: one(6).amount,
    recent_payments: r[7].results,
    trend,
    methods: r[12].results,
    auto_billing: autoBilling,
  };
}

export default [['GET', '/dashboard', 'user', dashboard]];
