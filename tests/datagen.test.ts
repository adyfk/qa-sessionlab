import { describe, expect, it } from 'vitest';
import { classifyField, luhnValid, person, strongPassword, testCard, uniqueTag } from '../src/shared/datagen';

describe('datagen', () => {
  it('test cards are Luhn-valid on test BINs', () => {
    for (const b of ['visa', 'mastercard', 'amex'] as const) {
      const c = testCard(b);
      expect(luhnValid(c.number)).toBe(true);
      expect(c.number).toHaveLength(b === 'amex' ? 15 : 16);
    }
  });
  it('strong password contains every class', () => {
    for (let i = 0; i < 50; i++) {
      const p = strongPassword();
      expect(p).toHaveLength(14);
      expect(p).toMatch(/[A-Z]/); expect(p).toMatch(/[a-z]/); expect(p).toMatch(/[0-9]/); expect(p).toMatch(/[^A-Za-z0-9]/);
    }
  });
  it('emails are unique and use the configured domain', () => {
    const a = person('mail.test').email, b = person('mail.test').email;
    expect(a).not.toBe(b);
    expect(a).toMatch(/^qa\+[a-z.]+\.\d+@mail\.test$/);
    expect(uniqueTag()).not.toBe(uniqueTag());
  });
  it('classifies common fields (EN + ID)', () => {
    expect(classifyField({ type: 'text', name: 'user_email' })).toBe('email');
    expect(classifyField({ type: 'password' })).toBe('password');
    expect(classifyField({ name: 'no_hp' , label: 'Nomor HP' })).toBe('phone');
    expect(classifyField({ name: 'kode_pos' })).toBe('postalCode');
    expect(classifyField({ autocomplete: 'given-name' })).toBe('firstName');
    expect(classifyField({ name: 'nama_lengkap' })).toBe('fullName');
    expect(classifyField({ tag: 'textarea', name: 'comment' })).toBe('textarea');
  });
});

import { en } from '../src/shared/locales/en';
import { id } from '../src/shared/locales/id';
import { es } from '../src/shared/locales/es';
import { pt_BR } from '../src/shared/locales/pt_BR';
import { ja } from '../src/shared/locales/ja';
import { zh_CN } from '../src/shared/locales/zh_CN';
import { matchLanguage, setLanguage, t } from '../src/shared/i18n';

describe('i18n', () => {
  const base = Object.keys(en).filter((k) => !k.endsWith('_one'));
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const [name, dict] of Object.entries({ id, es, pt_BR, ja, zh_CN })) {
    it(`${name} translates every UI string`, () => {
      const missing = base.filter((k) => !(k in dict) && !(k.endsWith('_other') ? false : `${k}_other` in dict));
      expect(missing).toEqual([]);
    });
    it(`${name} keeps the same placeholders`, () => {
      const bad = Object.entries(dict).filter(([k, v]) => {
        const src = (en as Record<string, string>)[k] ?? (en as Record<string, string>)[k.replace(/_(one|other)$/, '_other')];
        return src !== undefined && placeholders(src) !== placeholders(v!);
      }).map(([k]) => k);
      expect(bad).toEqual([]);
    });
    it(`${name} has no unknown keys`, () => expect(Object.keys(dict).filter((k) => !(k in en))).toEqual([]));
  }
  it('matches browser languages', () => {
    expect(matchLanguage('id-ID')).toBe('id');
    expect(matchLanguage('pt-PT')).toBe('pt_BR');
    expect(matchLanguage('zh-TW')).toBe('zh_CN');
    expect(matchLanguage('fr-FR')).toBe('en');
  });
  it('plurals and placeholders', () => {
    setLanguage('en');
    expect(t('s.openTabs', { n: 1 })).toBe('1 open tab');
    expect(t('s.openTabs', { n: 3 })).toBe('3 open tabs');
    setLanguage('id');
    expect(t('s.openTabs', { n: 1 })).toBe('1 tab terbuka');
    expect(t('d.confirmDelete', { name: 'Admin' })).toContain('“Admin”');
    setLanguage('en');
  });
});
