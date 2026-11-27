import { useState, FormEvent } from 'react';
import {
  Check,
  Copy,
  Edit3,
  Hash,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Unplug,
  Wifi,
  X,
} from 'lucide-react';
import { ConnectionState, DeviceProfile } from '../types/p2p';
import { normalizePinCode } from '../utils/device';
import { DeviceIcon } from './DeviceIcon';

interface PairingPanelProps {
  pinCode: string;
  localDevice: DeviceProfile;
  connectionState: ConnectionState;
  mqttActive: boolean;
  remoteDevice: DeviceProfile | null;
  statusError: string | null;
  onConnectWithPin: (pin: string) => Promise<void>;
  onCancelConnect: () => void;
  onDisconnect: () => void;
  onRegeneratePin: () => void;
  onRetrySignaling: () => void;
  onUpdateLocalName: (name: string) => void;
  onClearError: () => void;
}

export function PairingPanel({
  pinCode,
  localDevice,
  connectionState,
  mqttActive,
  remoteDevice,
  statusError,
  onConnectWithPin,
  onCancelConnect,
  onDisconnect,
  onRegeneratePin,
  onRetrySignaling,
  onUpdateLocalName,
  onClearError,
}: PairingPanelProps) {
  const [targetPin, setTargetPin] = useState('');
  const [copiedPin, setCopiedPin] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState(localDevice.name);

  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting';
  const isInitializing = connectionState === 'initializing';
  const isError = connectionState === 'error';

  const handleCopyPin = async () => {
    try {
      await navigator.clipboard.writeText(pinCode);
      setCopiedPin(true);
      setTimeout(() => setCopiedPin(false), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleSaveName = (e: FormEvent) => {
    e.preventDefault();
    if (draftName.trim()) {
      onUpdateLocalName(draftName.trim());
    }
    setIsEditingName(false);
  };

  const handleSubmitPin = (e: FormEvent) => {
    e.preventDefault();
    if (targetPin.length !== 4) return;
    void onConnectWithPin(targetPin);
  };

  return (
    <section
      id="pairing"
      aria-label="الاقتران السريع برمز PIN"
      className="flex flex-col gap-6"
    >
      {/* Device PIN Display / Connected Peer Card */}
      <div className="liquid-glass rounded-3xl p-6 flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${
                isConnected
                  ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                  : isConnecting || isInitializing
                    ? 'bg-cyan-500/15 border-cyan-400/30 text-cyan-300'
                    : isError
                      ? 'bg-rose-500/15 border-rose-400/30 text-rose-300'
                      : 'bg-white/[0.05] border-white/10 text-cyan-300'
              }`}
            >
              {isConnected ? (
                <Wifi className="w-5 h-5" aria-hidden="true" />
              ) : isConnecting || isInitializing ? (
                <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
              ) : (
                <Hash className="w-5 h-5" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-50 truncate">
                {isConnected ? 'الجهاز المقترن' : 'رمز غرفتك السريع'}
              </h2>
              <p className="text-xs text-slate-400 truncate">
                {isConnected
                  ? 'نقل محلي فائق السرعة عبر Wi-Fi / Hotspot'
                  : 'اقتران فوري خلال أقل من ثانية برمز من 4 أرقام'}
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

          {!isConnected && isError && (
            <button
              type="button"
              onClick={onRetrySignaling}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl text-xs font-semibold text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-400/25 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>إعادة التهيئة</span>
            </button>
          )}
        </div>

        {/* Live Telemetry Connection Badge */}
        <div
          role="status"
          aria-live="polite"
          className={`rounded-2xl px-4 py-3 border flex items-center justify-between gap-3 text-xs sm:text-sm font-semibold ${
            isConnected
              ? 'bg-emerald-500/10 border-emerald-400/25 text-emerald-200'
              : isConnecting
                ? 'bg-cyan-500/10 border-cyan-400/25 text-cyan-200'
                : isError
                  ? 'bg-rose-500/10 border-rose-400/25 text-rose-200'
                  : 'bg-white/[0.03] border-white/10 text-slate-300'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span
              aria-hidden="true"
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                isConnected
                  ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]'
                  : isConnecting || isInitializing
                    ? 'bg-cyan-400 animate-pulse'
                    : isError
                      ? 'bg-rose-400'
                      : 'bg-cyan-400'
              }`}
            />
            <span className="truncate">
              {isConnected
                ? 'متصل عبر الشبكة المحلية • P2P Direct'
                : isConnecting
                  ? 'جاري تبادل الإشارة وفتح قناة LAN...'
                  : isInitializing
                    ? 'جاري فتح الغرفة السريعة...'
                    : isError
                      ? 'تعذر فتح غرفة الإشارة'
                      : 'الغرفة جاهزة • في انتظار الجهاز الآخر'}
            </span>
          </div>

          {isConnecting && (
            <button
              type="button"
              onClick={onCancelConnect}
              className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-slate-100 shrink-0 cursor-pointer"
            >
              إلغاء
            </button>
          )}
        </div>

        {/* Connected View vs Local PIN View */}
        {isConnected ? (
          <div className="pt-1 flex flex-col gap-4">
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
                <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                  <span>{remoteDevice?.os || 'WebRTC LAN'}</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-emerald-300 font-medium">
                    <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                    {mqttActive ? 'تأمين الاتصال...' : '100% نقل محلي مباشر'}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
              <span>جهازك الحالي</span>
              <div className="flex items-center gap-2 text-slate-200 font-medium">
                <DeviceIcon
                  kind={localDevice.kind}
                  os={localDevice.os}
                  className="w-4 h-4 text-cyan-400"
                />
                <span>{localDevice.name}</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Local Device Name Bar */}
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

            {/* Clean 4-Digit Numeric PIN Display */}
            <div className="rounded-2xl bg-[#050811]/80 border border-white/10 p-5 flex flex-col items-center gap-4">
              <div className="text-xs text-slate-400 font-medium">
                رمز PIN الخاص بهذا الجهاز
              </div>

              <div
                dir="ltr"
                className="font-mono-code text-4xl sm:text-5xl font-bold tracking-[0.28em] text-cyan-300 select-all pl-[0.28em]"
              >
                {pinCode}
              </div>

              <div className="flex items-center gap-2 w-full justify-center">
                <button
                  type="button"
                  onClick={() => void handleCopyPin()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-slate-100 transition-colors cursor-pointer"
                >
                  {copiedPin ? (
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

                <button
                  type="button"
                  onClick={onRegeneratePin}
                  disabled={isConnecting}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-xl bg-white/[0.04] hover:bg-white/[0.09] disabled:opacity-45 border border-white/10 text-xs font-semibold text-slate-300 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>رمز جديد</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Device B: 4-Digit PIN Input Box */}
      {!isConnected && (
        <div className="liquid-glass rounded-3xl p-6 flex flex-col gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-50">الاتصال بجهاز آخر</h3>
            <p className="text-xs text-slate-400 mt-1">
              أدخل رمز PIN المكوّن من 4 أرقام الظاهر على الجهاز الآخر واضغط اتصال
            </p>
          </div>

          <form onSubmit={handleSubmitPin} className="flex flex-col gap-3">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={4}
              value={targetPin}
              onChange={(e) => {
                setTargetPin(normalizePinCode(e.target.value));
                if (statusError) onClearError();
              }}
              placeholder="0000"
              aria-label="أدخل رمز PIN من 4 أرقام"
              className="w-full min-h-[60px] bg-[#050811]/85 border border-white/15 focus:border-cyan-400 rounded-2xl px-4 py-3 text-center text-3xl font-mono-code font-bold tracking-[0.4em] pl-[0.4em] text-slate-50 placeholder:text-slate-600 focus:outline-none transition-colors"
            />

            <button
              type="submit"
              disabled={targetPin.length !== 4 || isConnecting}
              className="w-full min-h-[46px] px-5 py-2.5 rounded-2xl bg-gradient-to-l from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 disabled:opacity-45 disabled:pointer-events-none text-slate-950 font-bold text-sm sm:text-base transition-all cursor-pointer"
            >
              {isConnecting ? 'جاري الاقتران...' : 'اتصال'}
            </button>
          </form>

          {statusError && (
            <div
              role="alert"
              className="rounded-xl bg-rose-500/10 border border-rose-400/25 px-3.5 py-2.5 text-xs text-rose-200 flex items-start justify-between gap-2 leading-relaxed"
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
    </section>
  );
}
