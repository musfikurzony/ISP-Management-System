// All reports share one screen: choose a report, set its filter, then view, print or export to CSV.
import { useState } from 'react';
import { fetchAllRows } from '../lib/api.js';
import { useApp, useLoad } from '../lib/app.jsx';
import { downloadCsv, monthEnd, monthStart, plainMoney, todayDhaka } from '../lib/format.js';
import { METHOD_LABEL, STATUS_LABEL, TYPE_LABEL } from '../lib/labels.js';
import { Button, Card, DataTable, ErrorNote, Field, Input, Letterhead, PageHeader, PaperSize, Select } from '../components/ui.jsx';

// Column helpers: `csv` gives the plain value written to the CSV file.
const m = (key, label) => ({ key, label, money: true, csv: (r) => plainMoney(r[key]) });
const d = (key, label) => ({ key, label, date: true });

function reportList(t) {
  const customerCols = [
    { key: 'customer_code', label: t('ID') }, { key: 'name', label: t('Name') }, { key: 'mobile', label: t('Mobile') },
    { key: 'area', label: t('Area') }, { key: 'address', label: t('Address') }, { key: 'package_name', label: t('Package') },
    m('monthly_bill', t('Monthly bill')),
    { key: 'connection_type', label: t('Connection type'), text: (r) => t(TYPE_LABEL[r.connection_type]) },
    { key: 'username', label: t('Username') }, d('connection_date', t('Connection date')),
    { key: 'status', label: t('Status'), text: (r) => t(STATUS_LABEL[r.status]) },
    m('due', t('Due')),
  ];
  return [
    { id: 'customers', title: t('Customer list'), path: '/reports/customers', filter: 'none', params: () => ({}), columns: customerCols, sums: ['monthly_bill', 'due'] },
    { id: 'active', title: t('Active customer list'), path: '/reports/customers', filter: 'none', params: () => ({ status: 'active' }), columns: customerCols, sums: ['monthly_bill', 'due'] },
    { id: 'suspended', title: t('Suspended customer list'), path: '/reports/customers', filter: 'none', params: () => ({ status: 'suspended' }), columns: customerCols, sums: ['monthly_bill', 'due'] },
    {
      id: 'billing', title: t('Monthly billing report'), path: '/reports/monthly-billing', filter: 'month', params: (f) => ({ period: f.month }),
      columns: [
        { key: 'invoice_no', label: t('Invoice') }, { key: 'customer_code', label: t('ID') }, { key: 'name', label: t('Name') }, { key: 'mobile', label: t('Mobile') },
        { key: 'area', label: t('Area') }, d('issue_date', t('Invoice date')), d('due_date', t('Due date')),
        m('total', t('Amount')), m('paid_amount', t('Paid')), m('due', t('Due')),
        { key: 'status', label: t('Status'), text: (r) => t({ unpaid: 'Unpaid', partial: 'Partial', paid: 'Paid' }[r.status]) },
      ],
      sums: ['total', 'paid_amount', 'due'],
    },
    {
      id: 'daily', title: t('Daily collection report'), path: '/reports/daily-collection', filter: 'date', params: (f) => ({ date: f.date }),
      columns: [
        { key: 'receipt_no', label: t('Receipt') }, { key: 'customer_code', label: t('ID') }, { key: 'name', label: t('Name') }, { key: 'mobile', label: t('Mobile') },
        { key: 'method', label: t('Method'), text: (r) => t(METHOD_LABEL[r.method]) }, { key: 'reference', label: t('Transaction ID') },
        { key: 'verified', label: t('Verified'), text: (r) => t(r.verified === 'yes' ? 'Yes' : 'No') }, { key: 'collector', label: t('Collected by') },
        m('amount', t('Amount')),
      ],
      sums: ['amount'],
    },
    {
      id: 'monthly', title: t('Monthly collection report'), path: '/reports/monthly-collection', filter: 'month', params: (f) => ({ month: f.month }),
      columns: [
        d('payment_date', t('Date')), { key: 'payments', label: t('Payments'), right: true },
        m('cash', t('Cash')), m('bkash', t('bKash')), m('nagad', t('Nagad')), m('rocket', t('Rocket')), m('bank', t('Bank transfer')), m('other', t('Other')), m('total', t('Total')),
      ],
      sums: ['payments', 'cash', 'bkash', 'nagad', 'rocket', 'bank', 'other', 'total'],
    },
    {
      id: 'outstanding', title: t('Outstanding customer report'), path: '/reports/outstanding', filter: 'none', params: () => ({}),
      columns: [
        { key: 'customer_code', label: t('ID') }, { key: 'name', label: t('Name') }, { key: 'mobile', label: t('Mobile') }, { key: 'area', label: t('Area') },
        { key: 'status', label: t('Status'), text: (r) => t(STATUS_LABEL[r.status]) },
        { key: 'unpaid_invoices', label: t('Unpaid invoices'), right: true }, d('oldest_due_date', t('Oldest due date')),
        { key: 'days_overdue', label: t('Days overdue'), right: true, text: (r) => (r.days_overdue > 0 ? r.days_overdue : 0) },
        m('due', t('Due')),
      ],
      sums: ['due'],
    },
    {
      id: 'income-expense', title: t('Income and expense report'), path: '/reports/income-expense', filter: 'range', params: (f) => ({ from: f.from, to: f.to }),
      columns: [
        { key: 'type', label: t('Type'), text: (r) => t({ collection: 'Bill collection', income: 'Other income', expense: 'Expense' }[r.type]) },
        { key: 'category', label: t('Category'), text: (r) => (r.type === 'collection' ? t(METHOD_LABEL[r.category]) : r.category) },
        { key: 'entries', label: t('Entries'), right: true }, m('amount', t('Amount')),
      ],
      sums: [],
    },
  ];
}

