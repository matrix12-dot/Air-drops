import { useState } from 'react';
import { TopBar } from './components/TopBar';
import { PairingPanel } from './components/PairingPanel';
import { FileTransferPanel } from './components/FileTransferPanel';
import { ClipboardPanel } from './components/ClipboardPanel';
import { useWebRTCBridge } from './hooks/useWebRTCBridge';
import { primeAudioContext } from './utils/sound';

export default function App() {
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return true;
    const saved = localStorage.getItem('stark_sound_enabled');
    return saved === null ? true : saved === 'true';
  });

  const handleToggleSound = () => {
    primeAudioContext();
    setSoundEnabled((prev) => {
      const next = !prev;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('stark_sound_enabled', String(next));
      }
      return next;
    });
  };

  const {
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
  } = useWebRTCBridge(soundEnabled);

  return (
    <div id="top" className="min-h-screen space-backdrop text-slate-100 flex flex-col">
      <TopBar soundEnabled={soundEnabled} onToggleSound={handleToggleSound} />

      <main className="flex-1 max-w-[1240px] w-full mx-auto px-4 sm:px-6 py-8 sm:py-10 flex flex-col gap-8">
        {/* Focused Editorial Header */}
        <section className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-7">
          <div className="max-w-2xl">
            <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-50 leading-tight [text-wrap:balance]">
              جسر الملفات السريع عبر الشبكة المحلية
            </h1>
            <p className="text-sm sm:text-base text-slate-300 mt-2.5 leading-relaxed">
              اقتران فوري عبر QR بكاميرا المتصفح ونقل مباشر للملفات والروابط على شبكة Wi-Fi
              أو Hotspot بأقصى سرعة محلية ودون الحاجة إلى إنترنت أو خوادم وسيطة.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-400 shrink-0">
            <span>اتصال محلي Offline LAN</span>
            <span aria-hidden="true">·</span>
            <span>حزم ثنائية 64KB</span>
            <span aria-hidden="true">·</span>
            <span>بدون خوادم إشارة</span>
          </div>
        </section>

        {/* Primary 2-Column P2P Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-4 lg:sticky lg:top-24">
            <PairingPanel
              localDevice={localDevice}
              connectionState={connectionState}
              offerToken={offerToken}
              answerToken={answerToken}
              remoteDevice={remoteDevice}
              statusError={statusError}
              onCreateOffer={createHostOffer}
              onAcceptOffer={acceptHostOffer}
              onCompleteHandshake={completeHostHandshake}
              onResetPairing={resetPairing}
              onUpdateLocalName={updateLocalDeviceName}
              onClearError={clearError}
            />
          </div>

          <div className="lg:col-span-8 flex flex-col gap-6">
            <FileTransferPanel
              connectionState={connectionState}
              transfers={transfers}
              onSendFiles={sendFiles}
              onClearCompleted={clearCompletedTransfers}
            />

            <ClipboardPanel
              connectionState={connectionState}
              textDrops={textDrops}
              onSendText={sendTextDrop}
              onClearTextDrops={clearTextDrops}
            />
          </div>
        </div>
      </main>

      <footer className="border-t border-white/10 py-6 mt-4">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
          <span>Stark AirDrop | جسر الملفات — WebRTC محلي بدون خوادم</span>
          <span>يعمل محلياً بالكامل داخل المتصفح عبر شبكة Wi-Fi / Hotspot</span>
        </div>
      </footer>
    </div>
  );
}
