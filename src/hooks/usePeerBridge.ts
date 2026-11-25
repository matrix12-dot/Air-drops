import { useCallback, useEffect, useRef, useState } from 'react';
import Peer, { DataConnection } from 'peerjs';
import {
  ConnectionState,
  DeviceProfile,
  FileTransferItem,
  TextDropItem,
  WireMessage,
} from '../types/p2p';
import {
  detectLocalDevice,
  generateStarkId,
  normalizePeerId,
} from '../utils/device';
import { playArrivalChime, playConnectChime, primeAudioContext } from '../utils/sound';

const CHUNK_SIZE = 64 * 1024; // 64KB chunks
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
  if (payload instanceof Uint8Array) {
    return payload;
  }
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
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

async function waitForBufferDrain(conn: DataConnection): Promise<void> {
  const dc = conn.dataChannel;
  if (!dc || dc.bufferedAmount <= MAX_BUFFERED_AMOUNT) {
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
      // Fallback to timer only if bufferedAmountLowThreshold is unsupported
    }

    const timer = setTimeout(() => {
      finish();
    }, 35);
  });
}

export function usePeerBridge(soundEnabled: boolean) {
  const [peerId, setPeerId] = useState<string>(() => generateStarkId());
  const [localDevice, setLocalDevice] = useState<DeviceProfile>(() => detectLocalDevice());
  const [connectionState, setConnectionState] = useState<ConnectionState>('initializing');
  const [remotePeerId, setRemotePeerId] = useState<string | null>(null);
  const [remoteDevice, setRemoteDevice] = useState<DeviceProfile | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<FileTransferItem[]>([]);
  const [textDrops, setTextDrops] = useState<TextDropItem[]>([]);

  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const soundEnabledRef = useRef<boolean>(soundEnabled);
  const localDeviceRef = useRef<DeviceProfile>(localDevice);
  const peerIdRef = useRef<string>(peerId);
  const pendingAutoConnectRef = useRef<string | null>(null);
  const idRetryCountRef = useRef<number>(0);

  const incomingTransfersRef = useRef<Map<string, IncomingTransferBuffer>>(new Map());
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
    peerIdRef.current = peerId;
  }, [peerId]);

  // Capture ?connect=STARK-XXX on initial page load
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const target = params.get('connect');
    if (target) {
      const normalized = normalizePeerId(target);
      if (normalized) {
        pendingAutoConnectRef.current = normalized;
      }
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const updateTransferItem = useCallback(
    (id: string, updater: (prev: FileTransferItem) => FileTransferItem) => {
      setTransfers((prev) => prev.map((item) => (item.id === id ? updater(item) : item)));
    },
    []
  );

  const flushOutgoingQueue = useCallback(async () => {
    if (isSendingRef.current) return;
    const conn = connRef.current;
    if (!conn || !conn.open) return;

    isSendingRef.current = true;

    try {
      while (outgoingQueueRef.current.length > 0) {
        const activeConn = connRef.current;
        if (!activeConn || !activeConn.open) {
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
          activeConn.send({
            type: 'file-start',
            transferId,
            name: file.name,
            size: file.size,
            mimeType: file.type || 'application/octet-stream',
            totalChunks,
          } satisfies WireMessage);

          let offset = 0;
          let chunkIndex = 0;

          while (offset < file.size) {
            if (!activeConn.open) {
              throw new Error('انقطع الاتصال أثناء الإرسال');
            }

            await waitForBufferDrain(activeConn);

            const slice = file.slice(offset, offset + CHUNK_SIZE);
            const buffer = await slice.arrayBuffer();

            activeConn.send({
              type: 'file-chunk',
              transferId,
              index: chunkIndex,
              data: buffer,
            } satisfies WireMessage);

            offset += buffer.byteLength;
            chunkIndex += 1;

            const now = performance.now();
            if (now - lastUiUpdate >= 110 || offset >= file.size) {
              const dtSeconds = Math.max(0.001, (now - lastUiUpdate) / 1000);
              const instantMBps = (offset - lastBytes) / (1024 * 1024) / dtSeconds;
              smoothedSpeed =
                smoothedSpeed === 0 ? instantMBps : smoothedSpeed * 0.65 + instantMBps * 0.35;
              const progress = file.size > 0 ? Math.min(99, Math.round((offset / file.size) * 100)) : 100;

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

          activeConn.send({
            type: 'file-end',
            transferId,
          } satisfies WireMessage);

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
            err instanceof Error ? err.message : 'تعذر إرسال الملف عبر الاتصال المباشر';
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

  const handleIncomingData = useCallback(
    async (raw: unknown) => {
      if (!raw || typeof raw !== 'object') return;
      const msg = raw as WireMessage;

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
          incomingTransfersRef.current.set(msg.transferId, {
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
          });

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

        case 'file-chunk': {
          const bufferEntry = incomingTransfersRef.current.get(msg.transferId);
          if (!bufferEntry) return;

          const bytes = await toUint8Array(msg.data);
          bufferEntry.chunks.push(bytes as unknown as BlobPart);
          bufferEntry.bytesReceived += bytes.byteLength;

          const now = performance.now();
          if (
            now - bufferEntry.lastUiUpdate >= 110 ||
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

            updateTransferItem(msg.transferId, (prev) => ({
              ...prev,
              bytesTransferred: snapshotBytes,
              progress,
              speedMBps: snapshotSpeed,
            }));
          }
          break;
        }

        case 'file-end': {
          const bufferEntry = incomingTransfersRef.current.get(msg.transferId);
          if (!bufferEntry) return;
          incomingTransfersRef.current.delete(msg.transferId);

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

          if (connRef.current?.open) {
            connRef.current.send({
              type: 'file-ack',
              transferId: msg.transferId,
            } satisfies WireMessage);
          }
          break;
        }

        case 'file-ack': {
          // Confirmed received by remote peer
          break;
        }
      }
    },
    [updateTransferItem]
  );

  const attachConnection = useCallback(
    (conn: DataConnection) => {
      if (connRef.current && connRef.current !== conn) {
        try {
          connRef.current.close();
        } catch {
          // Ignore close error
        }
      }

      connRef.current = conn;
      setRemotePeerId(conn.peer);
      setStatusError(null);

      const handleOpen = () => {
        setConnectionState('connected');
        setRemotePeerId(conn.peer);
        setStatusError(null);
        playConnectChime(soundEnabledRef.current);

        conn.send({
          type: 'hello',
          device: localDeviceRef.current,
        } satisfies WireMessage);

        flushOutgoingQueue();
      };

      if (conn.open) {
        handleOpen();
      } else {
        setConnectionState('connecting');
      }

      conn.on('open', handleOpen);

      conn.on('data', (data) => {
        void handleIncomingData(data);
      });

      conn.on('close', () => {
        if (connRef.current === conn) {
          connRef.current = null;
          setRemotePeerId(null);
          setRemoteDevice(null);
          setConnectionState(peerRef.current && !peerRef.current.destroyed ? 'ready' : 'initializing');

          // Mark any in-progress incoming transfers as errored
          incomingTransfersRef.current.forEach((entry) => {
            updateTransferItem(entry.id, (prev) =>
              prev.status === 'transferring'
                ? { ...prev, status: 'error', errorMessage: 'انقطع الاتصال قبل اكتمال الاستقبال' }
                : prev
            );
          });
          incomingTransfersRef.current.clear();
        }
      });

      conn.on('error', () => {
        setStatusError('تعذر الحفاظ على قناة الاتصال المباشر مع الجهاز الآخر');
        if (connRef.current === conn) {
          connRef.current = null;
          setRemotePeerId(null);
          setRemoteDevice(null);
          setConnectionState('ready');
        }
      });
    },
    [flushOutgoingQueue, handleIncomingData, updateTransferItem]
  );

  const connectToPeer = useCallback(
    (rawTargetId: string) => {
      primeAudioContext();
      const targetId = normalizePeerId(rawTargetId);
      if (!targetId) {
        setStatusError('يرجى إدخال رمز الجهاز الآخر');
        return;
      }
      if (targetId === peerIdRef.current) {
        setStatusError('لا يمكنك الاتصال بنفس الجهاز');
        return;
      }
      const peer = peerRef.current;
      if (!peer || peer.destroyed) {
        pendingAutoConnectRef.current = targetId;
        return;
      }

      setStatusError(null);
      setConnectionState('connecting');
      setRemotePeerId(targetId);

      const conn = peer.connect(targetId, {
        reliable: true,
        serialization: 'binary',
      });
      attachConnection(conn);
    },
    [attachConnection]
  );

  useEffect(() => {
    let active = true;
    let peerInstance: Peer | null = null;

    const initPeer = (idToUse: string) => {
      if (!active) return;
      setConnectionState('initializing');

      peerInstance = new Peer(idToUse, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
          ],
        },
      });

      peerRef.current = peerInstance;

      peerInstance.on('open', (assignedId) => {
        if (!active) return;
        idRetryCountRef.current = 0;
        setPeerId(assignedId);
        peerIdRef.current = assignedId;
        setStatusError(null);

        if (!connRef.current?.open) {
          setConnectionState('ready');
        }

        if (
          pendingAutoConnectRef.current &&
          pendingAutoConnectRef.current !== assignedId
        ) {
          const target = pendingAutoConnectRef.current;
          pendingAutoConnectRef.current = null;
          connectToPeer(target);
        }
      });

      peerInstance.on('connection', (incomingConn) => {
        if (!active) return;
        attachConnection(incomingConn);
      });

      peerInstance.on('disconnected', () => {
        if (!active || !peerInstance || peerInstance.destroyed) return;
        // Reconnect to signaling server while preserving active P2P DataChannel
        try {
          peerInstance.reconnect();
        } catch {
          // Ignore reconnect race
        }
      });

      peerInstance.on('error', (err) => {
        if (!active) return;
        const errType = (err as { type?: string }).type;

        if (errType === 'unavailable-id' && idRetryCountRef.current < 5) {
          idRetryCountRef.current += 1;
          const nextId = generateStarkId();
          setPeerId(nextId);
          peerIdRef.current = nextId;
          try {
            peerInstance?.destroy();
          } catch {
            // Ignore
          }
          initPeer(nextId);
          return;
        }

        if (errType === 'peer-unavailable') {
          setStatusError('لم يتم العثور على الجهاز المطلوب. تأكد من فتح التطبيق على الجهاز الآخر وصحة الرمز.');
          if (!connRef.current?.open) {
            connRef.current = null;
            setRemotePeerId(null);
            setRemoteDevice(null);
            setConnectionState('ready');
          }
          return;
        }

        if (errType === 'network' || errType === 'server-error' || errType === 'socket-error') {
          setStatusError('تعذر الوصول إلى خادم الإشارات لبدء الاقتران. تحقق من اتصال الإنترنت.');
          if (!connRef.current?.open) {
            setConnectionState('error');
          }
          return;
        }

        setStatusError('حدث خطأ في الاتصال المباشر. حاول إعادة الاقتران.');
        if (!connRef.current?.open) {
          setConnectionState('ready');
        }
      });
    };

    initPeer(peerIdRef.current);

    return () => {
      active = false;
      try {
        connRef.current?.close();
      } catch {
        // Ignore
      }
      try {
        peerInstance?.destroy();
      } catch {
        // Ignore
      }
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      blobUrlsRef.current = [];
    };
  }, [attachConnection, connectToPeer]);

  const disconnectPeer = useCallback(() => {
    if (connRef.current) {
      try {
        connRef.current.close();
      } catch {
        // Ignore
      }
      connRef.current = null;
    }
    setRemotePeerId(null);
    setRemoteDevice(null);
    setStatusError(null);
    setConnectionState(peerRef.current && !peerRef.current.destroyed ? 'ready' : 'initializing');
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

      if (connRef.current?.open) {
        void flushOutgoingQueue();
      }
    },
    [flushOutgoingQueue]
  );

  const sendTextDrop = useCallback((content: string): boolean => {
    primeAudioContext();
    const trimmed = content.trim();
    if (!trimmed) return false;
    const conn = connRef.current;
    if (!conn || !conn.open) {
      setStatusError('يرجى الاقتران بجهاز آخر أولاً لإرسال النصوص');
      return false;
    }

    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `txt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const timestamp = Date.now();

    conn.send({
      type: 'text',
      id,
      content: trimmed,
      timestamp,
    } satisfies WireMessage);

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

    if (connRef.current?.open) {
      connRef.current.send({
        type: 'hello',
        device: updated,
      } satisfies WireMessage);
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
    peerId,
    localDevice,
    connectionState,
    remotePeerId,
    remoteDevice,
    statusError,
    transfers,
    textDrops,
    connectToPeer,
    disconnectPeer,
    sendFiles,
    sendTextDrop,
    updateLocalDeviceName,
    clearCompletedTransfers,
    clearTextDrops,
    clearError,
  };
}
