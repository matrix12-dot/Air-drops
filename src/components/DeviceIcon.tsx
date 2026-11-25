import { Laptop, Monitor, Smartphone, Tablet } from 'lucide-react';
import { DeviceKind, OperatingSystem } from '../types/p2p';

interface DeviceIconProps {
  kind: DeviceKind;
  os?: OperatingSystem;
  className?: string;
}

export function DeviceIcon({ kind, os, className = 'w-5 h-5' }: DeviceIconProps) {
  if (kind === 'mobile') {
    return <Smartphone className={className} aria-hidden="true" />;
  }
  if (kind === 'tablet') {
    return <Tablet className={className} aria-hidden="true" />;
  }
  if (os === 'Windows' || os === 'Linux') {
    return <Monitor className={className} aria-hidden="true" />;
  }
  return <Laptop className={className} aria-hidden="true" />;
}
