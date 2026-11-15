// Shared application state: who is logged in, ISP settings, chosen language.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { bn } from './bn.js';
import { fmtDate, fmtDateTime, fmtPeriod, money } from './format.js';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function AppProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [brand, setBrand] = useState({ ispName: 'ISP Billing', ispLogo: '' });
  const [settings, setSettings] = useState({});
  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem('lang') || ''; } catch { return ''; }
  });

  const loadSettings = useCallback(async () => {
    const { settings: s } = await api.get('/settings');
    setSettings(s);
    setBrand({ ispName: s.isp_name, ispLogo: s.isp_logo });
    return s;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const st = await api.get('/auth/status');
      setSetupRequired(st.setupRequired);
      setBrand({ ispName: st.ispName || 'ISP Billing', ispLogo: st.ispLogo || '' });
      setLangState((cur) => cur || st.language || 'en');
      setUser(st.user);
      if (st.user) await loadSettings();
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [loadSettings]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener('session-expired', onExpired);
    return () => window.removeEventListener('session-expired', onExpired);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang || 'en';
    document.title = brand.ispName ? `${brand.ispName} - Billing` : 'ISP Billing';
  }, [lang, brand.ispName]);

  const value = useMemo(() => {
    const L = lang === 'bn' ? 'bn' : 'en';
    const symbol = settings.currency_symbol || '৳';
    return {
      loading, error, user, setupRequired, brand, settings, lang: L,
      isAdmin: user?.role === 'admin',
      refresh, loadSettings,
      setLang: (l) => { setLangState(l); try { localStorage.setItem('lang', l); } catch { /* ignore */ } },
      onLogin: async (u) => { setUser(u); setSetupRequired(false); await loadSettings(); },
      logout: async () => { try { await api.post('/auth/logout'); } finally { setUser(null); } },
      // t('English text') returns the Bangla text when Bangla is selected.
      t: (text) => (L === 'bn' && bn[text]) || text,
      money: (p) => money(p, symbol),
      date: (d) => fmtDate(d, L),
      dateTime: (d) => fmtDateTime(d, L),
      period: (p) => fmtPeriod(p, L),
    };
  }, [loading, error, user, setupRequired, brand, settings, lang, refresh, loadSettings]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// Loads data for a screen and reloads whenever "deps" change.
export function useLoad(loader, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: '' }));
    loader()
      .then((data) => alive && setState({ data, loading: false, error: '' }))
      .catch((e) => alive && setState((s) => ({ data: s.data, loading: false, error: e.message })));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((n) => n + 1) };
}

// Waits until typing pauses before searching.
export function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
