// Small shared helpers used by every API route.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

// ---------- Dates (Asia/Dhaka is always UTC+6, no daylight saving) ----------
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

export function today() {
  return new Date(Date.now() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}
export function currentPeriod() {
  return today().slice(0, 7);
}
export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function lastDayOfPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
export function utcStamp(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
// SQL snippet converting a stored UTC timestamp column to a Dhaka calendar date.
export const dhakaDate = (col) => `date(${col}, '+6 hours')`;

// ---------- Input validation ----------
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_MONEY = 100000000000; // 1 billion Taka, in paisa

function bad(field, msg) {
  throw new HttpError(400, `${field}: ${msg}`);
}

export const v = {
  str(obj, field, { required = false, max = 200 } = {}) {
    let val = obj?.[field];
    if (val === undefined || val === null) val = '';
    if (typeof val !== 'string') val = String(val);
    val = val.trim();
    if (!val) {
      if (required) bad(field, 'is required');
      return null;
    }
    if (val.length > max) bad(field, `must be at most ${max} characters`);
    return val;
  },
  int(obj, field, { required = false, min = 0, max = 1000000000 } = {}) {
    const raw = obj?.[field];
    if (raw === undefined || raw === null || raw === '') {
      if (required) bad(field, 'is required');
      return null;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) bad(field, 'is not a valid number');
    return n;
  },
  num(obj, field, { required = false, min = 0, max = 1000000 } = {}) {
    const raw = obj?.[field];
    if (raw === undefined || raw === null || raw === '') {
      if (required) bad(field, 'is required');
      return null;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max) bad(field, 'is not a valid number');
    return n;
  },
  // Money always travels through the API as whole paisa.
  money(obj, field, { required = false, min = 0 } = {}) {
    const raw = obj?.[field];
    if (raw === undefined || raw === null || raw === '') {
      if (required) bad(field, 'is required');
      return null;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > MAX_MONEY) bad(field, 'is not a valid amount');
    return n;
  },
  date(obj, field, { required = false } = {}) {
    const val = obj?.[field];
    if (!val) {
      if (required) bad(field, 'is required');
      return null;
    }
    if (typeof val !== 'string' || !DATE_RE.test(val) || Number.isNaN(Date.parse(val + 'T00:00:00Z'))) {
      bad(field, 'must be a valid date');
    }
    return val;
  },
  period(obj, field, { required = false } = {}) {
    const val = obj?.[field];
    if (!val) {
      if (required) bad(field, 'is required');
      return null;
    }
    if (typeof val !== 'string' || !PERIOD_RE.test(val)) bad(field, 'must be a month like 2026-01');
    return val;
  },
  oneOf(obj, field, allowed, { required = false } = {}) {
    const val = obj?.[field];
    if (val === undefined || val === null || val === '') {
      if (required) bad(field, 'is required');
      return null;
    }
    if (!allowed.includes(val)) bad(field, 'is not an allowed value');
    return val;
  },
  bool(obj, field) {
    const val = obj?.[field];
    return val === true || val === 1 || val === '1' || val === 'true' ? 1 : 0;
  },
};

// Turns free text into a safe LIKE pattern.
export function likePattern(text) {
  return '%' + String(text).trim().slice(0, 80).replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}

export function paging(query, defaultLimit = 50, maxLimit = 1000) {
  let limit = parseInt(query.get('limit') || defaultLimit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = defaultLimit;
  limit = Math.min(limit, maxLimit);
  let page = parseInt(query.get('page') || '1', 10);
  if (!Number.isInteger(page) || page < 1) page = 1;
  return { limit, page, offset: (page - 1) * limit };
}

export async function getSettings(db, keys = null) {
  const rows = keys
    ? await db.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all()
    : await db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows.results) out[r.key] = r.value;
  return out;
}

// Returns a prepared statement so the audit entry can be saved in the same
// database transaction as the change it describes.
export function auditStmt(ctx, action, entityType, entityId, details = null) {
  return ctx.db
    .prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(
      ctx.user ? ctx.user.id : null,
      action,
      entityType || null,
      entityId === null || entityId === undefined ? null : String(entityId),
      details ? JSON.stringify(details).slice(0, 4000) : null,
      ctx.ip || null
    );
}
