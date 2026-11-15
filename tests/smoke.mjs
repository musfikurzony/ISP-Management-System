// End-to-end API check against a running local server (npm run dev).
// Usage: node tests/smoke.mjs [baseUrl]   -- needs a FRESH local database.
const BASE = process.argv[2] || 'http://127.0.0.1:8788';
let cookie = '';
let pass = 0, fail = 0;

async function call(method, path, body, useCookie = cookie) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(useCookie ? { cookie: useCookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, cookie: set ? set.split(';')[0] : null };
}
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name, extra ? JSON.stringify(extra) : ''); }
}
const today = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
const period = today.slice(0, 7);

let r = await call('GET', '/auth/status');
check('status says setup required', r.data.setupRequired === true, r.data);
r = await call('GET', '/customers');
check('API refuses anonymous access', r.status === 401);
r = await call('POST', '/auth/setup', { username: 'admin', full_name: 'Admin', password: 'short' });
check('weak password refused', r.status === 400);
r = await call('POST', '/auth/setup', { username: 'admin', full_name: 'Admin User', password: 'admin-pass-123' });
check('first admin created', r.status === 200 && r.cookie, r.data);
cookie = r.cookie;
r = await call('POST', '/auth/setup', { username: 'hacker', full_name: 'X', password: 'hacker-pass-123' });
check('second setup refused', r.status === 403);
r = await call('POST', '/auth/login', { username: 'admin', password: 'wrong-password' }, '');
check('wrong password refused', r.status === 401);
r = await call('POST', '/auth/login', { username: 'admin', password: 'admin-pass-123' }, '');
check('login works', r.status === 200 && r.cookie);

r = await call('POST', '/users', { username: 'operator1', full_name: 'Operator One', role: 'operator', password: 'operator-pass-1' });
check('operator created', r.status === 200, r.data);
const op = await call('POST', '/auth/login', { username: 'operator1', password: 'operator-pass-1' }, '');
const opCookie = op.cookie;
r = await call('GET', '/users', null, opCookie);
check('operator blocked from users', r.status === 403);
r = await call('PUT', '/settings', { isp_name: 'Hack' }, opCookie);
check('operator blocked from settings', r.status === 403);
r = await call('GET', '/audit', null, opCookie);
check('operator blocked from audit', r.status === 403);

r = await call('POST', '/packages', { name: 'Home 20', download_mbps: 20, upload_mbps: 20, price: 80000, description: 'Home' });
check('package created', r.status === 200, r.data);
const pkgId = r.data.id;
r = await call('POST', '/packages', { name: 'home 20', download_mbps: 20, upload_mbps: 20, price: 80000 });
check('duplicate package refused', r.status === 409);
r = await call('POST', '/packages', { name: 'X', download_mbps: 1, upload_mbps: 1, price: 100 }, opCookie);
check('operator cannot create package', r.status === 403);

const cust = (n, extra = {}) => ({ name: 'Customer ' + n, mobile: '0171100000' + n, area: 'Mirpur', connection_date: '2026-01-05', package_id: pkgId, monthly_bill: 80000, connection_type: 'pppoe', username: 'user' + n, ...extra });
r = await call('POST', '/customers', cust(1), opCookie);
check('customer 1 created by operator', r.status === 200, r.data);
const c1 = r.data.id;
r = await call('POST', '/customers', cust(2));
const c2 = r.data.id;
r = await call('POST', '/customers', cust(3, { status: 'suspended' }));
const c3 = r.data.id;
r = await call('POST', '/customers', cust(4, { username: 'user1' }));
check('duplicate username refused', r.status === 409);
r = await call('POST', '/customers', { name: '', mobile: 'abc' });
check('invalid customer refused', r.status === 400);
r = await call('GET', '/customers/' + c1);
check('customer code generated', r.data.customer?.customer_code === 'C00001', r.data.customer);
check('subscription history started', r.data.subscriptions?.length === 1);
r = await call('GET', '/customers?q=Customer&status=active');
check('search + filter works', r.data.total === 2, r.data);

