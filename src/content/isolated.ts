import { classifyField, person, valueFor, type Person } from '../shared/datagen';
import type { RecordedStep, Session } from '../shared/types';

/**
 * Runs in the extension's isolated world in every frame at document_start.
 *  - bridges the MAIN-world shim <-> background (cookie writes, jar updates)
 *  - shows the session name in the tab title
 *  - records user steps while a bug recording is active
 *  - fills forms / inserts test values
 */

const isTop = window === window.top;
let session: Session | null = null;
let recording = false;
let titlePrefix = true;
let maskSecrets = true;

const send = (msg: object) => chrome.runtime.sendMessage(msg).catch(() => undefined);

// ---------- bridge ----------
document.addEventListener('__qsl_to_iso', (e) => {
  try {
    const m = JSON.parse((e as CustomEvent).detail);
    if (m.type === 'cookieSet') void send({ type: 'cs:cookieSet', sid: m.sid, header: m.header, url: m.url });
    if (m.type === 'restored') void send({ type: 'cs:restored', sid: m.sid, id: m.id, origin: m.origin });
  } catch { /* ignore */ }
});
const toMain = (msg: object) => document.dispatchEvent(new CustomEvent('__qsl_to_main', { detail: JSON.stringify(msg) }));

// ---------- title ----------
let titleObserver: MutationObserver | null = null;
const tag = () => (session ? `[${session.name}] ` : '');
function applyTitle() {
  if (!isTop) return;
  const t = document.title;
  const clean = t.replace(/^\[[^\]]{1,40}\] /, '');
  const want = titlePrefix && session ? tag() + clean : clean;
  if (t !== want) document.title = want;
}
function watchTitle() {
  if (!isTop || titleObserver) return;
  titleObserver = new MutationObserver(applyTitle);
  const start = () => {
    applyTitle();
    titleObserver!.observe(document.head ?? document.documentElement, { subtree: true, childList: true, characterData: true });
  };
  if (document.head) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
}

// ---------- recorder ----------
function cssEscape(s: string) { return (window.CSS?.escape ?? ((x: string) => x.replace(/[^\w-]/g, '\\$&')))(s); }

function selectorFor(el: Element): string {
  const testId = el.getAttribute('data-testid') ?? el.getAttribute('data-test') ?? el.getAttribute('data-cy') ?? el.getAttribute('data-qa');
  if (testId) return `[data-testid="${testId}"]`;
  if (el.id && !/\d{4,}|^:r/.test(el.id)) return `#${cssEscape(el.id)}`;
  const name = el.getAttribute('name');
  if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
  const aria = el.getAttribute('aria-label');
  if (aria) return `${el.tagName.toLowerCase()}[aria-label="${aria}"]`;
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && parts.length < 4 && cur !== document.body) {
    let p = cur.tagName.toLowerCase();
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === cur!.tagName);
      if (same.length > 1) p += `:nth-of-type(${same.indexOf(cur) + 1})`;
    }
    parts.unshift(p);
    cur = parent;
  }
  return parts.join(' > ');
}

function describe(el: Element): string {
  const h = el as HTMLElement;
  const label = el.getAttribute('aria-label') || (h.innerText || '').trim().replace(/\s+/g, ' ') || el.getAttribute('title') || el.getAttribute('placeholder') || (el as HTMLInputElement).value || el.tagName.toLowerCase();
  return label.length > 60 ? label.slice(0, 60) + '…' : label;
}

function isSecret(el: Element) {
  const i = el as HTMLInputElement;
  const hay = `${i.type} ${i.name} ${i.id} ${i.autocomplete}`.toLowerCase();
  return i.type === 'password' || /pass|pwd|secret|token|otp|cvc|cvv|card/.test(hay);
}

function step(kind: RecordedStep['kind'], text: string, el?: Element) {
  if (!recording) return;
  void send({ type: 'cs:step', step: { t: Date.now(), kind, text, url: location.href, selector: el ? selectorFor(el) : undefined } });
}

document.addEventListener('click', (e) => {
  if (!recording) return;
  const el = (e.target as Element)?.closest?.('a,button,input,select,textarea,label,[role],[onclick],summary') ?? (e.target as Element);
  if (!el || !(el instanceof Element)) return;
  if (el instanceof HTMLInputElement && ['text', 'email', 'password', 'search', 'tel', 'number', 'url'].includes(el.type)) return;
  step('click', `Click “${describe(el)}”`, el);
}, true);

document.addEventListener('change', (e) => {
  if (!recording) return;
  const el = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  if (!el?.tagName) return;
  let v: string;
  if (el instanceof HTMLSelectElement) v = el.selectedOptions[0]?.text ?? el.value;
  else if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) v = el.checked ? 'checked' : 'unchecked';
  else v = maskSecrets && isSecret(el) ? '••••••' : el.value;
  const name = el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('placeholder') || el.id || el.tagName.toLowerCase();
  step('input', `Set “${name}” = “${v.length > 80 ? v.slice(0, 80) + '…' : v}”`, el);
}, true);

