import { useEffect, useState } from 'preact/hooks';
import { t } from '../../shared/i18n';
import { COLOR_HEX } from '../../shared/types';
import { call, isWebUrl, type AppState, type useToast } from '../api';

type Toast = ReturnType<typeof useToast>;

/** Open the same URL as several roles side by side — the core RBAC / permission test. */
export function Matrix({ state, tab, toast }: { state: AppState; tab: chrome.tabs.Tab | null; toast: Toast }) {
  const [url, setUrl] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [layout, setLayout] = useState<'windows' | 'tabs'>('windows');
  const [navUrl, setNavUrl] = useState('');
  useEffect(() => { if (!url && isWebUrl(tab?.url)) setUrl(tab!.url!); }, [tab?.url]);

  const groups = [...new Set(state.sessions.map((s) => s.group).filter(Boolean))];
  const toggle = (id: string) => { const n = new Set(picked); n.has(id) ? n.delete(id) : n.add(id); setPicked(n); };
  const active = state.matrixTabs.length > 0;

  return (
    <div class="section">
      <div class="card col">
        <h2>{t('m.title')}</h2>
        <span class="muted small">{t('m.hint')}</span>
        <label class="field"><span>{t('m.url')}</span>
          <input type="url" value={url} placeholder="https://staging.example.com/orders/123" onInput={(e) => setUrl((e.target as HTMLInputElement).value)} />
        </label>
        <div class="row wrap small">
          <span class="muted">{t('m.select')}</span>
          <button class="btn sm" onClick={() => setPicked(new Set(state.sessions.map((s) => s.id)))}>{t('m.all')}</button>
          <button class="btn sm" onClick={() => setPicked(new Set())}>{t('m.none')}</button>
          {groups.map((g) => <button class="btn sm" onClick={() => setPicked(new Set(state.sessions.filter((s) => s.group === g).map((s) => s.id)))}>{g}</button>)}
        </div>
        <div class="list">
          {state.sessions.length === 0 && <span class="muted small">{t('m.createFirst')}</span>}
          {state.sessions.map((s) => (
            <label class="check" style={{ padding: '2px 0' }}>
              <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
              <span class="dot" style={{ background: COLOR_HEX[s.color] }} />
              <span class="grow">{s.name}</span>
              {s.group && <span class="tag">{s.group}</span>}
            </label>
          ))}
        </div>
        <div class="row">
          <label class="check small"><input type="radio" name="layout" checked={layout === 'windows'} onChange={() => setLayout('windows')} /> {t('m.tiled')}</label>
          <label class="check small"><input type="radio" name="layout" checked={layout === 'tabs'} onChange={() => setLayout('tabs')} /> {t('m.tabs')}</label>
        </div>
        <button class="btn primary" disabled={picked.size === 0}
          onClick={() => toast.run(() => call('openMatrix', {
            url, sessionIds: state.sessions.filter((s) => picked.has(s.id)).map((s) => s.id), layout,
            screen: { width: screen.availWidth, height: screen.availHeight, left: (screen as any).availLeft ?? 0, top: (screen as any).availTop ?? 0 },
          }), t('m.opened', { n: picked.size }))}>
          {t('m.open', { n: picked.size || '' })}
        </button>
      </div>

      <div class="card col" aria-disabled={!active} style={{ opacity: active ? 1 : 0.55 }}>
        <h2>{t('m.drive')} {active && <span class="tag">{state.matrixTabs.length}</span>}</h2>
        <form class="row" onSubmit={(e) => { e.preventDefault(); void toast.run(() => call('matrixAction', { action: 'navigate', url: navUrl }), t('m.navigated')); }}>
          <input type="url" placeholder={t('m.goAll')} value={navUrl} onInput={(e) => setNavUrl((e.target as HTMLInputElement).value)} disabled={!active} />
          <button class="btn" disabled={!active || !navUrl}>{t('c.go')}</button>
        </form>
        <div class="row">
          <button class="btn grow" disabled={!active} onClick={() => call('matrixAction', { action: 'back' })}>{t('m.back')}</button>
          <button class="btn grow" disabled={!active} onClick={() => call('matrixAction', { action: 'reload' })}>{t('m.reload')}</button>
          <button class="btn grow danger" disabled={!active} onClick={() => call('matrixAction', { action: 'close' })}>{t('m.close')}</button>
        </div>
      </div>
    </div>
  );
}
