import { useEffect, useId, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, SwitchCamera, X } from 'lucide-react';
import { decodeSignalToken, SignalKind } from '../utils/sdpCodec';

interface QrScannerModalProps {
  expectedKind: SignalKind;
  title: string;
  subtitle: string;
  onDecoded: (rawToken: string) => void;
  onClose: () => void;
}

export function QrScannerModal({
  expectedKind,
  title,
  subtitle,
  onDecoded,
  onClose,
}: QrScannerModalProps) {
  const rawId = useId();
  const regionId = `qr-reader-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanWarning, setScanWarning] = useState<string | null>(null);
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [activeCameraIdx, setActiveCameraIdx] = useState<number>(0);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const handledRef = useRef<boolean>(false);

  useEffect(() => {
    let mounted = true;
    handledRef.current = false;

    const scanner = new Html5Qrcode(regionId, { verbose: false });
    scannerRef.current = scanner;

    const handleSuccess = (decodedText: string) => {
      if (!mounted || handledRef.current) return;

      const parsed = decodeSignalToken(decodedText);
      if (!parsed) {
        setScanWarning('هذا الرمز لا يخص Stark AirDrop. وجّه الكاميرا إلى رمز الاتصال الصحيح.');
        return;
      }
      if (parsed.kind !== expectedKind) {
        setScanWarning(
          expectedKind === 'offer'
            ? 'هذا رمز استجابة (Answer). يرجى مسح رمز العرض من الجهاز الأول.'
            : 'هذا رمز العرض نفسه. امسح رمز الاستجابة الجديد من شاشة الجهاز الثاني.'
        );
        return;
      }

      handledRef.current = true;
      setScanWarning(null);
      scanner
        .stop()
        .catch(() => {})
        .finally(() => {
          try {
            scanner.clear();
          } catch {
            // Ignore
          }
          if (mounted) {
            onDecoded(decodedText);
          }
        });
    };

    const startScanner = async () => {
      setCameraError(null);
      const scanConfig = {
        fps: 15,
        qrbox: { width: 240, height: 240 },
        aspectRatio: 1.0,
      };

      try {
        const availableCameras = await Html5Qrcode.getCameras();
        if (!mounted) return;
        setCameras(availableCameras);

        if (availableCameras.length > 0 && activeCameraIdx > 0 && availableCameras[activeCameraIdx]) {
          await scanner.start(
            availableCameras[activeCameraIdx].id,
            scanConfig,
            handleSuccess,
            () => {}
          );
          return;
        }

        try {
          await scanner.start(
            { facingMode: 'environment' },
            scanConfig,
            handleSuccess,
            () => {}
          );
        } catch {
          if (availableCameras.length > 0) {
            await scanner.start(availableCameras[0].id, scanConfig, handleSuccess, () => {});
          } else {
            throw new Error('NO_CAMERA');
          }
        }
      } catch {
        if (!mounted) return;
        setCameraError(
          'تعذر تشغيل الكاميرا. تأكد من السماح للمتصفح بالوصول إلى الكاميرا، أو أغلق النافذة واستخدم خيار لصق الرمز النصي.'
        );
      }
    };

    void startScanner();

    return () => {
      mounted = false;
      const activeScanner = scannerRef.current;
      if (activeScanner) {
        activeScanner
          .stop()
          .catch(() => {})
          .finally(() => {
            try {
              activeScanner.clear();
            } catch {
              // Ignore
            }
          });
      }
    };
  }, [activeCameraIdx, expectedKind, onDecoded, regionId]);

  const handleSwitchCamera = () => {
    if (cameras.length < 2) return;
    setActiveCameraIdx((prev) => (prev + 1) % cameras.length);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="liquid-glass rounded-3xl p-5 sm:p-6 max-w-md w-full flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center text-cyan-300 shrink-0">
              <Camera className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-slate-50 truncate">{title}</h3>
              <p className="text-xs text-slate-400 truncate">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {cameras.length > 1 && (
              <button
                type="button"
                onClick={handleSwitchCamera}
                aria-label="تبديل الكاميرا"
                className="p-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 transition-colors cursor-pointer"
              >
                <SwitchCamera className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق الماسح"
              className="p-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {cameraError ? (
          <div className="rounded-2xl bg-rose-500/10 border border-rose-400/25 p-5 text-center flex flex-col gap-3">
            <p className="text-xs sm:text-sm text-rose-200 leading-relaxed">{cameraError}</p>
            <button
              type="button"
              onClick={onClose}
              className="mx-auto px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-slate-100 cursor-pointer"
            >
              العودة واستخدام الرمز النصي
            </button>
          </div>
        ) : (
          <div className="relative rounded-2xl overflow-hidden bg-black border border-white/15">
            <div id={regionId} className="w-full min-h-[280px]" />
          </div>
        )}

        {scanWarning && (
          <div
            role="alert"
            className="rounded-xl bg-amber-500/10 border border-amber-400/25 px-3.5 py-2.5 text-xs text-amber-200 text-center"
          >
            {scanWarning}
          </div>
        )}

        <p className="text-xs text-slate-400 text-center">
          قرّب الكاميرا من شاشة الجهاز الآخر ليتم المسح تلقائياً بدون اتصال بالإنترنت
        </p>
      </div>
    </div>
  );
}
