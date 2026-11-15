// Basic income & expense book. This is a simple cash record,
// NOT a double-entry accounting system or balance sheet.
import { HttpError, auditStmt, paging, today, v } from '../util.js';

// The two tables are identical in shape; only the date column name differs.
const KINDS = {
  income: { table: 'income', dateCol: 'income_date' },
  expenses: { table: 'expenses', dateCol: 'expense_date' },
};

function makeRoutes(kind) {
  const { table, dateCol } = KINDS[kind];

  async function list(ctx) {
    const { limit, page, offset } = paging(ctx.query);
    const where = [];
    const binds = [];
    const from = v.date({ d: ctx.query.get('from') }, 'd');
    const to = v.date({ d: ctx.query.get('to') }, 'd');
    if (from) { where.push(`t.${dateCol} >= ?`); binds.push(from); }
    if (to) { where.push(`t.${dateCol} <= ?`); binds.push(to); }
    const cat = ctx.query.get('category');
    if (cat) { where.push('t.category = ?'); binds.push(cat.slice(0, 60)); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [rows, count] = await ctx.db.batch([
      ctx.db
        .prepare(
          `SELECT t.id, t.category, t.amount, t.${dateCol} AS entry_date, t.description, t.status, t.reversal_reason, u.full_name AS created_by_name
             FROM ${table} t JOIN users u ON u.id = t.created_by ${w} ORDER BY t.${dateCol} DESC, t.id DESC LIMIT ? OFFSET ?`
        )
        .bind(...binds, limit, offset),
      ctx.db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN t.status = 'valid' THEN t.amount ELSE 0 END), 0) AS amount FROM ${table} t ${w}`).bind(...binds),
    ]);
    return { entries: rows.results, total: count.results[0].n, sum_amount: count.results[0].amount, page, limit };
  }

  async function create(ctx) {
    const category = v.str(ctx.body, 'category', { required: true, max: 60 });
    const amount = v.money(ctx.body, 'amount', { required: true, min: 1 });
    const date = v.date(ctx.body, 'entry_date') || today();
    const description = v.str(ctx.body, 'description', { max: 300 });
    const res = await ctx.db
      .prepare(`INSERT INTO ${table} (category, amount, ${dateCol}, description, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id`)
      .bind(category, amount, date, description, ctx.user.id)
      .first();
    await auditStmt(ctx, `${table}.create`, table, res.id, { category, amount, date }).run();
    return { id: res.id };
  }

  async function reverse(ctx) {
    const reason = v.str(ctx.body, 'reason', { required: true, max: 300 });
    const res = await ctx.db
      .prepare(`UPDATE ${table} SET status = 'reversed', reversal_reason = ?, reversed_by = ?, reversed_at = datetime('now') WHERE id = ? AND status = 'valid'`)
      .bind(reason, ctx.user.id, ctx.params.id)
      .run();
    if (!res.meta.changes) throw new HttpError(409, 'This entry was not found or is already reversed');
    await auditStmt(ctx, `${table}.reverse`, table, ctx.params.id, { reason }).run();
    return { ok: true };
  }

  return [
    ['GET', `/${kind}`, 'user', list],
    ['POST', `/${kind}`, 'user', create],
    ['POST', `/${kind}/:id/reverse`, 'admin', reverse],
  ];
}

export default [...makeRoutes('income'), ...makeRoutes('expenses')];
