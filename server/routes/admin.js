// Administrator-only areas: users, settings, audit history and data export.
// Reading the display settings is allowed for every logged-in user.
import { HttpError, auditStmt, getSettings, paging, v } from '../util.js';
import { checkPasswordRules, hashPassword } from '../auth.js';

// ---------------- Users ----------------
async function listUsers(ctx) {
  const res = await ctx.db.prepare('SELECT id, username, full_name, role, is_active, last_login_at, created_at FROM users ORDER BY id').all();
  return { users: res.results };
}

async function createUser(ctx) {
  const username = v.str(ctx.body, 'username', { required: true, max: 40 }).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new HttpError(400, 'username: use 3-40 letters, numbers, dot, dash or underscore');
  const fullName = v.str(ctx.body, 'full_name', { required: true, max: 80 });
  const role = v.oneOf(ctx.body, 'role', ['admin', 'operator'], { required: true });
  checkPasswordRules(ctx.body.password);
  const res = await ctx.db
    .prepare('INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, ?) RETURNING id')
    .bind(username, fullName, await hashPassword(ctx.body.password), role)
    .first();
  await auditStmt(ctx, 'user.create', 'user', res.id, { username, role }).run();
  return { id: res.id };
}

async function updateUser(ctx) {
  const id = ctx.params.id;
  const old = await ctx.db.prepare('SELECT id, role, is_active FROM users WHERE id = ?').bind(id).first();
  if (!old) throw new HttpError(404, 'User not found');
  const fullName = v.str(ctx.body, 'full_name', { required: true, max: 80 });
  const role = v.oneOf(ctx.body, 'role', ['admin', 'operator'], { required: true });
  const isActive = v.bool(ctx.body, 'is_active');

  if (id === ctx.user.id && (role !== 'admin' || !isActive)) {
    throw new HttpError(400, 'You cannot remove your own administrator access. Ask another administrator.');
  }
  if (old.role === 'admin' && old.is_active && (role !== 'admin' || !isActive)) {
    const others = await ctx.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?").bind(id).first();
    if (others.n === 0) throw new HttpError(400, 'There must always be at least one active administrator.');
  }
  const stmts = [
    ctx.db.prepare("UPDATE users SET full_name = ?, role = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?").bind(fullName, role, isActive, id),
  ];
  let passwordChanged = false;
  if (ctx.body.password) {
    checkPasswordRules(ctx.body.password);
    stmts.push(ctx.db.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').bind(await hashPassword(ctx.body.password), id));
    passwordChanged = true;
  }
  // Signing the person out everywhere when access is reduced or the password is reset.
  if (passwordChanged || !isActive || role !== old.role) {
    if (id !== ctx.user.id) stmts.push(ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  }
  stmts.push(auditStmt(ctx, 'user.update', 'user', id, { role, is_active: isActive, password_reset: passwordChanged }));
  await ctx.db.batch(stmts);
  return { ok: true };
}

// ---------------- Settings ----------------
const SETTING_RULES = {
  isp_name: (b) => v.str(b, 'isp_name', { required: true, max: 100 }),
  isp_address: (b) => v.str(b, 'isp_address', { max: 300 }) || '',
  isp_contact: (b) => v.str(b, 'isp_contact', { max: 100 }) || '',
  billing_day: (b) => String(v.int(b, 'billing_day', { required: true, min: 1, max: 28 })),
  due_days: (b) => String(v.int(b, 'due_days', { required: true, min: 0, max: 60 })),
  auto_billing: (b) => String(v.bool(b, 'auto_billing')),
  currency_symbol: (b) => v.str(b, 'currency_symbol', { required: true, max: 5 }),
  language: (b) => v.oneOf(b, 'language', ['en', 'bn'], { required: true }),
  invoice_prefix: (b) => prefix(b, 'invoice_prefix'),
  receipt_prefix: (b) => prefix(b, 'receipt_prefix'),
  invoice_format: (b) => v.oneOf(b, 'invoice_format', ['a4', 'a5', 'pos'], { required: true }),
  receipt_format: (b) => v.oneOf(b, 'receipt_format', ['a4', 'a5', 'pos'], { required: true }),
  invoice_footer: (b) => v.str(b, 'invoice_footer', { max: 300 }) || '',
  expense_categories: (b) => v.str(b, 'expense_categories', { max: 1000 }) || 'Other',
  income_categories: (b) => v.str(b, 'income_categories', { max: 1000 }) || 'Other',
  isp_logo: (b) => {
    const logo = b.isp_logo || '';
    if (logo === '') return '';
    if (typeof logo !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo)) throw new HttpError(400, 'isp_logo: must be a PNG, JPG or WebP image');
    if (logo.length > 200000) throw new HttpError(400, 'isp_logo: image is too large (keep it under 150 KB)');
    return logo;
  },
};
function prefix(b, field) {
  const p = v.str(b, field, { max: 10 }) || '';
  if (!/^[A-Za-z0-9/-]*$/.test(p)) throw new HttpError(400, `${field}: use only letters, numbers, dash or slash`);
  return p;
}

async function readSettings(ctx) {
  const s = await getSettings(ctx.db);
  delete s.auto_billing_last_period;
  return { settings: s };
}

async function saveSettings(ctx) {
  const stmts = [];
  const changed = [];
  for (const key of Object.keys(SETTING_RULES)) {
    if (!(key in ctx.body)) continue;
    const value = SETTING_RULES[key](ctx.body);
    stmts.push(
      ctx.db
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')")
        .bind(key, value)
    );
    changed.push(key);
  }
  if (!stmts.length) throw new HttpError(400, 'Nothing to save');
  stmts.push(auditStmt(ctx, 'settings.update', 'settings', null, { changed }));
  await ctx.db.batch(stmts);
  return { ok: true };
}

// ---------------- Audit history ----------------
async function audit(ctx) {
  const { limit, page, offset } = paging(ctx.query);
  const where = [];
  const binds = [];
  const action = ctx.query.get('action');
  if (action) { where.push('a.action LIKE ?'); binds.push(action.replace(/[%_]/g, '').slice(0, 40) + '%'); }
  const uid = parseInt(ctx.query.get('user_id') || '', 10);
  if (uid > 0) { where.push('a.user_id = ?'); binds.push(uid); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [rows, count] = await ctx.db.batch([
    ctx.db
      .prepare(
        `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.ip, a.created_at, u.full_name AS user_name
           FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${w} ORDER BY a.id DESC LIMIT ? OFFSET ?`
      )
      .bind(...binds, limit, offset),
    ctx.db.prepare(`SELECT COUNT(*) AS n FROM audit_logs a ${w}`).bind(...binds),
  ]);
  return { logs: rows.results, total: count.results[0].n, page, limit };
}

// ---------------- Data export (in-app backup copy) ----------------
// Delivered one table at a time, 1000 rows per request, to stay inside free-tier limits.
// Password hashes and login sessions are never exported.
const EXPORT_TABLES = {
  users: 'id, username, full_name, role, is_active, last_login_at, created_at',
  packages: '*',
  customers: '*',
  subscriptions: '*',
  invoices: '*',
  invoice_items: '*',
  payments: '*',
  payment_allocations: '*',
  expenses: '*',
  income: '*',
  settings: '*',
  audit_logs: '*',
};

async function exportTable(ctx) {
  const table = ctx.query.get('table');
  if (!table) return { tables: Object.keys(EXPORT_TABLES) };
  if (!Object.hasOwn(EXPORT_TABLES, table)) throw new HttpError(400, 'Unknown table');
  const after = parseInt(ctx.query.get('after') || '0', 10) || 0;
  let res;
  if (table === 'settings') {
    res = await ctx.db.prepare('SELECT * FROM settings ORDER BY key').all();
    return { table, rows: res.results, more: false };
  }
  res = await ctx.db.prepare(`SELECT ${EXPORT_TABLES[table]} FROM ${table} WHERE id > ? ORDER BY id LIMIT 1001`).bind(after).all();
  const rows = res.results.slice(0, 1000);
  if (after === 0) await auditStmt(ctx, 'backup.export', 'table', table).run();
  return { table, rows, more: res.results.length > 1000, after: rows.length ? rows[rows.length - 1].id : after };
}

export default [
  ['GET', '/users', 'admin', listUsers],
  ['POST', '/users', 'admin', createUser],
  ['PUT', '/users/:id', 'admin', updateUser],
  ['GET', '/settings', 'user', readSettings],
  ['PUT', '/settings', 'admin', saveSettings],
  ['GET', '/audit', 'admin', audit],
  ['GET', '/export', 'admin', exportTable],
];
