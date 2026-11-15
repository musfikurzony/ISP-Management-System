import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, qs } from '../lib/api.js';
import { useApp, useLoad } from '../lib/app.jsx';
import { monthEnd, monthStart } from '../lib/format.js';
import { Button, Card, DataTable, ErrorNote, Field, InfoNote, Input, PageHeader, Spinner, StatCard } from '../components/ui.jsx';

// Chart colours (checked for colour-blind safety): blue = money in, orange = money out.
const C_IN = '#2a78d6';
const C_OUT = '#eb6834';
const INK = '#52514e';
import { METHOD_LABEL } from '../lib/labels.js';

function shortTaka(v) {
  if (v >= 10000000) return (v / 10000000).toFixed(1).replace(/\.0$/, '') + 'Cr';
  if (v >= 100000) return (v / 100000).toFixed(1).replace(/\.0$/, '') + 'L';
  if (v >= 1000) return (v / 1000).toFixed(0) + 'k';
  return String(v);
}

export default function Dashboard() {
  const { t, money, date, period } = useApp();
  const [range, setRange] = useState({ from: monthStart(), to: monthEnd() });
  const { data, loading, error } = useLoad(() => api.get('/dashboard' + qs(range)), [range.from, range.to]);

  if (!data) return loading ? <Spinner /> : <ErrorNote>{error}</ErrorNote>;
  const d = data;
  const trend = d.trend.map((x) => ({
    name: period(x.month).replace(/ \d{2}(\d{2})$/, " '$1"),
    in: (x.collection + x.other_income) / 100,
    out: x.expenses / 100,
  }));
  const methods = [...d.methods].sort((a, b) => b.amount - a.amount);
  const maxMethod = Math.max(1, ...methods.map((m) => m.amount));
  const net = d.income - d.expenses;

  return (
    <>
      <PageHeader title={t('Dashboard')} subtitle={`${date(d.range.from)} – ${date(d.range.to)}`}>
        <Field label={t('From')}><Input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></Field>
        <Field label={t('To')}><Input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></Field>
        <div className="flex items-end"><Button onClick={() => setRange({ from: monthStart(), to: monthEnd() })}>{t('This month')}</Button></div>
      </PageHeader>
      <ErrorNote>{error}</ErrorNote>
      {d.auto_billing && d.auto_billing.created > 0 && (
        <InfoNote color="green">{t('Monthly bills were generated automatically:')} {d.auto_billing.created} ({period(d.auto_billing.period)})</InfoNote>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard accent="blue" label={t('Total customers')} value={d.customers.total} />
        <StatCard accent="green" label={t('Active customers')} value={d.customers.active} />
        <StatCard accent="amber" label={t('Suspended customers')} value={d.customers.suspended} note={d.customers.inactive ? `${t('Inactive')}: ${d.customers.inactive}` : null} />
        <StatCard accent="red" label={t('Total outstanding bills')} value={money(d.outstanding)} note={`${d.outstanding_invoices} ${t('unpaid invoices')}`} />
        <StatCard accent="green" label={t("Today's collection")} value={money(d.today_collection)} note={`${d.today_payments} ${t('payments')}`} />
        <StatCard accent="blue" label={t('Bill collection')} value={money(d.collection)} note={`${d.collection_count} ${t('payments')} · ${t('Billed')} ${money(d.billed)}`} />
        <StatCard accent="green" label={t('Income')} value={money(d.income)} note={`${t('Other income')}: ${money(d.other_income)}`} />
        <StatCard accent="amber" label={t('Expenses')} value={money(d.expenses)} note={`${t('Net cash movement')}: ${money(net)}`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title={t('Income and expenses, last 12 months')} className="lg:col-span-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
                <CartesianGrid stroke="#e7e6e2" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={{ stroke: '#c9c8c2' }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} width={44} tickFormatter={shortTaka} />
                <Tooltip
                  cursor={{ fill: '#f1f5f9' }}
                  formatter={(v, name) => [money(v * 100), name]}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12, color: '#0b0b0b' }}
                  itemStyle={{ color: '#0b0b0b' }}
                />
                <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: INK }}>{v}</span>} />
                <Bar dataKey="in" name={t('Income')} fill={C_IN} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                <Bar dataKey="out" name={t('Expenses')} fill={C_OUT} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title={t('Collection by payment method')}>
          {methods.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">{t('No payments in this period.')}</p>
          ) : (
            <ul className="space-y-3">
              {methods.map((m) => (
                <li key={m.method}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-slate-700">{t(METHOD_LABEL[m.method])}</span>
                    <span className="font-medium text-slate-900 num">{money(m.amount)}</span>
                  </div>
                  <div className="h-2 rounded bg-slate-100">
                    <div className="h-2 rounded" style={{ width: `${Math.max(2, (m.amount / maxMethod) * 100)}%`, background: C_IN }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={t('Recent payments')} className="mt-4" pad={false} actions={<Link to="/payments" className="text-xs font-medium text-blue-700 hover:underline">{t('View all')}</Link>}>
        <DataTable
          rows={d.recent_payments}
          empty={t('No payments recorded yet.')}
          columns={[
            { key: 'receipt_no', label: t('Receipt'), render: (r) => <Link className="font-medium text-blue-700 hover:underline" to={`/payments/${r.id}`}>{r.receipt_no}</Link> },
            { key: 'payment_date', label: t('Date'), render: (r) => date(r.payment_date), className: 'whitespace-nowrap' },
            { key: 'customer_name', label: t('Customer'), render: (r) => <Link className="hover:underline" to={`/customers/${r.customer_id}`}>{r.customer_name}</Link> },
            { key: 'method', label: t('Method'), render: (r) => t(METHOD_LABEL[r.method]) },
            { key: 'collector', label: t('Collected by') },
            { key: 'amount', label: t('Amount'), right: true, render: (r) => money(r.amount) },
          ]}
        />
      </Card>
    </>
  );
}
