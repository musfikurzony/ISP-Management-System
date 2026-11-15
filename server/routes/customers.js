import { HttpError, auditStmt, likePattern, paging, today, v } from '../util.js';

const TYPES = ['pppoe', 'static', 'other'];
const STATUSES = ['active', 'suspended', 'inactive'];

function read(body) {
  const mobile = v.str(body, 'mobile', { required: true, max: 20 });
  if (!/^\+?[0-9][0-9 -]{5,18}$/.test(mobile)) throw new HttpError(400, 'mobile: is not a valid phone number');
  return {
    name: v.str(body, 'name', { required: true, max: 100 }),
    mobile,
    address: v.str(body, 'address', { max: 300 }),
    area: v.str(body, 'area', { max: 80 }),
    connection_date: v.date(body, 'connection_date', { required: true }),
    package_id: v.int(body, 'package_id', { min: 1 }),
    monthly_bill: v.money(body, 'monthly_bill', { required: true }),
    connection_type: v.oneOf(body, 'connection_type', TYPES, { required: true }),
    username: v.str(body, 'username', { max: 60 }),
    status: v.oneOf(body, 'status', STATUSES) || 'active',
    notes: v.str(body, 'notes', { max: 1000 }),
  };
}

// Reusable SQL: what a customer owes and how much advance they hold.
export const DUE_SQL = `COALESCE((SELECT SUM(i.total - i.paid_amount) FROM invoices i WHERE i.customer_id = c.id AND i.status IN ('unpaid','partial')), 0)`;
export const CREDIT_SQL = `(COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.customer_id = c.id AND p.status = 'valid'), 0)
  - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
               WHERE p.customer_id = c.id AND p.status = 'valid' AND a.released_at IS NULL), 0))`;

async function list(ctx) {
  const { limit, page, offset } = paging(ctx.query);
  const where = [];
  const binds = [];
  const q = ctx.query.get('q');
  if (q && q.trim()) {
    const p = likePattern(q);
    where.push(`(c.name LIKE ? ESCAPE '\\' OR c.mobile LIKE ? ESCAPE '\\' OR c.customer_code LIKE ? ESCAPE '\\' OR c.username LIKE ? ESCAPE '\\' OR c.address LIKE ? ESCAPE '\\')`);
    binds.push(p, p, p, p, p);
  }
  const status = ctx.query.get('status');
  if (STATUSES.includes(status)) { where.push('c.status = ?'); binds.push(status); }
  const area = ctx.query.get('area');
  if (area) { where.push('c.area = ?'); binds.push(area.slice(0, 80)); }
  const pkg = parseInt(ctx.query.get('package_id') || '', 10);
  if (pkg > 0) { where.push('c.package_id = ?'); binds.push(pkg); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const [rows, count] = await ctx.db.batch([
    ctx.db
      .prepare(
        `SELECT c.id, c.customer_code, c.name, c.mobile, c.area, c.status, c.monthly_bill, c.connection_type,
                p.name AS package_name, ${DUE_SQL} AS due
           FROM customers c LEFT JOIN packages p ON p.id = c.package_id
           ${w} ORDER BY c.id DESC LIMIT ? OFFSET ?`
      )
      .bind(...binds, limit, offset),
    ctx.db.prepare(`SELECT COUNT(*) AS n FROM customers c ${w}`).bind(...binds),
  ]);
  return { customers: rows.results, total: count.results[0].n, page, limit };
}

// Short list for the "select customer" boxes.
async function search(ctx) {
  const q = ctx.query.get('q') || '';
  const p = likePattern(q);
  const res = await ctx.db
    .prepare(
      `SELECT c.id, c.customer_code, c.name, c.mobile, c.area, c.monthly_bill, c.status, ${DUE_SQL} AS due
         FROM customers c
        WHERE c.name LIKE ?1 ESCAPE '\\' OR c.mobile LIKE ?1 ESCAPE '\\' OR c.customer_code LIKE ?1 ESCAPE '\\' OR c.username LIKE ?1 ESCAPE '\\'
        ORDER BY c.name LIMIT 15`
    )
    .bind(p)
    .all();
  return { customers: res.results };
}

async function areas(ctx) {
  const res = await ctx.db.prepare("SELECT DISTINCT area FROM customers WHERE area IS NOT NULL AND area <> '' ORDER BY area").all();
  return { areas: res.results.map((r) => r.area) };
}

async function get(ctx) {
  const id = ctx.params.id;
  const customer = await ctx.db
    .prepare(
      `SELECT c.*, p.name AS package_name, p.download_mbps, p.upload_mbps, ${DUE_SQL} AS due, ${CREDIT_SQL} AS credit
         FROM customers c LEFT JOIN packages p ON p.id = c.package_id WHERE c.id = ?`
    )
    .bind(id)
    .first();
  if (!customer) throw new HttpError(404, 'Customer not found');
  const [invoices, payments, subs] = await ctx.db.batch([
    ctx.db.prepare('SELECT id, invoice_no, kind, billing_period, issue_date, due_date, total, paid_amount, status FROM invoices WHERE customer_id = ? ORDER BY id DESC LIMIT 200').bind(id),
    ctx.db
      .prepare(
        `SELECT p.id, p.receipt_no, p.amount, p.method, p.reference, p.payment_date, p.status, p.verified, u.full_name AS collector
           FROM payments p JOIN users u ON u.id = p.collected_by WHERE p.customer_id = ? ORDER BY p.id DESC LIMIT 200`
      )
      .bind(id),
    ctx.db
      .prepare(
        `SELECT s.id, s.monthly_price, s.start_date, s.end_date, p.name AS package_name
           FROM subscriptions s LEFT JOIN packages p ON p.id = s.package_id WHERE s.customer_id = ? ORDER BY s.id DESC LIMIT 50`
      )
      .bind(id),
  ]);
  return { customer, invoices: invoices.results, payments: payments.results, subscriptions: subs.results };
}

async function checkRefs(ctx, c, selfId = 0) {
  if (c.package_id) {
    const p = await ctx.db.prepare('SELECT id FROM packages WHERE id = ?').bind(c.package_id).first();
    if (!p) throw new HttpError(400, 'package_id: package not found');
  }
  if (c.username) {
    const dup = await ctx.db.prepare('SELECT id FROM customers WHERE username = ? AND id <> ?').bind(c.username, selfId).first();
    if (dup) throw new HttpError(409, 'username: is already used by another customer');
  }
}

async function create(ctx) {
  const c = read(ctx.body);
  await checkRefs(ctx, c);
  const results = await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO customers (name, mobile, address, area, connection_date, package_id, monthly_bill, connection_type, username, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .bind(c.name, c.mobile, c.address, c.area, c.connection_date, c.package_id, c.monthly_bill, c.connection_type, c.username, c.status, c.notes),
    // The customer ID (C00001, C00002 ...) is produced by the database itself.
    ctx.db.prepare("UPDATE customers SET customer_code = printf('C%05d', id) WHERE customer_code IS NULL"),
    ctx.db
      .prepare(
        `INSERT INTO subscriptions (customer_id, package_id, monthly_price, start_date, created_by)
         SELECT id, package_id, monthly_bill, connection_date, ? FROM customers WHERE id = last_insert_rowid()`
      )
      .bind(ctx.user.id),
  ]);
  const id = results[0].results[0].id;
  await auditStmt(ctx, 'customer.create', 'customer', id, { name: c.name, mobile: c.mobile, monthly_bill: c.monthly_bill }).run();
  return { id };
}

