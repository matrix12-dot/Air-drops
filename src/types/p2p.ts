export type DeviceKind = 'mobile' | 'tablet' | 'desktop';

export type OperatingSystem =
  | 'iOS'
  | 'Android'
  | 'macOS'
  | 'Windows'
  | 'Linux'
  | 'ChromeOS'
  | 'Unknown';

export interface DeviceProfile {
  name: string;
  os: OperatingSystem;
  kind: DeviceKind;
}

export type ConnectionState =
  | 'idle'
  | 'awaiting-answer'
  | 'guest-ready'
  | 'connecting'
  | 'connected'
  | 'error';

export type TransferDirection = 'send' | 'receive';

export type TransferStatus = 'queued' | 'transferring' | 'completed' | 'error';

export interface FileTransferItem {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  direction: TransferDirection;
  status: TransferStatus;
  progress: number;
  bytesTransferred: number;
  speedMBps: number;
  blobUrl?: string;
  timestamp: number;
  errorMessage?: string;
}

export interface TextDropItem {
  id: string;
  content: string;
  direction: TransferDirection;
  timestamp: number;
}

export type ControlWireMessage =
  | {
      type: 'hello';
      device: DeviceProfile;
    }
  | {
      type: 'file-start';
      transferId: string;
      name: string;
      size: number;
      mimeType: string;
      totalChunks: number;
    }
  | {
      type: 'file-end';
      transferId: string;
    }
  | {
      type: 'file-ack';
      transferId: string;
    }
  | {
      type: 'text';
      id: string;
      content: string;
      timestamp: number;
    };
