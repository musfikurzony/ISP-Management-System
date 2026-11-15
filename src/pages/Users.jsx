import { useState } from 'react';
import { api } from '../lib/api.js';
import { useApp, useLoad } from '../lib/app.jsx';
import { Badge, Button, Card, DataTable, ErrorNote, Field, InfoNote, Input, Modal, PageHeader, Select } from '../components/ui.jsx';

function UserForm({ user, onClose, onSaved }) {
  const { t } = useApp();
  const [f, setF] = useState(user ? { ...user, password: '' } : { username: '', full_name: '', role: 'operator', is_active: 1, password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { username: f.username, full_name: f.full_name, role: f.role, is_active: Number(f.is_active), password: f.password || undefined };
      if (user) await api.put(`/users/${user.id}`, body);
      else await api.post('/users', body);
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title={user ? t('Edit user') : t('Add user')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        <Field label={t('Username')} required hint={user ? t('The username cannot be changed.') : t('Used to log in. Letters and numbers, no spaces.')}>
          <Input value={f.username} onChange={set('username')} required disabled={!!user} autoCapitalize="none" maxLength={40} />
        </Field>
        <Field label={t('Full name')} required><Input value={f.full_name} onChange={set('full_name')} required maxLength={80} /></Field>
        <Field label={t('Role')} required>
          <Select value={f.role} onChange={set('role')}>
            <option value="operator">{t('Billing Operator')}</option>
            <option value="admin">{t('Administrator')}</option>
          </Select>
        </Field>
        {user && (
          <Field label={t('Status')}>
            <Select value={f.is_active} onChange={set('is_active')}>
              <option value={1}>{t('Active')}</option>
              <option value={0}>{t('Inactive')} — {t('cannot log in')}</option>
            </Select>
          </Field>
        )}
        <Field label={user ? t('New password') : t('Password')} required={!user} hint={user ? t('Leave empty to keep the current password.') : t('At least 8 characters.')}>
          <Input type="password" value={f.password} onChange={set('password')} required={!user} minLength={8} autoComplete="new-password" />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" type="submit" busy={busy}>{t('Save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function Users() {
  const { t, dateTime } = useApp();
  const { data, loading, error, reload } = useLoad(() => api.get('/users'), []);
  const [editing, setEditing] = useState(null);
  return (
    <>
      <PageHeader title={t('Users')} subtitle={t('People who can log in to this software')}>
        <Button variant="primary" onClick={() => setEditing('new')}>+ {t('Add user')}</Button>
      </PageHeader>
      <ErrorNote>{error}</ErrorNote>
      <InfoNote>
        <b>{t('Administrator')}</b>: {t('full access, including settings, users, reversals and bulk billing.')}{' '}
        <b>{t('Billing Operator')}</b>: {t('customers, invoices, payments, income/expenses and reports only.')}
      </InfoNote>
      <Card pad={false}>
        <DataTable
          loading={loading}
          rows={data?.users}
          columns={[
            { key: 'full_name', label: t('Full name'), render: (r) => <span className="font-medium text-slate-900">{r.full_name}</span> },
            { key: 'username', label: t('Username') },
            { key: 'role', label: t('Role'), render: (r) => <Badge status={r.role} /> },
            { key: 'is_active', label: t('Status'), render: (r) => <Badge status={r.is_active ? 'active' : 'inactive'} /> },
            { key: 'last_login_at', label: t('Last login'), render: (r) => (r.last_login_at ? dateTime(r.last_login_at) : '—'), className: 'whitespace-nowrap' },
            { key: 'actions', label: '', right: true, render: (r) => <Button small onClick={() => setEditing(r)}>{t('Edit')}</Button> },
          ]}
        />
      </Card>
      {editing && <UserForm user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}
