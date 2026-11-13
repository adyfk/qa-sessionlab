export type GroupColor =
  | 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';

export const GROUP_COLORS: GroupColor[] = ['blue', 'red', 'green', 'orange', 'purple', 'pink', 'cyan', 'yellow', 'grey'];

/** Hex used for badges / UI chips, matching Chrome tab-group colours. */
export const COLOR_HEX: Record<GroupColor, string> = {
  grey: '#5f6368', blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00', green: '#188038',
  pink: '#d01884', purple: '#a142f4', cyan: '#007b83', orange: '#fa903e',
};

export interface StoredCookie {
  name: string;
  value: string;
  /** Lower-case domain without leading dot. */
  domain: string;
  /** true = exact host only (no Domain attribute in Set-Cookie). */
  hostOnly: boolean;
  path: string;
  /** Unix seconds, or -1 for a session cookie. */
  expires: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export interface EnvPreset {
  /** Key from DEVICE_PRESETS, or 'none'. */
  device: string;
  locale: string;          // '' = browser default
  timezone: string;        // '' = browser default
  network: string;         // key from NETWORK_PRESETS
  colorScheme: '' | 'light' | 'dark';
  reducedMotion: boolean;
  geo: { latitude: number; longitude: number; accuracy: number } | null;
}

export const EMPTY_PRESET: EnvPreset = {
  device: 'none', locale: '', timezone: '', network: 'none', colorScheme: '', reducedMotion: false, geo: null,
};

/** Emulation done in-page by the MAIN-world shim (CDP refuses these for extension clients). */
export interface PageEnv {
  timezone: string;
  locale: string;
  geo: EnvPreset['geo'];
}

export function pageEnvOf(p: EnvPreset | null | undefined): PageEnv | null {
  if (!p || (!p.timezone && !p.locale && !p.geo)) return null;
  return { timezone: p.timezone, locale: p.locale, geo: p.geo };
}

/** Emulation that needs chrome.debugger (device metrics, UA, throttling, media features). */
export function needsDebugger(p: EnvPreset | null | undefined): boolean {
  return !!p && (p.device !== 'none' || p.network !== 'none' || !!p.colorScheme || p.reducedMotion);
}

/** Delivered to every document of a session tab via the Server-Timing header. */
export interface BootPayload {
  sid: string;
  /** Non-HttpOnly cookies for this host (the shim filters path/secure). */
  jar: StoredCookie[];
  env: PageEnv | null;
  restore: { id: string; byOrigin: Record<string, Record<string, string>> } | null;
}

export function presetIsActive(p: EnvPreset | null | undefined): boolean {
  if (!p) return false;
  return p.device !== 'none' || !!p.locale || !!p.timezone || p.network !== 'none' || !!p.colorScheme || p.reducedMotion || !!p.geo;
}

export interface Session {
  id: string;
  name: string;
  color: GroupColor;
  /** Free-form folder, e.g. "Staging" or "Checkout flow". */
  group: string;
  /** Temporary sessions are wiped when their last tab closes. */
  temporary: boolean;
  preset: EnvPreset;
  notes: string;
  /** Optional default URL used by matrix / "open" buttons. */
  startUrl: string;
  createdAt: number;
}

export interface Snapshot {
  id: string;
  sessionId: string;
  label: string;
  createdAt: number;
  cookies: StoredCookie[];
  /** origin -> key/value pairs (session-scoped localStorage). */
  localStorage: Record<string, Record<string, string>>;
  /** origin -> session IndexedDB databases (see background/idb.ts). Absent in snapshots from older versions. */
  indexedDB?: Record<string, import('../background/idb').IdbDump[]>;
}

export interface RecordedStep {
  t: number;
  kind: 'navigate' | 'click' | 'input' | 'submit' | 'key' | 'note' | 'screenshot';
  text: string;
  url?: string;
  selector?: string;
}

export interface ConsoleEntry { t: number; level: string; text: string; url?: string; line?: number }
export interface NetworkEntry { t: number; method: string; url: string; status: number; statusText: string; error?: string; type?: string }

export interface Recording {
  id: string;
  tabId: number;
  sessionId: string | null;
  startedAt: number;
  stoppedAt: number | null;
  title: string;
  steps: RecordedStep[];
  console: ConsoleEntry[];
  network: NetworkEntry[];
  screenshots: { t: number; dataUrl: string; url: string }[];
  env: { userAgent?: string; viewport?: string; url?: string; preset?: EnvPreset | null; sessionName?: string };
}

export interface Settings {
  /** Prefix page titles with [SESSION]. */
  titlePrefix: boolean;
  /** Put session tabs in coloured Chrome tab groups. */
  useTabGroups: boolean;
  /** Tabs opened from a session tab inherit its session. */
  inheritOnOpen: boolean;
  /** Mask password-like fields in recorded steps. */
  maskSecrets: boolean;
  /** Email domain used by test data generator. */
  testEmailDomain: string;
  /** Let a local AI agent control the extension through the MCP bridge (off by default). */
  agentEnabled: boolean;
  agentPort: number;
  /** Shared secret the MCP server must present; generated on first enable. */
  agentToken: string;
  /** UI language: 'auto' (browser) or a code from shared/i18n LANGUAGES. */
  language: string;
}

export const DEFAULT_SETTINGS: Settings = {
  titlePrefix: true,
  useTabGroups: true,
  inheritOnOpen: true,
  maskSecrets: true,
  testEmailDomain: 'example.test',
  agentEnabled: true,
  agentPort: 17321,
  agentToken: '',
  language: 'auto',
};
