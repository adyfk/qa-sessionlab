import { useState } from 'preact/hooks';
import { isSealed, type Sealed } from '../../shared/crypto';
import { t } from '../../shared/i18n';
import { ROLE_TEMPLATES } from '../../shared/presets';
import { COLOR_HEX, presetIsActive, type Session } from '../../shared/types';
import { call, isWebUrl, type AppState, type useToast } from '../api';
import { SessionDetail } from './SessionDetail';

type Toast = ReturnType<typeof useToast>;

export function Sessions({ state, tab, toast }: { state: AppState; tab: chrome.tabs.Tab | null; toast: Toast }) {
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [temp, setTemp] = useState(false);
  const [sealed, setSealed] = useState<{ file: string; data: Sealed } | null>(null);
  const [pass, setPass] = useState('');
  const web = isWebUrl(tab?.url);
  const currentSid = tab?.id !== undefined ? state.assignments[tab.id] : undefined;
  const groups = [...new Set(state.sessions.map((s) => s.group).filter(Boolean))].sort();
  const existing = new Set(state.sessions.map((s) => s.name));

  const list = state.sessions.filter((s) => !q || `${s.name} ${s.group} ${s.notes}`.toLowerCase().includes(q.toLowerCase()));
  const byGroup = new Map<string, Session[]>();
  for (const s of list) byGroup.set(s.group, [...(byGroup.get(s.group) ?? []), s]);
  const orderedGroups = [...byGroup.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));

  const importFile = async (f: File) => {
    let json: unknown;
    try {
      json = JSON.parse(await f.text());
    } catch (e) {
      toast.show(t('s.invalidJson', { msg: (e as Error).message }), true);
      return;
    }
    if (isSealed(json)) { setSealed({ file: f.name, data: json }); setPass(''); return; }
    await toast.run(() => call('importStorageState', { name: f.name.replace(/\.(storageState\.)?json$/i, ''), state: json }), t('s.imported'));
  };

  return (
    <div class="section">
      <form class="card col" onSubmit={async (e) => {
        e.preventDefault();
        await toast.run(() => call('createSession', { session: { name, group, temporary: temp }, openUrl: web ? tab!.url : '' }), t('s.created'));
        setName('');
      }}>
        <h2>{t('s.newTitle')}</h2>
        <div class="row">
          <input type="text" placeholder={t('s.namePh')} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-label={t('s.nameAria')} />
          <input type="text" list="qsl-groups-new" placeholder={t('s.group')} style={{ width: 110 }} value={group} onInput={(e) => setGroup((e.target as HTMLInputElement).value)} aria-label={t('s.group')} />
          <datalist id="qsl-groups-new">{groups.map((g) => <option value={g} />)}</datalist>
        </div>
        <div class="row">
          <label class="check small muted grow"><input type="checkbox" checked={temp} onChange={(e) => setTemp((e.target as HTMLInputElement).checked)} /> {t('s.temporary')}</label>
          <button class="btn primary" type="submit">{web ? t('s.createOpenPage') : t('s.createOpen')}</button>
        </div>
        <div class="row wrap small">
          <span class="muted">{t('s.quickRoles')}</span>
          {ROLE_TEMPLATES.filter((r) => !existing.has(r)).slice(0, 6).map((r) => (
            <button type="button" class="btn sm" onClick={() => toast.run(() => call('createMany', { names: [r], group }), t('s.added', { name: r }))}>+ {r}</button>
          ))}
          <button type="button" class="btn sm" title={t('s.rbacTitle')}
            onClick={() => toast.run(() => call('createMany', { names: ['Admin', 'Staff', 'Customer', 'Guest'].filter((r) => !existing.has(r)), group }), t('s.rbacCreated'))}>
            {t('s.rbac')}
          </button>
        </div>
      </form>

      <div class="row">
        <input type="search" placeholder={t('s.search', { n: state.sessions.length })} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <label class="btn" title={t('s.importTitle')}>
          {t('s.import')}
          <input type="file" accept=".json,application/json" hidden onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void importFile(f); (e.target as HTMLInputElement).value = ''; }} />
        </label>
      </div>

      {sealed && (
        <form class="card col" onSubmit={async (e) => {
          e.preventDefault();
          try {
            await call('importShare', { file: sealed.data, passphrase: pass });
            toast.show(t('s.imported'));
            setSealed(null);
          } catch (err) {
            toast.show(String((err as Error).message).includes('WRONG_PASSPHRASE') ? t('s.wrongPass') : String((err as Error).message), true);
          }
        }}>
          <div class="small"><b>{t('s.sharedFile', { file: sealed.file })}</b></div>
          <div class="row">
            <input type="password" autoComplete="off" placeholder={t('s.passphraseFor')} aria-label={t('s.passphraseFor')} value={pass} onInput={(e) => setPass((e.target as HTMLInputElement).value)} />
            <button class="btn primary" type="submit" disabled={!pass}>{t('c.import')}</button>
            <button class="btn" type="button" onClick={() => setSealed(null)}>{t('c.cancel')}</button>
          </div>
        </form>
      )}

      {state.sessions.length === 0 && (
        <div class="empty">
          <div style={{ fontSize: 28 }}>🧪</div>
          <p>{t('s.empty')}</p>
          <p class="small">{t('s.emptyLong')}</p>
        </div>
      )}

      {orderedGroups.map((g) => (
        <div class="col">
          {(orderedGroups.length > 1 || g) && <h2 style={{ margin: '4px 0 0' }}>{g || t('s.ungrouped')}</h2>}
          <div class="list">
            {byGroup.get(g)!.map((s) => {
              const n = state.counts[s.id] ?? 0;
              const isOpen = open === s.id;
              return (
                <div class="sess" style={{ borderLeft: `4px solid ${COLOR_HEX[s.color]}` }}>
                  <div class="sess-head">
                    <button class="btn ghost sm" style={{ minWidth: 28, padding: 0 }} aria-expanded={isOpen} aria-label={t('s.detailsFor', { name: s.name })} onClick={() => setOpen(isOpen ? null : s.id)}>
                      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
                        <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </button>
                    <div class="grow" style={{ minWidth: 0, cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : s.id)}>
                      <div class="row" style={{ gap: 6 }}>
                        <span class="name ellipsis">{s.name}</span>
                        {s.id === currentSid && <span class="tag ok">{t('s.thisTab')}</span>}
                        {s.temporary && <span class="tag warn">{t('c.temp')}</span>}
                        {presetIsActive(s.preset) && <span class="tag ok">{t('c.emulated')}</span>}
                      </div>
                      <div class="muted small ellipsis">{n ? t('s.openTabs', { n }) : t('s.noTabs')}{s.notes ? ` · ${s.notes.split('\n')[0]}` : ''}</div>
                    </div>
                    {n > 0 && <button class="btn sm ghost" title={t('s.focus')} aria-label={t('s.focus')} onClick={() => call('focusSessionTabs', { id: s.id })}>⇥</button>}
                    <button class="btn sm" title={web ? t('pop.openUrlAs', { url: tab!.url!, name: s.name }) : t('s.openStart')} onClick={() => toast.run(() => call('openInSession', { id: s.id, url: web ? tab!.url : '' }))}>{t('c.open')}</button>
                  </div>
                  {isOpen && <SessionDetail s={s} tab={tab} toast={toast} groups={groups} />}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
