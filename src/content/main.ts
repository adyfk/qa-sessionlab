import { qslShim } from '../background/shim';
import type { BootPayload } from '../shared/types';

/**
 * Static MAIN-world content script, document_start, all frames.
 * Reads the per-tab boot payload that our DNR rules append to the document response as
 *   Server-Timing: qsl;dur=<priority>;desc="<base64url JSON>"
 * Synchronous, so the shim is in place before the page's first script executes.
 */
function fromServerTiming(): BootPayload | null {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const entries = (nav?.serverTiming ?? []).filter((e) => e.name === 'qsl' && e.description);
    if (!entries.length) return null;
    const best = entries.reduce((a, b) => (b.duration > a.duration ? b : a));
    const b64 = best.description.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** about:blank / srcdoc / javascript: frames have no response: inherit from a same-origin parent or opener. */
function fromRelative(): BootPayload | null {
  for (const get of [() => window.parent, () => window.opener]) {
    try {
      const other = get();
      if (other && other !== window && (other as any).__qslState) return (other as any).__qslState;
    } catch { /* cross-origin */ }
  }
  return null;
}

/** Origins where sessions are used get `Server-Timing: qslnosw` in every tab: no new service workers there. */
function swBlockedHere(): boolean {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return !!nav?.serverTiming?.some((e) => e.name === 'qslnosw');
  } catch {
    return false;
  }
}
if (swBlockedHere()) {
  try {
    const SWC = (window as any).ServiceWorkerContainer?.prototype;
    if (SWC) SWC.register = () => Promise.reject(new DOMException('Service workers are disabled on this site by QA SessionLab (Settings → Service workers)', 'SecurityError'));
  } catch { /* ignore */ }
}

const boot = fromServerTiming() ?? (location.protocol === 'about:' || location.href === 'about:srcdoc' ? fromRelative() : null);
if (boot) qslShim(boot);