document.addEventListener('submit', (e) => step('submit', `Submit form ${selectorFor(e.target as Element)}`, e.target as Element), true);
document.addEventListener('keydown', (e) => {
  if (recording && (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') && !e.repeat) {
    step('key', `Press ${e.key}`, e.target as Element);
  }
}, true);

// ---------- fill & insert ----------
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  el.focus();
  setter ? setter.call(el, value) : (el.value = value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function labelText(el: Element): string {
  const id = el.id;
  if (id) { const l = document.querySelector(`label[for="${cssEscape(id)}"]`); if (l) return (l as HTMLElement).innerText; }
  return (el.closest('label') as HTMLElement | null)?.innerText ?? '';
}

function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const st = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
}

function fillForm(domain: string, textOne?: string, textOther?: string): number {
  const p: Person = person(domain);
  let n = 0;
  const scope: ParentNode = (document.activeElement?.closest('form') as ParentNode | null) ?? document;
  scope.querySelectorAll<HTMLElement>('input, textarea, select').forEach((el) => {
    const i = el as HTMLInputElement;
    if (i.disabled || i.readOnly || !visible(el)) return;
    const type = (i.type || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'file', 'image', 'range', 'color'].includes(type)) return;
    if (type === 'checkbox') { if (i.required && !i.checked) { i.click(); n++; } return; }
    if (type === 'radio') {
      if (!document.querySelector(`input[type=radio][name="${cssEscape(i.name)}"]:checked`)) { i.click(); n++; }
      return;
    }
    if (el instanceof HTMLSelectElement) {
      const opt = [...el.options].find((o, idx) => idx > 0 && o.value && !o.disabled) ?? [...el.options].find((o) => o.value && !o.disabled);
      if (opt && !el.value) { setNativeValue(el, opt.value); n++; }
      return;
    }
    if (i.value) return; // don't overwrite what the tester typed
    const kind = classifyField({ type, name: i.name, id: i.id, placeholder: i.placeholder, autocomplete: i.autocomplete, label: labelText(el), tag: el.tagName.toLowerCase() });
    let v = valueFor(kind, p);
    if (i.maxLength > 0 && v.length > i.maxLength) v = v.slice(0, i.maxLength);
    if (type === 'number' && i.min && Number(v) < Number(i.min)) v = i.min;
    setNativeValue(i, v);
    n++;
  });
  const tpl = (n === 1 ? textOne : textOther) ?? 'Filled {n} fields as {name}';
  flash(tpl.replace('{n}', String(n)).replace('{name}', p.fullName));
  return n;
}

function insertValue(value: string) {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) setNativeValue(el, value);
  else if (el.isContentEditable) document.execCommand('insertText', false, value);
}

function flash(text: string) {
  if (!isTop) return;
  const d = document.createElement('div');
  d.textContent = text;
  d.setAttribute('style', 'position:fixed;z-index:2147483647;bottom:16px;right:16px;background:#202124;color:#fff;font:13px system-ui;padding:8px 12px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);pointer-events:none');
  document.documentElement.appendChild(d);
  setTimeout(() => d.remove(), 2500);
}

// ---------- messages from background ----------
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  switch (msg.type) {
    case 'jar': toMain(msg); break;
    case 'session': session = msg.session; if (session) watchTitle(); applyTitle(); break;
    case 'recording':
      recording = msg.on;
      if (typeof msg.maskSecrets === 'boolean') maskSecrets = msg.maskSecrets;
      if (isTop && !msg.quiet) flash(msg.text ?? (msg.on ? '● Recording started' : '■ Recording stopped'));
      break;
    case 'fillForm': reply(fillForm(msg.domain, msg.textOne, msg.textOther)); return;
    case 'insert': insertValue(msg.value); break;
  }
  reply(undefined);
});

// ---------- boot ----------
/** Session documents carry our Server-Timing boot entry; ordinary pages never talk to the background. */
function isSessionDocument(): boolean {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return !!nav?.serverTiming?.some((e) => e.name === 'qsl');
  } catch {
    return false;
  }
}

void (async () => {
  if (!isSessionDocument()) return;
  const res = await send({ type: 'cs:hello' });
  if (!res?.ok || !res.result) return;
  const r = res.result;
  session = r.session;
  recording = r.recording;
  titlePrefix = r.titlePrefix;
  maskSecrets = r.maskSecrets;
  if (session) {
    toMain({ type: 'jar', sid: session.id, jar: r.jar });
    if (r.workers) toMain({ type: 'workers', sid: session.id, mode: r.workers });
    watchTitle();
    // A pre-existing service worker serving this session page bypasses isolation: let the background fix it.
    if (isTop && navigator.serviceWorker?.controller) void send({ type: 'cs:swControlled', origin: location.origin });
  }
})();
