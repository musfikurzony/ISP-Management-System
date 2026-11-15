// Page frame: sidebar on the left, top bar with language switch and user menu.
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app.jsx';
import { Button, ErrorNote, Field, InfoNote, Input, Modal } from './ui.jsx';

const ICONS = {
  dashboard: 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  customers: 'M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 19v-1a4 4 0 00-3-3.8M15.5 3.2a3.5 3.5 0 010 6.6',
  packages: 'M4 8l8-4 8 4-8 4-8-4zM4 8v8l8 4 8-4V8M12 12v8',
  invoices: 'M7 3h8l4 4v14H7zM14 3v5h5M10 12h6M10 16h6',
  payments: 'M3 7h18v11H3zM3 11h18M7 15h3',
  finance: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  reports: 'M5 3h14v18H5zM9 8h6M9 12h6M9 16h3',
  users: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.3l2-1.5-2-3.4-2.3.9a7 7 0 00-2.2-1.3L14 3h-4l-.4 2.4a7 7 0 00-2.2 1.3l-2.3-.9-2 3.4 2 1.5a7 7 0 000 2.6l-2 1.5 2 3.4 2.3-.9a7 7 0 002.2 1.3L10 21h4l.4-2.4a7 7 0 002.2-1.3l2.3.9 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z',
  audit: 'M12 8v4l3 2M21 12a9 9 0 11-3-6.7M21 4v5h-5',
};
function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

const NAV = [
  { to: '/', icon: 'dashboard', label: 'Dashboard', end: true },
  { to: '/customers', icon: 'customers', label: 'Customers' },
  { to: '/packages', icon: 'packages', label: 'Packages' },
  { to: '/invoices', icon: 'invoices', label: 'Billing' },
  { to: '/payments', icon: 'payments', label: 'Payments' },
  { to: '/finance', icon: 'finance', label: 'Income & Expenses' },
  { to: '/reports', icon: 'reports', label: 'Reports' },
  { to: '/users', icon: 'users', label: 'Users', admin: true },
  { to: '/settings', icon: 'settings', label: 'Settings', admin: true },
  { to: '/audit', icon: 'audit', label: 'Activity History', admin: true },
];

function ChangePassword({ onClose }) {
  const { t } = useApp();
  const [f, setF] = useState({ current_password: '', new_password: '', again: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (f.new_password !== f.again) return setError(t('The two new passwords do not match.'));
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/change-password', f);
      setDone(true);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={t('Change password')} onClose={onClose}>
      {done ? (
        <>
          <InfoNote color="green">{t('Your password has been changed.')}</InfoNote>
          <div className="text-right"><Button onClick={onClose}>{t('Close')}</Button></div>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <ErrorNote>{error}</ErrorNote>
          <Field label={t('Current password')} required><Input type="password" autoComplete="current-password" value={f.current_password} onChange={set('current_password')} required /></Field>
          <Field label={t('New password')} required hint={t('At least 8 characters.')}><Input type="password" autoComplete="new-password" minLength={8} value={f.new_password} onChange={set('new_password')} required /></Field>
          <Field label={t('New password again')} required><Input type="password" autoComplete="new-password" value={f.again} onChange={set('again')} required /></Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={onClose}>{t('Cancel')}</Button>
            <Button variant="primary" type="submit" busy={busy}>{t('Save')}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function Layout({ children }) {
  const { t, user, brand, isAdmin, lang, setLang, logout } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const location = useLocation();

  const nav = (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
      {NAV.filter((n) => !n.admin || isAdmin).map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={() => setMenuOpen(false)}
          className={({ isActive }) =>
            'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium ' +
            (isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')
          }
        >
          <Icon name={n.icon} />
          {t(n.label)}
        </NavLink>
      ))}
    </nav>
  );
  const brandBlock = (
    <div className="flex h-14 items-center gap-2.5 border-b border-slate-200 px-4">
      {brand.ispLogo ? (
        <img src={brand.ispLogo} alt="" className="h-8 w-8 rounded object-contain" />
      ) : (
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">{(brand.ispName || 'I').slice(0, 1)}</span>
      )}
      <span className="truncate text-sm font-semibold text-slate-900">{brand.ispName}</span>
    </div>
  );

  return (
    <div className="app-frame min-h-screen lg:pl-60">
      {/* Sidebar: always visible on large screens */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-white lg:flex no-print">
        {brandBlock}
        {nav}
      </aside>
      {/* Sidebar: slide-in on phones */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden no-print">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl">
            {brandBlock}
            {nav}
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 sm:px-5 no-print">
        <button type="button" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Menu" onClick={() => setMenuOpen(true)}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <div className="hidden text-sm text-slate-500 lg:block">{t('ISP Billing & Customer Management')}</div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs font-medium">
            <button type="button" onClick={() => setLang('en')} className={'px-2.5 py-1.5 ' + (lang === 'en' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600')}>EN</button>
            <button type="button" onClick={() => setLang('bn')} className={'px-2.5 py-1.5 ' + (lang === 'bn' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600')}>বাংলা</button>
          </div>
          <div className="hidden text-right leading-tight sm:block">
            <div className="text-sm font-medium text-slate-800">{user.full_name}</div>
            <div className="text-xs text-slate-500">{t(user.role === 'admin' ? 'Administrator' : 'Billing Operator')}</div>
          </div>
          <Button small onClick={() => setPwOpen(true)} title={t('Change password')}>{t('Password')}</Button>
          <Button small onClick={logout}>{t('Log out')}</Button>
        </div>
      </header>

      <main key={location.pathname} className="mx-auto max-w-7xl p-3 sm:p-5">{children}</main>
      {pwOpen && <ChangePassword onClose={() => setPwOpen(false)} />}
    </div>
  );
}
