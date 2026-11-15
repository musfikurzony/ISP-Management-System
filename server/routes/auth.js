import { HttpError, auditStmt, getSettings, json, utcStamp, v } from '../util.js';
import { checkPasswordRules, createSession, destroySession, getSessionUser, hashPassword, verifyPassword } from '../auth.js';

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

function usernameOf(body) {
  const u = v.str(body, 'username', { required: true, max: 40 });
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(u)) throw new HttpError(400, 'username: use 3-40 letters, numbers, dot, dash or underscore');
  return u.toLowerCase();
}

// Tells the login screen what to show. Reveals nothing sensitive.
async function status(ctx) {
  const [count, s, user] = await Promise.all([
    ctx.db.prepare('SELECT COUNT(*) AS n FROM users').first(),
    getSettings(ctx.db, ['isp_name', 'isp_logo', 'language']),
    getSessionUser(ctx.db, ctx.request),
  ]);
  return { setupRequired: count.n === 0, ispName: s.isp_name, ispLogo: s.isp_logo, language: s.language, user };
}

// First-time setup: creates the first administrator. Works only while there are no users.
async function setup(ctx) {
  const username = usernameOf(ctx.body);
  const fullName = v.str(ctx.body, 'full_name', { required: true, max: 80 });
  checkPasswordRules(ctx.body.password);
  const hash = await hashPassword(ctx.body.password);
  const res = await ctx.db
    .prepare(
      `INSERT INTO users (username, full_name, password_hash, role)
       SELECT ?, ?, ?, 'admin' WHERE NOT EXISTS (SELECT 1 FROM users)`
    )
    .bind(username, fullName, hash)
    .run();
  if (!res.meta.changes) throw new HttpError(403, 'Setup is already complete. Please log in.');
  const user = await ctx.db.prepare('SELECT id, username, full_name, role FROM users WHERE username = ?').bind(username).first();
  ctx.user = user;
  await auditStmt(ctx, 'user.setup_admin', 'user', user.id).run();
  const cookie = await createSession(ctx.db, ctx.request, user.id, ctx.ip);
  return json({ user }, 200, { 'set-cookie': cookie });
}

async function login(ctx) {
  const username = v.str(ctx.body, 'username', { required: true, max: 40 }).toLowerCase();
  const password = typeof ctx.body.password === 'string' ? ctx.body.password.slice(0, 128) : '';
  const fail = new HttpError(401, 'Wrong username or password');

  const u = await ctx.db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
  if (!u) {
    await hashPassword(password); // spend the same time so usernames cannot be guessed by timing
    throw fail;
  }
  if (u.locked_until && u.locked_until > utcStamp()) {
    throw new HttpError(429, `Too many wrong attempts. Try again after ${LOCK_MINUTES} minutes.`);
  }
  const ok = u.is_active === 1 && (await verifyPassword(password, u.password_hash));
  if (!ok) {
    const fails = u.failed_attempts + 1;
    const lock = fails >= MAX_FAILS ? utcStamp(new Date(Date.now() + LOCK_MINUTES * 60000)) : null;
    await ctx.db.batch([
      ctx.db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').bind(lock ? 0 : fails, lock, u.id),
      auditStmt(ctx, 'auth.login_failed', 'user', u.id, lock ? { locked: true } : null),
    ]);
    throw fail;
  }
  ctx.user = u;
  await ctx.db.batch([
    ctx.db.prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?").bind(u.id),
    auditStmt(ctx, 'auth.login', 'user', u.id),
  ]);
  const cookie = await createSession(ctx.db, ctx.request, u.id, ctx.ip);
  return json({ user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role } }, 200, { 'set-cookie': cookie });
}

async function logout(ctx) {
  const cookie = await destroySession(ctx.db, ctx.request);
  return json({ ok: true }, 200, { 'set-cookie': cookie });
}

async function changePassword(ctx) {
  const row = await ctx.db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(ctx.user.id).first();
  if (!(await verifyPassword(String(ctx.body.current_password || ''), row.password_hash))) {
    throw new HttpError(400, 'current_password: is not correct');
  }
  checkPasswordRules(ctx.body.new_password);
  const hash = await hashPassword(ctx.body.new_password);
  await ctx.db.batch([
    ctx.db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").bind(hash, ctx.user.id),
    auditStmt(ctx, 'user.change_password', 'user', ctx.user.id),
  ]);
  return { ok: true };
}

export default [
  ['GET', '/auth/status', 'public', status],
  ['POST', '/auth/setup', 'public', setup],
  ['POST', '/auth/login', 'public', login],
  ['POST', '/auth/logout', 'public', logout],
  ['POST', '/auth/change-password', 'user', changePassword],
];
