import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { setLanguage, t } from '../shared/i18n';
import type { MessageKey } from '../shared/locales/en';
import { call } from './api';

const STEPS: [MessageKey, MessageKey][] = [['w.s1', 'w.s1b'], ['w.s2', 'w.s2b'], ['w.s3', 'w.s3b']];

function Welcome() {
  const [ready, setReady] = useState(false);
  const [url, setUrl] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void call('getState').then((s) => { setLanguage(s.settings.language); setReady(true); }).catch(() => setReady(true)); }, []);
  if (!ready) return null;

  const start = async () => {
    setErr(null);
    try {
      const target = url.trim() ? (/^https?:\/\//.test(url.trim()) ? url.trim() : `https://${url.trim()}`) : '';
      const existing = new Set(((await call('getState')).sessions as { name: string }[]).map((s) => s.name));
      const names = ['Admin', 'Customer', 'Guest'].filter((n) => !existing.has(n));
      const created = names.length ? await call<{ id: string }[]>('createMany', { names, group: 'My app', startUrl: target }) : [];
      const win = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: win.id! }).catch(() => undefined);
      if (target && created[0]) await call('openInSession', { id: created[0].id, url: target });
      setDone(names.length ? t('w.created', { names: names.join(', ') }) : t('w.exists'));
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  };

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 16px' }}>
      <div class="row" style={{ gap: 12 }}>
        <img src="icons/128.png" width={56} height={56} alt="" />
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>{t('w.title')}</h1>
          <p class="muted" style={{ margin: '4px 0 0' }}>{t('w.subtitle')}</p>
        </div>
      </div>

      <section class="card col" style={{ marginTop: 28, padding: 20 }}>
        <h2>{t('w.start')}</h2>
        <label class="field"><span>{t('w.url')}</span>
          <input type="url" placeholder="staging.myapp.com" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && start()} />
        </label>
        <div class="row wrap">
          <button class="btn primary" onClick={start}>{t('w.create')}</button>
          <span class="muted small">{t('w.createHint')}</span>
        </div>
        {done && <div class="tag ok" style={{ padding: '6px 10px', fontSize: 13 }}>✓ {done}</div>}
        {err && <div class="tag warn" style={{ padding: '6px 10px', fontSize: 13 }}>{err}</div>}
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 16 }}>
        {STEPS.map(([title, body], i) => (
          <div class="card col">
            <div class="row"><span class="chip" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{i + 1}</span><h3>{t(title)}</h3></div>
            <p class="muted" style={{ margin: 0 }}>{t(body)}</p>
          </div>
        ))}
      </section>

      <section class="card col" style={{ marginTop: 16 }}>
        <h2>{t('set.shortcuts')}</h2>
        <div class="row wrap small">
          <span><span class="kbd">Alt+Shift+S</span> {t('set.kbPopup')}</span>
          <span><span class="kbd">Alt+Shift+N</span> {t('set.kbNew')}</span>
          <span><span class="kbd">Alt+Shift+R</span> {t('set.kbRec')}</span>
        </div>
        <span class="muted small">{t('w.rightClick')}</span>
      </section>

      <p class="muted small" style={{ marginTop: 24 }}>{t('w.privacy')}</p>
    </main>
  );
}

render(<Welcome />, document.getElementById('app')!);
