import { useRef, useState, DragEvent, ChangeEvent } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Download,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
  FolderUp,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import { ConnectionState, FileTransferItem } from '../types/p2p';
import { formatBytes, formatSpeed, formatTime } from '../utils/device';

interface FileTransferPanelProps {
  connectionState: ConnectionState;
  transfers: FileTransferItem[];
  onSendFiles: (files: FileList | File[]) => void;
  onClearCompleted: () => void;
}

function getFileCategoryIcon(name: string, mimeType: string) {
  const lower = name.toLowerCase();
  if (mimeType.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|heic|avif)$/.test(lower)) {
    return <FileImage className="w-5 h-5 text-cyan-300" aria-hidden="true" />;
  }
  if (mimeType.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi)$/.test(lower)) {
    return <FileVideo className="w-5 h-5 text-emerald-300" aria-hidden="true" />;
  }
  if (mimeType.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac)$/.test(lower)) {
    return <FileAudio className="w-5 h-5 text-sky-300" aria-hidden="true" />;
  }
  if (/\.(zip|rar|7z|tar|gz|apk|ipa|exe|dmg|iso)$/.test(lower)) {
    return <FileArchive className="w-5 h-5 text-amber-300" aria-hidden="true" />;
  }
  if (/\.(js|ts|tsx|jsx|json|py|html|css|sh|yml|yaml|xml)$/.test(lower)) {
    return <FileCode2 className="w-5 h-5 text-cyan-200" aria-hidden="true" />;
  }
  if (mimeType.includes('pdf') || /\.(pdf|docx?|xlsx?|pptx?|txt|md)$/.test(lower)) {
    return <FileText className="w-5 h-5 text-slate-200" aria-hidden="true" />;
  }
  return <FileIcon className="w-5 h-5 text-slate-300" aria-hidden="true" />;
}

function CircularProgress({
  progress,
  status,
}: {
  progress: number;
  status: FileTransferItem['status'];
}) {
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, progress));
  const strokeDashoffset = circumference - (clamped / 100) * circumference;

  if (status === 'completed') {
    return (
      <div className="w-10 h-10 rounded-full bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center shrink-0">
        <CheckCircle2 className="w-5 h-5 text-emerald-400" aria-hidden="true" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="w-10 h-10 rounded-full bg-rose-500/15 border border-rose-400/30 flex items-center justify-center shrink-0">
        <AlertCircle className="w-5 h-5 text-rose-400" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="relative w-10 h-10 flex items-center justify-center shrink-0">
      <svg className="w-10 h-10 -rotate-90" viewBox="0 0 40 40" aria-hidden="true">
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth="3"
        />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="#22d3ee"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="transition-all duration-150"
        />
      </svg>
      <span className="absolute text-[10px] font-mono-code font-bold text-slate-100 tabular-nums">
        {clamped}%
      </span>
    </div>
  );
}

