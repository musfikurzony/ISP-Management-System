import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp, useLoad } from '../lib/app.jsx';
import { METHOD_LABEL, STATUS_LABEL, TYPE_LABEL } from '../lib/labels.js';
import { Badge, Button, Card, ConfirmModal, DataTable, ErrorNote, PageHeader, Select, Spinner, StatCard } from '../components/ui.jsx';
import { CustomerForm } from './Customers.jsx';
import { PaymentForm } from './Payments.jsx';
import { InvoiceForm } from './Invoices.jsx';

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{children || '—'}</dd>
    </div>
  );
}

export default function CustomerProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, money, date, period, isAdmin } = useApp();
  const { data, loading, error, reload } = useLoad(() => api.get(`/customers/${id}`), [id]);
  const [modal, setModal] = useState(null);
  const [actionError, setActionError] = useState('');

  if (!data) return loading ? <Spinner /> : <ErrorNote>{error}</ErrorNote>;
  const c = data.customer;
  const changeStatus = async (e) => {
    setActionError('');
    try {
      await api.post(`/customers/${id}/status`, { status: e.target.value });
      reload();
    } catch (err) {
      setActionError(err.message);
    }
  };

  return (
    <>
      <PageHeader title={c.name} subtitle={`${c.customer_code} · ${c.mobile}`}>
        <Button onClick={() => navigate('/customers')}>‹ {t('Back')}</Button>
        <Button onClick={() => setModal('edit')}>{t('Edit')}</Button>
        <Button onClick={() => setModal('invoice')}>{t('New invoice')}</Button>
        <Button variant="success" onClick={() => setModal('pay')}>{t('Record payment')}</Button>
      </PageHeader>
      <ErrorNote>{actionError || error}</ErrorNote>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard accent={c.due > 0 ? 'red' : 'green'} label={t('Outstanding balance')} value={money(c.due)} />
        <StatCard accent="blue" label={t('Advance balance')} value={money(c.credit)} note={t('Used automatically for the next bill')} />
        <StatCard label={t('Monthly bill')} value={money(c.monthly_bill)} note={c.package_name} />
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-1 text-xs font-medium text-slate-500">{t('Connection status')}</div>
          <Select value={c.status} onChange={changeStatus}>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </Select>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title={t('Customer details')}>
          <dl>
            <Row label={t('Customer ID')}>{c.customer_code}</Row>
            <Row label={t('Mobile number')}>{c.mobile}</Row>
            <Row label={t('Address')}>{c.address}</Row>
            <Row label={t('Area')}>{c.area}</Row>
            <Row label={t('Connection date')}>{date(c.connection_date)}</Row>
            <Row label={t('Internet package')}>{c.package_name && `${c.package_name} (${c.download_mbps}/${c.upload_mbps} Mbps)`}</Row>
            <Row label={t('Connection type')}>{t(TYPE_LABEL[c.connection_type])}</Row>
            <Row label={t('Username')}>{c.username}</Row>
            <Row label={t('Notes')}>{c.notes}</Row>
          </dl>
          {isAdmin && (
            <div className="mt-3 border-t border-slate-100 pt-3 text-right">
              <Button small variant="danger" onClick={() => setModal('delete')}>{t('Delete customer')}</Button>
            </div>
          )}
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card title={t('Invoice history')} pad={false}>
            <DataTable
              rows={data.invoices}
              empty={t('No invoices yet.')}
              columns={[
                { key: 'invoice_no', label: t('Invoice'), render: (r) => <Link className="font-medium text-blue-700 hover:underline" to={`/invoices/${r.id}`}>{r.invoice_no}</Link> },
                { key: 'billing_period', label: t('Month'), render: (r) => (r.billing_period ? period(r.billing_period) : t('One-time charge')), className: 'whitespace-nowrap' },
                { key: 'due_date', label: t('Due date'), render: (r) => date(r.due_date), className: 'whitespace-nowrap' },
                { key: 'total', label: t('Amount'), right: true, render: (r) => money(r.total) },
                { key: 'paid_amount', label: t('Paid'), right: true, render: (r) => money(r.paid_amount) },
                { key: 'status', label: t('Status'), render: (r) => <Badge status={r.status} /> },
              ]}
            />
          </Card>
          <Card title={t('Payment history')} pad={false}>
            <DataTable
              rows={data.payments}
              empty={t('No payments yet.')}
              columns={[
                { key: 'receipt_no', label: t('Receipt'), render: (r) => <Link className="font-medium text-blue-700 hover:underline" to={`/payments/${r.id}`}>{r.receipt_no}</Link> },
                { key: 'payment_date', label: t('Date'), render: (r) => date(r.payment_date), className: 'whitespace-nowrap' },
                { key: 'method', label: t('Method'), render: (r) => t(METHOD_LABEL[r.method]) },
                { key: 'collector', label: t('Collected by') },
                { key: 'amount', label: t('Amount'), right: true, render: (r) => money(r.amount) },
                { key: 'status', label: t('Status'), render: (r) => (r.status === 'reversed' ? <Badge status="reversed" /> : <Badge status={r.verified ? 'verified' : 'unverified'} />) },
              ]}
            />
          </Card>
          <Card title={t('Package and price history')} pad={false}>
            <DataTable
              rows={data.subscriptions}
              columns={[
                { key: 'package_name', label: t('Package'), render: (r) => r.package_name || '—' },
                { key: 'monthly_price', label: t('Monthly bill'), right: true, render: (r) => money(r.monthly_price) },
                { key: 'start_date', label: t('From'), render: (r) => date(r.start_date) },
                { key: 'end_date', label: t('To'), render: (r) => (r.end_date ? date(r.end_date) : t('Current')) },
              ]}
            />
          </Card>
        </div>
      </div>

      {modal === 'edit' && <CustomerForm customer={c} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal === 'pay' && <PaymentForm customer={c} onClose={() => setModal(null)} onSaved={(pid) => navigate(`/payments/${pid}`)} />}
      {modal === 'invoice' && <InvoiceForm customer={c} onClose={() => setModal(null)} onSaved={(iid) => navigate(`/invoices/${iid}`)} />}
      {modal === 'delete' && (
        <ConfirmModal
          danger
          title={t('Delete customer')}
          message={t('Delete this customer permanently? This is only possible when the customer has no invoices or payments.')}
          confirmLabel={t('Delete')}
          onClose={() => setModal(null)}
          onConfirm={async () => { await api.del(`/customers/${id}`); navigate('/customers'); }}
        />
      )}
    </>
  );
}
