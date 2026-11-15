import { useState } from 'react';
import { api } from '../lib/api.js';
import { useApp, useLoad } from '../lib/app.jsx';
import { fromPaisa, toPaisa } from '../lib/format.js';
import { Badge, Button, Card, ConfirmModal, DataTable, ErrorNote, Field, InfoNote, Input, Modal, PageHeader, Select, Textarea } from '../components/ui.jsx';

function PackageForm({ pkg, onClose, onSaved }) {
  const { t } = useApp();
  const [f, setF] = useState(pkg ? { ...pkg, price: fromPaisa(pkg.price), description: pkg.description || '' } : { name: '', download_mbps: '', upload_mbps: '', price: '', description: '', is_active: 1 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const price = toPaisa(f.price);
    if (price === null) return setError(t('Monthly price is not a valid amount.'));
    setBusy(true);
    setError('');
    try {
      const body = { name: f.name, download_mbps: f.download_mbps, upload_mbps: f.upload_mbps, price, description: f.description, is_active: Number(f.is_active) };
      if (pkg) await api.put(`/packages/${pkg.id}`, body);
      else await api.post('/packages', body);
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title={pkg ? t('Edit package') : t('Add package')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorNote>{error}</ErrorNote>
        {pkg && <InfoNote>{t('Changing the price here does not change existing invoices or what current customers pay. Edit a customer to change their monthly bill.')}</InfoNote>}
        <Field label={t('Package name')} required><Input value={f.name} onChange={set('name')} required maxLength={80} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Download speed (Mbps)')} required><Input type="number" step="any" min="0.1" value={f.download_mbps} onChange={set('download_mbps')} required /></Field>
          <Field label={t('Upload speed (Mbps)')} required><Input type="number" step="any" min="0.1" value={f.upload_mbps} onChange={set('upload_mbps')} required /></Field>
        </div>
        <Field label={t('Monthly price (Taka)')} required><Input value={f.price} onChange={set('price')} required inputMode="decimal" /></Field>
        <Field label={t('Description')}><Textarea value={f.description} onChange={set('description')} maxLength={500} /></Field>
        <Field label={t('Status')}>
          <Select value={f.is_active} onChange={set('is_active')}>
            <option value={1}>{t('Active')}</option>
            <option value={0}>{t('Inactive')}</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" type="submit" busy={busy}>{t('Save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function Packages() {
  const { t, money, isAdmin } = useApp();
  const { data, loading, error, reload } = useLoad(() => api.get('/packages'), []);
  const [editing, setEditing] = useState(null); // null | 'new' | package
  const [deleting, setDeleting] = useState(null);

  return (
    <>
      <PageHeader title={t('Packages')} subtitle={t('Internet packages offered to customers')}>
        {isAdmin && <Button variant="primary" onClick={() => setEditing('new')}>+ {t('Add package')}</Button>}
      </PageHeader>
      <ErrorNote>{error}</ErrorNote>
      <Card pad={false}>
        <DataTable
          loading={loading}
          rows={data?.packages}
          empty={t('No packages yet. Add your first internet package.')}
          columns={[
            { key: 'name', label: t('Package name'), render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
            { key: 'speed', label: t('Speed (down / up)'), render: (r) => `${r.download_mbps} / ${r.upload_mbps} Mbps`, className: 'whitespace-nowrap' },
            { key: 'price', label: t('Monthly price'), right: true, render: (r) => money(r.price) },
            { key: 'customer_count', label: t('Customers'), right: true },
            { key: 'description', label: t('Description'), className: 'text-slate-500' },
            { key: 'is_active', label: t('Status'), render: (r) => <Badge status={r.is_active ? 'active' : 'inactive'} /> },
            ...(isAdmin
              ? [{
                  key: 'actions', label: '', right: true,
                  render: (r) => (
                    <span className="flex justify-end gap-1.5">
                      <Button small onClick={() => setEditing(r)}>{t('Edit')}</Button>
                      {r.customer_count === 0 && <Button small variant="danger" onClick={() => setDeleting(r)}>{t('Delete')}</Button>}
                    </span>
                  ),
                }]
              : []),
          ]}
        />
      </Card>
      {editing && <PackageForm pkg={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {deleting && (
        <ConfirmModal
          danger
          title={t('Delete package')}
          message={`${t('Delete this package?')} ${deleting.name}`}
          confirmLabel={t('Delete')}
          onClose={() => setDeleting(null)}
          onConfirm={async () => { await api.del(`/packages/${deleting.id}`); reload(); }}
        />
      )}
    </>
  );
}
