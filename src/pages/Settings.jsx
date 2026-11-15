import { useState } from 'react';
import { api, qs } from '../lib/api.js';
import { useApp } from '../lib/app.jsx';
import { todayDhaka } from '../lib/format.js';
import { Button, Card, ErrorNote, Field, InfoNote, Input, PageHeader, Select, Textarea } from '../components/ui.jsx';

// Shrinks the chosen logo in the browser so it stays small enough to store.
function resizeLogo(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 320 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('This file is not an image.'));
    img.src = URL.createObjectURL(file);
  });
}

// Downloads every table (1000 rows at a time) into one JSON file.
async function downloadBackup(onProgress) {
  const { tables } = await api.get('/export');
  const out = { exported_at: new Date().toISOString(), note: 'ISP Billing data export. Money values are in paisa.', tables: {} };
  for (const table of tables) {
    onProgress(table);
    const rows = [];
    let after = 0;
    for (let i = 0; i < 1000; i++) {
      const d = await api.get('/export' + qs({ table, after }));
      rows.push(...d.rows);
      if (!d.more) break;
      after = d.after;
    }
    out.tables[table] = rows;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
  a.download = `isp-billing-backup-${todayDhaka()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function Settings() {
  const { t, settings, loadSettings } = useApp();
  const [f, setF] = useState({ ...settings });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [backup, setBackup] = useState('');
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setSaved(false); };

  const pickLogo = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      setF({ ...f, isp_logo: await resizeLogo(file) });
      setSaved(false);
    } catch (err) {
      setError(err.message);
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.put('/settings', { ...f, auto_billing: f.auto_billing === '1' || f.auto_billing === true });
      await loadSettings();
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };
  const runBackup = async () => {
    setError('');
    try {
      await downloadBackup((table) => setBackup(table));
    } catch (err) {
      setError(err.message);
    }
    setBackup('');
  };
  const formats = [['a4', 'A4 paper'], ['a5', 'A5 paper (half page)'], ['pos', '80mm receipt printer']];

  return (
    <form onSubmit={submit}>
      <PageHeader title={t('Settings')}>
        <Button variant="primary" type="submit" busy={busy}>{t('Save settings')}</Button>
      </PageHeader>
      <ErrorNote>{error}</ErrorNote>
      {saved && <InfoNote color="green">{t('Settings saved.')}</InfoNote>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('ISP information')}>
          <div className="space-y-3">
            <Field label={t('ISP name')} required><Input value={f.isp_name || ''} onChange={set('isp_name')} required maxLength={100} /></Field>
            <Field label={t('ISP logo')} hint={t('PNG or JPG. Shown on the login page, invoices and receipts.')}>
              <div className="flex items-center gap-3">
                {f.isp_logo ? <img src={f.isp_logo} alt="" className="h-12 rounded border border-slate-200 bg-white object-contain p-1" /> : <span className="text-sm text-slate-400">{t('No logo')}</span>}
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pickLogo} className="text-sm" />
                {f.isp_logo && <Button small onClick={() => { setF({ ...f, isp_logo: '' }); setSaved(false); }}>{t('Remove')}</Button>}
              </div>
            </Field>
            <Field label={t('Address')}><Textarea value={f.isp_address || ''} onChange={set('isp_address')} maxLength={300} /></Field>
            <Field label={t('Contact number')}><Input value={f.isp_contact || ''} onChange={set('isp_contact')} maxLength={100} /></Field>
          </div>
        </Card>

        <Card title={t('Billing')}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('Default billing date')} hint={t('Day of the month (1–28) when monthly bills are created.')}>
                <Input type="number" min="1" max="28" value={f.billing_day || ''} onChange={set('billing_day')} required />
              </Field>
              <Field label={t('Default due date')} hint={t('Number of days after the billing date.')}>
                <Input type="number" min="0" max="60" value={f.due_days || ''} onChange={set('due_days')} required />
              </Field>
            </div>
            <Field label={t('Automatic monthly billing')} hint={t('When on, bills for all Active customers are created automatically on the billing date. Duplicates are impossible.')}>
              <Select value={f.auto_billing === '1' || f.auto_billing === true ? '1' : '0'} onChange={set('auto_billing')}>
                <option value="1">{t('On')}</option>
                <option value="0">{t('Off — I will generate bills myself')}</option>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('Currency symbol')}><Input value={f.currency_symbol || ''} onChange={set('currency_symbol')} maxLength={5} required /></Field>
              <Field label={t('Default language')}>
                <Select value={f.language || 'en'} onChange={set('language')}>
                  <option value="en">English</option>
                  <option value="bn">বাংলা</option>
                </Select>
              </Field>
            </div>
          </div>
        </Card>

        <Card title={t('Invoice and receipt format')}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('Invoice number prefix')} hint={`${f.invoice_prefix || ''}000123`}><Input value={f.invoice_prefix || ''} onChange={set('invoice_prefix')} maxLength={10} /></Field>
              <Field label={t('Receipt number prefix')} hint={`${f.receipt_prefix || ''}000123`}><Input value={f.receipt_prefix || ''} onChange={set('receipt_prefix')} maxLength={10} /></Field>
              <Field label={t('Invoice format')}>
                <Select value={f.invoice_format || 'a4'} onChange={set('invoice_format')}>{formats.map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</Select>
              </Field>
              <Field label={t('Receipt format')}>
                <Select value={f.receipt_format || 'a5'} onChange={set('receipt_format')}>{formats.map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</Select>
              </Field>
            </div>
            <Field label={t('Footer text on invoices and receipts')}><Input value={f.invoice_footer || ''} onChange={set('invoice_footer')} maxLength={300} /></Field>
          </div>
        </Card>

        <Card title={t('Categories')}>
          <div className="space-y-3">
            <Field label={t('Expense categories')} hint={t('Separate with commas.')}><Textarea value={f.expense_categories || ''} onChange={set('expense_categories')} maxLength={1000} /></Field>
            <Field label={t('Income categories')} hint={t('Separate with commas.')}><Textarea value={f.income_categories || ''} onChange={set('income_categories')} maxLength={1000} /></Field>
          </div>
        </Card>

        <Card title={t('Backup')} className="lg:col-span-2">
          <p className="mb-3 text-sm text-slate-600">
            {t('Download a copy of all your data (customers, invoices, payments, income, expenses, activity history) as one file. Keep it somewhere safe. Passwords are never included.')}
          </p>
          <Button onClick={runBackup} busy={!!backup}>{t('Download data backup')}</Button>
          {backup && <span className="ml-3 text-sm text-slate-500">{t('Loading…')} {backup}</span>}
        </Card>
      </div>
    </form>
  );
}
