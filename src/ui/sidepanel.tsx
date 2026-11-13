import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { t } from '../shared/i18n';
import type { MessageKey } from '../shared/locales/en';
import { COLOR_HEX } from '../shared/types';
import { useAppState, useToast } from './api';
import { DataGen } from './panels/DataGen';
import { Matrix } from './panels/Matrix';
import { Recorder } from './panels/Recorder';
import { ConfirmBar } from './panels/SessionDetail';
import { Sessions } from './panels/Sessions';
import { SettingsPanel } from './panels/SettingsPanel';

const TABS: [string, MessageKey][] = [
  ['sessions', 'nav.sessions'], ['matrix', 'nav.matrix'], ['recorder', 'nav.recorder'], ['data', 'nav.data'], ['settings', 'nav.settings'],
];
type TabKey = 'sessions' | 'matrix' | 'recorder' | 'data' | 'settings';

function Panel() {
  const { state, tab } = useAppState();
  const toast = useToast();
  const [active, setActive] = useState<TabKey>(() => {
    try { return (localStorage.getItem('qsl.tab') as TabKey) || 'sessions'; } catch { return 'sessions'; }
  });
  useEffect(() => { try { localStorage.setItem('qsl.tab', active); } catch { /* ignore */ } }, [active]);

  if (!state) return <div class="empty">{t('c.loading')}</div>;
  const sid = tab?.id !== undefined ? state.assignments[tab.id] : undefined;
  const current = state.sessions.find((s) => s.id === sid);
  const rec = state.recordings.find((r) => r.tabId === tab?.id);

  return (
    <div>
      <div class="row" style={{ padding: '8px 12px' }}>
        <img src="icons/32.png" width={18} height={18} alt="" />
        <b class="grow">QA SessionLab</b>
        {rec && <span class="row small" style={{ gap: 4, color: 'var(--danger)' }}><span class="pulse" />{t('hdr.rec')}</span>}
        {current
          ? <span class="chip" style={{ background: COLOR_HEX[current.color] }} title={t('hdr.activeSession')}>{current.name}</span>
          : <span class="tag" title={t('hdr.defaultTitle')}>{t('hdr.default')}</span>}
      </div>
      <nav class="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button role="tab" aria-selected={active === k} onClick={() => setActive(k as TabKey)}>
            {t(label)}
            {k === 'recorder' && state.recordings.length > 0 && ' ●'}
          </button>
        ))}
      </nav>
      {active === 'sessions' && <Sessions state={state} tab={tab} toast={toast} />}
      {active === 'matrix' && <Matrix state={state} tab={tab} toast={toast} />}
      {active === 'recorder' && <Recorder state={state} tab={tab} toast={toast} />}
      {active === 'data' && <DataGen state={state} tab={tab} toast={toast} />}
      {active === 'settings' && <SettingsPanel state={state} toast={toast} />}
      <ConfirmBar />
      {toast.msg && <div class={`toast ${toast.msg.err ? 'err' : ''}`}>{toast.msg.text}</div>}
    </div>
  );
}

render(<Panel />, document.getElementById('app')!);
