import { DEVICE_PRESETS, NETWORK_PRESETS } from './presets';
import { t } from './i18n';
import type { Recording } from './types';

const time = (t: number, start: number) => {
  const s = Math.max(0, (t - start) / 1000);
  return `+${s.toFixed(1)}s`;
};
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Markdown bug report ready to paste into Jira / GitHub / Linear. */
export function toMarkdown(r: Recording, opts: { includeLogs?: boolean } = {}): string {
  const includeLogs = opts.includeLogs ?? true;
  const L: string[] = [];
  L.push(`# ${r.title}`, '');
  L.push(`## ${t('rep.env')}`, '');
  L.push(`- **${t('rep.url')}:** ${r.env.url ?? '-'}`);
  if (r.env.sessionName) L.push(`- **${t('rep.session')}:** ${r.env.sessionName}`);
  if (r.env.userAgent) L.push(`- **${t('rep.ua')}:** \`${r.env.userAgent}\``);
  if (r.env.viewport) L.push(`- **${t('rep.viewport')}:** ${r.env.viewport}`);
  const p = r.env.preset;
  if (p) {
    const bits = [
      DEVICE_PRESETS[p.device]?.label, NETWORK_PRESETS[p.network]?.label, p.locale && `locale ${p.locale}`,
      p.timezone && `tz ${p.timezone}`, p.colorScheme && `${p.colorScheme} mode`, p.reducedMotion && 'reduced motion',
      p.geo && `geo ${p.geo.latitude},${p.geo.longitude}`,
    ].filter(Boolean);
    if (bits.length) L.push(`- **${t('rep.emulation')}:** ${bits.join(', ')}`);
  }
  L.push(`- **${t('rep.recorded')}:** ${new Date(r.startedAt).toISOString()}${r.stoppedAt ? ` (${((r.stoppedAt - r.startedAt) / 1000).toFixed(0)}s)` : ''}`);
  L.push('');

  L.push(`## ${t('rep.steps')}`, '');
  let n = 1;
  for (const s of r.steps) {
    if (s.kind === 'screenshot') { L.push(`   - 📷 ${s.text}`); continue; }
    if (s.kind === 'note') { L.push(`   - 📝 _${s.text}_`); continue; }
    L.push(`${n++}. ${s.text}${s.selector ? ` — \`${s.selector}\`` : ''}`);
  }
  L.push('');
  L.push(`## ${t('rep.expected')}`, '', t('rep.expectedPh'), '');
  L.push(`## ${t('rep.actual')}`, '', t('rep.actualPh'), '');

  const errors = r.console.filter((c) => /error|exception|assert/.test(c.level));
  const warns = r.console.filter((c) => /warn/.test(c.level));
  L.push(`## ${t('rep.summary')}`, '');
  L.push(`- ${t('rep.consoleLine', { e: errors.length, w: warns.length })}`);
  L.push(`- ${t('rep.failedLine', { n: r.network.length })}`);
  L.push(`- ${t('rep.shotsLine', { n: r.screenshots.length })}`);
  L.push('');

  if (includeLogs && errors.length) {
    L.push(`## ${t('rep.consoleErrors')}`, '', '```');
    for (const c of errors.slice(-50)) L.push(`[${time(c.t, r.startedAt)}] ${c.level}: ${c.text}${c.url ? `  (${c.url}${c.line !== undefined ? `:${c.line + 1}` : ''})` : ''}`);
    L.push('```', '');
  }
  if (includeLogs && r.network.length) {
    L.push(`## ${t('rep.failed')}`, '', t('rep.cols'), '|---|---|---|---|');
    for (const x of r.network.slice(-50)) L.push(`| ${time(x.t, r.startedAt)} | ${x.method} | ${x.status || esc(x.error ?? 'failed')} | ${esc(x.url.length > 140 ? x.url.slice(0, 140) + '…' : x.url)} |`);
    L.push('');
  }
  L.push('---', t('rep.footer'));
  return L.join('\n');
}
