import { DeviceKind, DeviceProfile, OperatingSystem } from '../types/p2p';

// Exclude easily confused characters (0, O, 1, I, L) for fast manual typing
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generateStarkId(): string {
  const randomValues = new Uint8Array(3);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomValues);
  } else {
    for (let i = 0; i < 3; i++) {
      randomValues[i] = Math.floor(Math.random() * 256);
    }
  }
  let suffix = '';
  for (let i = 0; i < 3; i++) {
    suffix += CODE_ALPHABET[randomValues[i] % CODE_ALPHABET.length];
  }
  return `STARK-${suffix}`;
}

export function normalizePeerId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Support pasting a full ?connect=STARK-XXX URL
  if (trimmed.includes('connect=')) {
    try {
      const url = new URL(trimmed.startsWith('http') ? trimmed : `https://local.app/${trimmed}`);
      const param = url.searchParams.get('connect');
      if (param) {
        return normalizePeerId(param);
      }
    } catch {
      const match = trimmed.match(/connect=([A-Za-z0-9_-]+)/i);
      if (match?.[1]) {
        return normalizePeerId(match[1]);
      }
    }
  }

  const upper = trimmed.toUpperCase().replace(/\s+/g, '');
  if (upper.startsWith('STARK-')) {
    return upper;
  }
  if (upper.startsWith('STARK') && upper.length > 5) {
    return `STARK-${upper.slice(5).replace(/^-+/, '')}`;
  }
  // If user typed just the short 3-4 char suffix (e.g. "94X"), prepend STARK-
  if (/^[A-Z0-9]{3,5}$/.test(upper)) {
    return `STARK-${upper}`;
  }
  return upper;
}

export function detectLocalDevice(): DeviceProfile {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const platform = typeof navigator !== 'undefined' ? navigator.platform || '' : '';

  let os: OperatingSystem = 'Unknown';
  let kind: DeviceKind = 'desktop';

  if (/iPhone|iPod/i.test(ua)) {
    os = 'iOS';
    kind = 'mobile';
  } else if (/iPad/i.test(ua) || (/Mac/i.test(platform) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)) {
    os = 'iOS';
    kind = 'tablet';
  } else if (/Android/i.test(ua)) {
    os = 'Android';
    kind = /Mobile/i.test(ua) ? 'mobile' : 'tablet';
  } else if (/CrOS/i.test(ua)) {
    os = 'ChromeOS';
    kind = 'desktop';
  } else if (/Win/i.test(ua) || /Win/i.test(platform)) {
    os = 'Windows';
    kind = 'desktop';
  } else if (/Mac/i.test(ua) || /Mac/i.test(platform)) {
    os = 'macOS';
    kind = 'desktop';
  } else if (/Linux/i.test(ua)) {
    os = 'Linux';
    kind = 'desktop';
  }

  const storedName =
    typeof localStorage !== 'undefined' ? localStorage.getItem('stark_device_name') : null;

  const defaultNameByOs: Record<OperatingSystem, string> = {
    iOS: kind === 'tablet' ? 'iPad' : 'iPhone',
    Android: kind === 'tablet' ? 'جهاز لوحي Android' : 'هاتف Android',
    macOS: 'جهاز Mac',
    Windows: 'كمبيوتر Windows',
    Linux: 'جهاز Linux',
    ChromeOS: 'جهاز Chromebook',
    Unknown: kind === 'mobile' ? 'هاتف ذكي' : 'متصفح الويب',
  };

  return {
    name: storedName?.trim() || defaultNameByOs[os],
    os,
    kind,
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value >= 100 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

export function formatSpeed(mbps: number): string {
  if (!Number.isFinite(mbps) || mbps <= 0.01) return '0.0 MB/s';
  if (mbps < 1) return `${(mbps * 1024).toFixed(0)} KB/s`;
  return `${mbps.toFixed(1)} MB/s`;
}

export function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function isValidHttpUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
