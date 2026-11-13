export interface DevicePreset {
  label: string;
  width: number;
  height: number;
  dpr: number;
  mobile: boolean;
  userAgent: string;
  platform: string;
}

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA = (model: string) =>
  `Mozilla/5.0 (Linux; Android 14; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36`;

export const DEVICE_PRESETS: Record<string, DevicePreset> = {
  iphone15: { label: 'iPhone 15', width: 393, height: 852, dpr: 3, mobile: true, userAgent: IOS_UA, platform: 'iPhone' },
  iphoneSE: { label: 'iPhone SE', width: 375, height: 667, dpr: 2, mobile: true, userAgent: IOS_UA, platform: 'iPhone' },
  pixel8: { label: 'Pixel 8', width: 412, height: 915, dpr: 2.625, mobile: true, userAgent: ANDROID_UA('Pixel 8'), platform: 'Linux armv81' },
  galaxyS23: { label: 'Galaxy S23', width: 360, height: 780, dpr: 3, mobile: true, userAgent: ANDROID_UA('SM-S911B'), platform: 'Linux armv81' },
  galaxyA14: { label: 'Galaxy A14 (low-end)', width: 384, height: 854, dpr: 2, mobile: true, userAgent: ANDROID_UA('SM-A145F'), platform: 'Linux armv81' },
  ipadAir: { label: 'iPad Air', width: 820, height: 1180, dpr: 2, mobile: true, userAgent: IPAD_UA, platform: 'iPad' },
  laptop: { label: 'Laptop 1366×768', width: 1366, height: 768, dpr: 1, mobile: false, userAgent: '', platform: '' },
  desktop: { label: 'Desktop 1920×1080', width: 1920, height: 1080, dpr: 1, mobile: false, userAgent: '', platform: '' },
};

export interface NetworkPreset { label: string; offline: boolean; latency: number; down: number; up: number }

/** Throughput in bytes/sec (CDP units). Values follow Chrome DevTools presets. */
export const NETWORK_PRESETS: Record<string, NetworkPreset> = {
  offline: { label: 'Offline', offline: true, latency: 0, down: 0, up: 0 },
  slow3g: { label: 'Slow 3G', offline: false, latency: 2000, down: (500 * 1024) / 8 * 0.8, up: (500 * 1024) / 8 * 0.8 },
  fast3g: { label: 'Fast 3G / Slow 4G', offline: false, latency: 562.5, down: (1.6 * 1024 * 1024) / 8 * 0.9, up: (750 * 1024) / 8 * 0.9 },
  fast4g: { label: 'Fast 4G', offline: false, latency: 165, down: (9 * 1024 * 1024) / 8 * 0.9, up: (1.5 * 1024 * 1024) / 8 * 0.9 },
  highLatency: { label: 'High latency (1s RTT)', offline: false, latency: 1000, down: -1, up: -1 },
};

export const LOCALES = ['en-US', 'en-GB', 'id-ID', 'ms-MY', 'ja-JP', 'ko-KR', 'zh-CN', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ar-SA', 'he-IL', 'hi-IN', 'th-TH', 'vi-VN', 'tr-TR', 'ru-RU'];

export const TIMEZONES = ['UTC', 'Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'America/Sao_Paulo', 'Australia/Sydney', 'Pacific/Auckland', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];

export const GEO_PRESETS: Record<string, { label: string; latitude: number; longitude: number }> = {
  jakarta: { label: 'Jakarta', latitude: -6.2088, longitude: 106.8456 },
  surabaya: { label: 'Surabaya', latitude: -7.2575, longitude: 112.7521 },
  bali: { label: 'Denpasar', latitude: -8.6705, longitude: 115.2126 },
  singapore: { label: 'Singapore', latitude: 1.3521, longitude: 103.8198 },
  tokyo: { label: 'Tokyo', latitude: 35.6762, longitude: 139.6503 },
  london: { label: 'London', latitude: 51.5072, longitude: -0.1276 },
  newyork: { label: 'New York', latitude: 40.7128, longitude: -74.006 },
  sydney: { label: 'Sydney', latitude: -33.8688, longitude: 151.2093 },
};

/** Common QA role names offered as one-click session templates. */
export const ROLE_TEMPLATES = ['Super Admin', 'Admin', 'Manager', 'Staff', 'Customer', 'Guest', 'Seller', 'Buyer', 'Reviewer', 'Read-only'];
