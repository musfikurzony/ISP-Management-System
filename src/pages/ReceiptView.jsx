// Printable money receipt for one payment.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp, useLoad } from '../lib/app.jsx';
import { METHOD_LABEL } from '../lib/labels.js';
import { Badge, Button, ConfirmModal, ErrorNote, InfoNote, Letterhead, PaperSize, Spinner } from '../components/ui.jsx';

export default function ReceiptView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, money, date, dateTime, period, settings, isAdmin } = useApp();
  const { data, loading, error, reload } = useLoad(() => api.get(`/payments/${id}`), [id]);
  const [modal, setModal] = useState(null);
  const [actionError, setActionError] = useState('');
  if (!data) return loading ? <Spinner /> : <ErrorNote>{error}</ErrorNote>;
  const p = data.payment;
  const pos = settings.receipt_format === 'pos';
  const reversed = p.status === 'reversed';
  const verify = async () => {
    setActionError('');
    try { await api.post(`/payments/${id}/verify`); reload(); } catch (e) { setActionError(e.message); }
  };
  const Line = ({ label, children, bold }) => (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className={'text-right num ' + (bold ? 'font-bold text-slate-900' : 'font-medium text-slate-800')}>{children}</dd>
    </div>
  );

  return (
    <>
      <PaperSize format={settings.receipt_format} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 no-print">
        <Button onClick={() => navigate(-1)}>‹ {t('Back')}</Button>
        <div className="flex flex-wrap gap-2">
          {isAdmin && !reversed && !p.verified && <Button onClick={verify}>{t('Mark as verified')}</Button>}
          {isAdmin && !reversed && <Button variant="danger" onClick={() => setModal('reverse')}>{t('Reverse payment')}</Button>}
          <Button variant="primary" onClick={() => window.print()}>{t('Print receipt')}</Button>
        </div>
      </div>
      <ErrorNote>{actionError}</ErrorNote>
      {reversed && <InfoNote color="amber">{t('This payment was reversed and no longer counts.')} {t('Reason')}: {p.reversal_reason} ({p.reversed_by_name}, {dateTime(p.reversed_at)})</InfoNote>}
      {!reversed && !p.verified && <InfoNote color="amber"><span className="no-print">{t('This online payment has not been verified against the merchant / bank account yet.')}</span></InfoNote>}

      <div className={'print-plain mx-auto rounded-xl border border-slate-200 bg-white shadow-sm ' + (pos ? 'max-w-xs p-4 text-xs' : 'max-w-xl p-6 text-sm')}>
        <div className={pos ? 'mb-3 border-b border-dashed border-slate-400 pb-3' : 'mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4'}>
          <Letterhead compact={pos} />
          <div className={pos ? 'mt-2 text-center' : 'text-right'}>
            <div className={'font-bold uppercase tracking-wide text-slate-900 ' + (pos ? 'text-sm' : 'text-xl')}>{t('Money Receipt')}</div>
            <div className="font-medium text-slate-700">{p.receipt_no}</div>
            {reversed && <div className="mt-1 font-bold uppercase text-red-700">{t('Reversed')}</div>}
          </div>
        </div>
        <dl>
          <Line label={t('Date')}>{date(p.payment_date)}</Line>
          <Line label={t('Customer')}><Link to={`/customers/${p.customer_id}`} className="hover:underline">{p.customer_name}</Link> ({p.customer_code})</Line>
          <Line label={t('Mobile number')}>{p.mobile}</Line>
          <Line label={t('Payment method')}>{t(METHOD_LABEL[p.method])}{p.reference ? ` · ${p.reference}` : ''}</Line>
          <Line label={t('Amount received')} bold><span className={pos ? 'text-sm' : 'text-lg'}>{money(p.amount)}</span></Line>
        </dl>

        {data.allocations.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">{t('Paid for')}</div>
            {data.allocations.map((a, i) => (
              <div key={i} className="flex justify-between border-b border-slate-100 py-1">
                <span><Link to={`/invoices/${a.invoice_id}`} className="text-blue-700 hover:underline">{a.invoice_no}</Link> · {a.billing_period ? period(a.billing_period) : t('One-time charge')}</span>
                <span className="num">{money(a.amount)}</span>
              </div>
            ))}
          </div>
        )}
        <dl className="mt-3">
          {data.advance > 0 && <Line label={t('Kept as advance')}>{money(data.advance)}</Line>}
          <Line label={t('Remaining due')} bold>{money(data.customer_due)}</Line>
        </dl>
        {p.notes && <p className="mt-3 text-slate-600">{t('Notes')}: {p.notes}</p>}

        <div className={'flex justify-between text-xs text-slate-600 ' + (pos ? 'mt-8' : 'mt-12')}>
          <div>{t('Collected by')}: {p.collector}</div>
          <div className="border-t border-slate-400 px-4 pt-1">{t('Signature')}</div>
        </div>
        {settings.invoice_footer && <p className="mt-5 border-t border-slate-200 pt-3 text-center text-xs text-slate-500">{settings.invoice_footer}</p>}
        <p className="mt-2 text-center text-[10px] text-slate-400 no-print">
          {t('Recorded')}: {dateTime(p.created_at)} · <Badge status={reversed ? 'reversed' : p.verified ? 'verified' : 'unverified'} />
          {p.verified && p.verified_by_name ? ` ${p.verified_by_name}` : ''}
        </p>
      </div>

      {modal === 'reverse' && (
        <ConfirmModal
          danger needReason
          title={t('Reverse payment')}
          message={t('The payment stays on record marked as Reversed, and the invoices it paid become unpaid again. Use this to correct a wrong entry, then record the correct payment.')}
          confirmLabel={t('Reverse payment')}
          onClose={() => setModal(null)}
          onConfirm={async (reason) => { await api.post(`/payments/${id}/reverse`, { reason }); reload(); }}
        />
      )}
    </>
  );
}