export default function Reports() {
  const { t, money, date, period } = useApp();
  const reports = reportList(t);
  const [id, setId] = useState('outstanding');
  const [f, setF] = useState({ month: todayDhaka().slice(0, 7), date: todayDhaka(), from: monthStart(), to: monthEnd() });
  const rep = reports.find((r) => r.id === id);
  const params = rep.params(f);
  const { data, loading, error } = useLoad(() => fetchAllRows(rep.path, params), [id, JSON.stringify(params)]);
  const rows = data?.rows || [];
  const set = (k) => (e) => e.target.value && setF({ ...f, [k]: e.target.value });

  const subtitle =
    rep.filter === 'month' ? period(f.month) : rep.filter === 'date' ? date(f.date) : rep.filter === 'range' ? `${date(f.from)} – ${date(f.to)}` : date(todayDhaka());
  const cell = (c, r) => (c.money ? money(r[c.key]) : c.date ? date(r[c.key]) : c.text ? c.text(r) : r[c.key]);
  const columns = rep.columns.map((c) => ({ key: c.key, label: c.label, right: c.money || c.right, render: (r) => cell(c, r), className: c.date ? 'whitespace-nowrap' : '' }));
  const sum = (key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  const exportCsv = () =>
    downloadCsv(
      `${rep.id}-${Object.values(params).join('_') || todayDhaka()}.csv`,
      rep.columns.map((c) => ({ ...c, csv: c.csv || (c.text ? (r) => c.text(r) : undefined) })),
      rows
    );

  return (
    <>
      <PaperSize format="a4" />
      <PageHeader title={t('Reports')}>
        <Button onClick={exportCsv} disabled={!rows.length}>{t('Export CSV')}</Button>
        <Button variant="primary" onClick={() => window.print()} disabled={!rows.length}>{t('Print')}</Button>
      </PageHeader>

      <Card className="mb-4 no-print">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('Report')} className="lg:col-span-2">
            <Select value={id} onChange={(e) => setId(e.target.value)}>
              {reports.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </Select>
          </Field>
          {rep.filter === 'month' && <Field label={t('Month')}><Input type="month" value={f.month} onChange={set('month')} /></Field>}
          {rep.filter === 'date' && <Field label={t('Date')}><Input type="date" value={f.date} onChange={set('date')} /></Field>}
          {rep.filter === 'range' && (
            <>
              <Field label={t('From')}><Input type="date" value={f.from} onChange={set('from')} /></Field>
              <Field label={t('To')}><Input type="date" value={f.to} onChange={set('to')} /></Field>
            </>
          )}
        </div>
      </Card>
      <ErrorNote>{error}</ErrorNote>

      <div className="print-only mb-4">
        <Letterhead />
      </div>
      <Card pad={false} className="print-plain" title={<>{rep.title} <span className="font-normal text-slate-500">· {subtitle} · {rows.length} {t('records')}</span></>}>
        {id === 'income-expense' && data?.totals && (
          <div className="grid grid-cols-2 gap-3 border-b border-slate-100 p-4 text-sm lg:grid-cols-4">
            <div><div className="text-slate-500">{t('Bill collection')}</div><div className="text-lg font-semibold num">{money(data.totals.collection)}</div></div>
            <div><div className="text-slate-500">{t('Other income')}</div><div className="text-lg font-semibold num">{money(data.totals.other_income)}</div></div>
            <div><div className="text-slate-500">{t('Expenses')}</div><div className="text-lg font-semibold num">{money(data.totals.expenses)}</div></div>
            <div><div className="text-slate-500">{t('Net cash movement')}</div><div className="text-lg font-semibold num">{money(data.totals.net)}</div></div>
            <p className="col-span-full text-xs text-slate-500">{t('A simple cash record. This is not a full accounting balance sheet.')}</p>
          </div>
        )}
        {id === 'daily' && data?.summary && rows.length > 0 && (
          <div className="grid gap-4 border-b border-slate-100 p-4 text-sm sm:grid-cols-2">
            {[['By payment method', data.summary.by_method, (x) => t(METHOD_LABEL[x.label])], ['By collector', data.summary.by_collector, (x) => x.label]].map(([title, list, label]) => (
              <div key={title}>
                <div className="mb-1 text-xs font-semibold uppercase text-slate-500">{t(title)}</div>
                {list.map((x) => (
                  <div key={x.label} className="flex justify-between border-b border-slate-100 py-1">
                    <span>{label(x)} <span className="text-slate-400">({x.n})</span></span>
                    <span className="font-medium num">{money(x.amount)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <DataTable
          loading={loading}
          rows={rows}
          columns={columns}
          empty={t('No records for this report.')}
          foot={
            rows.length > 0 && rep.sums.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                  {rep.columns.map((c, i) => (
                    <td key={c.key} className={'px-3 py-2.5 ' + (c.money || c.right ? 'text-right num whitespace-nowrap' : '')}>
                      {rep.sums.includes(c.key) ? (c.money ? money(sum(c.key)) : sum(c.key)) : i === 0 ? t('Total') : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null
          }
        />
      </Card>
    </>
  );
}
