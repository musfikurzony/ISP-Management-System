import { HttpError, auditStmt, v } from '../util.js';

function read(body) {
  return {
    name: v.str(body, 'name', { required: true, max: 80 }),
    download_mbps: v.num(body, 'download_mbps', { required: true, min: 0.1, max: 100000 }),
    upload_mbps: v.num(body, 'upload_mbps', { required: true, min: 0.1, max: 100000 }),
    price: v.money(body, 'price', { required: true }),
    description: v.str(body, 'description', { max: 500 }),
    is_active: body.is_active === undefined ? 1 : v.bool(body, 'is_active'),
  };
}

async function list(ctx) {
  const res = await ctx.db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM customers c WHERE c.package_id = p.id) AS customer_count
         FROM packages p ORDER BY p.is_active DESC, p.price, p.name`
    )
    .all();
  return { packages: res.results };
}

async function create(ctx) {
  const p = read(ctx.body);
  const res = await ctx.db
    .prepare('INSERT INTO packages (name, download_mbps, upload_mbps, price, description, is_active) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(p.name, p.download_mbps, p.upload_mbps, p.price, p.description, p.is_active)
    .first();
  await auditStmt(ctx, 'package.create', 'package', res.id, p).run();
  return { id: res.id };
}

async function update(ctx) {
  const p = read(ctx.body);
  const old = await ctx.db.prepare('SELECT * FROM packages WHERE id = ?').bind(ctx.params.id).first();
  if (!old) throw new HttpError(404, 'Package not found');
  await ctx.db.batch([
    ctx.db
      .prepare("UPDATE packages SET name = ?, download_mbps = ?, upload_mbps = ?, price = ?, description = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(p.name, p.download_mbps, p.upload_mbps, p.price, p.description, p.is_active, ctx.params.id),
    auditStmt(ctx, 'package.update', 'package', ctx.params.id, { before: { name: old.name, price: old.price, is_active: old.is_active }, after: p }),
  ]);
  return { ok: true };
}

async function remove(ctx) {
  const used = await ctx.db
    .prepare('SELECT (SELECT COUNT(*) FROM customers WHERE package_id = ?1) + (SELECT COUNT(*) FROM subscriptions WHERE package_id = ?1) AS n')
    .bind(ctx.params.id)
    .first();
  if (used.n > 0) throw new HttpError(409, 'This package has been used by customers. Mark it Inactive instead of deleting.');
  const old = await ctx.db.prepare('SELECT name, price FROM packages WHERE id = ?').bind(ctx.params.id).first();
  if (!old) throw new HttpError(404, 'Package not found');
  await ctx.db.batch([
    ctx.db.prepare('DELETE FROM packages WHERE id = ?').bind(ctx.params.id),
    auditStmt(ctx, 'package.delete', 'package', ctx.params.id, old),
  ]);
  return { ok: true };
}

export default [
  ['GET', '/packages', 'user', list],
  ['POST', '/packages', 'admin', create],
  ['PUT', '/packages/:id', 'admin', update],
  ['DELETE', '/packages/:id', 'admin', remove],
];
