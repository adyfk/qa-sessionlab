import { describe, expect, it } from 'vitest';
import { open, seal } from '../src/shared/crypto';

describe('share encryption', () => {
  it('round-trips with the right passphrase', async () => {
    const s = await seal({ a: 1, cookies: [{ name: 'sid', value: 'x' }] }, 'correct horse battery');
    expect(s.data).not.toContain('sid');
    expect(await open(s, 'correct horse battery')).toEqual({ a: 1, cookies: [{ name: 'sid', value: 'x' }] });
  });
  it('rejects a wrong passphrase', async () => {
    const s = await seal({ a: 1 }, 'correct horse battery');
    await expect(open(s, 'wrong passphrase!')).rejects.toThrow('WRONG_PASSPHRASE');
  });
  it('detects tampering', async () => {
    const s = await seal({ a: 1 }, 'correct horse battery');
    const bytes = Uint8Array.from(atob(s.data), (c) => c.charCodeAt(0));
    bytes[0] ^= 1;
    await expect(open({ ...s, data: btoa(String.fromCharCode(...bytes)) }, 'correct horse battery')).rejects.toThrow('WRONG_PASSPHRASE');
  });
});
