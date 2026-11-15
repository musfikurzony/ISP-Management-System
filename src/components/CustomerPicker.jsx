// Search box for choosing a customer by name, mobile, customer ID or username.
import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api.js';
import { useApp, useDebounced } from '../lib/app.jsx';
import { Badge, Input } from './ui.jsx';

export default function CustomerPicker({ value, onChange, autoFocus }) {
  const { t, money } = useApp();
  const [text, setText] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const q = useDebounced(text, 250);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api.get('/customers/search' + qs({ q })).then((d) => alive && setResults(d.customers)).catch(() => {});
    return () => { alive = false; };
  }, [q, open]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
        <div>
          <span className="font-medium text-slate-900">{value.name}</span>{' '}
          <span className="text-slate-500">{value.customer_code} · {value.mobile}</span>
        </div>
        <button type="button" className="text-xs font-medium text-blue-700 hover:underline" onClick={() => { onChange(null); setText(''); setOpen(true); }}>
          {t('Change')}
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input
        value={text}
        autoFocus={autoFocus}
        placeholder={t('Type name, mobile or customer ID…')}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-blue-50" onClick={() => { onChange(c); setOpen(false); }}>
                <span>
                  <span className="font-medium text-slate-900">{c.name}</span>{' '}
                  <span className="text-slate-500">{c.customer_code} · {c.mobile}{c.area ? ` · ${c.area}` : ''}</span>
                </span>
                <span className="flex items-center gap-2 whitespace-nowrap">
                  {c.due > 0 && <span className="text-xs font-medium text-red-700 num">{t('Due')} {money(c.due)}</span>}
                  {c.status !== 'active' && <Badge status={c.status} />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
