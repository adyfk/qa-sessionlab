import { render } from 'preact';
import { useState } from 'preact/hooks';
import { t } from '../shared/i18n';
import { COLOR_HEX, presetIsActive, type Session } from '../shared/types';
import { call, isWebUrl, useAppState, useToast } from './api';

function Chip({ s }: { s: Session }) {
  return <span class="chip" style={{ background: COLOR_HEX[s.color] }}>{s.name}</span>;
}

function Popup() {
  const { state, tab, refresh } = useAppState();
  const toast = useToast();
  const [newName, setNewName] = useState('');
  const [temp, setTemp] = useState(false);
  const [filter, setFilter] = useState('');

  if (!state) return <div class="empty">{t('c.loading')}</div>;
  const sid = tab?.id !== undefined ? state.assignments[tab.id] : undefined;
  const current = state.sessions.find((s) => s.id === sid);
  const web = isWebUrl(tab?.url);
  const rec = state.recordings.find((r) => r.tabId === tab?.id);
  const visible = state.sessions.filter((s) => !filter || `${s.name} ${s.group}`.toLowerCase().includes(filter.toLowerCase()));

  const openPanel = async () => {
    if (tab?.windowId !== undefined) await chrome.sidePanel.open({ windowId: tab.windowId });
    window.close();
  };

  const createAndOpen = async () => {
    await toast.run(() => call('createSession', { session: { name: newName, temporary: temp }, openUrl: web ? tab!.url : '' }));
    setNewName('');
    window.close();
  };

  return (
    <div>
      <div class="row" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
        <img src="icons/32.png" width={20} height={20} alt="" />
        <h3 class="grow">QA SessionLab</h3>
        <button class="btn sm" onClick={openPanel} title={t('pop.panelTitle')}>{t('pop.panel')}</button>
      </div>

      <div class="section">
        <div class="card flat col">
          <div class="row">
            <span class="muted small grow">{t('pop.thisTab')}</span>
            {current ? <Chip s={current} /> : <span class="tag">{t('pop.notIsolated')}</span>}
            {current?.temporary && <span class="tag warn">{t('c.temp')}</span>}
            {current && presetIsActive(current.preset) && <span class="tag ok">{t('c.emulated')}</span>}
          </div>
          {web ? (
            <>
              <select
                aria-label={t('pop.moveLabel')}
                value={sid ?? ''}
                onChange={async (e) => {
                  const v = (e.target as HTMLSelectElement).value;
                  if (v === '__new') await toast.run(() => call('assignNewSession', { tabId: tab!.id, temporary: true }), t('pop.movedNew'));
                  else await toast.run(() => call('assignTab', { tabId: tab!.id, sessionId: v || null }), t('pop.moved'));
                  void refresh();
                }}
              >
                <option value="">{t('pop.defaultOption')}</option>
                {state.sessions.map((s) => <option value={s.id}>{s.name}{s.group ? ` · ${s.group}` : ''}</option>)}
                <option value="__new">{t('pop.newTempOption')}</option>
              </select>
              <div class="row">
                <button
                  class={`btn grow ${rec ? 'rec' : ''}`}
                  onClick={async () => {
                    await toast.run(() => call(rec ? 'stopRecording' : 'startRecording', { tabId: tab!.id }), rec ? t('pop.recSaved') : t('pop.recording'));
                    void refresh();
                  }}
                >
                  {rec ? <><span class="pulse" style={{ background: '#fff' }} /> {t('pop.stopRecording')}</> : t('pop.record')}
                </button>
                <button class="btn grow" onClick={() => toast.run(async () => { await call('screenshot', { tabId: tab!.id, note: 'Popup screenshot' }); }, rec ? t('pop.shotAdded') : t('pop.shotTaken'))}>{t('pop.screenshot')}</button>
                <button class="btn grow" onClick={() => toast.run(() => call('fillTab', { tabId: tab!.id }), t('pop.filled'))}>{t('pop.fill')}</button>
              </div>
            </>
          ) : (
            <span class="muted small">{t('pop.openHttp')}</span>
          )}
        </div>

        <div class="col">
          <div class="row">
            <h2 class="grow" style={{ margin: 0 }}>{web ? t('pop.openAs') : t('pop.sessions')}</h2>
            {state.sessions.length > 6 && <input type="search" placeholder={t('pop.filter')} style={{ width: 120 }} value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} />}
          </div>
          {state.sessions.length === 0 && <div class="muted small">{t('pop.noSessions')}</div>}
          <div class="list" style={{ maxHeight: 220, overflow: 'auto' }}>
            {visible.map((s) => (
              <button
                class="btn"
                style={{ justifyContent: 'flex-start' }}
                onClick={async () => { await toast.run(() => call('openInSession', { id: s.id, url: web ? tab!.url : '' })); window.close(); }}
                title={web ? t('pop.openUrlAs', { url: tab!.url!, name: s.name }) : t('pop.openName', { name: s.name })}
              >
                <span class="dot" style={{ background: COLOR_HEX[s.color] }} />
                <span class="grow ellipsis" style={{ textAlign: 'left' }}>{s.name}</span>
                {s.group && <span class="tag">{s.group}</span>}
                {(state.counts[s.id] ?? 0) > 0 && <span class="tag">{t('pop.tabs', { n: state.counts[s.id] })}</span>}
              </button>
            ))}
          </div>
        </div>

        <form class="col" onSubmit={(e) => { e.preventDefault(); void createAndOpen(); }}>
          <div class="row">
            <input type="text" placeholder={t('pop.newPh')} value={newName} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} aria-label={t('pop.newAria')} />
            <button class="btn primary" type="submit">{t('pop.openBtn')}</button>
          </div>
          <label class="check small muted"><input type="checkbox" checked={temp} onChange={(e) => setTemp((e.target as HTMLInputElement).checked)} /> {t('pop.tempHint')}</label>
        </form>

        <div class="muted small">
          <span class="kbd">Alt+Shift+N</span> {t('pop.kbNew')} · <span class="kbd">Alt+Shift+R</span> {t('pop.kbRec')}
        </div>
      </div>
      {toast.msg && <div class={`toast ${toast.msg.err ? 'err' : ''}`}>{toast.msg.text}</div>}
    </div>
  );
}

render(<Popup />, document.getElementById('app')!);
