import { en, type MessageKey } from './locales/en';
import { id } from './locales/id';
import { es } from './locales/es';
import { pt_BR } from './locales/pt_BR';
import { ja } from './locales/ja';
import { zh_CN } from './locales/zh_CN';

export type Dict = Partial<Record<MessageKey, string>>;
export const LANGUAGES = { en: 'English', id: 'Bahasa Indonesia', es: 'Español', pt_BR: 'Português (Brasil)', ja: '日本語', zh_CN: '简体中文' } as const;
export type Lang = keyof typeof LANGUAGES;
const DICTS: Record<Lang, Dict> = { en, id, es, pt_BR, ja, zh_CN };

let current: Lang = 'en';

/** Map a BCP-47 tag (navigator.language) to a supported language. */
export function matchLanguage(tag: string | undefined): Lang {
  const t = (tag ?? '').toLowerCase().replace('_', '-');
  if (t.startsWith('id') || t.startsWith('in') || t.startsWith('ms')) return 'id';
  if (t.startsWith('es')) return 'es';
  if (t.startsWith('pt')) return 'pt_BR';
  if (t.startsWith('ja')) return 'ja';
  if (t.startsWith('zh')) return 'zh_CN';
  return 'en';
}

/** pref: 'auto' or a Lang code. */
export function setLanguage(pref: string | undefined): Lang {
  current = pref && pref !== 'auto' && pref in DICTS ? (pref as Lang) : matchLanguage(typeof navigator !== 'undefined' ? navigator.language : 'en');
  if (typeof document !== 'undefined') document.documentElement.lang = current.replace('_', '-');
  return current;
}
export const getLanguage = () => current;

type Vars = Record<string, string | number>;

/** Translate. With vars.n, `key_one` / `key_other` plural forms are used when they exist. */
export function t(key: MessageKey | `${string}_one` | `${string}_other` | string, vars?: Vars): string {
  let k = key as MessageKey;
  if (vars && typeof vars.n === 'number') {
    const form = new Intl.PluralRules(current.replace('_', '-')).select(vars.n) === 'one' ? '_one' : '_other';
    const pk = `${key}${form}` as MessageKey;
    if (pk in en) k = pk;
  }
  const s = DICTS[current][k] ?? (en as Record<string, string>)[k] ?? String(key);
  return vars ? s.replace(/\{(\w+)\}/g, (m, v) => (v in vars ? String(vars[v]) : m)) : s;
}
