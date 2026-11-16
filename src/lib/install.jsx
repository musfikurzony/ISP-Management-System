// "Install app" support. Chrome tells us when the app can be installed
// (the beforeinstallprompt event); we keep that and show our own Install button.
import { useEffect, useState } from 'react';
import { useApp } from './app.jsx';

let savedPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    savedPrompt = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    savedPrompt = null;
    notify();
  });
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
}

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

export function InstallButton({ full }) {
  const { t } = useApp();
  const [, force] = useState(0);
  const [iosHelp, setIosHelp] = useState(false);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);

  if (isStandalone()) return null; // already installed and opened as an app
  const ios = isIos() && !savedPrompt;
  if (!savedPrompt && !ios) return null;

  const install = async () => {
    if (ios) return setIosHelp((v) => !v);
    const prompt = savedPrompt;
    savedPrompt = null;
    prompt.prompt();
    await prompt.userChoice.catch(() => {});
    notify();
  };
  return (
    <span className={full ? 'block' : 'relative'}>
      <button
        type="button"
        onClick={install}
        className={
          'inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 font-medium text-white hover:bg-emerald-700 ' +
          (full ? 'w-full px-3.5 py-2.5 text-sm' : 'px-2.5 py-1.5 text-xs')
        }
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
        </svg>
        {t('Install app')}
      </button>
      {iosHelp && (
        <span className={'z-30 mt-2 block rounded-lg border border-slate-200 bg-white p-3 text-left text-xs text-slate-700 shadow-lg ' + (full ? '' : 'absolute right-0 w-60')}>
          {t('On iPhone: tap the Share button in Safari, then "Add to Home Screen".')}
        </span>
      )}
    </span>
  );
}
