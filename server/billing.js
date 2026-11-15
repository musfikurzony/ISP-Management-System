// Core billing rules. Used by the API and by the optional scheduled (cron) worker.

import { addDays, currentPeriod, getSettings, lastDayOfPeriod, today } from './util.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function periodLabel(period) {
  const [y, m] = period.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

// Two statements that bring every invoice of one customer back in line with
// the payments actually allocated to it. Safe to run any number of times.
export function recomputeStmts(db, customerId) {
  return [
    db
      .prepare(
        `UPDATE invoices SET paid_amount = (
           SELECT COALESCE(SUM(a.amount), 0)
             FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
            WHERE a.invoice_id = invoices.id AND a.released_at IS NULL AND p.status = 'valid')
         WHERE customer_id = ?`
      )
      .bind(customerId),
    db
      .prepare(
        `UPDATE invoices SET status = CASE
             WHEN paid_amount >= total THEN 'paid'
             WHEN paid_amount > 0 THEN 'partial'
             ELSE 'unpaid' END
         WHERE customer_id = ? AND status <> 'void'`
      )
      .bind(customerId),
  ];
}

// Unused money (advance) a customer has, listed per payment.
async function freePayments(db, customerId) {
  const res = await db
    .prepare(
      `SELECT p.id, p.amount - COALESCE((
           SELECT SUM(a.amount) FROM payment_allocations a
            WHERE a.payment_id = p.id AND a.released_at IS NULL), 0) AS free
         FROM payments p
        WHERE p.customer_id = ? AND p.status = 'valid'
        ORDER BY p.id`
    )
    .bind(customerId)
    .all();
  return res.results.filter((r) => r.free > 0);
}

export async function openInvoices(db, customerId) {
  const res = await db
    .prepare(
      `SELECT id, invoice_no, total, paid_amount, total - paid_amount AS due, due_date, billing_period, kind
         FROM invoices
        WHERE customer_id = ? AND status IN ('unpaid', 'partial')
        ORDER BY due_date, id`
    )
    .bind(customerId)
    .all();
  return res.results;
}

// Guarded allocation: it is only saved if the invoice still has that much due,
// so an invoice can never be paid twice even if two people work at once.
export function allocationStmt(db, paymentIdSql, paymentBind, invoiceId, amount) {
  return db
    .prepare(
      `INSERT INTO payment_allocations (payment_id, invoice_id, amount)
       SELECT ${paymentIdSql}, ?, ?
        WHERE (SELECT total - paid_amount FROM invoices WHERE id = ? AND status IN ('unpaid', 'partial')) >= ?`
    )
    .bind(...paymentBind, invoiceId, amount, invoiceId, amount);
}

// Uses a customer's advance balance to pay their oldest unpaid invoices.
export async function applyCredit(db, customerId) {
  const [pays, invs] = await Promise.all([freePayments(db, customerId), openInvoices(db, customerId)]);
  if (!pays.length || !invs.length) return 0;
  const stmts = [];
  let applied = 0;
  let pi = 0;
  for (const inv of invs) {
    let due = inv.due;
    while (due > 0 && pi < pays.length) {
      const use = Math.min(due, pays[pi].free);
      stmts.push(allocationStmt(db, '?', [pays[pi].id], inv.id, use));
      // keep paid_amount current so the next guarded insert sees the right due
      stmts.push(db.prepare('UPDATE invoices SET paid_amount = paid_amount + ? WHERE id = ? AND changes() > 0').bind(use, inv.id));
      due -= use;
      pays[pi].free -= use;
      applied += use;
      if (pays[pi].free === 0) pi++;
    }
    if (pi >= pays.length) break;
  }
  if (stmts.length) await db.batch([...stmts, ...recomputeStmts(db, customerId)]);
  return applied;
}

// Creates the monthly bill for every active customer for one billing period.
// IDEMPOTENT: running it again for the same period creates nothing new, because
// the database has a unique rule (customer + period) and we use INSERT OR IGNORE.
export async function generateMonthlyInvoices(db, period, { userId = null, issueDate = null } = {}) {
  const s = await getSettings(db, ['billing_day', 'due_days', 'invoice_prefix']);
  const billingDay = Math.min(Math.max(parseInt(s.billing_day, 10) || 1, 1), 28);
  const dueDays = Math.min(Math.max(parseInt(s.due_days, 10) || 0, 0), 60);
  const issue = issueDate || `${period}-${String(billingDay).padStart(2, '0')}`;
  const due = addDays(issue, dueDays);
  const label = periodLabel(period);

  const results = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO invoices (customer_id, kind, billing_period, issue_date, due_date, total, created_by)
         SELECT id, 'monthly', ?, ?, ?, monthly_bill, ?
           FROM customers
          WHERE status = 'active' AND monthly_bill > 0 AND connection_date <= ?`
      )
      .bind(period, issue, due, userId, lastDayOfPeriod(period)),
    db
      .prepare(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
         SELECT i.id, 'Internet bill - ' || ? || COALESCE(' (' || p.name || ')', ''), 1, i.total, i.total
           FROM invoices i
           JOIN customers c ON c.id = i.customer_id
           LEFT JOIN packages p ON p.id = c.package_id
          WHERE i.invoice_no IS NULL`
      )
      .bind(label),
    db.prepare(`UPDATE invoices SET invoice_no = ? || printf('%06d', id) WHERE invoice_no IS NULL`).bind(s.invoice_prefix || 'INV-'),
  ]);
  const created = results[0].meta.changes || 0;

  // Customers who paid in advance: use that money for the new bill.
  let creditApplied = 0;
  if (created > 0) {
    const withCredit = await db
      .prepare(
        `SELECT DISTINCT p.customer_id AS id
           FROM payments p
          WHERE p.status = 'valid'
            AND p.amount > COALESCE((SELECT SUM(a.amount) FROM payment_allocations a
                                      WHERE a.payment_id = p.id AND a.released_at IS NULL), 0)
            AND EXISTS (SELECT 1 FROM invoices i
                         WHERE i.customer_id = p.customer_id AND i.status IN ('unpaid', 'partial'))`
      )
      .all();
    for (const row of withCredit.results) creditApplied += await applyCredit(db, row.id);
  }
  return { period, created, creditApplied, issueDate: issue, dueDate: due };
}

// Runs the automatic monthly billing once per period, on or after the billing day.
// Called by the scheduled worker and also (as a fallback) when the dashboard opens.
export async function runAutoBillingIfDue(db) {
  const s = await getSettings(db, ['auto_billing', 'billing_day', 'auto_billing_last_period']);
  if (s.auto_billing !== '1') return null;
  const period = currentPeriod();
  if (s.auto_billing_last_period === period) return null;
  const billingDay = Math.min(Math.max(parseInt(s.billing_day, 10) || 1, 1), 28);
  if (parseInt(today().slice(8, 10), 10) < billingDay) return null;

  const result = await generateMonthlyInvoices(db, period);
  await db.batch([
    db
      .prepare(
        `INSERT INTO settings (key, value) VALUES ('auto_billing_last_period', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      )
      .bind(period),
    db
      .prepare("INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (NULL, 'invoice.auto_generate', 'billing_period', ?, ?)")
      .bind(period, JSON.stringify(result)),
  ]);
  return result;
}
