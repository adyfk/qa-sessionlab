import { useEffect, useState } from 'preact/hooks';
import { LANGUAGES, t } from '../../shared/i18n';
import type { MessageKey } from '../../shared/locales/en';
import type { Settings } from '../../shared/types';
import { call, copy, download, type AppState, type useToast } from '../api';

type Toast = ReturnType<typeof useToast>;

export function SettingsPanel({ state, toast }: { state: AppState; toast: Toast }) {
  const s = state.settings;
  const [domain, setDomain] = useState(s.testEmailDomain);
  const [withCookies, setWithCookies] = useState(false);
  const [swOrigins, setSwOrigins] = useState<string[]>([]);
  const loadSw = async () => setSwOrigins(await call<string[]>('swBlockedOrigins'));
  useEffect(() => { void loadSw(); }, []);
  const [agent, setAgent] = useState<{ status: string; lastError: string; token: string } | null>(null);
  const [port, setPort] = useState(String(s.agentPort));
  useEffect(() => {
    const load = async () => setAgent(await call('agentStatus'));
    void load();
    const timer = setInterval(load, 1500);
    return () => clearInterval(timer);
  }, []);
  const mcpCmd = agent ? `claude mcp add qa-sessionlab -e QSL_TOKEN=${agent.token}${s.agentPort !== 17321 ? ` -e QSL_PORT=${s.agentPort}` : ''} -- node <QA-SessionLab-folder>/tools/mcp/qsl-mcp.mjs` : '';
  const save = (patch: Partial<Settings>) => toast.run(() => call('saveSettings', { patch }), t('c.saved'));
  const Toggle = ({ k, label, hint }: { k: keyof Settings; label: MessageKey; hint: MessageKey }) => (
    <label class="check" style={{ alignItems: 'flex-start' }}>
      <input type="checkbox" checked={!!s[k]} onChange={(e) => save({ [k]: (e.target as HTMLInputElement).checked })} style={{ marginTop: 3 }} />
      <span><div>{t(label)}</div><div class="muted small">{t(hint)}</div></span>
    </label>
  );

  return (
    <div class="section">
      <div class="card col">
        <label class="field"><span>{t('set.language')}</span>
          <select value={s.language} onChange={(e) => save({ language: (e.target as HTMLSelectElement).value })} aria-label="Language">
            <option value="auto">{t('set.auto')}</option>
            {Object.entries(LANGUAGES).map(([code, label]) => <option value={code}>{label}</option>)}
          </select>
        </label>
      </div>

      <div class="card col">
        <h2>{t('set.behaviour')}</h2>
        <Toggle k="useTabGroups" label="set.groups" hint="set.groupsHint" />
        <Toggle k="titlePrefix" label="set.title" hint="set.titleHint" />
        <Toggle k="inheritOnOpen" label="set.inherit" hint="set.inheritHint" />
        <Toggle k="maskSecrets" label="set.mask" hint="set.maskHint" />
        <form class="field" onSubmit={(e) => { e.preventDefault(); void save({ testEmailDomain: domain.trim() || 'example.test' }); }}>
          <span>{t('set.emailDomain')}</span>
          <div class="row"><input type="text" value={domain} onInput={(e) => setDomain((e.target as HTMLInputElement).value)} /><button class="btn">{t('c.save')}</button></div>
        </form>
      </div>

      <div class="card col" data-qa="ai-control">
        <h2>{t('set.ai')}</h2>
        <span class="muted small">{t('set.aiHint')}</span>
        <label class="check"><input type="checkbox" checked={s.agentEnabled} onChange={(e) => save({ agentEnabled: (e.target as HTMLInputElement).checked })} /> {t('set.aiAllow')}</label>
        {s.agentEnabled && agent && (
          <>
            <div class="row small">
              <span class={`tag ${agent.status === 'connected' ? 'ok' : 'warn'}`}>{agent.status === 'connected' ? t('set.aiConnected') : agent.status === 'connecting' ? t('set.aiConnecting') : t('set.aiWaiting')}</span>
              {agent.status !== 'connected' && agent.lastError && <span class="muted small grow">{agent.lastError === 'wrongToken' ? t('set.aiWrongToken') : agent.lastError === 'noServer' ? t('set.aiNoServer', { port: s.agentPort }) : agent.lastError}</span>}
            </div>
            <div class="row">
              <label class="field" style={{ width: 110 }}><span>{t('set.port')}</span>
                <input type="number" value={port} onInput={(e) => setPort((e.target as HTMLInputElement).value)} onBlur={() => { const n = Number(port); if (n > 1023 && n < 65536 && n !== s.agentPort) void save({ agentPort: n }); }} />
              </label>
              <label class="field grow"><span>{t('set.token')}</span>
                <div class="row"><input type="text" readOnly value={agent.token} class="mono" /><button class="btn sm" onClick={async () => { await copy(agent.token); toast.show(t('set.tokenCopied')); }}>{t('c.copy')}</button></div>
              </label>
            </div>
            <div class="field"><span>{t('set.register')}</span>
              <div class="row"><input type="text" readOnly value={mcpCmd} class="mono" /><button class="btn sm" onClick={async () => { await copy(mcpCmd); toast.show(t('set.cmdCopied')); }}>{t('c.copy')}</button></div>
            </div>
            <button class="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => save({ agentToken: '' }).then(() => call('agentStatus')).then(setAgent)}>{t('set.newToken')}</button>
          </>
        )}
      </div>

      <div class="card col">
        <h2>{t('set.sw')}</h2>
        <span class="muted small">{t('set.swHint')}</span>
        {swOrigins.length === 0 && <span class="small muted">{t('set.swNone')}</span>}
        {swOrigins.map((o) => (
          <div class="row">
            <span class="mono grow ellipsis">{o}</span>
            <button class="btn sm" onClick={async () => { await toast.run(() => call('allowServiceWorkers', { origin: o }), t('set.swAllowed')); void loadSw(); }}>{t('set.swAllow')}</button>
          </div>
        ))}
      </div>

      <div class="card col">
        <h2>{t('set.backup')}</h2>
        <span class="muted small">{t('set.backupHint')}</span>
        <label class="check small"><input type="checkbox" checked={withCookies} onChange={(e) => setWithCookies((e.target as HTMLInputElement).checked)} /> {t('set.includeLogins')}</label>
        <div class="row">
          <button class="btn" onClick={async () => {
            const b = await toast.run(() => call('exportAll', { includeCookies: withCookies }));
            if (b) download(`qa-sessionlab-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b, null, 2), 'application/json');
          }}>{t('set.export')}</button>
          <label class="btn">{t('set.importBackup')}
            <input type="file" accept=".json,application/json" hidden onChange={async (e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              (e.target as HTMLInputElement).value = '';
              if (!f) return;
              try {
                const n = await call<number>('importAll', { backup: JSON.parse(await f.text()) });
                toast.show(t('set.imported', { n }));
              } catch (err) { toast.show(String((err as Error).message ?? err), true); }
            }} />
          </label>
        </div>
      </div>

      <div class="card col">
        <h2>{t('set.shortcuts')}</h2>
        <div class="small"><span class="kbd">Alt+Shift+S</span> {t('set.kbPopup')} · <span class="kbd">Alt+Shift+N</span> {t('set.kbNew')} · <span class="kbd">Alt+Shift+R</span> {t('set.kbRec')}</div>
        <div class="row wrap">
          <button class="btn sm" onClick={() => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>{t('set.customize')}</button>
          <button class="btn sm" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') })}>{t('set.guide')}</button>
        </div>
      </div>

      <div class="card col small">
        <h2>{t('set.how')}</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {(['set.how1', 'set.how2', 'set.how3', 'set.how4', 'set.how5', 'set.how6'] as MessageKey[]).map((k) => <li>{t(k)}</li>)}
        </ul>
      </div>
    </div>
  );
}
