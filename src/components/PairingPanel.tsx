import { useState, FormEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Check,
  Copy,
  Edit3,
  Link2,
  Loader2,
  Maximize2,
  QrCode,
  Unplug,
  Wifi,
  X,
} from 'lucide-react';
import { ConnectionState, DeviceProfile } from '../types/p2p';
import { DeviceIcon } from './DeviceIcon';

interface PairingPanelProps {
  peerId: string;
  localDevice: DeviceProfile;
  connectionState: ConnectionState;
  remotePeerId: string | null;
  remoteDevice: DeviceProfile | null;
  statusError: string | null;
  onConnect: (targetId: string) => void;
  onDisconnect: () => void;
  onUpdateLocalName: (name: string) => void;
  onClearError: () => void;
}

export function PairingPanel({
  peerId,
  localDevice,
  connectionState,
  remotePeerId,
  remoteDevice,
  statusError,
  onConnect,
  onDisconnect,
  onUpdateLocalName,
  onClearError,
}: PairingPanelProps) {
  const [targetInput, setTargetInput] = useState('');
  const [copiedId, setCopiedId] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState(localDevice.name);
  const [showLargeQr, setShowLargeQr] = useState(false);

  const pairingUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}?connect=${encodeURIComponent(peerId)}`
      : `?connect=${peerId}`;

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(peerId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(pairingUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleSubmitConnect = (e: FormEvent) => {
    e.preventDefault();
    if (!targetInput.trim()) return;
    onConnect(targetInput);
  };

  const handleSaveName = (e: FormEvent) => {
    e.preventDefault();
    if (draftName.trim()) {
      onUpdateLocalName(draftName.trim());
    }
    setIsEditingName(false);
  };

  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting';

  return (
    <section
      id="pairing"
      aria-label="الاقتران والاتصال المباشر"
      className="flex flex-col gap-6"
    >
      {/* Connection Status Card */}
      <div className="liquid-glass rounded-3xl p-6 flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${
                isConnected
                  ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                  : isConnecting
                    ? 'bg-cyan-500/15 border-cyan-400/30 text-cyan-300'
                    : 'bg-white/[0.05] border-white/10 text-cyan-300'
              }`}
            >
              {isConnected ? (
                <Wifi className="w-5 h-5" aria-hidden="true" />
              ) : isConnecting ? (
                <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
              ) : (
                <QrCode className="w-5 h-5" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-50 truncate">
                {isConnected ? 'الجهاز المقترن' : 'هوية جهازك'}
              </h2>
              <p className="text-xs text-slate-400 truncate">
                {isConnected
                  ? 'نقل مشفّر من جهاز لجهاز عبر WebRTC'
                  : 'شارك الرمز أو امسح QR لبدء النقل'}
              </p>
            </div>
          </div>

          {isConnected && (
            <button
              type="button"
              onClick={onDisconnect}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl text-xs font-semibold text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-400/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Unplug className="w-3.5 h-3.5" aria-hidden="true" />
              <span>قطع الاتصال</span>
            </button>
          )}
        </div>

        {/* Live Telemetry Connection Badge */}
        <div
          role="status"
          aria-live="polite"
          className={`rounded-2xl px-4 py-3 border flex items-center gap-3 text-xs sm:text-sm font-semibold ${
            isConnected
              ? 'bg-emerald-500/10 border-emerald-400/25 text-emerald-200'
              : isConnecting
                ? 'bg-cyan-500/10 border-cyan-400/25 text-cyan-200'
                : connectionState === 'error'
                  ? 'bg-rose-500/10 border-rose-400/25 text-rose-200'
                  : 'bg-white/[0.03] border-white/10 text-slate-300'
          }`}
        >
          <span
            aria-hidden="true"
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              isConnected
                ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]'
                : isConnecting
                  ? 'bg-cyan-400 animate-pulse'
                  : connectionState === 'error'
                    ? 'bg-rose-400'
                    : 'bg-slate-400'
            }`}
          />
          <span className="truncate">
            {isConnected
              ? 'متصل عبر الشبكة المحلية • P2P Direct'
              : isConnecting
                ? 'جاري إنشاء القناة المباشرة...'
                : connectionState === 'initializing'
                  ? 'جاري تهيئة المعرّف المحلي...'
                  : connectionState === 'error'
                    ? 'تعذر الاتصال بخادم الإشارات'
                    : 'جاهز للاقتران • في انتظار الجهاز الآخر'}
          </span>
        </div>

        {/* Connected Peer Details OR Local QR + Short Code */}
        {isConnected ? (
          <div className="pt-2 border-t border-white/10 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-emerald-500/20 border border-cyan-400/25 flex items-center justify-center text-cyan-200 shrink-0">
                  <DeviceIcon
                    kind={remoteDevice?.kind || 'desktop'}
                    os={remoteDevice?.os}
                    className="w-6 h-6"
                  />
                </div>
                <div className="min-w-0">
                  <div className="text-base font-bold text-slate-50 truncate">
                    {remoteDevice?.name || 'جهاز متصل'}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span>{remoteDevice?.os || 'WebRTC'}</span>
                    <span aria-hidden="true">·</span>
                    <span dir="ltr" className="font-mono-code text-cyan-300">
                      {remotePeerId}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
              <span>جهازك الحالي</span>
              <div className="flex items-center gap-2 text-slate-200 font-medium">
                <DeviceIcon kind={localDevice.kind} os={localDevice.os} className="w-4 h-4 text-cyan-400" />
                <span>{localDevice.name}</span>
                <span aria-hidden="true">·</span>
                <span dir="ltr" className="font-mono-code text-slate-300">
                  {peerId}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Local Device Identity & Edit */}
            <div className="flex items-center justify-between gap-2 pb-4 border-b border-white/10">
              <div className="flex items-center gap-2.5 min-w-0">
                <DeviceIcon
                  kind={localDevice.kind}
                  os={localDevice.os}
                  className="w-4 h-4 text-cyan-400 shrink-0"
                />
                {isEditingName ? (
                  <form onSubmit={handleSaveName} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      maxLength={32}
                      autoFocus
                      className="bg-white/[0.06] border border-cyan-400/40 rounded-lg px-2.5 py-1 text-xs text-slate-100 focus:outline-none w-36"
                    />
                    <button
                      type="submit"
                      className="px-2.5 py-1 rounded-lg bg-cyan-500 text-slate-950 text-xs font-bold cursor-pointer"
                    >
                      حفظ
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-semibold text-slate-200 truncate">
                      {localDevice.name}
                    </span>
                    <span className="text-xs text-slate-400">· {localDevice.os}</span>
                  </div>
                )}
              </div>
              {!isEditingName && (
                <button
                  type="button"
                  onClick={() => {
                    setDraftName(localDevice.name);
                    setIsEditingName(true);
                  }}
                  aria-label="تعديل اسم الجهاز"
                  className="p-2 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-white/[0.06] transition-colors cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Short Device ID Box */}
            <div className="flex items-center justify-between gap-3 bg-[#050811]/70 border border-white/10 rounded-2xl px-4 py-3.5">
              <div className="min-w-0">
                <div className="text-xs text-slate-400 mb-0.5">رمز هذا الجهاز</div>
                <div
                  dir="ltr"
                  className="font-mono-code text-xl sm:text-2xl font-bold tracking-wider text-cyan-300 select-all"
                >
                  {peerId}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyId}
                  className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-slate-100 transition-colors whitespace-nowrap cursor-pointer"
                >
                  {copiedId ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                      <span>تم النسخ</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
                      <span>نسخ الرمز</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Scannable QR Code */}
            <div className="flex flex-col items-center gap-3.5 pt-1">
              <div className="relative group">
                <div className="bg-white p-3.5 rounded-2xl shadow-lg shadow-cyan-950/30">
                  <QRCodeSVG
                    value={pairingUrl}
                    size={168}
                    level="M"
                    bgColor="#FFFFFF"
                    fgColor="#050811"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowLargeQr(true)}
                  aria-label="تكبير رمز QR"
                  className="absolute bottom-2 left-2 p-2 rounded-xl bg-slate-900/90 text-white hover:bg-slate-950 transition-opacity opacity-90 sm:opacity-0 sm:group-hover:opacity-100 cursor-pointer"
                >
                  <Maximize2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <div className="w-full flex flex-col items-center gap-2 text-center">
                <p className="text-xs text-slate-400 leading-relaxed">
                  وجّه كاميرا الهاتف نحو الرمز للاقتران الفوري خلال ثانية واحدة
                </p>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-semibold text-cyan-300 hover:text-cyan-200 hover:bg-cyan-500/10 transition-colors cursor-pointer"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                      <span>تم نسخ رابط الاقتران المباشر</span>
                    </>
                  ) : (
                    <>
                      <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>نسخ رابط الاقتران السريع</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Manual Peer Pairing Box */}
      {!isConnected && (
        <div className="liquid-glass rounded-3xl p-6 flex flex-col gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-50">الاتصال بجهاز آخر</h3>
            <p className="text-xs text-slate-400 mt-1">
              أدخل رمز الجهاز المقابل مثل{' '}
              <span dir="ltr" className="font-mono-code text-slate-200">
                STARK-94X
              </span>{' '}
              أو آخر 3 أحرف فقط
            </p>
          </div>

          <form onSubmit={handleSubmitConnect} className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="text"
              dir="ltr"
              value={targetInput}
              onChange={(e) => {
                setTargetInput(e.target.value);
                if (statusError) onClearError();
              }}
              placeholder="STARK-94X"
              aria-label="رمز الجهاز الآخر"
              className="flex-1 min-h-[44px] bg-[#050811]/80 border border-white/15 focus:border-cyan-400 rounded-xl px-4 py-2.5 text-sm font-mono-code text-slate-100 placeholder:text-slate-500 uppercase focus:outline-none transition-colors"
            />
            <button
              type="submit"
              disabled={!targetInput.trim() || isConnecting || connectionState === 'initializing'}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-gradient-to-l from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 disabled:opacity-45 disabled:pointer-events-none text-slate-950 font-bold text-sm transition-all whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isConnecting ? 'جاري الاتصال...' : 'اقتران'}
            </button>
          </form>

          {statusError && (
            <div
              role="alert"
              className="rounded-xl bg-rose-500/10 border border-rose-400/25 px-3.5 py-2.5 text-xs text-rose-200 flex items-center justify-between gap-2"
            >
              <span>{statusError}</span>
              <button
                type="button"
                onClick={onClearError}
                aria-label="إغلاق التنبيه"
                className="p-1 rounded hover:bg-white/10 text-rose-200 cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Enlarged QR Modal */}
      {showLargeQr && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="رمز QR المكبّر للاقتران"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setShowLargeQr(false)}
        >
          <div
            className="liquid-glass rounded-3xl p-6 max-w-sm w-full flex flex-col items-center gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full flex items-center justify-between">
              <span className="text-sm font-bold text-slate-100">مسح رمز الاقتران</span>
              <button
                type="button"
                onClick={() => setShowLargeQr(false)}
                aria-label="إغلاق"
                className="p-2 rounded-xl hover:bg-white/10 text-slate-300 cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <div className="bg-white p-5 rounded-2xl">
              <QRCodeSVG
                value={pairingUrl}
                size={240}
                level="M"
                bgColor="#FFFFFF"
                fgColor="#050811"
              />
            </div>
            <div dir="ltr" className="font-mono-code text-xl font-bold text-cyan-300">
              {peerId}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
