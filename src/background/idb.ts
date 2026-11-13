/* eslint-disable */
/**
 * IndexedDB snapshot / restore for a session (databases named "__qsl:<sid>:<name>").
 * Both functions run inside the page via chrome.scripting.executeScript, so they must be
 * self-contained. Values are encoded to JSON with tags for Date, ArrayBuffer/typed arrays, Map, Set;
 * Blobs/Files are dropped (stored as null) to keep snapshots small and serializable.
 */
export interface IdbDump {
  name: string;
  version: number;
  stores: { name: string; keyPath: string | string[] | null; autoIncrement: boolean; indexes: { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }[]; keys: unknown[]; values: unknown[] }[];
}

export async function dumpIdbInPage(prefix: string, maxBytes: number): Promise<{ origin: string; dbs: IdbDump[]; truncated: boolean }> {
  const enc = (v: any): any => {
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof Date) return { __qsl: 'Date', v: v.getTime() };
    if (v instanceof ArrayBuffer) return { __qsl: 'AB', v: Array.from(new Uint8Array(v)) };
    if (ArrayBuffer.isView(v)) return { __qsl: 'TA', t: v.constructor.name, v: Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    if (v instanceof Map) return { __qsl: 'Map', v: [...v].map(([k, x]) => [enc(k), enc(x)]) };
    if (v instanceof Set) return { __qsl: 'Set', v: [...v].map(enc) };
    if (typeof Blob !== 'undefined' && v instanceof Blob) return null;
    if (Array.isArray(v)) return v.map(enc);
    const o: any = {};
    for (const k of Object.keys(v)) o[k] = enc(v[k]);
    return o;
  };
  const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const out: IdbDump[] = [];
  let bytes = 0;
  let truncated = false;
  const list = (await (indexedDB as any).databases?.()) ?? [];
  for (const info of list) {
    if (!info.name?.startsWith(prefix)) continue;
    const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open(info.name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked')); });
    const dump: IdbDump = { name: info.name.slice(prefix.length), version: db.version, stores: [] };
    for (const sn of Array.from(db.objectStoreNames)) {
      const st = db.transaction(sn, 'readonly').objectStore(sn);
      const indexes = Array.from(st.indexNames).map((n) => { const i = st.index(n); return { name: n, keyPath: i.keyPath, unique: i.unique, multiEntry: i.multiEntry }; });
      const keys = (await req(st.getAllKeys())).map(enc);
      const values = (await req(db.transaction(sn, 'readonly').objectStore(sn).getAll())).map(enc);
      bytes += JSON.stringify(values).length;
      if (bytes > maxBytes) { truncated = true; dump.stores.push({ name: sn, keyPath: st.keyPath as any, autoIncrement: st.autoIncrement, indexes, keys: [], values: [] }); continue; }
      dump.stores.push({ name: sn, keyPath: st.keyPath as any, autoIncrement: st.autoIncrement, indexes, keys, values });
    }
    db.close();
    out.push(dump);
  }
  return { origin: location.origin, dbs: out, truncated };
}

export async function restoreIdbInPage(prefix: string, dbs: IdbDump[]): Promise<number> {
  const dec = (v: any): any => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(dec);
    switch (v.__qsl) {
      case 'Date': return new Date(v.v);
      case 'AB': return new Uint8Array(v.v).buffer;
      case 'TA': { const C = (self as any)[v.t] ?? Uint8Array; const b = new Uint8Array(v.v).buffer; return new C(b, 0, b.byteLength / (C.BYTES_PER_ELEMENT ?? 1)); }
      case 'Map': return new Map(v.v.map(([k, x]: any) => [dec(k), dec(x)]));
      case 'Set': return new Set(v.v.map(dec));
    }
    const o: any = {};
    for (const k of Object.keys(v)) o[k] = dec(v[k]);
    return o;
  };
  const del = (name: string) => new Promise<void>((res) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  // remove every session DB first, so the restored state is exact
  for (const info of ((await (indexedDB as any).databases?.()) ?? [])) if (info.name?.startsWith(prefix)) await del(info.name);
  let n = 0;
  for (const d of dbs) {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open(prefix + d.name, Math.max(1, d.version));
      r.onupgradeneeded = () => {
        for (const s of d.stores) {
          const st = r.result.createObjectStore(s.name, { keyPath: s.keyPath ?? undefined, autoIncrement: s.autoIncrement });
          for (const i of s.indexes) st.createIndex(i.name, i.keyPath, { unique: i.unique, multiEntry: i.multiEntry });
        }
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    for (const s of d.stores) {
      if (!s.values.length) continue;
      await new Promise<void>((res, rej) => {
        const tx = db.transaction(s.name, 'readwrite');
        const st = tx.objectStore(s.name);
        s.values.forEach((v, i) => (s.keyPath ? st.put(dec(v)) : st.put(dec(v), dec(s.keys[i]))));
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      n += s.values.length;
    }
    db.close();
  }
  return n;
}
