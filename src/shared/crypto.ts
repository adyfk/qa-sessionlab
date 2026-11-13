/**
 * Passphrase encryption for shared session files: PBKDF2-SHA256 (310k iterations) -> AES-256-GCM.
 * Pure WebCrypto, works in the service worker, pages and Node (tests).
 */
const b64 = (u: Uint8Array) => { let s = ''; for (const b of u) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ITER = 310_000;

async function key(passphrase: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export interface Sealed { format: 'qa-sessionlab-share'; v: 1; kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }; iv: string; data: string }

export async function seal(payload: unknown, passphrase: string): Promise<Sealed> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await key(passphrase, salt, ITER);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(payload))));
  return { format: 'qa-sessionlab-share', v: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITER, salt: b64(salt) }, iv: b64(iv), data: b64(ct) };
}

export async function open<T = unknown>(sealed: Sealed, passphrase: string): Promise<T> {
  if (sealed?.format !== 'qa-sessionlab-share') throw new Error('Not a QA SessionLab share file');
  const k = await key(passphrase, unb64(sealed.kdf.salt), sealed.kdf.iterations);
  let pt: ArrayBuffer;
  try {
    pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) as BufferSource }, k, unb64(sealed.data) as BufferSource);
  } catch {
    throw new Error('WRONG_PASSPHRASE');
  }
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

export const isSealed = (x: any): x is Sealed => x?.format === 'qa-sessionlab-share';
