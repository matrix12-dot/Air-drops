import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionState,
  ControlWireMessage,
  DeviceProfile,
  FileTransferItem,
  TextDropItem,
} from '../types/p2p';
import { detectLocalDevice } from '../utils/device';
import { decodeSignalToken, encodeSignalToken, gatherLocalSdp } from '../utils/sdpCodec';
import { playArrivalChime, playConnectChime, primeAudioContext } from '../utils/sound';

const CHUNK_SIZE = 64 * 1024; // 64KB binary chunks
const MAX_BUFFERED_AMOUNT = 1024 * 1024; // 1MB high-water mark
const BUFFER_LOW_THRESHOLD = 256 * 1024; // 256KB low-water mark

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

async function waitForBufferDrain(dc: RTCDataChannel): Promise<void> {
  if (dc.bufferedAmount <= MAX_BUFFERED_AMOUNT) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      dc.removeEventListener('bufferedamountlow', onLow);
      clearTimeout(timer);
      resolve();
    };

    const onLow = () => finish();

    try {
      dc.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;
      dc.addEventListener('bufferedamountlow', onLow);
    } catch {
      // Fallback to timer only
    }

    const timer = setTimeout(finish, 30);
  });
}

export function useWebRTCBridge(soundEnabled: boolean) {
  const [localDevice, setLocalDevice] = useState<DeviceProfile>(() => detectLocalDevice());
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [offerToken, setOfferToken] = useState<string>('');
  const [answerToken, setAnswerToken] = useState<string>('');
  const [remoteDevice, setRemoteDevice] = useState<DeviceProfile | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<FileTransferItem[]>([]);
  const [textDrops, setTextDrops] = useState<TextDropItem[]>([]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const soundEnabledRef = useRef<boolean>(soundEnabled);
  const localDeviceRef = useRef<DeviceProfile>(localDevice);

  const activeIncomingRef = useRef<IncomingTransferBuffer | null>(null);
  const outgoingQueueRef = useRef<OutgoingQueuedFile[]>([]);
  const isSendingRef = useRef<boolean>(false);
  const blobUrlsRef = useRef<string[]>([]);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    localDeviceRef.current = localDevice;
  }, [localDevice]);

  const clearConnectTimeout = useCallback(() => {
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
  }, []);

  const teardownPeer = useCallback(() => {
    clearConnectTimeout();
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
  }, [clearConnectTimeout]);

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
        const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
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

          while (offset < file.size) {
            if (activeDc.readyState !== 'open') {
              throw new Error('انقطع الاتصال أثناء الإرسال');
            }

            await waitForBufferDrain(activeDc);

            const slice = file.slice(offset, offset + CHUNK_SIZE);
            const buffer = await slice.arrayBuffer();
            activeDc.send(buffer);

            offset += buffer.byteLength;

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
      // Control JSON messages arrive as strings; binary chunks arrive as raw ArrayBuffer
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

      // Raw binary chunk frame
      const bufferEntry = activeIncomingRef.current;
      if (!bufferEntry) return;

      const bytes = await toUint8Array(data);
      if (bytes.byteLength === 0) return;

      bufferEntry.chunks.push(bytes as unknown as BlobPart);
      bufferEntry.bytesReceived += bytes.byteLength;

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
      dcRef.current = dc;

      const onOpen = () => {
        clearConnectTimeout();
        if (dcRef.current !== dc) return;
        setConnectionState('connected');
        setStatusError(null);
        setOfferToken('');
        setAnswerToken('');
        playConnectChime(soundEnabledRef.current);

        try {
          dc.send(
            JSON.stringify({
              type: 'hello',
              device: localDeviceRef.current,
            } satisfies ControlWireMessage)
          );
        } catch {
          // Ignore race
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
        clearConnectTimeout();
        if (dcRef.current === dc) {
          dcRef.current = null;
          setRemoteDevice(null);
          setOfferToken('');
          setAnswerToken('');
          setConnectionState('idle');

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
        clearConnectTimeout();
        if (dcRef.current === dc) {
          setStatusError('تعذر إكمال الاتصال عبر قناة البيانات المحلية');
        }
      };
    },
    [clearConnectTimeout, flushOutgoingQueue, handleDataMessage, updateTransferItem]
  );

  const createLanPeerConnection = useCallback(() => {
    teardownPeer();

    // Empty iceServers forces 100% offline local LAN host candidates with zero internet delay
    const pc = new RTCPeerConnection({
      iceServers: [],
    });

    pc.oniceconnectionstatechange = () => {
      if (pcRef.current !== pc) return;
      if (pc.iceConnectionState === 'failed') {
        clearConnectTimeout();
        setStatusError(
          'تعذر الربط المباشر عبر الشبكة المحلية. تأكد من أن الجهازين على نفس شبكة Wi-Fi أو Hotspot بدون تفعيل VPN أو عزل الأجهزة (AP Isolation).'
        );
        setConnectionState('error');
      }
    };

    pcRef.current = pc;
    return pc;
  }, [clearConnectTimeout, teardownPeer]);

  // Step 1 (Host): Create Offer QR instantaneously (<50ms)
  const createHostOffer = useCallback(async () => {
    primeAudioContext();
    setStatusError(null);
    setAnswerToken('');
    setRemoteDevice(null);

    try {
      const pc = createLanPeerConnection();
      const dc = pc.createDataChannel('stark-bridge', { ordered: true });
      attachDataChannel(dc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const fullLocalSdp = await gatherLocalSdp(pc);
      const token = encodeSignalToken('offer', fullLocalSdp);

      setOfferToken(token);
      setConnectionState('awaiting-answer');
    } catch {
      setStatusError('تعذر إنشاء رمز الاتصال السريع. تأكد من دعم المتصفح لـ WebRTC.');
      setConnectionState('error');
    }
  }, [attachDataChannel, createLanPeerConnection]);

  // Step 2 (Guest): Scan/Paste Host Offer -> immediately produce Answer QR
  const acceptHostOffer = useCallback(
    async (rawToken: string): Promise<boolean> => {
      primeAudioContext();
      const decoded = decodeSignalToken(rawToken);
      if (!decoded) {
        setStatusError('الرمز المقروء غير صالح. تأكد من مسح رمز العرض الصحيح.');
        return false;
      }
      if (decoded.kind !== 'offer') {
        setStatusError('هذا رمز استجابة (Answer) وليس رمز عرض (Offer). امسح الرمز من الجهاز المُنشئ للاتصال.');
        return false;
      }

      setStatusError(null);
      setOfferToken('');
      setRemoteDevice(null);

      try {
        const pc = createLanPeerConnection();
        pc.ondatachannel = (event) => {
          attachDataChannel(event.channel);
        };

        await pc.setRemoteDescription(
          new RTCSessionDescription({ type: 'offer', sdp: decoded.sdp })
        );

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        const fullLocalSdp = await gatherLocalSdp(pc);
        const token = encodeSignalToken('answer', fullLocalSdp);

        setAnswerToken(token);
        setConnectionState('guest-ready');
        return true;
      } catch {
        setStatusError('تعذر معالجة رمز الاتصال. أنشئ اتصالاً جديداً وحاول مجدداً.');
        setConnectionState('error');
        return false;
      }
    },
    [attachDataChannel, createLanPeerConnection]
  );

  // Step 3 (Host): Scan/Paste Guest Answer -> instantaneous LAN DataChannel lock
  const completeHostHandshake = useCallback(
    async (rawToken: string): Promise<boolean> => {
      primeAudioContext();
      const decoded = decodeSignalToken(rawToken);
      if (!decoded) {
        setStatusError('رمز الاستجابة غير صالح. تأكد من مسح رمز QR الظاهر على الجهاز الآخر.');
        return false;
      }
      if (decoded.kind !== 'answer') {
        setStatusError('هذا رمز عرض (Offer) وليس رمز استجابة (Answer). امسح الرمز الجديد من شاشة الجهاز الثاني.');
        return false;
      }

      const pc = pcRef.current;
      if (!pc || pc.signalingState === 'closed') {
        setStatusError('انتهت صلاحية الجلسة الحالية. أنشئ اتصالاً سريعاً جديداً.');
        setConnectionState('idle');
        return false;
      }

      try {
        setStatusError(null);
        setConnectionState('connecting');

        await pc.setRemoteDescription(
          new RTCSessionDescription({ type: 'answer', sdp: decoded.sdp })
        );

        clearConnectTimeout();
        connectTimeoutRef.current = setTimeout(() => {
          if (dcRef.current?.readyState !== 'open') {
            setStatusError(
              'لم تكتمل قناة الشبكة المحلية (LAN). تأكد من اتصال الجهازين بنفس شبكة Wi-Fi/Hotspot وإيقاف أي VPN، ثم أعد المحاولة.'
            );
            setConnectionState('awaiting-answer');
          }
        }, 8000);

        return true;
      } catch {
        setStatusError('تعذر إتمام المصافحة المباشرة. تأكد من أن رمز الاستجابة يطابق رمز العرض الحالي.');
        setConnectionState('awaiting-answer');
        return false;
      }
    },
    [clearConnectTimeout]
  );

  const resetPairing = useCallback(() => {
    teardownPeer();
    setOfferToken('');
    setAnswerToken('');
    setRemoteDevice(null);
    setStatusError(null);
    setConnectionState('idle');
  }, [teardownPeer]);

  useEffect(() => {
    return () => {
      teardownPeer();
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      blobUrlsRef.current = [];
    };
  }, [teardownPeer]);

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
    localDevice,
    connectionState,
    offerToken,
    answerToken,
    remoteDevice,
    statusError,
    transfers,
    textDrops,
    createHostOffer,
    acceptHostOffer,
    completeHostHandshake,
    resetPairing,
    sendFiles,
    sendTextDrop,
    updateLocalDeviceName,
    clearCompletedTransfers,
    clearTextDrops,
    clearError,
  };
}