export function FileTransferPanel({
  connectionState,
  transfers,
  onSendFiles,
  onClearCompleted,
}: FileTransferPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const isConnected = connectionState === 'connected';
  const hasCompleted = transfers.some(
    (t) => t.status === 'completed' || t.status === 'error'
  );

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onSendFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onSendFiles(e.target.files);
      e.target.value = '';
    }
  };

  return (
    <section
      id="transfers"
      aria-label="نقل الملفات عالي السرعة"
      className="liquid-glass rounded-3xl p-6 flex flex-col gap-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-50">إرسال واستقبال الملفات</h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            نقل مباشر من جهاز لآخر بحزم 256KB لجميع الصيغ والأحجام الكبيرة بأقصى سرعة للشبكة المحلية
          </p>
        </div>

        {hasCompleted && (
          <button
            type="button"
            onClick={onClearCompleted}
            className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl text-xs font-semibold text-slate-300 hover:text-slate-100 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>مسح السجل</span>
          </button>
        )}
      </div>

      {/* Drag & Drop Target */}
      <div
        role="button"
        tabIndex={0}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className={`rounded-2xl border-2 border-dashed p-7 sm:p-9 text-center transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-cyan-400 ${
          isDragging
            ? 'border-cyan-400 bg-cyan-500/12 scale-[0.995]'
            : isConnected
              ? 'border-white/15 hover:border-cyan-400/60 bg-white/[0.02] hover:bg-cyan-500/[0.04]'
              : 'border-white/10 hover:border-white/25 bg-white/[0.015]'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileChange}
          className="hidden"
          aria-label="اختيار ملفات للإرسال"
        />

        <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-emerald-500/15 border border-cyan-400/25 flex items-center justify-center mb-4">
          <FolderUp className="w-7 h-7 text-cyan-300" aria-hidden="true" />
        </div>

        <p className="text-base font-bold text-slate-100">
          {isDragging
            ? 'أفلت الملفات هنا للبدء فوراً'
            : 'اسحب وأفلت الملفات هنا، أو اضغط للاختيار'}
        </p>

        <p className="text-xs sm:text-sm text-slate-400 mt-1.5">
          يدعم الفيديو، الصور، ملفات APK، الأرشيفات المضغوطة ZIP، وملفات PDF بأي حجم
        </p>

        {!isConnected && (
          <p className="text-xs text-amber-300/90 mt-3 font-medium">
            ملاحظة: يمكنك اختيار الملفات الآن وسيبدأ الإرسال تلقائياً فور اقتران الجهازين
          </p>
        )}
      </div>

      {/* Transfers List */}
      {transfers.length > 0 ? (
        <div className="flex flex-col divide-y divide-white/10 border-t border-white/10">
          {transfers.map((item) => {
            const isSend = item.direction === 'send';
            const isTransferring = item.status === 'transferring';
            const isCompleted = item.status === 'completed';

            return (
              <div
                key={item.id}
                className="py-4 first:pt-4 last:pb-1 flex flex-col gap-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/10 flex items-center justify-center shrink-0">
                      {getFileCategoryIcon(item.name, item.mimeType)}
                    </div>

                    <div className="min-w-0">
                      <div
                        dir="auto"
                        className="text-sm font-semibold text-slate-100 truncate max-w-[200px] sm:max-w-[380px]"
                        title={item.name}
                      >
                        {item.name}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-0.5 tabular-nums">
                        <span className="inline-flex items-center gap-1 text-slate-300">
                          {isSend ? (
                            <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
                          ) : (
                            <ArrowDownLeft
                              className="w-3.5 h-3.5 text-emerald-400"
                              aria-hidden="true"
                            />
                          )}
                          {isSend ? 'إرسال' : 'استقبال'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span dir="ltr" className="font-mono-code">
                          {isTransferring
                            ? `${formatBytes(item.bytesTransferred)} / ${formatBytes(item.size)}`
                            : formatBytes(item.size)}
                        </span>

                        {(isTransferring || (isCompleted && item.speedMBps > 0)) && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span dir="ltr" className="font-mono-code text-cyan-300 font-semibold">
                              {formatSpeed(item.speedMBps)}
                            </span>
                          </>
                        )}

                        <span aria-hidden="true">·</span>
                        <span>{formatTime(item.timestamp)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {!isSend && isCompleted && item.blobUrl && (
                      <a
                        href={item.blobUrl}
                        download={item.name}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/30 text-emerald-200 text-xs font-bold transition-colors whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>حفظ الملف</span>
                      </a>
                    )}

                    <CircularProgress progress={item.progress} status={item.status} />
                  </div>
                </div>

                {/* Linear Progress Bar */}
                {item.status !== 'error' && (
                  <div className="w-full h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-150 ${
                        isCompleted
                          ? 'bg-emerald-400'
                          : item.status === 'queued'
                            ? 'bg-slate-500'
                            : 'bg-gradient-to-l from-cyan-400 to-emerald-400'
                      }`}
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}

                {item.status === 'queued' && (
                  <p className="text-xs text-slate-400">في قائمة الانتظار بانتظار بدء النقل...</p>
                )}

                {item.status === 'error' && (
                  <p className="text-xs text-rose-300">
                    {item.errorMessage || 'تعذر إكمال نقل الملف'}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="pt-2 border-t border-white/10 text-center py-6">
          <p className="text-sm text-slate-400">
            لا توجد عمليات نقل حالية. ستظهر الملفات المرسلة والمستقبلة هنا مع مؤشر السرعة المباشر.
          </p>
        </div>
      )}
    </section>
  );
}
