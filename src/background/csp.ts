import { workerModeFor, type WorkerMode } from '../shared/csp';
import { tabSessionSync } from './state';

/**
 * Decide, per session document, whether workers may be bootstrapped from a blob: URL (needed for
 * worker storage isolation) without violating the page's Content-Security-Policy.
 */
const modes = new Map<string, WorkerMode>();

chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (!tabSessionSync(d.tabId)) return;
    const policies = (d.responseHeaders ?? []).filter((h) => h.name.toLowerCase() === 'content-security-policy' && h.value).map((h) => h.value!);
    modes.set(`${d.tabId}|${d.frameId}`, workerModeFor(policies));
    if (modes.size > 2000) modes.clear();
  },
  { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame'] },
  ['responseHeaders', 'extraHeaders'],
);

export function workerModeOf(tabId: number, frameId: number): WorkerMode {
  return modes.get(`${tabId}|${frameId}`) ?? { classic: false, module: false };
}
