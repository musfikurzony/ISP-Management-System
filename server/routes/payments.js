import { HttpError, auditStmt, getSettings, likePattern, paging, today, v } from '../util.js';
import { allocationStmt, openInvoices, recomputeStmts } from '../billing.js';

export const METHODS = ['cash', 'bkash', 'nagad', 'rocket', 'bank', 'other'];
const NEW_PAYMENT = '(SELECT id FROM payments WHERE receipt_no IS NULL)';

async function list(ctx) {
  const { limit, page, offset } = paging(ctx.query);
  const where = [];
  const binds = [];
  const from = v.date({ d: ctx.query.get('from') }, 'd');
  const to = v.date({ d: ctx.query.get('to') }, 'd');
  if (from) { where.push('p.payment_date >= ?'); binds.push(from); }
  if (to) { where.push('p.payment_date <= ?'); binds.push(to); }
  const collector = parseInt(ctx.query.get('collector') || '', 10);
  if (collector > 0) { where.push('p.collected_by = ?'); binds.push(collector); }
  const method = ctx.query.get('method');
  if (METHODS.includes(method)) { where.push('p.method = ?'); binds.push(method); }
  const status = ctx.query.get('status');
  if (status === 'valid' || status === 'reversed') { where.push('p.status = ?'); binds.push(status); }
  if (ctx.query.get('unverified') === '1') where.push("p.verified = 0 AND p.status = 'valid'");
  const cid = parseInt(ctx.query.get('customer_id') || '', 10);
  if (cid > 0) { where.push('p.customer_id = ?'); binds.push(cid); }
  const q = ctx.query.get('q');
  if (q && q.trim()) {
    const p = likePattern(q);
    where.push(`(p.receipt_no LIKE ? ESCAPE '\\' OR p.reference LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR c.mobile LIKE ? ESCAPE '\\' OR c.customer_code LIKE ? ESCAPE '\\')`);
    binds.push(p, p, p, p, p);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const base = 'FROM payments p JOIN customers c ON c.id = p.customer_id JOIN users u ON u.id = p.collected_by';
  const [rows, count] = await ctx.db.batch([
    ctx.db
      .prepare(
        `SELECT p.id, p.receipt_no, p.amount, p.method, p.reference, p.payment_date, p.status, p.verified,
                c.id AS customer_id, c.name AS customer_name, c.customer_code, u.full_name AS collector
           ${base} ${w} ORDER BY p.id DESC LIMIT ? OFFSET ?`
      )
      .bind(...binds, limit, offset),
    ctx.db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN p.status = 'valid' THEN p.amount ELSE 0 END), 0) AS amount ${base} ${w}`).bind(...binds),
  ]);
  return { payments: rows.results, total: count.results[0].n, sum_amount: count.results[0].amount, page, limit };
}

async function collectors(ctx) {
  const res = await ctx.db.prepare('SELECT id, full_name FROM users ORDER BY full_name').all();
  return { collectors: res.results };
}

// Everything the "record payment" screen needs about one customer.
async function customerOpen(ctx) {
  return { invoices: await openInvoices(ctx.db, ctx.params.id) };
}

async function get(ctx) {
  const p = await ctx.db
    .prepare(
      `SELECT p.*, c.name AS customer_name, c.customer_code, c.mobile, c.address, c.area,
              u.full_name AS collector, r.full_name AS reversed_by_name, vu.full_name AS verified_by_name
         FROM payments p JOIN customers c ON c.id = p.customer_id JOIN users u ON u.id = p.collected_by
         LEFT JOIN users r ON r.id = p.reversed_by LEFT JOIN users vu ON vu.id = p.verified_by
        WHERE p.id = ?`
    )
    .bind(ctx.params.id)
    .first();
  if (!p) throw new HttpError(404, 'Payment not found');
  const [allocs, due] = await ctx.db.batch([
    ctx.db
      .prepare(
        `SELECT a.amount, a.released_at, i.id AS invoice_id, i.invoice_no, i.billing_period, i.kind
           FROM payment_allocations a JOIN invoices i ON i.id = a.invoice_id WHERE a.payment_id = ? ORDER BY a.id`
      )
      .bind(p.id),
    ctx.db.prepare("SELECT COALESCE(SUM(total - paid_amount), 0) AS due FROM invoices WHERE customer_id = ? AND status IN ('unpaid','partial')").bind(p.customer_id),
  ]);
  const active = allocs.results.filter((a) => !a.released_at);
  const allocated = active.reduce((sum, a) => sum + a.amount, 0);
  return { payment: p, allocations: active, advance: p.status === 'valid' ? p.amount - allocated : 0, customer_due: due.results[0].due };
}

// Record a payment. The money goes to the chosen invoice first, then to the
// customer's oldest unpaid invoices; anything left over is kept as advance.
async function create(ctx) {
  const b = ctx.body;
  const customerId = v.int(b, 'customer_id', { required: true, min: 1 });
  const amount = v.money(b, 'amount', { required: true, min: 1 });
  const method = v.oneOf(b, 'method', METHODS, { required: true });
  const reference = v.str(b, 'reference', { max: 80 });
  const date = v.date(b, 'payment_date') || today();
  const notes = v.str(b, 'notes', { max: 300 });
  const invoiceId = v.int(b, 'invoice_id', { min: 1 });
  if (date > today()) throw new HttpError(400, 'payment_date: cannot be in the future');
  if (method !== 'cash' && method !== 'other' && !reference) {
    throw new HttpError(400, 'reference: enter the transaction ID for bKash, Nagad, Rocket or bank payments');
  }
  // Cash in hand is verified by nature. Online money counts as verified only
  // when the operator confirms they checked the merchant/bank account.
  const verified = method === 'cash' ? 1 : v.bool(b, 'verified');

  const customer = await ctx.db.prepare('SELECT id FROM customers WHERE id = ?').bind(customerId).first();
  if (!customer) throw new HttpError(404, 'Customer not found');

  // Guard against a double click / double submit.
  const twin = await ctx.db
    .prepare(
      `SELECT id FROM payments WHERE customer_id = ? AND amount = ? AND method = ? AND payment_date = ?
          AND collected_by = ? AND status = 'valid' AND created_at > datetime('now', '-20 seconds')`
    )
    .bind(customerId, amount, method, date, ctx.user.id)
    .first();
  if (twin) throw new HttpError(409, 'The same payment was saved a moment ago. Check the collection history before trying again.');
  if (reference && method !== 'cash') {
    const dupRef = await ctx.db.prepare("SELECT receipt_no FROM payments WHERE method = ? AND reference = ? AND status = 'valid'").bind(method, reference).first();
    if (dupRef) throw new HttpError(409, `This transaction ID was already recorded (receipt ${dupRef.receipt_no}).`);
  }

  let open = await openInvoices(ctx.db, customerId);
  if (invoiceId) {
    const chosen = open.find((i) => i.id === invoiceId);
    if (!chosen) throw new HttpError(400, 'invoice_id: this invoice is not outstanding for the selected customer');
    open = [chosen, ...open.filter((i) => i.id !== invoiceId)];
  }
  let left = amount;
  const plan = [];
  for (const inv of open) {
    if (left <= 0) break;
    const use = Math.min(left, inv.due);
    plan.push({ invoice_id: inv.id, amount: use });
    left -= use;
  }

  const s = await getSettings(ctx.db, ['receipt_prefix']);
  const results = await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO payments (customer_id, amount, method, reference, payment_date, verified, verified_by, verified_at, notes, collected_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') END, ?, ?) RETURNING id`
      )
      .bind(customerId, amount, method, reference, date, verified, verified ? ctx.user.id : null, verified, notes, ctx.user.id),
    ...plan.map((a) => allocationStmt(ctx.db, NEW_PAYMENT, [], a.invoice_id, a.amount)),
    ctx.db
      .prepare(`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip) VALUES (?, 'payment.create', 'payment', ${NEW_PAYMENT}, ?, ?)`)
      .bind(ctx.user.id, JSON.stringify({ customer_id: customerId, amount, method, reference, date, verified }), ctx.ip),
    ctx.db.prepare("UPDATE payments SET receipt_no = ? || printf('%06d', id) WHERE receipt_no IS NULL").bind(s.receipt_prefix || 'RCP-'),
    ...recomputeStmts(ctx.db, customerId),
  ]);
  return { id: results[0].results[0].id };
}

