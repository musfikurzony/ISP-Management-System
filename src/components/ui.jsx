// Small reusable building blocks so every screen looks and behaves the same.
import { useEffect, useState } from 'react';
import { useApp } from '../lib/app.jsx';

const cx = (...a) => a.filter(Boolean).join(' ');

const BTN = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 border-transparent',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 border-transparent',
  danger: 'bg-white text-red-700 border-red-200 hover:bg-red-50',
  plain: 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50',
};
export function Button({ variant = 'plain', small, className, busy, children, ...rest }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        small ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm',
        BTN[variant],
        className
      )}
    >
      {busy ? '…' : children}
    </button>
  );
}

const inputCls =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100';

export function Field({ label, hint, required, className, children }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label} {required && <span className="text-red-600">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
export const Input = (props) => <input {...props} className={cx(inputCls, props.className)} />;
export const Textarea = (props) => <textarea rows={2} {...props} className={cx(inputCls, props.className)} />;
export const Select = ({ children, ...props }) => (
  <select {...props} className={cx(inputCls, 'pr-8', props.className)}>{children}</select>
);

export function Card({ title, actions, className, children, pad = true }) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <div className="flex flex-wrap gap-2 no-print">{actions}</div>
        </div>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap gap-2 no-print">{children}</div>
    </div>
  );
}

const BADGE = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  grey: 'bg-slate-100 text-slate-600 ring-slate-200',
};
const STATUS_COLOR = {
  active: 'green', paid: 'green', valid: 'green', verified: 'green',
  suspended: 'amber', partial: 'amber', unverified: 'amber',
  unpaid: 'red', overdue: 'red', reversed: 'red',
  inactive: 'grey', void: 'grey', admin: 'blue', operator: 'grey',
};
const STATUS_TEXT = {
  active: 'Active', suspended: 'Suspended', inactive: 'Inactive', paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid',
  void: 'Void', valid: 'Valid', reversed: 'Reversed', verified: 'Verified', unverified: 'Not verified',
  admin: 'Administrator', operator: 'Billing Operator', overdue: 'Overdue',
};
export function Badge({ status, color, children }) {
  const { t } = useApp();
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', BADGE[color || STATUS_COLOR[status] || 'grey'])}>
      {children || t(STATUS_TEXT[status] || status)}
    </span>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{children}</div>;
}
export function InfoNote({ children, color = 'blue' }) {
  const c = color === 'green' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : color === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-blue-200 bg-blue-50 text-blue-900';
  return <div className={cx('mb-3 rounded-lg border px-3 py-2 text-sm', c)}>{children}</div>;
}
export function Spinner() {
  const { t } = useApp();
  return <div className="py-10 text-center text-sm text-slate-500">{t('Loading…')}</div>;
}

// columns: [{ key, label, render?(row), right?, className? }]
export function DataTable({ columns, rows, loading, empty, onRowClick, foot }) {
  const { t } = useApp();
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            {columns.map((c) => (
              <th key={c.key} className={cx('px-3 py-2.5 whitespace-nowrap', c.right && 'text-right')}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows?.map((r, i) => (
            <tr key={r.id ?? i} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cx('hover:bg-slate-50', onRowClick && 'cursor-pointer')}>
              {columns.map((c) => (
                <td key={c.key} className={cx('px-3 py-2.5 align-middle', c.right && 'text-right num whitespace-nowrap', c.className)}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot}
      </table>
      {loading && !rows?.length && <Spinner />}
      {!loading && rows && rows.length === 0 && <div className="py-10 text-center text-sm text-slate-500">{empty || t('Nothing to show yet.')}</div>}
    </div>
  );
}

export function Pagination({ page, limit, total, onPage }) {
  const { t } = useApp();
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) return total > 0 ? <div className="px-4 py-2.5 text-xs text-slate-500">{total} {t('records')}</div> : null;
  return (
    <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500 no-print">
      <span>{(page - 1) * limit + 1}–{Math.min(page * limit, total)} / {total}</span>
      <div className="flex gap-2">
        <Button small disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ {t('Previous')}</Button>
        <Button small disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('Next')} ›</Button>
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-3 sm:p-6 no-print" role="dialog" aria-modal="true">
      <div className={cx('w-full rounded-xl bg-white shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">✕</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

// "Are you sure?" box that can also ask for a written reason (used for reversals and voids).
export function ConfirmModal({ title, message, needReason, confirmLabel, danger, onConfirm, onClose }) {
  const { t } = useApp();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <ErrorNote>{error}</ErrorNote>
      <p className="mb-3 text-sm text-slate-700">{message}</p>
      {needReason && (
        <Field label={t('Reason')} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus />
        </Field>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>{t('Cancel')}</Button>
        <Button variant={danger ? 'danger' : 'primary'} busy={busy} disabled={needReason && !reason.trim()} onClick={go}>{confirmLabel || t('Confirm')}</Button>
      </div>
    </Modal>
  );
}

export function StatCard({ label, value, note, accent = 'slate' }) {
  const bar = { blue: 'bg-blue-600', green: 'bg-emerald-600', red: 'bg-red-500', amber: 'bg-amber-500', slate: 'bg-slate-300' }[accent];
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <span className={cx('absolute inset-y-0 left-0 w-1', bar)} />
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900 num">{value}</div>
      {note && <div className="mt-0.5 text-xs text-slate-500">{note}</div>}
    </div>
  );
}

// Print header with the ISP's name, logo and address (used by invoices, receipts and reports).
export function Letterhead({ compact }) {
  const { settings } = useApp();
  return (
    <div className={cx('flex items-center gap-3', compact && 'flex-col text-center')}>
      {settings.isp_logo && <img src={settings.isp_logo} alt="" className={compact ? 'h-12' : 'h-14 w-auto'} />}
      <div>
        <div className={cx('font-bold text-slate-900', compact ? 'text-base' : 'text-xl')}>{settings.isp_name}</div>
        {settings.isp_address && <div className="text-xs text-slate-600 whitespace-pre-line">{settings.isp_address}</div>}
        {settings.isp_contact && <div className="text-xs text-slate-600">{settings.isp_contact}</div>}
      </div>
    </div>
  );
}

// Sets the paper size for the browser's print dialog.
export function PaperSize({ format }) {
  const size = format === 'pos' ? '80mm auto' : format === 'a5' ? 'A5' : 'A4';
  const margin = format === 'pos' ? '4mm' : '12mm';
  return <style>{`@page { size: ${size}; margin: ${margin}; }`}</style>;
}