// ---- billing ----
r = await call('POST', '/invoices/generate', { billing_period: period }, opCookie);
check('operator cannot bulk generate', r.status === 403);
r = await call('POST', '/invoices/generate', { billing_period: period });
check('monthly generation creates 2 (suspended skipped)', r.data.created === 2, r.data);
r = await call('POST', '/invoices/generate', { billing_period: period });
check('generation is idempotent (0 new)', r.data.created === 0, r.data);
r = await call('POST', '/invoices', { customer_id: c1, kind: 'monthly', billing_period: period });
check('manual duplicate monthly refused', r.status === 409, r.data);
r = await call('GET', '/invoices?customer_id=' + c1);
const inv1 = r.data.invoices[0];
check('invoice numbered', /^INV-\d{6}$/.test(inv1.invoice_no), inv1);

// price change must not alter the old invoice
await call('PUT', '/packages/' + pkgId, { name: 'Home 20', download_mbps: 20, upload_mbps: 20, price: 100000 });
await call('PUT', '/customers/' + c1, cust(1, { monthly_bill: 100000 }));
r = await call('GET', '/invoices/' + inv1.id);
check('old invoice amount preserved', r.data.invoice.total === 80000 && r.data.items[0].amount === 80000, r.data);
r = await call('GET', '/customers/' + c1);
check('price change recorded in subscriptions', r.data.subscriptions.length === 2);

// ---- payments ----
r = await call('POST', '/payments', { customer_id: c1, amount: 30000, method: 'cash', invoice_id: inv1.id }, opCookie);
check('partial payment recorded', r.status === 200, r.data);
const pay1 = r.data.id;
r = await call('GET', '/invoices/' + inv1.id);
check('invoice is partial 300/800', r.data.invoice.status === 'partial' && r.data.invoice.paid_amount === 30000, r.data.invoice);
r = await call('POST', '/payments', { customer_id: c1, amount: 30000, method: 'cash', invoice_id: inv1.id }, opCookie);
check('double submit blocked', r.status === 409, r.data);
r = await call('POST', '/payments', { customer_id: c1, amount: 150000, method: 'bkash' }, opCookie);
check('bKash without transaction ID refused', r.status === 400);
r = await call('POST', '/payments', { customer_id: c1, amount: 150000, method: 'bkash', reference: 'TRX123' }, opCookie);
check('overpayment recorded', r.status === 200, r.data);
const pay2 = r.data.id;
r = await call('POST', '/payments', { customer_id: c2, amount: 100, method: 'bkash', reference: 'TRX123' }, opCookie);
check('reused transaction ID refused', r.status === 409);
r = await call('GET', '/payments/' + pay2);
check('online payment starts unverified', r.data.payment.verified === 0);
check('advance = 1500 - 500 = 1000', r.data.advance === 100000, r.data);
r = await call('GET', '/customers/' + c1);
check('customer due 0, credit 1000', r.data.customer.due === 0 && r.data.customer.credit === 100000, r.data.customer);
r = await call('POST', `/payments/${pay2}/verify`, {}, opCookie);
check('operator cannot verify', r.status === 403);
r = await call('POST', `/payments/${pay2}/verify`, {});
check('admin verifies', r.status === 200);

// advance is used by next month's bill
const next = new Date(period + '-01T00:00:00Z'); next.setUTCMonth(next.getUTCMonth() + 1);
const nextPeriod = next.toISOString().slice(0, 7);
r = await call('POST', '/invoices/generate', { billing_period: nextPeriod });
check('next month generated, advance applied', r.data.created === 2 && r.data.creditApplied === 100000, r.data);
r = await call('GET', '/invoices?customer_id=' + c1 + '&period=' + nextPeriod);
check('next invoice at new price and paid from advance', r.data.invoices[0].total === 100000 && r.data.invoices[0].status === 'paid', r.data.invoices[0]);

// reversal
r = await call('POST', `/payments/${pay1}/reverse`, { reason: 'test' }, opCookie);
check('operator cannot reverse', r.status === 403);
r = await call('POST', `/payments/${pay1}/reverse`, {});
check('reversal needs a reason', r.status === 400);
r = await call('POST', `/payments/${pay1}/reverse`, { reason: 'Entered for wrong customer' });
check('admin reverses payment', r.status === 200, r.data);
r = await call('GET', '/invoices/' + inv1.id);
check('invoice back to partial 500/800', r.data.invoice.status === 'partial' && r.data.invoice.paid_amount === 50000, r.data.invoice);
r = await call('GET', '/payments/' + pay1);
check('reversed payment still on record', r.data.payment.status === 'reversed');

