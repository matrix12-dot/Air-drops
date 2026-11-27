import { DeviceKind, DeviceProfile, OperatingSystem } from '../types/p2p';

export function generatePinCode(): string {
  const arr = new Uint32Array(1);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    arr[0] = Math.floor(Math.random() * 9000);
  }
  const num = 1000 + (arr[0] % 9000);
  return String(num);
}

// Convert Arabic-Indic / Eastern Arabic numerals to ASCII digits and strip non-digits
export function normalizePinCode(raw: string): string {
  const ascii = raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  return ascii.replace(/\D/g, '').slice(0, 4);
}

function fallbackHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
  );
}

export async function deriveRoomTopic(pin: string): Promise<string> {
  const cleanPin = normalizePinCode(pin);
  const salted = `stark-lan-drop-room-v1:${cleanPin}`;

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const encoded = new TextEncoder().encode(salted);
      const digest = await crypto.subtle.digest('SHA-256', encoded);
      const bytes = Array.from(new Uint8Array(digest));
      const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
      return `stark-lan-drop/room-${hex.slice(0, 20)}`;
    } catch {
      // Fallback below
    }
  }

  return `stark-lan-drop/room-${fallbackHash(salted)}`;
}

export function detectLocalDevice(): DeviceProfile {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const platform = typeof navigator !== 'undefined' ? navigator.platform || '' : '';

  let os: OperatingSystem = 'Unknown';
  let kind: DeviceKind = 'desktop';

  if (/iPhone|iPod/i.test(ua)) {
    os = 'iOS';
    kind = 'mobile';
  } else if (
    /iPad/i.test(ua) ||
    (/Mac/i.test(platform) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)
  ) {
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
