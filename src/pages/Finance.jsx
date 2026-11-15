// Basic income & expense book (a simple cash record, not full accounting).
import { useState } from 'react';
import { api, qs } from '../lib/api.js';
import { useApp, useLoad } from '../lib/app.jsx';
import { monthEnd, monthStart, toPaisa, todayDhaka } from '../lib/format.js';
import { Badge, Button, Card, ConfirmModal, DataTable, ErrorNote, Field, Input, Modal, PageHeader, Pagination, StatCard, Textarea } from '../components/ui.jsx';

function EntryForm({ kind, onClose, onSaved }) {
  const { t, settings } = useApp();
  const cats = (settings[kind === 'income' ? 'income_categories' : 'expense_categories'] || 'Other').split(',').map((s) => s.trim()).filter(Boolean);
  const [f, setF] = useState({ category: cats[0] || '', amount: '', entry_date: todayDhaka(), description: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const amount = toPaisa(f.amount);
    if (!amount) return setError(t('Amount is not valid.'));
    setBusy(true);
    setError('');
    try {
      await api.post('/' + kind, { ...f, amount });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title={kind === 'income' ? t('Add income') : t('Add expense')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        <Field label={t('Category')} required hint={t('Pick from the list or type a new one.')}>
          <Input value={f.category} onChange={set('category')} required maxLength={60} list="cat-list" />
          <datalist id="cat-list">{cats.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Amount (Taka)')} required><Input value={f.amount} onChange={set('amount')} required inputMode="decimal" autoFocus /></Field>
          <Field label={t('Date')} required><Input type="date" value={f.entry_date} onChange={set('entry_date')} required /></Field>
        </div>
        <Field label={t('Description')}><Textarea value={f.description} onChange={set('description')} maxLength={300} /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" type="submit" busy={busy}>{t('Save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function Finance() {
  const { t, money, date, isAdmin } = useApp();
  const [tab, setTab] = useState('expenses');
  const [range, setRange] = useState({ from: monthStart(), to: monthEnd() });
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [reversing, setReversing] = useState(null);
  const list = useLoad(() => api.get(`/${tab}` + qs({ ...range, page })), [tab, range.from, range.to, page]);
  const summary = useLoad(() => api.get('/reports/income-expense' + qs(range)), [range.from, range.to]);
  const reloadAll = () => { list.reload(); summary.reload(); };
  const tt = summary.data?.totals;

  return (
    <>
      <PageHeader title={t('Income & Expenses')} subtitle={t('A simple cash record. This is not a full accounting balance sheet.')}>
        <Field label={t('From')}><Input type="date" value={range.from} onChange={(e) => { setRange({ ...range, from: e.target.value }); setPage(1); }} /></Field>
        <Field label={t('To')}><Input type="date" value={range.to} onChange={(e) => { setRange({ ...range, to: e.target.value }); setPage(1); }} /></Field>
      </PageHeader>
      <ErrorNote>{list.error || summary.error}</ErrorNote>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard accent="blue" label={t('Bill collection')} value={money(tt?.collection)} />
        <StatCard accent="green" label={t('Other income')} value={money(tt?.other_income)} />
        <StatCard accent="amber" label={t('Expenses')} value={money(tt?.expenses)} />
        <StatCard accent={tt && tt.net < 0 ? 'red' : 'green'} label={t('Net cash movement')} value={money(tt?.net)} note={t('Collection + other income − expenses')} />
      </div>

      <Card
        className="mt-4"
        pad={false}
        title={
          <span className="flex gap-1">
            {[['expenses', 'Expenses'], ['income', 'Other income']].map(([k, label]) => (
              <button key={k} type="button" onClick={() => { setTab(k); setPage(1); }} className={'rounded-lg px-3 py-1.5 text-sm font-medium ' + (tab === k ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100')}>
                {t(label)}
              </button>
            ))}
          </span>
        }
        actions={<Button variant="primary" onClick={() => setAdding(true)}>+ {tab === 'income' ? t('Add income') : t('Add expense')}</Button>}
      >
        <DataTable
          loading={list.loading}
          rows={list.data?.entries}
          empty={t('Nothing recorded in this period.')}
          columns={[
            { key: 'entry_date', label: t('Date'), render: (r) => date(r.entry_date), className: 'whitespace-nowrap' },
            { key: 'category', label: t('Category'), render: (r) => <span className="font-medium text-slate-900">{r.category}</span> },
            { key: 'description', label: t('Description'), render: (r) => <>{r.description}{r.status === 'reversed' && <span className="block text-xs text-red-700">{t('Reason')}: {r.reversal_reason}</span>}</> },
            { key: 'created_by_name', label: t('Entered by') },
            { key: 'amount', label: t('Amount'), right: true, render: (r) => <span className={r.status === 'reversed' ? 'text-slate-400 line-through' : ''}>{money(r.amount)}</span> },
            {
              key: 'status', label: '', right: true,
              render: (r) => (r.status === 'reversed' ? <Badge status="reversed" /> : isAdmin ? <Button small variant="danger" onClick={() => setReversing(r)}>{t('Reverse')}</Button> : null),
            },
          ]}
          foot={
            list.data?.entries.length ? (
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                  <td className="px-3 py-2.5" colSpan={4}>{t('Total')}</td>
                  <td className="px-3 py-2.5 text-right num">{money(list.data.sum_amount)}</td>
                  <td />
                </tr>
              </tfoot>
            ) : null
          }
        />
        {list.data && <Pagination page={list.data.page} limit={list.data.limit} total={list.data.total} onPage={setPage} />}
      </Card>

      {adding && <EntryForm kind={tab} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reloadAll(); }} />}
      {reversing && (
        <ConfirmModal
          danger needReason
          title={t('Reverse entry')}
          message={`${t('The entry stays on record marked as Reversed and is no longer counted.')} ${reversing.category} · ${money(reversing.amount)}`}
          confirmLabel={t('Reverse')}
          onClose={() => setReversing(null)}
          onConfirm={async (reason) => { await api.post(`/${tab}/${reversing.id}/reverse`, { reason }); reloadAll(); }}
        />
      )}
    </>
  );
}
