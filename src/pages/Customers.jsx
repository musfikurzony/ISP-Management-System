import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { useApp, useDebounced, useLoad } from '../lib/app.jsx';
import { fromPaisa, toPaisa, todayDhaka } from '../lib/format.js';
import { STATUS_LABEL, TYPE_LABEL } from '../lib/labels.js';
import { Badge, Button, Card, DataTable, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Textarea } from '../components/ui.jsx';

const EMPTY = { name: '', mobile: '', address: '', area: '', connection_date: '', package_id: '', monthly_bill: '', connection_type: 'pppoe', username: '', status: 'active', notes: '' };

// Add / edit form, shared with the customer profile page.
export function CustomerForm({ customer, onClose, onSaved }) {
  const { t, money } = useApp();
  const [f, setF] = useState(() =>
    customer
      ? { ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, customer[k] ?? ''])), monthly_bill: fromPaisa(customer.monthly_bill) }
      : { ...EMPTY, connection_date: todayDhaka() }
  );
  const [packages, setPackages] = useState([]);
  const [areas, setAreas] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/packages').then((d) => setPackages(d.packages)).catch(() => {});
    api.get('/customers/areas').then((d) => setAreas(d.areas)).catch(() => {});
  }, []);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pickPackage = (e) => {
    const p = packages.find((x) => String(x.id) === e.target.value);
    // choosing a package fills in its price; the bill can still be adjusted for this customer
    setF({ ...f, package_id: e.target.value, monthly_bill: p ? fromPaisa(p.price) : f.monthly_bill });
  };
  const submit = async (e) => {
    e.preventDefault();
    const bill = toPaisa(f.monthly_bill);
    if (bill === null) return setError(t('Monthly bill is not a valid amount.'));
    setBusy(true);
    setError('');
    try {
      const body = { ...f, package_id: f.package_id || null, monthly_bill: bill };
      const res = customer ? await api.put(`/customers/${customer.id}`, body) : await api.post('/customers', body);
      onSaved(customer ? customer.id : res.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal wide title={customer ? t('Edit customer') : t('Add customer')} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorNote>{error}</ErrorNote>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Name')} required><Input value={f.name} onChange={set('name')} required maxLength={100} autoFocus /></Field>
          <Field label={t('Mobile number')} required><Input value={f.mobile} onChange={set('mobile')} required maxLength={20} inputMode="tel" placeholder="01XXXXXXXXX" /></Field>
          <Field label={t('Address')} className="sm:col-span-2"><Input value={f.address} onChange={set('address')} maxLength={300} /></Field>
          <Field label={t('Area')}>
            <Input value={f.area} onChange={set('area')} maxLength={80} list="area-list" />
            <datalist id="area-list">{areas.map((a) => <option key={a} value={a} />)}</datalist>
          </Field>
          <Field label={t('Connection date')} required><Input type="date" value={f.connection_date} onChange={set('connection_date')} required /></Field>
          <Field label={t('Internet package')}>
            <Select value={f.package_id} onChange={pickPackage}>
              <option value="">{t('— No package —')}</option>
              {packages.filter((p) => p.is_active || String(p.id) === String(f.package_id)).map((p) => (
                <option key={p.id} value={p.id}>{p.name} · {p.download_mbps} Mbps · {money(p.price)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('Monthly bill (Taka)')} required hint={t('Filled from the package. Change it only if this customer pays a different amount.')}>
            <Input value={f.monthly_bill} onChange={set('monthly_bill')} required inputMode="decimal" />
          </Field>
          <Field label={t('Connection type')} required>
            <Select value={f.connection_type} onChange={set('connection_type')}>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </Select>
          </Field>
          <Field label={t('Username (optional)')}><Input value={f.username} onChange={set('username')} maxLength={60} autoCapitalize="none" /></Field>
          <Field label={t('Connection status')} required>
            <Select value={f.status} onChange={set('status')}>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </Select>
          </Field>
          <Field label={t('Notes')} className="sm:col-span-2"><Textarea value={f.notes} onChange={set('notes')} maxLength={1000} /></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" type="submit" busy={busy}>{t('Save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function Customers() {
  const { t, money } = useApp();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ q: '', status: '', area: '', package_id: '' });
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [lists, setLists] = useState({ areas: [], packages: [] });
  const q = useDebounced(filters.q);
  const { data, loading, error } = useLoad(
    () => api.get('/customers' + qs({ ...filters, q, page })),
    [q, filters.status, filters.area, filters.package_id, page]
  );
  useEffect(() => {
    Promise.all([api.get('/customers/areas'), api.get('/packages')]).then(([a, p]) => setLists({ areas: a.areas, packages: p.packages })).catch(() => {});
  }, []);
  const setFilter = (k) => (e) => { setFilters({ ...filters, [k]: e.target.value }); setPage(1); };

  return (
    <>
      <PageHeader title={t('Customers')} subtitle={data ? `${data.total} ${t('customers')}` : ''}>
        <Button variant="primary" onClick={() => setAdding(true)}>+ {t('Add customer')}</Button>
      </PageHeader>
      <Card pad={false}>
        <div className="grid gap-2 border-b border-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input type="search" placeholder={t('Search name, mobile, ID, username…')} value={filters.q} onChange={setFilter('q')} />
          <Select value={filters.status} onChange={setFilter('status')} aria-label={t('Status')}>
            <option value="">{t('All statuses')}</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </Select>
          <Select value={filters.area} onChange={setFilter('area')} aria-label={t('Area')}>
            <option value="">{t('All areas')}</option>
            {lists.areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
          <Select value={filters.package_id} onChange={setFilter('package_id')} aria-label={t('Package')}>
            <option value="">{t('All packages')}</option>
            {lists.packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <DataTable
          loading={loading}
          rows={data?.customers}
          onRowClick={(r) => navigate(`/customers/${r.id}`)}
          empty={t('No customers found. Use "Add customer" to create one.')}
          columns={[
            { key: 'customer_code', label: t('ID'), className: 'whitespace-nowrap text-slate-500' },
            { key: 'name', label: t('Name'), render: (r) => <Link to={`/customers/${r.id}`} className="font-medium text-slate-900 hover:underline" onClick={(e) => e.stopPropagation()}>{r.name}</Link> },
            { key: 'mobile', label: t('Mobile'), className: 'whitespace-nowrap' },
            { key: 'area', label: t('Area') },
            { key: 'package_name', label: t('Package') },
            { key: 'monthly_bill', label: t('Monthly bill'), right: true, render: (r) => money(r.monthly_bill) },
            { key: 'due', label: t('Due'), right: true, render: (r) => (r.due > 0 ? <span className="font-medium text-red-700">{money(r.due)}</span> : '—') },
            { key: 'status', label: t('Status'), render: (r) => <Badge status={r.status} /> },
          ]}
        />
        {data && <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
      </Card>
      {adding && <CustomerForm onClose={() => setAdding(false)} onSaved={(id) => navigate(`/customers/${id}`)} />}
    </>
  );
}
