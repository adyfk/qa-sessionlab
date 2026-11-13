import { useEffect, useState } from 'preact/hooks';
import { t } from '../../shared/i18n';
import { DEVICE_PRESETS, GEO_PRESETS, LOCALES, NETWORK_PRESETS, TIMEZONES } from '../../shared/presets';
import { COLOR_HEX, GROUP_COLORS, presetIsActive, type EnvPreset, type Session, type Snapshot, type StoredCookie } from '../../shared/types';
import { call, copy, download, isWebUrl, slug, type useToast } from '../api';

type Toast = ReturnType<typeof useToast>;

export function SessionDetail({ s, tab, toast, groups }: { s: Session; tab: chrome.tabs.Tab | null; toast: Toast; groups: string[] }) {
  const [name, setName] = useState(s.name);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [cookies, setCookies] = useState<StoredCookie[] | null>(null);
  const [snapLabel, setSnapLabel] = useState('');
  const [sharing, setSharing] = useState(false);
  const [pass, setPass] = useState('');
  useEffect(() => setName(s.name), [s.name]);
  const loadSnaps = async () => setSnaps(await call<Snapshot[]>('listSnapshots', { id: s.id }));
  useEffect(() => { void loadSnaps(); }, [s.id]);

  const patch = (p: Partial<Session>, ok?: string) => toast.run(() => call('updateSession', { id: s.id, patch: p }), ok);
  const setPreset = (p: Partial<EnvPreset>) => patch({ preset: { ...s.preset, ...p } }, t('d.presetApplied'));
  const web = isWebUrl(tab?.url);

  return (
    <div class="sess-body">
      {/* identity */}
      <div class="col">
        <div class="row">
          <label class="field grow"><span>{t('d.name')}</span>
            <input type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} onBlur={() => name !== s.name && patch({ name }, t('d.renamed'))} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          </label>
          <label class="field" style={{ width: 130 }}><span>{t('s.group')}</span>
            <input type="text" list="qsl-groups" value={s.group} placeholder={t('d.groupPh')} onChange={(e) => patch({ group: (e.target as HTMLInputElement).value.trim() })} />
          </label>
        </div>
        <datalist id="qsl-groups">{groups.map((g) => <option value={g} />)}</datalist>
        <div class="swatches" role="group" aria-label={t('d.colour')}>
          {GROUP_COLORS.map((c) => (
            <button class="swatch" aria-label={c} aria-pressed={s.color === c} style={{ background: COLOR_HEX[c] }} onClick={() => patch({ color: c })} />
          ))}
        </div>
        <label class="field"><span>{t('d.startUrl')}</span>
          <input type="url" value={s.startUrl} placeholder="https://staging.example.com/login" onChange={(e) => patch({ startUrl: (e.target as HTMLInputElement).value.trim() })} />
        </label>
        <label class="field"><span>{t('d.notes')}</span>
          <textarea value={s.notes} onChange={(e) => patch({ notes: (e.target as HTMLTextAreaElement).value })} />
        </label>
        <label class="check small"><input type="checkbox" checked={s.temporary} onChange={(e) => patch({ temporary: (e.target as HTMLInputElement).checked })} /> {t('d.tempLong')}</label>
      </div>

      {/* environment */}
      <details>
        <summary>{t('d.env')} {presetIsActive(s.preset) ? <span class="tag ok">{t('c.on')}</span> : null}</summary>
        <div class="col" style={{ marginTop: 8 }}>
          <div class="grid2">
            <label class="field"><span>{t('d.device')}</span>
              <select value={s.preset.device} onChange={(e) => setPreset({ device: (e.target as HTMLSelectElement).value })}>
                <option value="none">{t('d.noDevice')}</option>
                {Object.entries(DEVICE_PRESETS).map(([k, d]) => <option value={k}>{d.label}</option>)}
              </select>
            </label>
            <label class="field"><span>{t('d.network')}</span>
              <select value={s.preset.network} onChange={(e) => setPreset({ network: (e.target as HTMLSelectElement).value })}>
                <option value="none">{t('d.noThrottle')}</option>
                {Object.entries(NETWORK_PRESETS).map(([k, d]) => <option value={k}>{d.label}</option>)}
              </select>
            </label>
            <label class="field"><span>{t('d.locale')}</span>
              <input type="text" list="qsl-locales" value={s.preset.locale} placeholder={t('d.browserDefault')} onChange={(e) => setPreset({ locale: (e.target as HTMLInputElement).value.trim() })} />
            </label>
            <label class="field"><span>{t('d.timezone')}</span>
              <input type="text" list="qsl-tz" value={s.preset.timezone} placeholder={t('d.browserDefault')} onChange={(e) => setPreset({ timezone: (e.target as HTMLInputElement).value.trim() })} />
            </label>
            <label class="field"><span>{t('d.scheme')}</span>
              <select value={s.preset.colorScheme} onChange={(e) => setPreset({ colorScheme: (e.target as HTMLSelectElement).value as EnvPreset['colorScheme'] })}>
                <option value="">{t('d.system')}</option><option value="light">{t('d.light')}</option><option value="dark">{t('d.dark')}</option>
              </select>
            </label>
            <label class="field"><span>{t('d.geo')}</span>
              <select
                value={s.preset.geo ? Object.keys(GEO_PRESETS).find((k) => GEO_PRESETS[k].latitude === s.preset.geo!.latitude) ?? 'custom' : ''}
                onChange={(e) => {
                  const k = (e.target as HTMLSelectElement).value;
                  const g = GEO_PRESETS[k];
                  void setPreset({ geo: g ? { latitude: g.latitude, longitude: g.longitude, accuracy: 50 } : null });
                }}
              >
                <option value="">{t('d.realGeo')}</option>
                {Object.entries(GEO_PRESETS).map(([k, g]) => <option value={k}>{g.label}</option>)}
                {s.preset.geo && !Object.values(GEO_PRESETS).some((g) => g.latitude === s.preset.geo!.latitude) && <option value="custom">{t('d.custom')}</option>}
              </select>
            </label>
          </div>
          <datalist id="qsl-locales">{LOCALES.map((l) => <option value={l} />)}</datalist>
          <datalist id="qsl-tz">{TIMEZONES.map((l) => <option value={l} />)}</datalist>
          <label class="check small"><input type="checkbox" checked={s.preset.reducedMotion} onChange={(e) => setPreset({ reducedMotion: (e.target as HTMLInputElement).checked })} /> {t('d.reducedMotion')}</label>
          <div class="row">
            <span class="muted small grow">{t('d.debuggerNote')}</span>
            <button class="btn sm" onClick={() => setPreset({ device: 'none', locale: '', timezone: '', network: 'none', colorScheme: '', reducedMotion: false, geo: null })}>{t('c.reset')}</button>
          </div>
        </div>
      </details>

      {/* snapshots */}
      <details>
        <summary>{t('d.snapshots')} <span class="tag">{snaps.length}</span></summary>
        <div class="col" style={{ marginTop: 8 }}>
          <span class="muted small">{t('d.snapHint')}</span>
          <form class="row" onSubmit={async (e) => { e.preventDefault(); await toast.run(() => call('takeSnapshot', { id: s.id, label: snapLabel }), t('d.snapSaved')); setSnapLabel(''); void loadSnaps(); }}>
            <input type="text" placeholder={t('d.snapPh')} value={snapLabel} onInput={(e) => setSnapLabel((e.target as HTMLInputElement).value)} />
            <button class="btn primary" type="submit">{t('c.save')}</button>
          </form>
          {snaps.map((x) => (
            <div class="row">
              <div class="grow">
                <div class="ellipsis">{x.label}</div>
                <div class="muted small">{t('d.snapMeta', { date: new Date(x.createdAt).toLocaleString(), cookies: x.cookies.length, origins: Object.keys(x.localStorage).length })}</div>
              </div>
              <button class="btn sm" onClick={() => toast.run(() => call('restoreSnapshot', { id: s.id, snapId: x.id }), t('d.restored'))}>{t('d.restore')}</button>
              <button class="btn sm ghost danger" aria-label={t('d.deleteSnap')} onClick={async () => { await call('deleteSnapshot', { id: s.id, snapId: x.id }); void loadSnaps(); }}>✕</button>
            </div>
          ))}
        </div>
      </details>

      {/* cookies */}
      <details onToggle={async (e) => { if ((e.target as HTMLDetailsElement).open) setCookies(await call('getCookies', { id: s.id })); }}>
        <summary>{t('d.cookies')} {cookies && <span class="tag">{cookies.length}</span>}</summary>
        <div class="col" style={{ marginTop: 8 }}>
          {cookies && cookies.length === 0 && <span class="muted small">{t('d.noCookies')}</span>}
          {cookies && cookies.length > 0 && (
            <div class="scroll">
              <table class="tbl">
                <thead><tr><th>{t('d.colName')}</th><th>{t('d.colDomain')}</th><th>{t('d.colFlags')}</th></tr></thead>
                <tbody>
                  {cookies.map((c) => (
                    <tr title={c.value}>
                      <td class="mono ellipsis" style={{ maxWidth: 120 }}>{c.name}</td>
                      <td class="mono">{c.hostOnly ? '' : '.'}{c.domain}{c.path !== '/' ? c.path : ''}</td>
                      <td class="small">{[c.httpOnly && 'HttpOnly', c.secure && 'Secure', c.sameSite, c.expires === -1 ? t('d.sessionCookie') : new Date(c.expires * 1000).toLocaleDateString()].filter(Boolean).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div class="row wrap">
            <button class="btn sm" disabled={!web} title={web ? t('d.cloneTitle', { host: new URL(tab!.url!).hostname }) : t('d.openWebFirst')}
              onClick={async () => { const n = await toast.run(() => call<number>('cloneDefaultCookies', { id: s.id, url: tab!.url })); if (n !== undefined) toast.show(t('d.cloned', { n })); setCookies(await call('getCookies', { id: s.id })); }}>
              {t('d.clone')}
            </button>
          </div>
        </div>
      </details>

      {/* share */}
      {sharing && (
        <form class="card col" onSubmit={async (e) => {
          e.preventDefault();
          if (pass.length < 8) { toast.show(t('d.shareTooShort'), true); return; }
          const file = await toast.run(() => call('exportShare', { id: s.id, passphrase: pass }));
          if (file) { download(`${slug(s.name)}.qsl-share.json`, JSON.stringify(file), 'application/json'); toast.show(t('d.shareDone')); setSharing(false); setPass(''); }
        }}>
          <b class="small">{t('d.shareTitle')}</b>
          <span class="muted small">{t('d.shareHint')}</span>
          <div class="row">
            <input type="password" autoComplete="new-password" placeholder={t('d.sharePass')} aria-label={t('d.sharePass')} value={pass} onInput={(e) => setPass((e.target as HTMLInputElement).value)} />
            <button class="btn primary" type="submit">{t('d.shareCreate')}</button>
          </div>
        </form>
      )}

      {/* actions */}
      <div class="row wrap">
        <button class="btn sm" onClick={() => setSharing(!sharing)}>{t('d.share')}</button>
        <button class="btn sm" onClick={async () => {
          const st = await toast.run(() => call('exportStorageState', { id: s.id }));
          if (st) download(`${slug(s.name)}.storageState.json`, JSON.stringify(st, null, 2), 'application/json');
        }}>{t('d.exportPw')}</button>
        <button class="btn sm" onClick={async () => {
          const st = await toast.run(() => call('exportStorageState', { id: s.id }));
          if (st) { await copy(JSON.stringify(st, null, 2)); toast.show(t('d.jsonCopied')); }
        }}>{t('d.copyJson')}</button>
        <button class="btn sm" onClick={() => toast.run(() => call('duplicateSession', { id: s.id }), t('d.duplicated'))}>{t('d.duplicate')}</button>
        <button class="btn sm" onClick={() => confirmThen(t('d.confirmClear', { name: s.name }), () => toast.run(() => call('clearSessionData', { id: s.id }), t('d.cleared')))}>{t('d.clear')}</button>
        <button class="btn sm danger" onClick={() => confirmThen(t('d.confirmDelete', { name: s.name }), () => toast.run(() => call('deleteSession', { id: s.id }), t('d.deleted')))}>{t('c.delete')}</button>
      </div>
    </div>
  );
}

/** Inline confirm without window.confirm() (blocked in side panels on some Chrome builds). */
let pending: { text: string; fn: () => unknown } | null = null;
const listeners = new Set<() => void>();
export function confirmThen(text: string, fn: () => unknown) { pending = { text, fn }; listeners.forEach((l) => l()); }
export function ConfirmBar() {
  const [, force] = useState(0);
  useEffect(() => { const l = () => force((x) => x + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  if (!pending) return null;
  const p = pending;
  const close = () => { pending = null; force((x) => x + 1); };
  return (
    <div class="toast" role="alertdialog" style={{ bottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span class="grow">{p.text}</span>
      <button class="btn sm" style={{ color: '#fff', borderColor: '#777', background: 'transparent' }} onClick={close}>{t('c.cancel')}</button>
      <button class="btn sm rec" onClick={() => { close(); void p.fn(); }}>{t('c.confirm')}</button>
    </div>
  );
}
