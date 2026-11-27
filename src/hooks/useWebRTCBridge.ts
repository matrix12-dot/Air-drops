import { useCallback, useEffect, useRef, useState } from 'react';
import mqtt, { MqttClient } from 'mqtt';
import {
  ConnectionState,
  ControlWireMessage,
  DeviceProfile,
  FileTransferItem,
  IceDiagnostics,
  MqttSignalPayload,
  TextDropItem,
} from '../types/p2p';
import {
  deriveRoomTopic,
  detectLocalDevice,
  generatePinCode,
  normalizePinCode,
} from '../utils/device';
import { playArrivalChime, playConnectChime, primeAudioContext } from '../utils/sound';

const MQTT_BROKER_URL = 'wss://broker.emqx.io:8084/mqtt';
const HANDSHAKE_WINDOW_MS = 5000; // Strictly 5s signaling window
const CHUNK_SIZE = 262144; // 256KB binary chunks
const MAX_BUFFERED_AMOUNT = 8 * 1024 * 1024; // 8MB high-water mark
const BUFFER_LOW_THRESHOLD = 1048576; // 1MB low-water mark (native bufferedamountlow)

interface IncomingTransferBuffer {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  chunks: BlobPart[];
  bytesReceived: number;
  startedAt: number;
  lastUiUpdate: number;
  lastBytes: number;
  smoothedSpeedMBps: number;
}

interface OutgoingQueuedFile {
  transferId: string;
  file: File;
}

function makeClientId(): string {
  return `stark-${Math.random().toString(36).slice(2, 10)}`;
}

function decodeMqttPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (payload instanceof Uint8Array || ArrayBuffer.isView(payload)) {
    const view = payload instanceof Uint8Array
      ? payload
      : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    return new TextDecoder().decode(view);
  }
  if (payload instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(payload));
  }
  return String(payload ?? '');
}

function triggerBrowserDownload(blobUrl: string, fileName: string): void {
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    document.body.removeChild(anchor);
  }, 250);
}

async function toUint8Array(payload: unknown): Promise<Uint8Array> {
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }
  if (payload instanceof Uint8Array) {
    return payload;
  }
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  }
  if (typeof Blob !== 'undefined' && payload instanceof Blob) {
    const buf = await payload.arrayBuffer();
    return new Uint8Array(buf);
  }
  return new Uint8Array(0);
}

function waitForBufferDrain(dc: RTCDataChannel): Promise<void> {
  if (dc.bufferedAmount < MAX_BUFFERED_AMOUNT || dc.readyState !== 'open') {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const cleanup = () => {
      dc.removeEventListener('bufferedamountlow', onDrain);
      dc.removeEventListener('close', onDrain);
      dc.removeEventListener('error', onDrain);
    };

    const onDrain = () => {
      cleanup();
      resolve();
    };

    dc.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;
    dc.addEventListener('bufferedamountlow', onDrain, { once: true });
    dc.addEventListener('close', onDrain, { once: true });
    dc.addEventListener('error', onDrain, { once: true });

    // Re-check synchronously in case bufferedAmount dropped below threshold before listener attached
    if (dc.bufferedAmount <= BUFFER_LOW_THRESHOLD || dc.readyState !== 'open') {
      cleanup();
      resolve();
    }
  });
}

async function inspectActiveIcePair(pc: RTCPeerConnection): Promise<IceDiagnostics> {
  try {
    const stats = await pc.getStats();
    let selectedPairId: string | undefined;
    let fallbackPair: Record<string, unknown> | null = null;

    stats.forEach((report) => {
      const r = report as unknown as Record<string, unknown>;
      if (r.type === 'transport' && typeof r.selectedCandidatePairId === 'string') {
        selectedPairId = r.selectedCandidatePairId;
      }
      if (
        r.type === 'candidate-pair' &&
        (r.nominated === true || r.state === 'succeeded')
      ) {
        fallbackPair = r;
      }
    });

    const pair =
      (selectedPairId
        ? (stats.get(selectedPairId) as unknown as Record<string, unknown> | undefined)
        : undefined) || fallbackPair;

    if (!pair) {
      return { mode: 'unknown', label: 'P2P Active' };
    }

    const localCandidate =
      typeof pair.localCandidateId === 'string'
        ? (stats.get(pair.localCandidateId) as unknown as Record<string, unknown> | undefined)
        : undefined;
    const remoteCandidate =
      typeof pair.remoteCandidateId === 'string'
        ? (stats.get(pair.remoteCandidateId) as unknown as Record<string, unknown> | undefined)
        : undefined;

    const localType = String(localCandidate?.candidateType || '');
    const remoteType = String(remoteCandidate?.candidateType || '');
    const protocol = String(
      remoteCandidate?.protocol || localCandidate?.protocol || 'udp'
    ).toUpperCase();
    const remoteAddress = String(remoteCandidate?.address || remoteCandidate?.ip || '');
    const localAddress = String(localCandidate?.address || localCandidate?.ip || '');

    if (localType === 'relay' || remoteType === 'relay') {
      return {
        mode: 'relayed',
        label: remoteAddress ? `Relayed (${remoteAddress})` : 'Relayed',
        protocol,
        localAddress,
        remoteAddress,
      };
    }

    const displayAddress = remoteAddress || localAddress;
    const formattedAddress = displayAddress
      ? displayAddress.endsWith('.local')
        ? 'mDNS .local'
        : displayAddress
      : 'Local LAN';

    return {
      mode: 'lan-direct',
      label: `LAN Direct (${formattedAddress})`,
      protocol,
      localAddress,
      remoteAddress,
    };
  } catch {
    return { mode: 'unknown', label: 'LAN Direct' };
  }
}

