import { HttpError, addDays, auditStmt, getSettings, likePattern, paging, today, v } from '../util.js';
import { applyCredit, generateMonthlyInvoices, periodLabel, recomputeStmts } from '../billing.js';

const STATUSES = ['unpaid', 'partial', 'paid', 'void'];

async function list(ctx) {
  const { limit, page, offset } = paging(ctx.query);
  const where = [];
  const binds = [];
  const status = ctx.query.get('status');
  if (STATUSES.includes(status)) { where.push('i.status = ?'); binds.push(status); }
  else if (status === 'open') where.push("i.status IN ('unpaid','partial')");
  else if (status === 'overdue') { where.push("i.status IN ('unpaid','partial') AND i.due_date < ?"); binds.push(today()); }
  const period = ctx.query.get('period');
  if (period && /^\d{4}-\d{2}$/.test(period)) { where.push('i.billing_period = ?'); binds.push(period); }
  const cid = parseInt(ctx.query.get('customer_id') || '', 10);
  if (cid > 0) { where.push('i.customer_id = ?'); binds.push(cid); }
  const q = ctx.query.get('q');
  if (q && q.trim()) {
    const p = likePattern(q);
    where.push(`(i.invoice_no LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR c.mobile LIKE ? ESCAPE '\\' OR c.customer_code LIKE ? ESCAPE '\\')`);
    binds.push(p, p, p, p);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const from = 'FROM invoices i JOIN customers c ON c.id = i.customer_id';
  const [rows, count] = await ctx.db.batch([
    ctx.db
      .prepare(
        `SELECT i.id, i.invoice_no, i.kind, i.billing_period, i.issue_date, i.due_date, i.total, i.paid_amount, i.status,
                c.id AS customer_id, c.name AS customer_name, c.customer_code, c.mobile
           ${from} ${w} ORDER BY i.id DESC LIMIT ? OFFSET ?`
      )
      .bind(...binds, limit, offset),
    ctx.db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(i.total),0) AS total, COALESCE(SUM(i.paid_amount),0) AS paid ${from} ${w}`).bind(...binds),
  ]);
  const c = count.results[0];
  return { invoices: rows.results, total: c.n, sum_total: c.total, sum_paid: c.paid, page, limit };
}

async function get(ctx) {
  const inv = await ctx.db
    .prepare(
      `SELECT i.*, c.name AS customer_name, c.customer_code, c.mobile, c.address, c.area, u.full_name AS created_by_name
         FROM invoices i JOIN customers c ON c.id = i.customer_id LEFT JOIN users u ON u.id = i.created_by
        WHERE i.id = ?`
    )
    .bind(ctx.params.id)
    .first();
  if (!inv) throw new HttpError(404, 'Invoice not found');
  const [items, allocs] = await ctx.db.batch([
    ctx.db.prepare('SELECT description, quantity, unit_price, amount FROM invoice_items WHERE invoice_id = ? ORDER BY id').bind(inv.id),
    ctx.db
      .prepare(
        `SELECT a.amount, p.id AS payment_id, p.receipt_no, p.payment_date, p.method
           FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
          WHERE a.invoice_id = ? AND a.released_at IS NULL AND p.status = 'valid' ORDER BY a.id`
      )
      .bind(inv.id),
  ]);
  return { invoice: inv, items: items.results, payments: allocs.results };
}

// Manual invoice: either a monthly bill for one customer and month,
// or a one-off charge (connection fee, router, cable ...).
async function create(ctx) {
  const b = ctx.body;
  const customerId = v.int(b, 'customer_id', { required: true, min: 1 });
  const kind = v.oneOf(b, 'kind', ['monthly', 'manual'], { required: true });
  const period = v.period(b, 'billing_period', { required: kind === 'monthly' });
  const issue = v.date(b, 'issue_date') || today();
  const notes = v.str(b, 'notes', { max: 500 });
  const s = await getSettings(ctx.db, ['due_days', 'invoice_prefix']);
  const due = v.date(b, 'due_date') || addDays(issue, parseInt(s.due_days, 10) || 0);
  if (due < issue) throw new HttpError(400, 'due_date: cannot be before the invoice date');

  const customer = await ctx.db
    .prepare('SELECT c.id, c.monthly_bill, p.name AS package_name FROM customers c LEFT JOIN packages p ON p.id = c.package_id WHERE c.id = ?')
    .bind(customerId)
    .first();
  if (!customer) throw new HttpError(404, 'Customer not found');

  let items;
  if (kind === 'monthly') {
    const amount = v.money(b, 'amount') ?? customer.monthly_bill;
    if (amount <= 0) throw new HttpError(400, 'amount: must be more than zero');
    const dup = await ctx.db
      .prepare("SELECT invoice_no FROM invoices WHERE customer_id = ? AND billing_period = ? AND kind = 'monthly' AND status <> 'void'")
      .bind(customerId, period)
      .first();
    if (dup) throw new HttpError(409, `This customer already has a monthly bill for ${periodLabel(period)} (${dup.invoice_no}).`);
    items = [{ description: `Internet bill - ${periodLabel(period)}${customer.package_name ? ` (${customer.package_name})` : ''}`, quantity: 1, unit_price: amount }];
  } else {
    if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 20) throw new HttpError(400, 'items: add between 1 and 20 lines');
    items = b.items.map((it) => ({
      description: v.str(it, 'description', { required: true, max: 200 }),
      quantity: v.int(it, 'quantity', { required: true, min: 1, max: 10000 }),
      unit_price: v.money(it, 'unit_price', { required: true }),
    }));
  }
  for (const it of items) it.amount = it.quantity * it.unit_price;
  const total = items.reduce((sum, it) => sum + it.amount, 0);
  if (total <= 0) throw new HttpError(400, 'The invoice total must be more than zero');

  // One transaction: invoice + its lines + invoice number + audit entry.
  const newId = "(SELECT id FROM invoices WHERE invoice_no IS NULL)";
  const results = await ctx.db.batch([
    ctx.db
      .prepare('INSERT INTO invoices (customer_id, kind, billing_period, issue_date, due_date, total, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
      .bind(customerId, kind, period, issue, due, total, notes, ctx.user.id),
    ...items.map((it) =>
      ctx.db.prepare(`INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount) VALUES (${newId}, ?, ?, ?, ?)`).bind(it.description, it.quantity, it.unit_price, it.amount)
    ),
    ctx.db
      .prepare(`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip) VALUES (?, 'invoice.create', 'invoice', ${newId}, ?, ?)`)
      .bind(ctx.user.id, JSON.stringify({ customer_id: customerId, kind, period, total }), ctx.ip),
    ctx.db.prepare("UPDATE invoices SET invoice_no = ? || printf('%06d', id) WHERE invoice_no IS NULL").bind(s.invoice_prefix || 'INV-'),
  ]);
  const id = results[0].results[0].id;
  await applyCredit(ctx.db, customerId); // use any advance the customer already paid
  return { id };
}

// Bulk monthly billing for all active customers. Safe to press more than once.
async function generate(ctx) {
  const period = v.period(ctx.body, 'billing_period', { required: true });
  const result = await generateMonthlyInvoices(ctx.db, period, { userId: ctx.user.id });
  await auditStmt(ctx, 'invoice.generate_monthly', 'billing_period', period, result).run();
  return result;
}

// Invoices are never deleted. A wrong invoice is voided; money already paid
// against it goes back to the customer's advance balance.
async function voidInvoice(ctx) {
  const reason = v.str(ctx.body, 'reason', { required: true, max: 300 });
  const inv = await ctx.db.prepare('SELECT id, customer_id, status, invoice_no, total FROM invoices WHERE id = ?').bind(ctx.params.id).first();
  if (!inv) throw new HttpError(404, 'Invoice not found');
  if (inv.status === 'void') throw new HttpError(409, 'This invoice is already void');
  await ctx.db.batch([
    ctx.db.prepare("UPDATE payment_allocations SET released_at = datetime('now') WHERE invoice_id = ? AND released_at IS NULL").bind(inv.id),
    ctx.db.prepare("UPDATE invoices SET status = 'void', void_reason = ?, voided_by = ?, voided_at = datetime('now') WHERE id = ?").bind(reason, ctx.user.id, inv.id),
    ...recomputeStmts(ctx.db, inv.customer_id),
    auditStmt(ctx, 'invoice.void', 'invoice', inv.id, { invoice_no: inv.invoice_no, total: inv.total, reason }),
  ]);
  await applyCredit(ctx.db, inv.customer_id);
  return { ok: true };
}

export default [
  ['GET', '/invoices', 'user', list],
  ['GET', '/invoices/:id', 'user', get],
  ['POST', '/invoices', 'user', create],
  ['POST', '/invoices/generate', 'admin', generate],
  ['POST', '/invoices/:id/void', 'admin', voidInvoice],
];
