// The single entry point for every /api/... request.
// Order of checks: route exists -> same-site check -> logged in -> role allowed -> handler.

import { HttpError, json } from './util.js';
import { getSessionUser } from './auth.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import customerRoutes from './routes/customers.js';
import packageRoutes from './routes/packages.js';
import invoiceRoutes from './routes/invoices.js';
import paymentRoutes from './routes/payments.js';
import financeRoutes from './routes/finance.js';
import reportRoutes from './routes/reports.js';
import adminRoutes from './routes/admin.js';

// Each route: [METHOD, '/path/:param', access, handler]
// access: 'public' (no login), 'user' (any logged-in user), 'admin' (administrator only)
const routes = [
  ...authRoutes,
  ...dashboardRoutes,
  ...customerRoutes,
  ...packageRoutes,
  ...invoiceRoutes,
  ...paymentRoutes,
  ...financeRoutes,
  ...reportRoutes,
  ...adminRoutes,
].map(([method, path, access, handler]) => ({
  method,
  access,
  handler,
  regex: new RegExp('^' + path.replace(/:[a-z]+/gi, '(\\d+)') + '$'),
  names: (path.match(/:[a-z]+/gi) || []).map((n) => n.slice(1)),
}));

export async function handleApi(request, env) {
  try {
    if (!env.DB) throw new HttpError(500, 'Database is not connected. Check the D1 binding named "DB".');
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';

    let match = null;
    let pathExists = false;
    for (const r of routes) {
      const m = r.regex.exec(path);
      if (!m) continue;
      pathExists = true;
      if (r.method === request.method) {
        match = { route: r, params: Object.fromEntries(r.names.map((n, i) => [n, Number(m[i + 1])])) };
        break;
      }
    }
    if (!match) throw new HttpError(pathExists ? 405 : 404, pathExists ? 'Method not allowed' : 'Not found');

    const ctx = {
      env,
      db: env.DB,
      request,
      params: match.params,
      query: url.searchParams,
      ip: request.headers.get('cf-connecting-ip') || null,
      user: null,
      body: {},
    };

    if (request.method !== 'GET') {
      // Protection against other websites sending requests on a user's behalf (CSRF).
      const origin = request.headers.get('origin');
      if (origin && new URL(origin).host !== url.host) throw new HttpError(403, 'Request blocked');
      const text = await request.text();
      if ((text || request.method !== 'DELETE') && !(request.headers.get('content-type') || '').includes('application/json')) {
        throw new HttpError(415, 'Requests must be JSON');
      }
      if (text.length > 400000) throw new HttpError(413, 'Request is too large');
      try {
        ctx.body = text ? JSON.parse(text) : {};
      } catch {
        throw new HttpError(400, 'Invalid JSON');
      }
      if (!ctx.body || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) throw new HttpError(400, 'Invalid request');
    }

    if (match.route.access !== 'public') {
      ctx.user = await getSessionUser(ctx.db, request);
      if (!ctx.user) throw new HttpError(401, 'Please log in');
      if (match.route.access === 'admin' && ctx.user.role !== 'admin') {
        throw new HttpError(403, 'Only an administrator can do this');
      }
    }

    const result = await match.route.handler(ctx);
    return result instanceof Response ? result : json(result ?? { ok: true });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    const msg = String(err && err.message ? err.message : err);
    // Friendly versions of database rule violations.
    if (msg.includes('UNIQUE constraint failed')) return json({ error: 'This record already exists (duplicate value).' }, 409);
    if (msg.includes('FOREIGN KEY constraint failed')) return json({ error: 'This record is linked to other records and cannot be changed this way.' }, 409);
    const abort = msg.match(/(Payments|Invoices|Expenses|Income|Audit history|A payment amount|An invoice amount)[^:]*?\./);
    if (abort) return json({ error: abort[0] }, 409);
    console.error('API error:', msg);
    return json({ error: 'Something went wrong on the server. Please try again.' }, 500);
  }
}
