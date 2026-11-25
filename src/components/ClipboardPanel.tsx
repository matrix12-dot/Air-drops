import { useState, FormEvent, KeyboardEvent } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ClipboardPaste,
  Copy,
  ExternalLink,
  Send,
  Trash2,
} from 'lucide-react';
import { ConnectionState, TextDropItem } from '../types/p2p';
import { formatTime, isValidHttpUrl } from '../utils/device';

interface ClipboardPanelProps {
  connectionState: ConnectionState;
  textDrops: TextDropItem[];
  onSendText: (content: string) => boolean;
  onClearTextDrops: () => void;
}

export function ClipboardPanel({
  connectionState,
  textDrops,
  onSendText,
  onClearTextDrops,
}: ClipboardPanelProps) {
  const [draft, setDraft] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isConnected = connectionState === 'connected';

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    const sent = onSendText(draft);
    if (sent) {
      setDraft('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (draft.trim() && isConnected) {
        const sent = onSendText(draft);
        if (sent) setDraft('');
      }
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText) {
        setDraft((prev) => (prev ? `${prev}\n${clipText}` : clipText));
      }
    } catch {
      // Clipboard read permission may be unavailable on some browsers
    }
  };

  const handleCopyItem = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 1800);
    } catch {
      // Ignore copy failure
    }
  };

  return (
    <section
      id="clipboard"
      aria-label="الحافظة الفورية ومشاركة النصوص"
      className="liquid-glass rounded-3xl p-6 flex flex-col gap-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-50">الحافظة الفورية (Text & Link Drop)</h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            أرسل الروابط، الأوامر البرمجية، أو الملاحظات مباشرة إلى الجهاز المقابل بنقرة واحدة
          </p>
        </div>

        {textDrops.length > 0 && (
          <button
            type="button"
            onClick={onClearTextDrops}
            className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl text-xs font-semibold text-slate-300 hover:text-slate-100 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>مسح النصوص</span>
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <textarea
          dir="auto"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="اكتب رابطاً، أمراً، أو نصاً لمشاركته فوراً... (Ctrl + Enter للإرسال)"
          aria-label="نص أو رابط للإرسال"
          className="w-full rounded-2xl bg-[#050811]/80 border border-white/15 focus:border-cyan-400 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 resize-y min-h-[92px] focus:outline-none transition-colors"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handlePasteFromClipboard}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-semibold text-slate-300 hover:text-cyan-300 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-colors cursor-pointer"
          >
            <ClipboardPaste className="w-3.5 h-3.5" aria-hidden="true" />
            <span>لصق من الحافظة</span>
          </button>

          <button
            type="submit"
            disabled={!draft.trim() || !isConnected}
            className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[42px] rounded-xl bg-gradient-to-l from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 disabled:opacity-45 disabled:pointer-events-none text-slate-950 text-sm font-bold transition-all cursor-pointer"
          >
            <Send className="w-4 h-4" aria-hidden="true" />
            <span>{isConnected ? 'إرسال النص' : 'بانتظار الاقتران'}</span>
          </button>
        </div>
      </form>

      {textDrops.length > 0 ? (
        <div className="flex flex-col divide-y divide-white/10 border-t border-white/10">
          {textDrops.map((item) => {
            const isSend = item.direction === 'send';
            const isUrl = isValidHttpUrl(item.content);
            const isCopied = copiedId === item.id;

            return (
              <div key={item.id} className="py-4 first:pt-4 last:pb-1 flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-300">
                      {isSend ? (
                        <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
                      ) : (
                        <ArrowDownLeft
                          className="w-3.5 h-3.5 text-emerald-400"
                          aria-hidden="true"
                        />
                      )}
                      {isSend ? 'مُرسل' : 'مُستلم'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{formatTime(item.timestamp)}</span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isUrl && (
                      <a
                        href={item.content.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-3 py-1.5 min-h-[36px] rounded-xl text-xs font-semibold text-cyan-300 hover:text-cyan-200 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-400/20 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>فتح الرابط</span>
                      </a>
                    )}

                    <button
                      type="button"
                      onClick={() => handleCopyItem(item.id, item.content)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-xl text-xs font-semibold text-slate-100 bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 transition-colors cursor-pointer"
                    >
                      {isCopied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                          <span className="text-emerald-300">تم النسخ</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
                          <span>نسخ</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <pre
                  dir="auto"
                  className="font-sans text-sm text-slate-100 whitespace-pre-wrap break-words bg-[#050811]/60 border border-white/10 rounded-2xl px-4 py-3 leading-relaxed select-all"
                >
                  {item.content}
                </pre>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="pt-2 border-t border-white/10 text-center py-4">
          <p className="text-sm text-slate-400">
            لا توجد نصوص مشاركة بعد. ستظهر الروابط والملاحظات الواردة هنا لنسخها بضغطة واحدة.
          </p>
        </div>
      )}
    </section>
  );
}
