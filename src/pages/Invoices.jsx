import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { useApp, useDebounced, useLoad } from '../lib/app.jsx';
import { fromPaisa, toPaisa, todayDhaka } from '../lib/format.js';
import CustomerPicker from '../components/CustomerPicker.jsx';
import { Badge, Button, Card, DataTable, ErrorNote, Field, InfoNote, Input, Modal, PageHeader, Pagination, Select, Textarea } from '../components/ui.jsx';

// Manual invoice for one customer: a monthly bill or a one-time charge.
export function InvoiceForm({ customer, onClose, onSaved }) {
  const { t, money } = useApp();
  const [cust, setCust] = useState(customer || null);
  const [kind, setKind] = useState('monthly');
  const [periodVal, setPeriodVal] = useState(todayDhaka().slice(0, 7));
  const [amount, setAmount] = useState('');
  const [items, setItems] = useState([{ description: '', quantity: 1, unit_price: '' }]);
  const [issue, setIssue] = useState(todayDhaka());
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const setItem = (i, k, val) => setItems(items.map((it, n) => (n === i ? { ...it, [k]: val } : it)));
  const itemsTotal = items.reduce((s, it) => s + (toPaisa(it.unit_price) || 0) * (parseInt(it.quantity, 10) || 0), 0);

  const submit = async (e) => {
    e.preventDefault();
    if (!cust) return setError(t('Please select a customer.'));
    const body = { customer_id: cust.id, kind, issue_date: issue, due_date: due || undefined, notes };
    if (kind === 'monthly') {
      body.billing_period = periodVal;
      if (amount !== '') {
        body.amount = toPaisa(amount);
        if (!body.amount) return setError(t('Amount is not valid.'));
      }
    } else {
      body.items = items.map((it) => ({ description: it.description, quantity: parseInt(it.quantity, 10), unit_price: toPaisa(it.unit_price) }));
      if (body.items.some((it) => it.unit_price === null || !it.quantity)) return setError(t('Please fill in every line correctly.'));
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/invoices', body);
      onSaved(res.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal wide title={t('New invoice')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        <Field label={t('Customer')} required><CustomerPicker value={cust} onChange={setCust} autoFocus={!customer} /></Field>
        <Field label={t('Invoice type')}>
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="monthly">{t('Monthly internet bill')}</option>
            <option value="manual">{t('One-time charge (connection fee, router, cable…)')}</option>
          </Select>
        </Field>
        {kind === 'monthly' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Billing month')} required><Input type="month" value={periodVal} onChange={(e) => setPeriodVal(e.target.value)} required /></Field>
            <Field label={t('Amount (Taka)')} hint={cust ? `${t('Leave empty to use the monthly bill:')} ${money(cust.monthly_bill)}` : null}>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={cust ? fromPaisa(cust.monthly_bill) : ''} />
            </Field>
          </div>
        ) : (
          <div>
            <div className="mb-1 text-sm font-medium text-slate-700">{t('Invoice lines')}</div>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <Input className="col-span-6" placeholder={t('Description')} value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} required maxLength={200} />
                  <Input className="col-span-2" type="number" min="1" placeholder={t('Qty')} value={it.quantity} onChange={(e) => setItem(i, 'quantity', e.target.value)} required />
                  <Input className="col-span-3" placeholder={t('Price')} inputMode="decimal" value={it.unit_price} onChange={(e) => setItem(i, 'unit_price', e.target.value)} required />
                  <button type="button" className="col-span-1 text-slate-400 hover:text-red-600 disabled:opacity-30" disabled={items.length === 1} onClick={() => setItems(items.filter((_, n) => n !== i))} aria-label="Remove">✕</button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <Button small onClick={() => setItems([...items, { description: '', quantity: 1, unit_price: '' }])}>+ {t('Add line')}</Button>
              <span className="text-sm font-semibold text-slate-900 num">{t('Total')}: {money(itemsTotal)}</span>
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Invoice date')} required><Input type="date" value={issue} onChange={(e) => setIssue(e.target.value)} required /></Field>
          <Field label={t('Due date')} hint={t('Leave empty to use the default from Settings.')}><Input type="date" value={due} min={issue} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <Field label={t('Notes')}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" type="submit" busy={busy}>{t('Create invoice')}</Button>
        </div>
      </form>
    </Modal>
  );
}

// Bulk monthly billing for every active customer.
function GenerateModal({ onClose, onDone }) {
  const { t, period, money } = useApp();
  const [periodVal, setPeriodVal] = useState(todayDhaka().slice(0, 7));
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      setResult(await api.post('/invoices/generate', { billing_period: periodVal }));
      onDone();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };
  return (
    <Modal title={t('Generate monthly bills')} onClose={onClose}>
      <ErrorNote>{error}</ErrorNote>
      {result ? (
        <>
          <InfoNote color="green">
            <div className="font-semibold">{period(result.period)}: {result.created} {t('new invoices created')}</div>
            {result.created === 0 && <div>{t('Every active customer already has a bill for this month. Nothing was duplicated.')}</div>}
            {result.creditApplied > 0 && <div>{t('Paid automatically from customer advance:')} {money(result.creditApplied)}</div>}
          </InfoNote>
          <div className="text-right"><Button onClick={onClose}>{t('Close')}</Button></div>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-600">
            {t('Creates one bill for every Active customer for the chosen month. It is safe to run more than once: customers who already have a bill for that month are skipped.')}
          </p>
          <Field label={t('Billing month')} required><Input type="month" value={periodVal} onChange={(e) => setPeriodVal(e.target.value)} /></Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={onClose}>{t('Cancel')}</Button>
            <Button variant="primary" busy={busy} disabled={!periodVal} onClick={run}>{t('Generate bills')}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

export default function Invoices() {
  const { t, money, date, period, isAdmin } = useApp();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ q: '', status: 'open', period: '' });
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const q = useDebounced(filters.q);
  const { data, loading, error, reload } = useLoad(() => api.get('/invoices' + qs({ ...filters, q, page })), [q, filters.status, filters.period, page]);
  const setFilter = (k) => (e) => { setFilters({ ...filters, [k]: e.target.value }); setPage(1); };
  const today = todayDhaka();

  return (
    <>
      <PageHeader title={t('Billing')} subtitle={data ? `${data.total} ${t('invoices')} · ${t('Total')} ${money(data.sum_total)} · ${t('Due')} ${money(data.sum_total - data.sum_paid)}` : ''}>
        {isAdmin && <Button onClick={() => setModal('generate')}>{t('Generate monthly bills')}</Button>}
        <Button variant="primary" onClick={() => setModal('new')}>+ {t('New invoice')}</Button>
      </PageHeader>
      <Card pad={false}>
        <div className="grid gap-2 border-b border-slate-100 p-3 sm:grid-cols-3">
          <Input type="search" placeholder={t('Search invoice no., customer, mobile…')} value={filters.q} onChange={setFilter('q')} />
          <Select value={filters.status} onChange={setFilter('status')} aria-label={t('Status')}>
            <option value="open">{t('Outstanding (unpaid + partial)')}</option>
            <option value="overdue">{t('Overdue')}</option>
            <option value="">{t('All invoices')}</option>
            <option value="unpaid">{t('Unpaid')}</option>
            <option value="partial">{t('Partial')}</option>
            <option value="paid">{t('Paid')}</option>
            <option value="void">{t('Void')}</option>
          </Select>
          <Input type="month" value={filters.period} onChange={setFilter('period')} aria-label={t('Billing month')} />
        </div>
        <ErrorNote>{error}</ErrorNote>
        <DataTable
          loading={loading}
          rows={data?.invoices}
          onRowClick={(r) => navigate(`/invoices/${r.id}`)}
          empty={t('No invoices match these filters.')}
          columns={[
            { key: 'invoice_no', label: t('Invoice'), render: (r) => <Link className="font-medium text-blue-700 hover:underline" to={`/invoices/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.invoice_no}</Link> },
            { key: 'customer_name', label: t('Customer'), render: (r) => <><span className="font-medium text-slate-900">{r.customer_name}</span> <span className="text-xs text-slate-500">{r.customer_code}</span></> },
            { key: 'billing_period', label: t('Month'), render: (r) => (r.billing_period ? period(r.billing_period) : t('One-time charge')), className: 'whitespace-nowrap' },
            { key: 'due_date', label: t('Due date'), className: 'whitespace-nowrap', render: (r) => <span className={r.due_date < today && (r.status === 'unpaid' || r.status === 'partial') ? 'font-medium text-red-700' : ''}>{date(r.due_date)}</span> },
            { key: 'total', label: t('Amount'), right: true, render: (r) => money(r.total) },
            { key: 'paid_amount', label: t('Paid'), right: true, render: (r) => money(r.paid_amount) },
            { key: 'due', label: t('Due'), right: true, render: (r) => (r.status === 'void' ? '—' : money(r.total - r.paid_amount)) },
            { key: 'status', label: t('Status'), render: (r) => <Badge status={r.status} /> },
          ]}
        />
        {data && <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
      </Card>
      {modal === 'new' && <InvoiceForm onClose={() => setModal(null)} onSaved={(id) => navigate(`/invoices/${id}`)} />}
      {modal === 'generate' && <GenerateModal onClose={() => setModal(null)} onDone={reload} />}
    </>
  );
}
