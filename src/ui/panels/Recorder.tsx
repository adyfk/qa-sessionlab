import { useEffect, useState } from 'preact/hooks';
import { t } from '../../shared/i18n';
import { toMarkdown } from '../../shared/report';
import type { Recording } from '../../shared/types';
import { call, copy, dataUrlToBlob, download, isWebUrl, slug, type AppState, type useToast } from '../api';
import { confirmThen } from './SessionDetail';

type Toast = ReturnType<typeof useToast>;
interface Meta { id: string; title: string; startedAt: number; stoppedAt: number | null; sessionName?: string; counts: number[] }

const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h`;
};

export function Recorder({ state, tab, toast }: { state: AppState; tab: chrome.tabs.Tab | null; toast: Toast }) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [list, setList] = useState<Meta[]>([]);
  const [view, setView] = useState<Recording | null>(null);
  const live = state.recordings.find((r) => r.tabId === tab?.id);
  const web = isWebUrl(tab?.url);

  const load = async () => setList(await call<Meta[]>('listRecordings'));
  useEffect(() => { void load(); }, [state.recordings.length]);

  if (view) return <RecordingView r={view} toast={toast} onBack={() => { setView(null); void load(); }} />;

  return (
    <div class="section">
      <div class="card col">
        <h2>{t('r.title')}</h2>
        {!live ? (
          <>
            <span class="muted small">{t('r.hint')}</span>
            <input type="text" placeholder={t('r.titlePh')} value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} disabled={!web} />
            <button class="btn rec" disabled={!web} onClick={async () => { await toast.run(() => call('startRecording', { tabId: tab!.id, title }), t('r.started')); setTitle(''); }}>{t('r.start')}</button>
            {!web && <span class="muted small">{t('r.switch')}</span>}
          </>
        ) : (
          <>
            <div class="row"><span class="pulse" /><b class="grow ellipsis">{live.title}</b><span class="muted small">{ago(live.startedAt)}</span></div>
            <div class="row small muted wrap">
              <span>{t('r.steps', { n: live.counts[0] })}</span>·<span>{t('r.console', { n: live.counts[1] })}</span>·<span>{t('r.failed', { n: live.counts[2] })}</span>·<span>{t('r.shots', { n: live.counts[3] })}</span>
            </div>
            <form class="row" onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; await call('addNote', { tabId: tab!.id, text: note.trim() }); setNote(''); toast.show(t('r.noteAdded')); }}>
              <input type="text" placeholder={t('r.notePh')} value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
              <button class="btn">{t('c.add')}</button>
            </form>
            <div class="row">
              <button class="btn grow" onClick={() => toast.run(() => call('screenshot', { tabId: tab!.id, note: 'Screenshot' }), t('r.shotAdded'))}>{t('r.shot')}</button>
              <button class="btn grow rec" onClick={async () => {
                const r = await toast.run(() => call<Recording>('stopRecording', { tabId: tab!.id }), t('r.saved'));
                if (r) setView(r);
              }}>{t('r.stop')}</button>
            </div>
          </>
        )}
      </div>

      <h2 style={{ margin: '4px 0 0' }}>{t('r.list')}</h2>
      {list.length === 0 && <div class="muted small">{t('r.empty', { key: 'Alt+Shift+R' })}</div>}
      <div class="list">
        {list.map((m) => (
          <button class="btn" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={async () => setView(await call('getRecording', { id: m.id }))}>
            <div class="grow" style={{ minWidth: 0 }}>
              <div class="ellipsis">{!m.stoppedAt && '● '}{m.title}</div>
              <div class="muted small">{new Date(m.startedAt).toLocaleString()}{m.sessionName ? ` · ${m.sessionName}` : ''} · {t('r.steps', { n: m.counts[0] })} · {t('r.console', { n: m.counts[1] })} · {t('r.failed', { n: m.counts[2] })}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function RecordingView({ r, toast, onBack }: { r: Recording; toast: Toast; onBack: () => void }) {
  const [title, setTitle] = useState(r.title);
  const [md, setMd] = useState(() => toMarkdown(r));
  const [big, setBig] = useState<string | null>(null);
  const errors = r.console.filter((c) => /error|exception|assert/.test(c.level));
  const name = slug(title);

  const saveTitle = async () => {
    if (title === r.title) return;
    r.title = title;
    await call('renameRecording', { id: r.id, title });
    setMd(toMarkdown(r));
  };

  return (
    <div class="section">
      <div class="row">
        <button class="btn sm" onClick={onBack}>{t('c.back')}</button>
        <span class="grow" />
        <button class="btn sm danger" onClick={() => confirmThen(t('r.confirmDelete'), async () => { await call('deleteRecording', { id: r.id }); onBack(); })}>{t('c.delete')}</button>
      </div>
      <input type="text" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} onBlur={saveTitle} aria-label={t('r.bugTitle')} style={{ fontWeight: 600 }} />
      <div class="row small muted wrap">
        <span>{t('r.steps', { n: r.steps.length })}</span>·<span>{t('r.errors', { n: errors.length })}</span>·<span>{t('r.failedReq', { n: r.network.length })}</span>·<span>{t('r.screenshots', { n: r.screenshots.length })}</span>
      </div>

      <div class="row wrap">
        <button class="btn primary" onClick={async () => { await copy(md); toast.show(t('r.copied')); }}>{t('r.copy')}</button>
        <button class="btn" onClick={() => download(`${name}.md`, md, 'text/markdown')}>⤓ .md</button>
        <button class="btn" onClick={() => download(`${name}.json`, JSON.stringify({ ...r, screenshots: r.screenshots.map((s) => ({ t: s.t, url: s.url })) }, null, 2), 'application/json')}>⤓ .json</button>
        <button class="btn" disabled={!r.screenshots.length} onClick={() => r.screenshots.forEach((s, i) => download(`${name}-${i + 1}.png`, dataUrlToBlob(s.dataUrl)))}>{t('r.dlShots')}</button>
      </div>

      {r.screenshots.length > 0 && (
        <div class="thumbs">
          {r.screenshots.map((s, i) => <img src={s.dataUrl} alt={t('r.shotN', { n: i + 1 })} onClick={() => setBig(s.dataUrl)} />)}
        </div>
      )}
      {big && <img src={big} alt="" style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 6, cursor: 'zoom-out' }} onClick={() => setBig(null)} />}

      <details open>
        <summary>{t('r.preview')}</summary>
        <textarea class="mono" style={{ minHeight: 260, marginTop: 6 }} value={md} onInput={(e) => setMd((e.target as HTMLTextAreaElement).value)} />
      </details>
      {errors.length > 0 && (
        <details>
          <summary>{t('r.consoleErrors', { n: errors.length })}</summary>
          <div class="scroll mono small">{errors.map((c) => <div style={{ color: 'var(--danger)', padding: '2px 0', borderBottom: '1px solid var(--line)' }}>{c.text}</div>)}</div>
        </details>
      )}
      {r.network.length > 0 && (
        <details>
          <summary>{t('r.failedList', { n: r.network.length })}</summary>
          <div class="scroll">
            <table class="tbl"><tbody>{r.network.map((n) => <tr><td>{n.method}</td><td>{n.status || n.error}</td><td class="mono" style={{ wordBreak: 'break-all' }}>{n.url}</td></tr>)}</tbody></table>
          </div>
        </details>
      )}
    </div>
  );
}
