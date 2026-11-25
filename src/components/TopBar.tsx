import { Volume2, VolumeX } from 'lucide-react';

interface TopBarProps {
  soundEnabled: boolean;
  onToggleSound: () => void;
}

export function TopBar({ soundEnabled, onToggleSound }: TopBarProps) {
  return (
    <header className="w-full border-b border-white/10 bg-[#050811]/80 backdrop-blur-xl sticky top-0 z-30">
      <div className="max-w-[1240px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <a
          href="#top"
          className="text-lg sm:text-xl font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0 flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-cyan-400 rounded-md"
        >
          <span>Stark AirDrop</span>
          <span className="text-cyan-400 font-semibold" aria-hidden="true">
            |
          </span>
          <span className="text-slate-200 font-semibold">جسر الملفات</span>
        </a>

        {/* Zone 2: Concise single-line navigation links */}
        <nav
          aria-label="أقسام التطبيق"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-300"
        >
          <a
            href="#pairing"
            className="hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0 py-1 border-b border-transparent hover:border-cyan-400/60"
          >
            الاقتران السريع
          </a>
          <a
            href="#transfers"
            className="hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0 py-1 border-b border-transparent hover:border-cyan-400/60"
          >
            نقل الملفات
          </a>
          <a
            href="#clipboard"
            className="hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0 py-1 border-b border-transparent hover:border-cyan-400/60"
          >
            الحافظة الفورية
          </a>
        </nav>

        {/* Zone 3: Single primary utility action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onToggleSound}
            aria-pressed={soundEnabled}
            className="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] rounded-xl text-xs sm:text-sm font-semibold border border-white/10 bg-white/[0.04] hover:bg-white/[0.09] text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            {soundEnabled ? (
              <Volume2 className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
            ) : (
              <VolumeX className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
            )}
            <span>{soundEnabled ? 'الصوت مفعّل' : 'الصوت مكتوم'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
