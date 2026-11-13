import { useState } from 'preact/hooks';
import { EDGE_CASES, QUICK_VALUES, person, testCard, type Person } from '../../shared/datagen';
import { t } from '../../shared/i18n';
import type { MessageKey } from '../../shared/locales/en';
import { call, copy, isWebUrl, type AppState, type useToast } from '../api';

type Toast = ReturnType<typeof useToast>;

const FIELDS: (keyof Person)[] = ['fullName', 'email', 'username', 'password', 'phone', 'birthDate', 'street', 'city', 'province', 'postalCode', 'company', 'nik', 'npwp'];

export function DataGen({ state, tab, toast }: { state: AppState; tab: chrome.tabs.Tab | null; toast: Toast }) {
  const domain = state.settings.testEmailDomain;
  const [p, setP] = useState(() => person(domain));
  const [cards] = useState(() => (['visa', 'mastercard', 'amex'] as const).map((b) => testCard(b)));
  const web = isWebUrl(tab?.url);
  const cp = async (v: string, label: string) => { await copy(v); toast.show(`${t('c.copied')} · ${label}: ${v.length > 40 ? v.slice(0, 40) + '…' : v || '∅'}`); };

  return (
    <div class="section">
      <div class="card col">
        <div class="row">
          <h2 class="grow" style={{ margin: 0 }}>{t('t.identity')}</h2>
          <button class="btn sm" onClick={() => setP(person(domain))}>{t('c.new')}</button>
          <button class="btn sm primary" disabled={!web} title={t('t.fillTitle')}
            onClick={() => toast.run(() => call('fillTab', { tabId: tab!.id }), t('pop.filled'))}>{t('t.fill')}</button>
        </div>
        <table class="tbl">
          <tbody>
            {FIELDS.map((k) => {
              const label = t(`t.f.${k}` as MessageKey);
              return (
                <tr>
                  <th style={{ width: 92 }}>{label}</th>
                  <td class="mono" style={{ wordBreak: 'break-all' }}>{p[k]}</td>
                  <td style={{ width: 30 }}><button class="btn sm ghost" aria-label={t('t.copyField', { name: label })} onClick={() => cp(p[k], label)}>⧉</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <span class="muted small">{t('t.emailHint', { pattern: `qa+…@${domain}` })}</span>
      </div>

      <div class="card col">
        <h2>{t('t.quick')}</h2>
        <div class="row wrap">
          {Object.entries(QUICK_VALUES).map(([k, v]) => {
            const label = t(`q.${k}` as MessageKey);
            return <button class="btn sm" key={k} onClick={() => cp(v.value(domain), label)}>{label}</button>;
          })}
        </div>
      </div>

      <div class="card col">
        <h2>{t('t.cards')}</h2>
        <span class="muted small">{t('t.cardsHint')}</span>
        {cards.map((c) => (
          <div class="row">
            <span class="tag" style={{ width: 82, textAlign: 'center' }}>{c.brand}</span>
            <span class="mono grow">{c.number}</span>
            <span class="mono muted">{c.expiry} · {c.cvc}</span>
            <button class="btn sm ghost" aria-label={t('t.copyField', { name: c.brand })} onClick={() => cp(c.number, c.brand)}>⧉</button>
          </div>
        ))}
      </div>

      <div class="card col">
        <h2>{t('t.edge')}</h2>
        <span class="muted small">{t('t.edgeHint')}</span>
        <div class="list">
          {Object.entries(EDGE_CASES).map(([k, v]) => {
            const val = v.value();
            const label = t(`e.${k}` as MessageKey);
            return (
              <button class="btn sm" key={k} style={{ justifyContent: 'flex-start', overflow: 'hidden' }} onClick={() => cp(val, label)} title={val}>
                <span style={{ flex: 'none', textAlign: 'left' }}>{label}</span>
                <span class="mono muted ellipsis" style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>{JSON.stringify(val).slice(0, 60)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