// Mark an online payment as verified after checking the merchant / bank account.
async function verify(ctx) {
  const res = await ctx.db
    .prepare("UPDATE payments SET verified = 1, verified_by = ?, verified_at = datetime('now') WHERE id = ? AND verified = 0 AND status = 'valid'")
    .bind(ctx.user.id, ctx.params.id)
    .run();
  if (!res.meta.changes) throw new HttpError(409, 'This payment is already verified or has been reversed');
  await auditStmt(ctx, 'payment.verify', 'payment', ctx.params.id).run();
  return { ok: true };
}

// Payments are never deleted. A reversal keeps the record and cancels its effect.
async function reverse(ctx) {
  const reason = v.str(ctx.body, 'reason', { required: true, max: 300 });
  const p = await ctx.db.prepare('SELECT id, customer_id, amount, receipt_no, status FROM payments WHERE id = ?').bind(ctx.params.id).first();
  if (!p) throw new HttpError(404, 'Payment not found');
  if (p.status !== 'valid') throw new HttpError(409, 'This payment is already reversed');
  await ctx.db.batch([
    ctx.db.prepare("UPDATE payments SET status = 'reversed', reversal_reason = ?, reversed_by = ?, reversed_at = datetime('now') WHERE id = ? AND status = 'valid'").bind(reason, ctx.user.id, p.id),
    ...recomputeStmts(ctx.db, p.customer_id),
    auditStmt(ctx, 'payment.reverse', 'payment', p.id, { receipt_no: p.receipt_no, amount: p.amount, reason }),
  ]);
  return { ok: true };
}

export default [
  ['GET', '/payments', 'user', list],
  ['GET', '/payments/collectors', 'user', collectors],
  ['GET', '/payments/open/:id', 'user', customerOpen],
  ['GET', '/payments/:id', 'user', get],
  ['POST', '/payments', 'user', create],
  ['POST', '/payments/:id/verify', 'admin', verify],
  ['POST', '/payments/:id/reverse', 'admin', reverse],
];
