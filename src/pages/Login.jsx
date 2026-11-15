// Login screen. On a brand-new installation it shows "create the first administrator" instead.
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app.jsx';
import { Button, ErrorNote, Field, InfoNote, Input } from '../components/ui.jsx';

export default function Login() {
  const { t, brand, setupRequired, onLogin, lang, setLang } = useApp();
  const [f, setF] = useState({ username: '', password: '', full_name: '', again: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (setupRequired && f.password !== f.again) return setError(t('The two passwords do not match.'));
    setBusy(true);
    try {
      const { user } = await api.post(setupRequired ? '/auth/setup' : '/auth/login', {
        username: f.username.trim(),
        password: f.password,
        full_name: f.full_name,
      });
      await onLogin(user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-5 text-center">
          {brand.ispLogo ? (
            <img src={brand.ispLogo} alt="" className="mx-auto mb-3 h-14 object-contain" />
          ) : (
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-xl font-bold text-white">{(brand.ispName || 'I').slice(0, 1)}</div>
          )}
          <h1 className="text-lg font-semibold text-slate-900">{brand.ispName}</h1>
          <p className="text-sm text-slate-500">{t('ISP Billing & Customer Management')}</p>
        </div>
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          {setupRequired && <InfoNote>{t('Welcome! Create the first administrator account to start using the software.')}</InfoNote>}
          <ErrorNote>{error}</ErrorNote>
          {setupRequired && (
            <Field label={t('Your full name')} required><Input value={f.full_name} onChange={set('full_name')} required maxLength={80} /></Field>
          )}
          <Field label={t('Username')} required><Input value={f.username} onChange={set('username')} required autoFocus autoComplete="username" autoCapitalize="none" /></Field>
          <Field label={t('Password')} required hint={setupRequired ? t('At least 8 characters.') : null}>
            <Input type="password" value={f.password} onChange={set('password')} required minLength={setupRequired ? 8 : 1} autoComplete={setupRequired ? 'new-password' : 'current-password'} />
          </Field>
          {setupRequired && (
            <Field label={t('Password again')} required><Input type="password" value={f.again} onChange={set('again')} required autoComplete="new-password" /></Field>
          )}
          <Button variant="primary" type="submit" busy={busy} className="w-full">{setupRequired ? t('Create administrator') : t('Log in')}</Button>
        </form>
        <div className="mt-4 text-center text-xs text-slate-500">
          <button type="button" className={lang === 'en' ? 'font-semibold text-blue-700' : ''} onClick={() => setLang('en')}>English</button>
          {' · '}
          <button type="button" className={lang === 'bn' ? 'font-semibold text-blue-700' : ''} onClick={() => setLang('bn')}>বাংলা</button>
        </div>
      </div>
    </div>
  );
}