// void
r = await call('GET', '/invoices?customer_id=' + c2 + '&period=' + period);
const inv2 = r.data.invoices[0];
await call('POST', '/payments', { customer_id: c2, amount: 80000, method: 'cash', invoice_id: inv2.id });
r = await call('POST', `/invoices/${inv2.id}/void`, { reason: 'Customer was away' });
check('invoice voided', r.status === 200, r.data);
r = await call('GET', '/customers/' + c2);
check('void moved money to the other invoice', r.data.customer.due === 0 && r.data.customer.credit === 0, r.data.customer);
r = await call('POST', '/invoices', { customer_id: c2, kind: 'monthly', billing_period: period });
check('can re-bill a voided period', r.status === 200, r.data);
r = await call('POST', '/invoices', { customer_id: c3, kind: 'manual', items: [{ description: 'Router', quantity: 2, unit_price: 150000 }, { description: 'Cable', quantity: 1, unit_price: 20000 }] }, opCookie);
check('manual multi-line invoice', r.status === 200, r.data);
r = await call('GET', '/invoices/' + r.data.id);
check('manual invoice total 3200', r.data.invoice.total === 320000 && r.data.items.length === 2, r.data.invoice);

// delete safeguards
r = await call('DELETE', '/customers/' + c1);
check('customer with history cannot be deleted', r.status === 409);
r = await call('POST', '/customers', cust(5));
r = await call('DELETE', '/customers/' + r.data.id, null, opCookie);
check('operator cannot delete customer', r.status === 403);
r = await call('DELETE', '/packages/' + pkgId);
check('used package cannot be deleted', r.status === 409);

// finance + reports + dashboard
r = await call('POST', '/expenses', { category: 'Bandwidth', amount: 500000, description: 'IIG bill' }, opCookie);
check('expense recorded', r.status === 200);
const expId = r.data.id;
r = await call('POST', '/income', { category: 'Connection Fee', amount: 100000 });
check('income recorded', r.status === 200);
r = await call('POST', `/expenses/${expId}/reverse`, { reason: 'x' }, opCookie);
check('operator cannot reverse expense', r.status === 403);
r = await call('GET', '/dashboard');
check('dashboard loads', r.status === 200 && r.data.customers.total === 4 && r.data.trend.length === 12, r.data);
check('dashboard income = collection + other', r.data.income === r.data.collection + 100000 && r.data.expenses === 500000, r.data);
for (const rep of ['customers', 'customers?status=active', 'monthly-billing', 'daily-collection', 'monthly-collection', 'outstanding', 'income-expense']) {
  r = await call('GET', '/reports/' + rep, null, opCookie);
  check('report ' + rep, r.status === 200 && Array.isArray(r.data.rows), r.data);
}
r = await call('GET', '/reports/income-expense');
check('net cash movement', r.data.totals.net === r.data.totals.collection + 100000 - 500000, r.data.totals);

// settings / audit / export / security
r = await call('PUT', '/settings', { isp_name: 'Test Net', billing_day: 5, language: 'bn' });
check('settings saved', r.status === 200, r.data);
r = await call('PUT', '/settings', { billing_day: 40 });
check('bad setting refused', r.status === 400);
r = await call('GET', '/audit');
check('audit history recorded', r.data.total > 15, r.data.total);
r = await call('GET', '/export?table=users');
check('export hides password hashes', r.status === 200 && !('password_hash' in r.data.rows[0]));
r = await call('GET', '/export?table=sessions');
check('sessions not exportable', r.status === 400);
let res = await fetch(BASE + '/api/customers', { method: 'POST', headers: { 'content-type': 'application/json', cookie, origin: 'https://evil.example' }, body: '{}' });
check('cross-site request blocked', res.status === 403);
r = await call('PUT', '/users/2', { full_name: 'Operator One', role: 'operator', is_active: 0 });
r = await call('GET', '/customers', null, opCookie);
check('disabled user is signed out at once', r.status === 401);
r = await call('PUT', '/users/1', { full_name: 'Admin', role: 'operator', is_active: 1 });
check('cannot demote yourself', r.status === 400);
r = await call('POST', '/auth/logout', {});
r = await call('GET', '/customers');
check('logout ends the session', r.status === 401);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
