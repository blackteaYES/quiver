import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  RefreshCw,
  ScrollText,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import type { AppData } from '@/lib/types';
import { cn, formatClock } from '@/lib/utils';

export function MobileStatusSheet({
  open,
  data,
  driftCount,
  refreshing,
  lastChecked,
  onClose,
  onRefresh,
  onOpenAudit,
  onOpenSettings,
}: {
  open: boolean;
  data: AppData;
  driftCount: number;
  refreshing: boolean;
  lastChecked: Date;
  onClose: () => void;
  onRefresh: () => void;
  onOpenAudit: () => void;
  onOpenSettings: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const enabled = data.bindings.filter(
    (binding) => binding.state !== 'orphaned' && binding.state !== 'missing',
  ).length;

  const stats = [
    { label: '技能', value: data.skills.length, tone: 'text-fg' },
    { label: '处生效', value: enabled, tone: 'text-jade' },
    { label: '处修改', value: driftCount, tone: driftCount > 0 ? 'text-amber' : 'text-fg-muted' },
    { label: '个项目', value: data.projects.filter((item) => !item.missing).length, tone: 'text-fg-muted' },
  ];

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[90] bg-overlay backdrop-blur-[3px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="状态与设置"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 34 }}
            className="absolute inset-x-0 bottom-0 rounded-t-[16px] border-t border-hairline bg-raised px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3 shadow-float"
          >
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-hairline-strong" />
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-[16px] font-semibold text-fg">状态与设置</h2>
                <p className="mt-0.5 text-[13px] text-fg-subtle">
                  对账状态、操作日志与路径映射
                </p>
              </div>
              <IconButton label="关闭" onClick={onClose} className="-mr-1 h-9 w-9">
                <X className="h-4 w-4" />
              </IconButton>
            </div>

            <div className="mt-3 flex items-center justify-between rounded-[8px] border border-hairline bg-soft px-3 py-2.5">
              <span className="flex items-center gap-2 text-[14px] text-fg-muted">
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    refreshing
                      ? 'animate-soft-pulse bg-sky'
                      : 'bg-jade shadow-[0_0_7px_rgba(52,211,153,0.55)]',
                  )}
                />
                {refreshing ? '正在对账…' : '对账在线'}
              </span>
              <span className="font-mono text-[13px] text-fg-subtle">
                上次检查 {formatClock(lastChecked)}
              </span>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {stats.map((item) => (
                <div
                  key={item.label}
                  className="flex items-baseline gap-1.5 rounded-[7px] border border-hairline bg-soft px-3 py-2"
                >
                  <span className={cn('font-mono text-[18px] leading-none', item.tone)}>
                    {String(item.value).padStart(2, '0')}
                  </span>
                  <span className="text-[13px] text-fg-subtle">{item.label}</span>
                </div>
              ))}
            </div>

            <div className="mt-3 space-y-1.5">
              <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                className="flex h-11 w-full items-center gap-2.5 rounded-[7px] border border-hairline bg-soft px-3 text-left text-[14px] text-fg-muted transition-colors hover:border-hairline-strong hover:bg-soft-strong disabled:opacity-60"
              >
                <RefreshCw
                  className={cn('h-4 w-4', refreshing && 'animate-spin-slow')}
                  strokeWidth={1.8}
                />
                立即刷新文件状态
              </button>
              <button
                type="button"
                onClick={onOpenAudit}
                className="flex h-11 w-full items-center gap-2.5 rounded-[7px] border border-hairline bg-soft px-3 text-left text-[14px] text-fg-muted transition-colors hover:border-hairline-strong hover:bg-soft-strong"
              >
                <ScrollText className="h-4 w-4" strokeWidth={1.8} />
                操作日志
              </button>
              <button
                type="button"
                onClick={onOpenSettings}
                className="flex h-11 w-full items-center gap-2.5 rounded-[7px] border border-hairline bg-soft px-3 text-left text-[14px] text-fg-muted transition-colors hover:border-hairline-strong hover:bg-soft-strong"
              >
                <Settings2 className="h-4 w-4" strokeWidth={1.8} />
                设置与路径映射
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-2.5 font-mono text-[13px] text-fg-subtle">
              <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.7} />
              本地优先 · 中央库只读
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
