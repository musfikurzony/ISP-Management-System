// One invoice, laid out so it prints cleanly on A4, A5 or an 80mm receipt printer.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp, useLoad } from '../lib/app.jsx';
import { METHOD_LABEL } from '../lib/labels.js';
import { Badge, Button, ConfirmModal, ErrorNote, InfoNote, Letterhead, PaperSize, Spinner } from '../components/ui.jsx';
import { PaymentForm } from './Payments.jsx';

export default function InvoiceView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, money, date, period, settings, isAdmin } = useApp();
  const { data, loading, error, reload } = useLoad(() => api.get(`/invoices/${id}`), [id]);
  const [modal, setModal] = useState(null);
  if (!data) return loading ? <Spinner /> : <ErrorNote>{error}</ErrorNote>;
  const inv = data.invoice;
  const due = inv.status === 'void' ? 0 : inv.total - inv.paid_amount;
  const pos = settings.invoice_format === 'pos';
  const customer = { id: inv.customer_id, name: inv.customer_name, customer_code: inv.customer_code, mobile: inv.mobile };

  return (
    <>
      <PaperSize format={settings.invoice_format} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 no-print">
        <Button onClick={() => navigate(-1)}>‹ {t('Back')}</Button>
        <div className="flex flex-wrap gap-2">
          {isAdmin && inv.status !== 'void' && <Button variant="danger" onClick={() => setModal('void')}>{t('Void invoice')}</Button>}
          {due > 0 && <Button variant="success" onClick={() => setModal('pay')}>{t('Record payment')}</Button>}
          <Button variant="primary" onClick={() => window.print()}>{t('Print')}</Button>
        </div>
      </div>
      {inv.status === 'void' && <InfoNote color="amber">{t('This invoice is void.')} {t('Reason')}: {inv.void_reason}</InfoNote>}

      <div className={'print-plain mx-auto rounded-xl border border-slate-200 bg-white shadow-sm ' + (pos ? 'max-w-xs p-4 text-xs' : 'max-w-3xl p-6 sm:p-8')}>
        <div className={pos ? 'mb-3 border-b border-dashed border-slate-400 pb-3' : 'mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5'}>
          <Letterhead compact={pos} />
          <div className={pos ? 'mt-2 text-center' : 'text-right'}>
            <div className={'font-bold uppercase tracking-wide text-slate-900 ' + (pos ? 'text-sm' : 'text-2xl')}>{t('Invoice')}</div>
            <div className="font-medium text-slate-700">{inv.invoice_no}</div>
            <div className="mt-1 no-print"><Badge status={inv.status} /></div>
          </div>
        </div>

        <div className={pos ? 'mb-3 space-y-2' : 'mb-6 grid gap-4 sm:grid-cols-2'}>
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">{t('Bill to')}</div>
            <div className="font-semibold text-slate-900">
              <Link to={`/customers/${inv.customer_id}`} className="hover:underline">{inv.customer_name}</Link>
            </div>
            <div className="text-slate-600">{t('Customer ID')}: {inv.customer_code}</div>
            <div className="text-slate-600">{inv.mobile}</div>
            {(inv.address || inv.area) && <div className="text-slate-600">{[inv.address, inv.area].filter(Boolean).join(', ')}</div>}
          </div>
          <dl className={pos ? '' : 'sm:text-right'}>
            <div><dt className="inline text-slate-500">{t('Invoice date')}: </dt><dd className="inline font-medium">{date(inv.issue_date)}</dd></div>
            <div><dt className="inline text-slate-500">{t('Due date')}: </dt><dd className="inline font-medium">{date(inv.due_date)}</dd></div>
            {inv.billing_period && <div><dt className="inline text-slate-500">{t('Billing month')}: </dt><dd className="inline font-medium">{period(inv.billing_period)}</dd></div>}
          </dl>
        </div>

        <table className="w-full text-left">
          <thead>
            <tr className="border-y border-slate-300 text-xs uppercase text-slate-500">
              <th className="py-2 pr-2">{t('Description')}</th>
              <th className="px-2 py-2 text-right">{t('Qty')}</th>
              {!pos && <th className="px-2 py-2 text-right">{t('Price')}</th>}
              <th className="py-2 pl-2 text-right">{t('Amount')}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-2 pr-2">{it.description}</td>
                <td className="px-2 py-2 text-right num">{it.quantity}</td>
                {!pos && <td className="px-2 py-2 text-right num">{money(it.unit_price)}</td>}
                <td className="py-2 pl-2 text-right num">{money(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <dl className={'space-y-1 ' + (pos ? 'w-full' : 'w-64')}>
            <div className="flex justify-between"><dt className="text-slate-600">{t('Total')}</dt><dd className="font-semibold num">{money(inv.total)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">{t('Paid')}</dt><dd className="num">{money(inv.paid_amount)}</dd></div>
            <div className="flex justify-between border-t border-slate-300 pt-1 text-base"><dt className="font-semibold">{t('Balance due')}</dt><dd className="font-bold num">{money(due)}</dd></div>
          </dl>
        </div>

        {data.payments.length > 0 && (
          <div className="mt-5">
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">{t('Payments received')}</div>
            {data.payments.map((p, i) => (
              <div key={i} className="flex justify-between border-b border-slate-100 py-1 text-sm">
                <span><Link to={`/payments/${p.payment_id}`} className="text-blue-700 hover:underline">{p.receipt_no}</Link> · {date(p.payment_date)} · {t(METHOD_LABEL[p.method])}</span>
                <span className="num">{money(p.amount)}</span>
              </div>
            ))}
          </div>
        )}
        {inv.notes && <p className="mt-4 text-sm text-slate-600">{t('Notes')}: {inv.notes}</p>}
        {settings.invoice_footer && <p className="mt-6 border-t border-slate-200 pt-3 text-center text-xs text-slate-500">{settings.invoice_footer}</p>}
      </div>

      {modal === 'pay' && <PaymentForm customer={customer} invoiceId={inv.id} onClose={() => setModal(null)} onSaved={(pid) => navigate(`/payments/${pid}`)} />}
      {modal === 'void' && (
        <ConfirmModal
          danger needReason
          title={t('Void invoice')}
          message={t('The invoice stays on record but no longer counts. Money already paid against it goes back to the customer as advance.')}
          confirmLabel={t('Void invoice')}
          onClose={() => setModal(null)}
          onConfirm={async (reason) => { await api.post(`/invoices/${id}/void`, { reason }); reload(); }}
        />
      )}
    </>
  );
}
