export interface WorkerMode { classic: boolean; module: boolean }

/** Pure, exported for tests. `policies` = every enforced CSP header value of the document. */
export function workerModeFor(policies: string[]): WorkerMode {
  const allows = (chain: string[]) =>
    policies.every((p) => {
      const dirs = new Map<string, string[]>();
      for (const part of p.split(';')) {
        const [name, ...vals] = part.trim().split(/\s+/);
        if (name && !dirs.has(name.toLowerCase())) dirs.set(name.toLowerCase(), vals.map((v) => v.toLowerCase()));
      }
      const d = chain.find((c) => dirs.has(c));
      if (!d) return true;
      return dirs.get(d)!.includes('blob:');
    });
  const classic = allows(['worker-src', 'child-src', 'script-src', 'default-src']);
  return { classic, module: classic && allows(['script-src', 'default-src']) };
}

