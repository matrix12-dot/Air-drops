import LZString from 'lz-string';

export type SignalKind = 'offer' | 'answer';

const OFFER_PREFIX = 'SO1:';
const ANSWER_PREFIX = 'SA1:';

const ESSENTIAL_PREFIXES = [
  'v=',
  'o=',
  's=',
  't=',
  'm=',
  'c=',
  'a=group:',
  'a=extmap-allow-mixed',
  'a=msid-semantic:',
  'a=ice-ufrag:',
  'a=ice-pwd:',
  'a=ice-options:',
  'a=fingerprint:',
  'a=setup:',
  'a=mid:',
  'a=sctp-port:',
  'a=max-message-size:',
];

function minifySdp(rawSdp: string): string {
  const lines = rawSdp.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  const ipv4Candidates: string[] = [];
  const otherCandidates: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('a=candidate:')) {
      // Only keep host candidates since iceServers is [] (100% offline LAN)
      if (!trimmed.includes(' typ host')) continue;
      // Check if IPv4 LAN address vs mDNS/IPv6
      const parts = trimmed.split(' ');
      const ip = parts[4] || '';
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
        if (!ip.startsWith('127.')) {
          ipv4Candidates.push(trimmed);
        }
      } else if (ip.endsWith('.local')) {
        otherCandidates.push(trimmed);
      } else if (!ip.startsWith('fe80:')) {
        otherCandidates.push(trimmed);
      }
      continue;
    }

    if (ESSENTIAL_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
      kept.push(trimmed);
    }
  }

  // Prioritize IPv4 LAN candidates first, then mDNS/IPv6 up to 5 total
  const selectedCandidates = [...ipv4Candidates, ...otherCandidates].slice(0, 5);
  return [...kept, ...selectedCandidates].join('\n');
}

export function encodeSignalToken(kind: SignalKind, rawSdp: string): string {
  const compactSdp = minifySdp(rawSdp);
  const compressed = LZString.compressToBase64(compactSdp);
  return `${kind === 'offer' ? OFFER_PREFIX : ANSWER_PREFIX}${compressed}`;
}

export interface DecodedSignalToken {
  kind: SignalKind;
  sdp: string;
}

export function decodeSignalToken(rawInput: string): DecodedSignalToken | null {
  const cleaned = rawInput.replace(/[\s\u200B-\u200F\uFEFF]/g, '');
  if (!cleaned) return null;

  let kind: SignalKind | null = null;
  let payload = '';

  if (cleaned.startsWith(OFFER_PREFIX)) {
    kind = 'offer';
    payload = cleaned.slice(OFFER_PREFIX.length);
  } else if (cleaned.startsWith(ANSWER_PREFIX)) {
    kind = 'answer';
    payload = cleaned.slice(ANSWER_PREFIX.length);
  } else {
    return null;
  }

  try {
    const decompressed = LZString.decompressFromBase64(payload);
    if (!decompressed || !decompressed.includes('v=0') || !decompressed.includes('m=application')) {
      return null;
    }
    const normalizedSdp = decompressed.replace(/\n/g, '\r\n') + '\r\n';
    return { kind, sdp: normalizedSdp };
  } catch {
    return null;
  }
}

export async function gatherLocalSdp(pc: RTCPeerConnection): Promise<string> {
  const currentSdp = pc.localDescription?.sdp || '';
  if (pc.iceGatheringState === 'complete' && currentSdp.includes('a=candidate:')) {
    return currentSdp;
  }

  return await new Promise<string>((resolve) => {
    let settled = false;
    let candidateSettleTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      pc.removeEventListener('icecandidate', onCandidate);
      pc.removeEventListener('icegatheringstatechange', onGatheringChange);
      clearTimeout(maxTimer);
      if (candidateSettleTimer) clearTimeout(candidateSettleTimer);
      resolve(pc.localDescription?.sdp || currentSdp);
    };

    const onCandidate = (event: RTCPeerConnectionIceEvent) => {
      if (!event.candidate) {
        finish();
        return;
      }
      // Once we have a local host candidate, wait just 40ms for sibling adapters then lock in
      if (!candidateSettleTimer) {
        candidateSettleTimer = setTimeout(finish, 40);
      }
    };

    const onGatheringChange = () => {
      if (pc.iceGatheringState === 'complete') {
        finish();
      }
    };

    pc.addEventListener('icecandidate', onCandidate);
    pc.addEventListener('icegatheringstatechange', onGatheringChange);

    // Hard cap at 280ms so QR renders instantaneously with zero perceived lag
    const maxTimer = setTimeout(finish, 280);
  });
}
