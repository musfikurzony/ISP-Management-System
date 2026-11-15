import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { useApp, useDebounced, useLoad } from '../lib/app.jsx';
import { fromPaisa, monthStart, toPaisa, todayDhaka } from '../lib/format.js';
import { METHODS, METHOD_LABEL } from '../lib/labels.js';
import CustomerPicker from '../components/CustomerPicker.jsx';
import { Badge, Button, Card, DataTable, ErrorNote, Field, InfoNote, Input, Modal, PageHeader, Pagination, Select, Textarea } from '../components/ui.jsx';

// "Record payment" form. Used from the Payments page, a customer profile and an invoice.
export function PaymentForm({ customer, invoiceId, onClose, onSaved }) {
  const { t, money, date, period } = useApp();
  const [cust, setCust] = useState(customer || null);
  const [open, setOpen] = useState([]);
  const [f, setF] = useState({ invoice_id: invoiceId ? String(invoiceId) : '', amount: '', method: 'cash', reference: '', payment_date: todayDhaka(), notes: '', verified: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // Load the customer's outstanding invoices and suggest the amount due.
  useEffect(() => {
    if (!cust) return setOpen([]);
    let alive = true;
    api.get(`/payments/open/${cust.id}`).then((d) => {
      if (!alive) return;
      setOpen(d.invoices);
      const chosen = d.invoices.find((i) => String(i.id) === String(invoiceId));
      const suggested = chosen ? chosen.due : d.invoices.reduce((s, i) => s + i.due, 0);
      setF((cur) => ({ ...cur, amount: cur.amount || (suggested ? fromPaisa(suggested) : '') }));
    }).catch(() => {});
    return () => { alive = false; };
  }, [cust, invoiceId]);

  const totalDue = open.reduce((s, i) => s + i.due, 0);
  const amount = toPaisa(f.amount);
  const online = f.method !== 'cash' && f.method !== 'other';
  const pickInvoice = (e) => {
    const inv = open.find((i) => String(i.id) === e.target.value);
    setF({ ...f, invoice_id: e.target.value, amount: fromPaisa(inv ? inv.due : totalDue) });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!cust) return setError(t('Please select a customer.'));
    if (!amount) return setError(t('Amount is not valid.'));
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/payments', {
        customer_id: cust.id,
        invoice_id: f.invoice_id || null,
        amount,
        method: f.method,
        reference: f.reference,
        payment_date: f.payment_date,
        notes: f.notes,
        verified: f.verified,
      });
      onSaved(res.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={t('Record payment')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        <Field label={t('Customer')} required><CustomerPicker value={cust} onChange={(c) => { setCust(c); setF((cur) => ({ ...cur, invoice_id: '', amount: '' })); }} autoFocus={!customer} /></Field>
        {cust && (
          <Field label={t('Outstanding invoice')} hint={open.length ? `${t('Total due')}: ${money(totalDue)}` : t('This customer has no unpaid invoice. The payment will be kept as advance.')}>
            <Select value={f.invoice_id} onChange={pickInvoice} disabled={!open.length}>
              <option value="">{t('Automatic — oldest unpaid invoice first')}</option>
              {open.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.invoice_no} · {i.billing_period ? period(i.billing_period) : t('One-time charge')} · {t('Due')} {money(i.due)} · {date(i.due_date)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Amount (Taka)')} required><Input value={f.amount} onChange={set('amount')} required inputMode="decimal" /></Field>
          <Field label={t('Payment date')} required><Input type="date" value={f.payment_date} max={todayDhaka()} onChange={set('payment_date')} required /></Field>
        </div>
        {cust && amount > totalDue && (
          <InfoNote>{t('This is more than the customer owes. The extra will be saved as advance:')} <b>{money(amount - totalDue)}</b></InfoNote>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Payment method')} required>
            <Select value={f.method} onChange={set('method')}>
              {METHODS.map((m) => <option key={m} value={m}>{t(METHOD_LABEL[m])}</option>)}
            </Select>
          </Field>
          <Field label={online ? t('Transaction ID') : t('Reference (optional)')} required={online}>
            <Input value={f.reference} onChange={set('reference')} required={online} maxLength={80} />
          </Field>
        </div>
        {f.method !== 'cash' && (
          <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <input type="checkbox" className="mt-0.5" checked={f.verified} onChange={(e) => setF({ ...f, verified: e.target.checked })} />
            <span>{t('I have checked the merchant / bank account and this money was really received. Leave unticked if you have not checked yet; an administrator can verify it later.')}</span>
          </label>
        )}
        <Field label={t('Notes')}><Textarea value={f.notes} onChange={set('notes')} maxLength={300} /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="success" type="submit" busy={busy}>{t('Save payment')}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function Payments() {
  const { t, money, date } = useApp();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ q: '', from: monthStart(), to: todayDhaka(), collector: '', method: '', unverified: '' });
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [collectors, setCollectors] = useState([]);
  const q = useDebounced(filters.q);
  const { data, loading, error } = useLoad(
    () => api.get('/payments' + qs({ ...filters, q, page })),
    [q, filters.from, filters.to, filters.collector, filters.method, filters.unverified, page]
  );
  useEffect(() => { api.get('/payments/collectors').then((d) => setCollectors(d.collectors)).catch(() => {}); }, []);
  const setFilter = (k) => (e) => { setFilters({ ...filters, [k]: e.target.value }); setPage(1); };

  return (
    <>
      <PageHeader title={t('Payments')} subtitle={data ? `${data.total} ${t('payments')} · ${t('Total')} ${money(data.sum_amount)}` : ''}>
        <Button variant="success" onClick={() => setAdding(true)}>+ {t('Record payment')}</Button>
      </PageHeader>
      <Card pad={false}>
        <div className="grid gap-2 border-b border-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-6">
          <Input className="lg:col-span-2" type="search" placeholder={t('Search receipt, transaction ID, customer…')} value={filters.q} onChange={setFilter('q')} />
          <Input type="date" value={filters.from} onChange={setFilter('from')} aria-label={t('From')} />
          <Input type="date" value={filters.to} onChange={setFilter('to')} aria-label={t('To')} />
          <Select value={filters.collector} onChange={setFilter('collector')} aria-label={t('Collected by')}>
            <option value="">{t('All collectors')}</option>
            {collectors.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </Select>
          <Select value={filters.method + (filters.unverified ? '!' : '')} onChange={(e) => { const val = e.target.value; setFilters({ ...filters, method: val === '!' ? '' : val, unverified: val === '!' ? '1' : '' }); setPage(1); }} aria-label={t('Method')}>
            <option value="">{t('All methods')}</option>
            {METHODS.map((m) => <option key={m} value={m}>{t(METHOD_LABEL[m])}</option>)}
            <option value="!">{t('Not verified')}</option>
          </Select>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <DataTable
          loading={loading}
          rows={data?.payments}
          onRowClick={(r) => navigate(`/payments/${r.id}`)}
          empty={t('No payments match these filters.')}
          columns={[
            { key: 'receipt_no', label: t('Receipt'), render: (r) => <Link className="font-medium text-blue-700 hover:underline" to={`/payments/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.receipt_no}</Link> },
            { key: 'payment_date', label: t('Date'), render: (r) => date(r.payment_date), className: 'whitespace-nowrap' },
            { key: 'customer_name', label: t('Customer'), render: (r) => <><span className="font-medium text-slate-900">{r.customer_name}</span> <span className="text-xs text-slate-500">{r.customer_code}</span></> },
            { key: 'method', label: t('Method'), render: (r) => <>{t(METHOD_LABEL[r.method])}{r.reference && <span className="block text-xs text-slate-500">{r.reference}</span>}</> },
            { key: 'collector', label: t('Collected by') },
            { key: 'amount', label: t('Amount'), right: true, render: (r) => <span className={r.status === 'reversed' ? 'text-slate-400 line-through' : ''}>{money(r.amount)}</span> },
            { key: 'status', label: t('Status'), render: (r) => (r.status === 'reversed' ? <Badge status="reversed" /> : <Badge status={r.verified ? 'verified' : 'unverified'} />) },
          ]}
        />
        {data && <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
      </Card>
      {adding && <PaymentForm onClose={() => setAdding(false)} onSaved={(id) => navigate(`/payments/${id}`)} />}
    </>
  );
}
