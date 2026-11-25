import { useState, FormEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Camera,
  Check,
  ChevronDown,
  Copy,
  Edit3,
  Loader2,
  Maximize2,
  QrCode,
  RotateCcw,
  ScanLine,
  Unplug,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import { ConnectionState, DeviceProfile } from '../types/p2p';
import { SignalKind } from '../utils/sdpCodec';
import { DeviceIcon } from './DeviceIcon';
import { QrScannerModal } from './QrScannerModal';

interface PairingPanelProps {
  localDevice: DeviceProfile;
  connectionState: ConnectionState;
  offerToken: string;
  answerToken: string;
  remoteDevice: DeviceProfile | null;
  statusError: string | null;
  onCreateOffer: () => void;
  onAcceptOffer: (token: string) => Promise<boolean>;
  onCompleteHandshake: (token: string) => Promise<boolean>;
  onResetPairing: () => void;
  onUpdateLocalName: (name: string) => void;
  onClearError: () => void;
}

export function PairingPanel({
  localDevice,
  connectionState,
  offerToken,
  answerToken,
  remoteDevice,
  statusError,
  onCreateOffer,
  onAcceptOffer,
  onCompleteHandshake,
  onResetPairing,
  onUpdateLocalName,
  onClearError,
}: PairingPanelProps) {
  const [scannerMode, setScannerMode] = useState<SignalKind | null>(null);
  const [manualOfferInput, setManualOfferInput] = useState('');
  const [manualAnswerInput, setManualAnswerInput] = useState('');
  const [showManualOfferBox, setShowManualOfferBox] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState(localDevice.name);
  const [largeQrValue, setLargeQrValue] = useState<{ title: string; value: string } | null>(null);

  const isConnected = connectionState === 'connected';
  const isHostAwaiting = connectionState === 'awaiting-answer' || connectionState === 'connecting';
  const isGuestReady = connectionState === 'guest-ready';
  const isConnecting = connectionState === 'connecting';

  const handleCopyToken = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 1800);
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

  const handleManualOfferSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!manualOfferInput.trim()) return;
    const ok = await onAcceptOffer(manualOfferInput);
    if (ok) {
      setManualOfferInput('');
      setShowManualOfferBox(false);
    }
  };

  const handleManualAnswerSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!manualAnswerInput.trim()) return;
    const ok = await onCompleteHandshake(manualAnswerInput);
    if (ok) {
      setManualAnswerInput('');
    }
  };

  const handleScanDecoded = async (rawToken: string) => {
    const mode = scannerMode;
    setScannerMode(null);
    if (mode === 'offer') {
      await onAcceptOffer(rawToken);
    } else if (mode === 'answer') {
      await onCompleteHandshake(rawToken);
    }
  };

  return (
    <section
      id="pairing"
      aria-label="الاقتران المباشر عبر الشبكة المحلية"
      className="flex flex-col gap-6"
    >
      <div className="liquid-glass rounded-3xl p-6 flex flex-col gap-5">
        {/* Panel Header */}
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
                {isConnected
                  ? 'الجهاز المقترن'
                  : isHostAwaiting
                    ? 'الخطوة 1: امسح الرمز من الجهاز الثاني'
                    : isGuestReady
                      ? 'الخطوة 2: وجّه هذا الرمز للجهاز الأول'
                      : 'الاقتران المباشر (Offline LAN)'}
              </h2>
              <p className="text-xs text-slate-400 truncate">
                {isConnected
                  ? 'نقل محلي فائق السرعة عبر Wi-Fi / Hotspot'
                  : 'اتصال WebRTC محلي 100% بدون إنترنت أو خوادم'}
              </p>
            </div>
          </div>

          {isConnected ? (
            <button
              type="button"
              onClick={onResetPairing}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl text-xs font-semibold text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-400/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Unplug className="w-3.5 h-3.5" aria-hidden="true" />
              <span>قطع الاتصال</span>
            </button>
          ) : (isHostAwaiting || isGuestReady) ? (
            <button
              type="button"
              onClick={onResetPairing}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl text-xs font-semibold text-slate-300 bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>إلغاء</span>
            </button>
          ) : null}
        </div>

        {/* Live Connection Status Badge */}
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
                    : isHostAwaiting || isGuestReady
                      ? 'bg-cyan-400'
                      : 'bg-slate-400'
            }`}
          />
          <span className="truncate">
            {isConnected
              ? 'متصل عبر الشبكة المحلية • P2P Direct'
              : isConnecting
                ? 'جاري فتح قناة البيانات المحلية...'
                : isHostAwaiting
                  ? 'بانتظار مسح رمز الاستجابة من الجهاز الثاني'
                  : isGuestReady
                    ? 'رمز الاستجابة جاهز • امسحه من الجهاز الأول'
                    : 'جاهز • لا يتطلب إنترنت أو خادم وسيط'}
          </span>
        </div>

        {/* Local Device Name Bar */}
        {!isConnected && (
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
        )}

        {/* STATE 1: CONNECTED */}
        {isConnected && (
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
                  <span className="text-emerald-300 font-medium">قناة محلية مباشرة</span>
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
        )}

        {/* STATE 2: IDLE — Choose Host or Guest */}
        {(connectionState === 'idle' || connectionState === 'error') && (
          <div className="flex flex-col gap-3.5">
            <button
              type="button"
              onClick={() => void onCreateOffer()}
              className="w-full min-h-[48px] px-5 py-3 rounded-2xl bg-gradient-to-l from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 transition-all cursor-pointer shadow-lg shadow-cyan-950/40"
            >
              <Zap className="w-4 h-4" aria-hidden="true" />
              <span>إنشاء اتصال سريع</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onClearError();
                setScannerMode('offer');
              }}
              className="w-full min-h-[48px] px-5 py-3 rounded-2xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/15 text-slate-100 font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 transition-colors cursor-pointer"
            >
              <Camera className="w-4 h-4 text-cyan-300" aria-hidden="true" />
              <span>مسح QR والانضمام</span>
            </button>

            {/* Fallback text paste for devices without a camera */}
            <div className="pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowManualOfferBox((v) => !v)}
                aria-expanded={showManualOfferBox}
                className="w-full flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 py-1 transition-colors cursor-pointer"
              >
                <span>أو لصق رمز العرض يدوياً (بدون كاميرا)</span>
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${showManualOfferBox ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>

              {showManualOfferBox && (
                <form onSubmit={handleManualOfferSubmit} className="mt-2.5 flex flex-col gap-2">
                  <input
                    type="text"
                    dir="ltr"
                    value={manualOfferInput}
                    onChange={(e) => {
                      setManualOfferInput(e.target.value);
                      if (statusError) onClearError();
                    }}
                    placeholder="SO1:..."
                    aria-label="لصق رمز العرض"
                    className="w-full min-h-[42px] bg-[#050811]/80 border border-white/15 focus:border-cyan-400 rounded-xl px-3.5 py-2 text-xs font-mono-code text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!manualOfferInput.trim()}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 disabled:opacity-45 border border-cyan-400/30 text-cyan-200 text-xs font-bold cursor-pointer"
                  >
                    توليد رمز الاستجابة
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        {/* STATE 3: HOST — Display Offer QR + Scan/Paste Answer */}
        {isHostAwaiting && offerToken && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col items-center gap-3">
              <div className="relative group">
                <div className="bg-white p-3.5 rounded-2xl shadow-lg shadow-cyan-950/30">
                  <QRCodeSVG
                    value={offerToken}
                    size={196}
                    level="L"
                    bgColor="#FFFFFF"
                    fgColor="#050811"
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setLargeQrValue({
                      title: 'رمز العرض (امسحه من الجهاز الثاني)',
                      value: offerToken,
                    })
                  }
                  aria-label="تكبير رمز QR"
                  className="absolute bottom-2 left-2 p-2 rounded-xl bg-slate-900/90 text-white hover:bg-slate-950 transition-opacity opacity-90 sm:opacity-0 sm:group-hover:opacity-100 cursor-pointer"
                >
                  <Maximize2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => void handleCopyToken(offerToken)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-cyan-300 hover:bg-cyan-500/10 transition-colors cursor-pointer"
              >
                {copiedToken ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                    <span>تم نسخ رمز العرض</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>نسخ رمز العرض النصي</span>
                  </>
                )}
              </button>
            </div>

            <div className="pt-4 border-t border-white/10 flex flex-col gap-3">
              <p className="text-xs text-slate-300 font-semibold">
                بعد ظهور الرمز الجديد على الجهاز الثاني، امسحه لإتمام القفل المباشر:
              </p>

              <button
                type="button"
                onClick={() => {
                  onClearError();
                  setScannerMode('answer');
                }}
                disabled={isConnecting}
                className="w-full min-h-[46px] px-4 py-2.5 rounded-2xl bg-gradient-to-l from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 disabled:opacity-50 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <ScanLine className="w-4 h-4" aria-hidden="true" />
                <span>مسح QR الاستجابة بالكاميرا</span>
              </button>

              <form onSubmit={handleManualAnswerSubmit} className="flex gap-2">
                <input
                  type="text"
                  dir="ltr"
                  value={manualAnswerInput}
                  onChange={(e) => {
                    setManualAnswerInput(e.target.value);
                    if (statusError) onClearError();
                  }}
                  placeholder="أو الصق SA1:..."
                  aria-label="لصق رمز الاستجابة"
                  className="flex-1 min-h-[42px] bg-[#050811]/80 border border-white/15 focus:border-cyan-400 rounded-xl px-3.5 py-2 text-xs font-mono-code text-slate-100 placeholder:text-slate-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!manualAnswerInput.trim() || isConnecting}
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] disabled:opacity-45 text-xs font-bold text-slate-100 whitespace-nowrap cursor-pointer"
                >
                  ربط
                </button>
              </form>
            </div>
          </div>
        )}

        {/* STATE 4: GUEST — Display Answer QR for Host to scan */}
        {isGuestReady && answerToken && (
          <div className="flex flex-col items-center gap-4">
            <div className="relative group">
              <div className="bg-white p-3.5 rounded-2xl shadow-lg shadow-emerald-950/30">
                <QRCodeSVG
                  value={answerToken}
                  size={204}
                  level="L"
                  bgColor="#FFFFFF"
                  fgColor="#050811"
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  setLargeQrValue({
                    title: 'رمز الاستجابة (امسحه من الجهاز الأول)',
                    value: answerToken,
                  })
                }
                aria-label="تكبير رمز QR"
                className="absolute bottom-2 left-2 p-2 rounded-xl bg-slate-900/90 text-white hover:bg-slate-950 transition-opacity opacity-90 sm:opacity-0 sm:group-hover:opacity-100 cursor-pointer"
              >
                <Maximize2 className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <p className="text-xs text-slate-300 text-center leading-relaxed">
              وجّه كاميرا الجهاز الأول نحو هذا الرمز لإتمام الاتصال فوراً عبر الشبكة المحلية
            </p>

            <button
              type="button"
              onClick={() => void handleCopyToken(answerToken)}
              className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-cyan-300 transition-colors cursor-pointer"
            >
              {copiedToken ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                  <span>تم نسخ رمز الاستجابة</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>نسخ رمز الاستجابة النصي</span>
                </>
              )}
            </button>
          </div>
        )}

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

      {/* Built-in HTML5 Camera QR Scanner */}
      {scannerMode && (
        <QrScannerModal
          expectedKind={scannerMode}
          title={
            scannerMode === 'offer'
              ? 'مسح رمز الاتصال (الجهاز الأول)'
              : 'مسح رمز الاستجابة (الجهاز الثاني)'
          }
          subtitle={
            scannerMode === 'offer'
              ? 'وجّه الكاميرا نحو رمز QR على شاشة المرسل'
              : 'وجّه الكاميرا نحو رمز الاستجابة لإتمام القفل'
          }
          onDecoded={(token) => void handleScanDecoded(token)}
          onClose={() => setScannerMode(null)}
        />
      )}

      {/* Enlarged QR Modal */}
      {largeQrValue && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={largeQrValue.title}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setLargeQrValue(null)}
        >
          <div
            className="liquid-glass rounded-3xl p-6 max-w-sm w-full flex flex-col items-center gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-slate-100 truncate">
                {largeQrValue.title}
              </span>
              <button
                type="button"
                onClick={() => setLargeQrValue(null)}
                aria-label="إغلاق"
                className="p-2 rounded-xl hover:bg-white/10 text-slate-300 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <div className="bg-white p-5 rounded-2xl">
              <QRCodeSVG
                value={largeQrValue.value}
                size={250}
                level="L"
                bgColor="#FFFFFF"
                fgColor="#050811"
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
