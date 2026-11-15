// Read-only history of who did what. Entries can never be edited or deleted.
import { useState } from 'react';
import { api, qs } from '../lib/api.js';
import { useApp, useLoad } from '../lib/app.jsx';
import { Card, DataTable, ErrorNote, PageHeader, Pagination, Select } from '../components/ui.jsx';

const GROUPS = [['', 'All activity'], ['payment', 'Payments'], ['invoice', 'Billing'], ['customer', 'Customers'], ['package', 'Packages'], ['expenses', 'Expenses'], ['income', 'Other income'], ['user', 'Users'], ['auth', 'Logins'], ['settings', 'Settings'], ['backup', 'Data export']];

export default function AuditLog() {
  const { t, dateTime } = useApp();
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error } = useLoad(() => api.get('/audit' + qs({ action, page })), [action, page]);
  return (
    <>
      <PageHeader title={t('Activity History')} subtitle={t('A permanent record of every important action')}>
        <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label={t('Type')}>
          {GROUPS.map(([k, label]) => <option key={k} value={k}>{t(label)}</option>)}
        </Select>
      </PageHeader>
      <ErrorNote>{error}</ErrorNote>
      <Card pad={false}>
        <DataTable
          loading={loading}
          rows={data?.logs}
          columns={[
            { key: 'created_at', label: t('Time'), render: (r) => dateTime(r.created_at), className: 'whitespace-nowrap' },
            { key: 'user_name', label: t('User'), render: (r) => r.user_name || t('System (automatic)') },
            { key: 'action', label: t('Action'), render: (r) => <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{r.action}</code> },
            { key: 'entity_id', label: t('Record'), render: (r) => (r.entity_id ? `${r.entity_type} #${r.entity_id}` : r.entity_type || '') , className: 'whitespace-nowrap' },
            { key: 'details', label: t('Details'), render: (r) => <span className="break-all text-xs text-slate-500">{r.details}</span> },
          ]}
        />
        {data && <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