async function update(ctx) {
  const id = ctx.params.id;
  const c = read(ctx.body);
  const old = await ctx.db.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first();
  if (!old) throw new HttpError(404, 'Customer not found');
  await checkRefs(ctx, c, id);

  const stmts = [
    ctx.db
      .prepare(
        `UPDATE customers SET name = ?, mobile = ?, address = ?, area = ?, connection_date = ?, package_id = ?, monthly_bill = ?,
                connection_type = ?, username = ?, status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(c.name, c.mobile, c.address, c.area, c.connection_date, c.package_id, c.monthly_bill, c.connection_type, c.username, c.status, c.notes, id),
  ];
  // A package or price change starts a new subscription record. Old invoices are untouched.
  if (old.package_id !== c.package_id || old.monthly_bill !== c.monthly_bill) {
    stmts.push(
      ctx.db.prepare('UPDATE subscriptions SET end_date = ? WHERE customer_id = ? AND end_date IS NULL').bind(today(), id),
      ctx.db.prepare('INSERT INTO subscriptions (customer_id, package_id, monthly_price, start_date, created_by) VALUES (?, ?, ?, ?, ?)').bind(id, c.package_id, c.monthly_bill, today(), ctx.user.id)
    );
  }
  const changed = {};
  for (const k of Object.keys(c)) if (old[k] !== c[k]) changed[k] = [old[k], c[k]];
  stmts.push(auditStmt(ctx, 'customer.update', 'customer', id, changed));
  await ctx.db.batch(stmts);
  return { ok: true };
}

// Quick status change (Active / Suspended / Inactive).
async function setStatus(ctx) {
  const status = v.oneOf(ctx.body, 'status', STATUSES, { required: true });
  const old = await ctx.db.prepare('SELECT status FROM customers WHERE id = ?').bind(ctx.params.id).first();
  if (!old) throw new HttpError(404, 'Customer not found');
  await ctx.db.batch([
    ctx.db.prepare("UPDATE customers SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(status, ctx.params.id),
    auditStmt(ctx, 'customer.status', 'customer', ctx.params.id, { from: old.status, to: status }),
  ]);
  return { ok: true };
}

// Safeguard: a customer with any invoice or payment can never be deleted.
async function remove(ctx) {
  const id = ctx.params.id;
  const old = await ctx.db.prepare('SELECT customer_code, name, mobile FROM customers WHERE id = ?').bind(id).first();
  if (!old) throw new HttpError(404, 'Customer not found');
  const used = await ctx.db
    .prepare('SELECT (SELECT COUNT(*) FROM invoices WHERE customer_id = ?1) + (SELECT COUNT(*) FROM payments WHERE customer_id = ?1) AS n')
    .bind(id)
    .first();
  if (used.n > 0) {
    throw new HttpError(409, 'This customer has invoices or payments and cannot be deleted. Change the status to Inactive instead.');
  }
  await ctx.db.batch([
    ctx.db.prepare('DELETE FROM customers WHERE id = ?').bind(id),
    auditStmt(ctx, 'customer.delete', 'customer', id, old),
  ]);
  return { ok: true };
}

export default [
  ['GET', '/customers', 'user', list],
  ['GET', '/customers/search', 'user', search],
  ['GET', '/customers/areas', 'user', areas],
  ['GET', '/customers/:id', 'user', get],
  ['POST', '/customers', 'user', create],
  ['PUT', '/customers/:id', 'user', update],
  ['POST', '/customers/:id/status', 'user', setStatus],
  ['DELETE', '/customers/:id', 'admin', remove],
];