export function useWebRTCBridge(soundEnabled: boolean) {
  const [pinCode, setPinCode] = useState<string>(() => generatePinCode());
  const [localDevice, setLocalDevice] = useState<DeviceProfile>(() => detectLocalDevice());
  const [connectionState, setConnectionState] = useState<ConnectionState>('initializing');
  const [mqttActive, setMqttActive] = useState<boolean>(false);
  const [remoteDevice, setRemoteDevice] = useState<DeviceProfile | null>(null);
  const [iceDiagnostics, setIceDiagnostics] = useState<IceDiagnostics | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<FileTransferItem[]>([]);
  const [textDrops, setTextDrops] = useState<TextDropItem[]>([]);

  const hostMqttRef = useRef<MqttClient | null>(null);
  const guestMqttRef = useRef<MqttClient | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);

  const clientIdRef = useRef<string>(makeClientId());
  const soundEnabledRef = useRef<boolean>(soundEnabled);
  const localDeviceRef = useRef<DeviceProfile>(localDevice);
  const pinCodeRef = useRef<string>(pinCode);
  const [hostGeneration, setHostGeneration] = useState<number>(0);

  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const handshakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answerReceivedRef = useRef<boolean>(false);

  const activeIncomingRef = useRef<IncomingTransferBuffer | null>(null);
  const outgoingQueueRef = useRef<OutgoingQueuedFile[]>([]);
  const isSendingRef = useRef<boolean>(false);
  const blobUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    localDeviceRef.current = localDevice;
  }, [localDevice]);

  useEffect(() => {
    pinCodeRef.current = pinCode;
  }, [pinCode]);

  const clearHandshakeTimer = useCallback(() => {
    if (handshakeTimerRef.current) {
      clearTimeout(handshakeTimerRef.current);
      handshakeTimerRef.current = null;
    }
  }, []);

  const closeMqttClient = useCallback((client: MqttClient | null) => {
    if (!client) return;
    try {
      client.removeAllListeners();
      client.end(true);
    } catch {
      // Ignore MQTT close errors
    }
  }, []);

  const disconnectAllMqtt = useCallback(() => {
    clearHandshakeTimer();
    if (hostMqttRef.current) {
      closeMqttClient(hostMqttRef.current);
      hostMqttRef.current = null;
    }
    if (guestMqttRef.current) {
      closeMqttClient(guestMqttRef.current);
      guestMqttRef.current = null;
    }
    setMqttActive(false);
  }, [clearHandshakeTimer, closeMqttClient]);

  const teardownWebRTC = useCallback(() => {
    pendingIceRef.current = [];
    answerReceivedRef.current = false;
    setIceDiagnostics(null);
    if (dcRef.current) {
      try {
        dcRef.current.close();
      } catch {
        // Ignore
      }
      dcRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        // Ignore
      }
      pcRef.current = null;
    }
    activeIncomingRef.current = null;
  }, []);

  const updateTransferItem = useCallback(
    (id: string, updater: (prev: FileTransferItem) => FileTransferItem) => {
      setTransfers((prev) => prev.map((item) => (item.id === id ? updater(item) : item)));
    },
    []
  );

  const flushOutgoingQueue = useCallback(async () => {
    if (isSendingRef.current) return;
    const dc = dcRef.current;
    if (!dc || dc.readyState !== 'open') return;

    isSendingRef.current = true;

    try {
      while (outgoingQueueRef.current.length > 0) {
        const activeDc = dcRef.current;
        if (!activeDc || activeDc.readyState !== 'open') {
          break;
        }

        const nextItem = outgoingQueueRef.current.shift();
        if (!nextItem) continue;

        const { transferId, file } = nextItem;
        const maxSctpMessage = pcRef.current?.sctp?.maxMessageSize;
        const effectiveChunkSize =
          maxSctpMessage && maxSctpMessage >= 16384
            ? Math.min(CHUNK_SIZE, maxSctpMessage)
            : CHUNK_SIZE;

        const totalChunks = Math.max(1, Math.ceil(file.size / effectiveChunkSize));
        const startedAt = performance.now();
        let lastUiUpdate = startedAt;
        let lastBytes = 0;
        let smoothedSpeed = 0;

        updateTransferItem(transferId, (prev) => ({
          ...prev,
          status: 'transferring',
          progress: file.size === 0 ? 100 : 0,
        }));

        try {
          activeDc.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;

          activeDc.send(
            JSON.stringify({
              type: 'file-start',
              transferId,
              name: file.name,
              size: file.size,
              mimeType: file.type || 'application/octet-stream',
              totalChunks,
            } satisfies ControlWireMessage)
          );

          let offset = 0;
          let nextSlicePromise: Promise<ArrayBuffer> | null =
            file.size > 0
              ? file.slice(0, Math.min(effectiveChunkSize, file.size)).arrayBuffer()
              : null;

          while (nextSlicePromise) {
            const buffer = await nextSlicePromise;

            if (activeDc.readyState !== 'open') {
              throw new Error('انقطع الاتصال أثناء الإرسال');
            }

            const nextOffset = offset + buffer.byteLength;
            nextSlicePromise =
              nextOffset < file.size
                ? file
                    .slice(nextOffset, Math.min(nextOffset + effectiveChunkSize, file.size))
                    .arrayBuffer()
                : null;

            if (activeDc.bufferedAmount >= MAX_BUFFERED_AMOUNT) {
              await waitForBufferDrain(activeDc);
              if (activeDc.readyState !== 'open') {
                throw new Error('انقطع الاتصال أثناء الإرسال');
              }
            }

            activeDc.send(buffer);
            offset = nextOffset;

            const now = performance.now();
            if (now - lastUiUpdate >= 100 || offset >= file.size) {
              const dtSeconds = Math.max(0.001, (now - lastUiUpdate) / 1000);
              const instantMBps = (offset - lastBytes) / (1024 * 1024) / dtSeconds;
              smoothedSpeed =
                smoothedSpeed === 0 ? instantMBps : smoothedSpeed * 0.65 + instantMBps * 0.35;
              const progress =
                file.size > 0 ? Math.min(99, Math.round((offset / file.size) * 100)) : 100;

              lastUiUpdate = now;
              lastBytes = offset;

              updateTransferItem(transferId, (prev) => ({
                ...prev,
                bytesTransferred: offset,
                progress,
                speedMBps: smoothedSpeed,
              }));
            }
          }

          activeDc.send(
            JSON.stringify({
              type: 'file-end',
              transferId,
            } satisfies ControlWireMessage)
          );

          const totalSeconds = Math.max(0.01, (performance.now() - startedAt) / 1000);
          const avgMBps = file.size / (1024 * 1024) / totalSeconds;

          updateTransferItem(transferId, (prev) => ({
            ...prev,
            status: 'completed',
            progress: 100,
            bytesTransferred: file.size,
            speedMBps: avgMBps,
          }));
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'تعذر إرسال الملف عبر الشبكة المحلية';
          updateTransferItem(transferId, (prev) => ({
            ...prev,
            status: 'error',
            errorMessage: message,
          }));
        }
      }
    } finally {
      isSendingRef.current = false;
    }
  }, [updateTransferItem]);

  const handleDataMessage = useCallback(
    async (data: unknown) => {
      if (typeof data === 'string') {
        let msg: ControlWireMessage;
        try {
          msg = JSON.parse(data) as ControlWireMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'hello': {
            setRemoteDevice(msg.device);
            break;
          }

          case 'text': {
            setTextDrops((prev) => [
              {
                id: msg.id,
                content: msg.content,
                direction: 'receive',
                timestamp: msg.timestamp || Date.now(),
              },
              ...prev,
            ]);
            playArrivalChime(soundEnabledRef.current);
            break;
          }

          case 'file-start': {
            const now = performance.now();
            activeIncomingRef.current = {
              id: msg.transferId,
              name: msg.name,
              size: msg.size,
              mimeType: msg.mimeType || 'application/octet-stream',
              chunks: [],
              bytesReceived: 0,
              startedAt: now,
              lastUiUpdate: now,
              lastBytes: 0,
              smoothedSpeedMBps: 0,
            };

            setTransfers((prev) => [
              {
                id: msg.transferId,
                name: msg.name,
                size: msg.size,
                mimeType: msg.mimeType || 'application/octet-stream',
                direction: 'receive',
                status: 'transferring',
                progress: 0,
                bytesTransferred: 0,
                speedMBps: 0,
                timestamp: Date.now(),
              },
              ...prev,
            ]);
            break;
          }

          case 'file-end': {
            const bufferEntry = activeIncomingRef.current;
            if (!bufferEntry || bufferEntry.id !== msg.transferId) return;
            activeIncomingRef.current = null;

            const blob = new Blob(bufferEntry.chunks, {
              type: bufferEntry.mimeType || 'application/octet-stream',
            });
            const blobUrl = URL.createObjectURL(blob);
            blobUrlsRef.current.push(blobUrl);

            const totalSeconds = Math.max(0.01, (performance.now() - bufferEntry.startedAt) / 1000);
            const avgMBps = bufferEntry.size / (1024 * 1024) / totalSeconds;

            updateTransferItem(msg.transferId, (prev) => ({
              ...prev,
              status: 'completed',
              progress: 100,
              bytesTransferred: bufferEntry.size,
              speedMBps: avgMBps,
              blobUrl,
            }));

            triggerBrowserDownload(blobUrl, bufferEntry.name);
            playArrivalChime(soundEnabledRef.current);

            if (dcRef.current?.readyState === 'open') {
              dcRef.current.send(
                JSON.stringify({
                  type: 'file-ack',
                  transferId: msg.transferId,
                } satisfies ControlWireMessage)
              );
            }
            break;
          }

          case 'file-ack': {
            break;
          }
        }
        return;
      }

      const bufferEntry = activeIncomingRef.current;
      if (!bufferEntry) return;

      let chunkPart: BlobPart;
      let byteLength = 0;

      if (data instanceof ArrayBuffer) {
        chunkPart = data;
        byteLength = data.byteLength;
      } else {
        const bytes = await toUint8Array(data);
        chunkPart = bytes as unknown as BlobPart;
        byteLength = bytes.byteLength;
      }

      if (byteLength === 0) return;

      bufferEntry.chunks.push(chunkPart);
      bufferEntry.bytesReceived += byteLength;

      const now = performance.now();
      if (
        now - bufferEntry.lastUiUpdate >= 100 ||
        bufferEntry.bytesReceived >= bufferEntry.size
      ) {
        const dtSeconds = Math.max(0.001, (now - bufferEntry.lastUiUpdate) / 1000);
        const instantMBps =
          (bufferEntry.bytesReceived - bufferEntry.lastBytes) / (1024 * 1024) / dtSeconds;
        bufferEntry.smoothedSpeedMBps =
          bufferEntry.smoothedSpeedMBps === 0
            ? instantMBps
            : bufferEntry.smoothedSpeedMBps * 0.65 + instantMBps * 0.35;

        const progress =
          bufferEntry.size > 0
            ? Math.min(99, Math.round((bufferEntry.bytesReceived / bufferEntry.size) * 100))
            : 100;

        bufferEntry.lastUiUpdate = now;
        bufferEntry.lastBytes = bufferEntry.bytesReceived;

        const snapshotBytes = bufferEntry.bytesReceived;
        const snapshotSpeed = bufferEntry.smoothedSpeedMBps;
        const transferId = bufferEntry.id;

        updateTransferItem(transferId, (prev) => ({
          ...prev,
          bytesTransferred: snapshotBytes,
          progress,
          speedMBps: snapshotSpeed,
        }));
      }
    },
    [updateTransferItem]
  );

  const attachDataChannel = useCallback(
    (dc: RTCDataChannel) => {
      dc.binaryType = 'arraybuffer';
      dc.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;
      dcRef.current = dc;

      const refreshDiagnostics = () => {
        const activePc = pcRef.current;
        if (!activePc) return;
        void inspectActiveIcePair(activePc).then((diag) => {
          if (pcRef.current === activePc) {
            setIceDiagnostics(diag);
          }
        });
      };

      const onOpen = () => {
        if (dcRef.current !== dc) return;
        // Immediately disconnect from MQTT so 100% of file/clipboard data travels purely over LAN
        disconnectAllMqtt();
        setConnectionState('connected');
        setStatusError(null);
        playConnectChime(soundEnabledRef.current);
        refreshDiagnostics();
        setTimeout(refreshDiagnostics, 400);

        try {
          dc.send(
            JSON.stringify({
              type: 'hello',
              device: localDeviceRef.current,
            } satisfies ControlWireMessage)
          );
        } catch {
          // Ignore send race
        }

        void flushOutgoingQueue();
      };

      dc.onopen = onOpen;
      if (dc.readyState === 'open') {
        onOpen();
      }

      dc.onmessage = (event) => {
        void handleDataMessage(event.data);
      };

      dc.onclose = () => {
        if (dcRef.current === dc) {
          dcRef.current = null;
          setRemoteDevice(null);
          teardownWebRTC();
          setHostGeneration((g) => g + 1);

          if (activeIncomingRef.current) {
            const failedId = activeIncomingRef.current.id;
            activeIncomingRef.current = null;
            updateTransferItem(failedId, (prev) =>
              prev.status === 'transferring'
                ? { ...prev, status: 'error', errorMessage: 'انقطع الاتصال قبل اكتمال الاستقبال' }
                : prev
            );
          }
        }
      };

      dc.onerror = () => {
        if (dcRef.current === dc) {
          setStatusError('تعذر إكمال قناة البيانات المحلية');
        }
      };
    },
    [disconnectAllMqtt, flushOutgoingQueue, handleDataMessage, teardownWebRTC, updateTransferItem]
  );

  const flushPendingIce = useCallback(async (pc: RTCPeerConnection) => {
    const queued = [...pendingIceRef.current];
    pendingIceRef.current = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Ignore stale candidates
      }
    }
  }, []);

  // Device A: Host room listener for the 4-digit PIN
  useEffect(() => {
    let active = true;
    let localHostClient: MqttClient | null = null;
    let hostHandshakeTimer: ReturnType<typeof setTimeout> | null = null;

    const startHostRoom = async () => {
      if (dcRef.current?.readyState === 'open') return;

      setConnectionState('initializing');
      const roomTopic = await deriveRoomTopic(pinCodeRef.current);
      if (!active) return;

      const client = mqtt.connect(MQTT_BROKER_URL, {
        clientId: makeClientId(),
        clean: true,
        connectTimeout: 7000,
        reconnectPeriod: 3000,
        keepalive: 25,
      });

      localHostClient = client;
      hostMqttRef.current = client;

      client.on('connect', () => {
        if (!active || hostMqttRef.current !== client) return;
        client.subscribe(roomTopic, { qos: 0 }, (err) => {
          if (!active || hostMqttRef.current !== client) return;
          if (err) {
            setConnectionState('error');
            setStatusError('تعذر الاشتراك في قناة الاقتران السريع');
            return;
          }
          setMqttActive(true);
          if (!dcRef.current || dcRef.current.readyState !== 'open') {
            setConnectionState('ready');
          }
        });
      });

      client.on('message', async (_topic, rawPayload) => {
        if (!active || hostMqttRef.current !== client) return;
        let msg: MqttSignalPayload;
        try {
          msg = JSON.parse(decodeMqttPayload(rawPayload)) as MqttSignalPayload;
        } catch {
          return;
        }

        if (msg.from === clientIdRef.current) return;

        if (msg.type === 'offer') {
          if (dcRef.current?.readyState === 'open') return;

          setStatusError(null);
          setConnectionState('connecting');
          setRemoteDevice(msg.device);
          teardownWebRTC();

          // Enforce 5-second handshake window for Host once Offer arrives
          if (hostHandshakeTimer) clearTimeout(hostHandshakeTimer);
          hostHandshakeTimer = setTimeout(() => {
            if (active && dcRef.current?.readyState !== 'open') {
              teardownWebRTC();
              setRemoteDevice(null);
              setConnectionState('ready');
              setStatusError(
                'تعذر فتح قناة LAN المباشرة خلال 5 ثوانٍ. تأكد من اتصال الجهازين بنفس شبكة Wi-Fi أو Hotspot بدون VPN.'
              );
            }
          }, HANDSHAKE_WINDOW_MS);

          const pc = new RTCPeerConnection({ iceServers: [] });
          pcRef.current = pc;

          pc.ondatachannel = (event) => {
            attachDataChannel(event.channel);
          };

          pc.onicecandidate = (event) => {
            if (event.candidate && client.connected) {
              client.publish(
                roomTopic,
                JSON.stringify({
                  type: 'ice',
                  from: clientIdRef.current,
                  to: msg.from,
                  candidate: event.candidate.toJSON(),
                } satisfies MqttSignalPayload)
              );
            }
          };

          pc.oniceconnectionstatechange = () => {
            if (pcRef.current !== pc) return;
            if (pc.iceConnectionState === 'failed') {
              if (hostHandshakeTimer) clearTimeout(hostHandshakeTimer);
              teardownWebRTC();
              setRemoteDevice(null);
              setConnectionState('ready');
              setStatusError(
                'فشل الاتصال المباشر عبر الشبكة المحلية (LAN). تحقق من عدم تفعيل عزل الأجهزة أو VPN.'
              );
            }
          };

          try {
            await pc.setRemoteDescription(
              new RTCSessionDescription({ type: 'offer', sdp: msg.sdp })
            );
            await flushPendingIce(pc);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            if (client.connected && pc.localDescription?.sdp) {
              client.publish(
                roomTopic,
                JSON.stringify({
                  type: 'answer',
                  from: clientIdRef.current,
                  to: msg.from,
                  sdp: pc.localDescription.sdp,
                  device: localDeviceRef.current,
                } satisfies MqttSignalPayload)
              );
            }
          } catch {
            if (hostHandshakeTimer) clearTimeout(hostHandshakeTimer);
            teardownWebRTC();
            setConnectionState('ready');
            setStatusError('حدث خطأ أثناء معالجة طلب الاقتران');
          }
        } else if (msg.type === 'ice') {
          if (msg.to && msg.to !== clientIdRef.current) return;
          const pc = pcRef.current;
          if (pc && pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch {
              // Ignore stale ICE
            }
          } else {
            pendingIceRef.current.push(msg.candidate);
          }
        }
      });

      client.on('error', () => {
        if (!active || hostMqttRef.current !== client) return;
        if (!dcRef.current || dcRef.current.readyState !== 'open') {
          setMqttActive(false);
          setConnectionState('error');
          setStatusError('تعذر الوصول إلى وسيط الإشارة (EMQX). تحقق من الاتصال ثم أعد المحاولة.');
        }
      });
    };

    void startHostRoom();

    return () => {
      active = false;
      if (hostHandshakeTimer) clearTimeout(hostHandshakeTimer);
      if (hostMqttRef.current === localHostClient) {
        closeMqttClient(localHostClient);
        hostMqttRef.current = null;
      } else {
        closeMqttClient(localHostClient);
      }
    };
  }, [
    attachDataChannel,
    closeMqttClient,
    flushPendingIce,
    hostGeneration,
    pinCode,
    teardownWebRTC,
  ]);

  useEffect(() => {
    return () => {
      disconnectAllMqtt();
      teardownWebRTC();
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      blobUrlsRef.current = [];
    };
  }, [disconnectAllMqtt, teardownWebRTC]);

  // Device B: Connect to Host's 4-digit PIN room for max 5 seconds
  const connectWithPin = useCallback(
    async (rawPin: string) => {
      primeAudioContext();
      const cleanPin = normalizePinCode(rawPin);
      if (cleanPin.length !== 4) {
        setStatusError('يرجى إدخال رمز PIN مكوّن من 4 أرقام');
        return;
      }
      if (cleanPin === pinCodeRef.current) {
        setStatusError('لا يمكنك الاتصال برمز نفس الجهاز. أدخل الرمز الظاهر على الجهاز الآخر.');
        return;
      }

      // Close host listener while dialing out as Guest
      if (hostMqttRef.current) {
        closeMqttClient(hostMqttRef.current);
        hostMqttRef.current = null;
      }
      if (guestMqttRef.current) {
        closeMqttClient(guestMqttRef.current);
        guestMqttRef.current = null;
      }
      clearHandshakeTimer();
      teardownWebRTC();

      setStatusError(null);
      setRemoteDevice(null);
      setConnectionState('connecting');
      setMqttActive(true);

      const roomTopic = await deriveRoomTopic(cleanPin);
      const guestClient = mqtt.connect(MQTT_BROKER_URL, {
        clientId: makeClientId(),
        clean: true,
        connectTimeout: 4500,
        reconnectPeriod: 0,
        keepalive: 15,
      });

      guestMqttRef.current = guestClient;
      answerReceivedRef.current = false;

      // Strict 5-second signaling window on MQTT
      handshakeTimerRef.current = setTimeout(() => {
        if (dcRef.current?.readyState === 'open') return;
        closeMqttClient(guestClient);
        if (guestMqttRef.current === guestClient) {
          guestMqttRef.current = null;
        }
        setMqttActive(false);
        teardownWebRTC();
        setRemoteDevice(null);
        setStatusError(
          answerReceivedRef.current
            ? 'تعذر إكمال الربط المباشر عبر الشبكة المحلية خلال 5 ثوانٍ. تأكد من أن الجهازين على نفس شبكة Wi-Fi/Hotspot بدون VPN.'
            : `لم يتم العثور على جهاز ينتظر بالرمز ${cleanPin} خلال 5 ثوانٍ. تأكد من صحة الرمز.`
        );
        // Re-enable own Host room so user stays ready
        setHostGeneration((g) => g + 1);
      }, HANDSHAKE_WINDOW_MS);

      guestClient.on('connect', () => {
        if (guestMqttRef.current !== guestClient) return;
        guestClient.subscribe(roomTopic, { qos: 0 }, async (err) => {
          if (err || guestMqttRef.current !== guestClient) {
            clearHandshakeTimer();
            closeMqttClient(guestClient);
            guestMqttRef.current = null;
            setMqttActive(false);
            setStatusError('تعذر الاشتراك في غرفة الاقتران');
            setHostGeneration((g) => g + 1);
            return;
          }

          const pc = new RTCPeerConnection({ iceServers: [] });
          pcRef.current = pc;

          const dc = pc.createDataChannel('stark-bridge', { ordered: true });
          attachDataChannel(dc);

          pc.onicecandidate = (event) => {
            if (event.candidate && guestClient.connected) {
              guestClient.publish(
                roomTopic,
                JSON.stringify({
                  type: 'ice',
                  from: clientIdRef.current,
                  candidate: event.candidate.toJSON(),
                } satisfies MqttSignalPayload)
              );
            }
          };

          pc.oniceconnectionstatechange = () => {
            if (pcRef.current !== pc) return;
            if (pc.iceConnectionState === 'failed') {
              clearHandshakeTimer();
              closeMqttClient(guestClient);
              guestMqttRef.current = null;
              setMqttActive(false);
              teardownWebRTC();
              setRemoteDevice(null);
              setStatusError(
                'فشل التفاوض الشبكي المباشر (LAN). تأكد من اتصال الجهازين بنفس الشبكة بدون عزل أو VPN.'
              );
              setHostGeneration((g) => g + 1);
            }
          };

          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            if (guestClient.connected && pc.localDescription?.sdp) {
              guestClient.publish(
                roomTopic,
                JSON.stringify({
                  type: 'offer',
                  from: clientIdRef.current,
                  sdp: pc.localDescription.sdp,
                  device: localDeviceRef.current,
                } satisfies MqttSignalPayload)
              );
            }
          } catch {
            clearHandshakeTimer();
            closeMqttClient(guestClient);
            guestMqttRef.current = null;
            setMqttActive(false);
            teardownWebRTC();
            setStatusError('تعذر إنشاء اتصال WebRTC المحلي');
            setHostGeneration((g) => g + 1);
          }
        });
      });

      guestClient.on('message', async (_topic, rawPayload) => {
        if (guestMqttRef.current !== guestClient) return;
        let msg: MqttSignalPayload;
        try {
          msg = JSON.parse(decodeMqttPayload(rawPayload)) as MqttSignalPayload;
        } catch {
          return;
        }

        if (msg.from === clientIdRef.current) return;

        if (msg.type === 'answer' && msg.to === clientIdRef.current) {
          answerReceivedRef.current = true;
          setRemoteDevice(msg.device);
          const pc = pcRef.current;
          if (!pc) return;
          try {
            await pc.setRemoteDescription(
              new RTCSessionDescription({ type: 'answer', sdp: msg.sdp })
            );
            await flushPendingIce(pc);
          } catch {
            // Ignore SDP race
          }
        } else if (msg.type === 'ice') {
          if (msg.to && msg.to !== clientIdRef.current) return;
          const pc = pcRef.current;
          if (pc && pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch {
              // Ignore
            }
          } else {
            pendingIceRef.current.push(msg.candidate);
          }
        }
      });

      guestClient.on('error', () => {
        if (guestMqttRef.current !== guestClient) return;
        clearHandshakeTimer();
        closeMqttClient(guestClient);
        guestMqttRef.current = null;
        setMqttActive(false);
        teardownWebRTC();
        setStatusError('تعذر الاتصال بخادم الإشارة السريع (EMQX)');
        setHostGeneration((g) => g + 1);
      });
    },
    [
      attachDataChannel,
      clearHandshakeTimer,
      closeMqttClient,
      flushPendingIce,
      teardownWebRTC,
    ]
  );

  const cancelConnect = useCallback(() => {
    clearHandshakeTimer();
    if (guestMqttRef.current) {
      closeMqttClient(guestMqttRef.current);
      guestMqttRef.current = null;
    }
    setMqttActive(false);
    teardownWebRTC();
    setRemoteDevice(null);
    setStatusError(null);
    setHostGeneration((g) => g + 1);
  }, [clearHandshakeTimer, closeMqttClient, teardownWebRTC]);

  const disconnectPeer = useCallback(() => {
    disconnectAllMqtt();
    teardownWebRTC();
    setRemoteDevice(null);
    setStatusError(null);
    setHostGeneration((g) => g + 1);
  }, [disconnectAllMqtt, teardownWebRTC]);

  const regeneratePin = useCallback(() => {
    disconnectAllMqtt();
    teardownWebRTC();
    setRemoteDevice(null);
    setStatusError(null);
    setPinCode(generatePinCode());
  }, [disconnectAllMqtt, teardownWebRTC]);

  const retrySignaling = useCallback(() => {
    setStatusError(null);
    setHostGeneration((g) => g + 1);
  }, []);

  const sendFiles = useCallback(
    (files: FileList | File[]) => {
      primeAudioContext();
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;

      const newItems: FileTransferItem[] = [];
      for (const file of fileArray) {
        const transferId =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        outgoingQueueRef.current.push({ transferId, file });
        newItems.push({
          id: transferId,
          name: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
          direction: 'send',
          status: 'queued',
          progress: 0,
          bytesTransferred: 0,
          speedMBps: 0,
          timestamp: Date.now(),
        });
      }

      setTransfers((prev) => [...newItems.reverse(), ...prev]);

      if (dcRef.current?.readyState === 'open') {
        void flushOutgoingQueue();
      }
    },
    [flushOutgoingQueue]
  );

  const sendTextDrop = useCallback((content: string): boolean => {
    primeAudioContext();
    const trimmed = content.trim();
    if (!trimmed) return false;
    const dc = dcRef.current;
    if (!dc || dc.readyState !== 'open') {
      setStatusError('يرجى إتمام الاقتران أولاً لإرسال النصوص');
      return false;
    }

    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `txt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const timestamp = Date.now();

    dc.send(
      JSON.stringify({
        type: 'text',
        id,
        content: trimmed,
        timestamp,
      } satisfies ControlWireMessage)
    );

    setTextDrops((prev) => [
      {
        id,
        content: trimmed,
        direction: 'send',
        timestamp,
      },
      ...prev,
    ]);

    return true;
  }, []);

  const updateLocalDeviceName = useCallback((newName: string) => {
    const cleaned = newName.trim().slice(0, 32);
    if (!cleaned) return;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('stark_device_name', cleaned);
    }
    const updated: DeviceProfile = { ...localDeviceRef.current, name: cleaned };
    setLocalDevice(updated);
    localDeviceRef.current = updated;

    if (dcRef.current?.readyState === 'open') {
      dcRef.current.send(
        JSON.stringify({
          type: 'hello',
          device: updated,
        } satisfies ControlWireMessage)
      );
    }
  }, []);

  const clearCompletedTransfers = useCallback(() => {
    setTransfers((prev) => {
      prev.forEach((item) => {
        if (item.status === 'completed' && item.blobUrl) {
          URL.revokeObjectURL(item.blobUrl);
        }
      });
      return prev.filter((item) => item.status === 'transferring' || item.status === 'queued');
    });
  }, []);

  const clearTextDrops = useCallback(() => {
    setTextDrops([]);
  }, []);

  const clearError = useCallback(() => {
    setStatusError(null);
  }, []);

  return {
    pinCode,
    localDevice,
    connectionState,
    mqttActive,
    remoteDevice,
    iceDiagnostics,
    statusError,
    transfers,
    textDrops,
    connectWithPin,
    cancelConnect,
    disconnectPeer,
    regeneratePin,
    retrySignaling,
    sendFiles,
    sendTextDrop,
    updateLocalDeviceName,
    clearCompletedTransfers,
    clearTextDrops,
    clearError,
  };
}
