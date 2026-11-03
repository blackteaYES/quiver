import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, ArrowUpRight, GitFork } from 'lucide-react';
import type { Binding, Skill } from '@/lib/types';
import { cn, shortSha } from '@/lib/utils';

const diffTone = {
  M: 'text-amber',
  A: 'text-jade',
  D: 'text-rose',
} as const;

export function VersionPill({
  binding,
  skill,
  align = 'left',
  className,
}: {
  binding: Binding;
  skill?: Skill;
  align?: 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const isDrift = binding.state === 'drifted' && !binding.ignoredDrift;
  const isIgnored = binding.ignoredDrift;
  const hasUpdate = Boolean(binding.updateAvailable);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const enter = (pointerType?: string) => {
    if (pointerType && pointerType !== 'mouse') return;
    if (timer.current) window.clearTimeout(timer.current);
    if (isDrift) setOpen(true);
  };

  const leave = (pointerType?: string) => {
    if (pointerType && pointerType !== 'mouse') return;
    if (!isDrift) return;
    timer.current = window.setTimeout(() => setOpen(false), 140);
  };

  if (!isDrift) {
    return (
      <span
        title={
          isIgnored
            ? '本地存在分叉，已按你的选择忽略提醒'
            : hasUpdate
              ? `技能库有更新版本 @${shortSha(binding.updateAvailable!)}`
              : undefined
        }
        className={cn(
          'mono-pill',
          isIgnored && 'text-fg-faint',
          hasUpdate && 'text-sky/90',
          className,
        )}
      >
        {isIgnored ? <GitFork className="h-2.5 w-2.5" /> : null}
        @{shortSha(binding.resolvedSha)}
        {hasUpdate ? <ArrowUpRight className="h-2.5 w-2.5" /> : null}
      </span>
    );
  }

  return (
    <span
      className={cn('relative inline-flex', className)}
      onPointerEnter={(event) => enter(event.pointerType)}
      onPointerLeave={(event) => leave(event.pointerType)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-describedby={open ? `drift-${binding.id}` : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) enter();
        }}
        onBlur={() => leave()}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-[4px] border border-amber/[0.2] bg-amber/[0.06] px-2.5 py-1 font-mono text-[13px] leading-none text-amber transition-colors hover:border-amber/35 hover:bg-amber/[0.1] max-sm:min-h-10"
      >
        <span className="text-amber/70">@{shortSha(binding.resolvedSha)}</span>
        <ArrowRight className="h-2.5 w-2.5 text-amber/60" strokeWidth={2} />
        <span>@{shortSha(binding.currentSha ?? binding.resolvedSha)}</span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            id={`drift-${binding.id}`}
            role="tooltip"
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -3, scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className={cn(
              'absolute top-[calc(100%+9px)] z-50 w-[282px] max-w-[calc(100vw-24px)] origin-top rounded-[9px] border border-hairline bg-raised p-3 text-left shadow-float',
              align === 'left' ? 'left-0' : 'right-0',
            )}
          >
            <span
              className={cn(
                'pointer-events-none absolute -top-[4px] h-2 w-2 rotate-45 rounded-[1px] border-l border-t border-hairline bg-raised',
                align === 'left' ? 'left-5' : 'right-5',
              )}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[14px] font-medium text-fg">
                <span className="h-1.5 w-1.5 rounded-full bg-amber shadow-[0_0_7px_rgba(251,191,36,0.55)]" />
                本地存在修改
              </span>
              <span className="font-mono text-[13px] text-fg-faint">
                {binding.driftFiles?.length ?? 0} 个文件
              </span>
            </div>

            <div className="mt-2.5 flex items-center gap-1.5 font-mono text-[13px]">
              <span className="rounded-[4px] border border-hairline bg-soft px-1.5 py-[2px] text-fg-subtle">
                @{shortSha(binding.resolvedSha)}
              </span>
              <ArrowRight className="h-2.5 w-2.5 text-fg-faint" />
              <span className="rounded-[4px] border border-amber/[0.18] bg-amber/[0.05] px-1.5 py-[2px] text-amber/90">
                @{shortSha(binding.currentSha ?? binding.resolvedSha)}
              </span>
              <span className="ml-auto text-fg-faint">基准版本</span>
            </div>

            <div className="my-2.5 h-px bg-hairline" />

            <ul className="space-y-1.5">
              {(binding.driftFiles ?? []).map((file) => (
                <li
                  key={`${file.status}-${file.path}`}
                  className="flex items-center gap-2 font-mono text-[13px] leading-none"
                >
                  <span
                    className={cn(
                      'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border border-hairline bg-soft text-[13px] font-medium',
                      diffTone[file.status],
                    )}
                  >
                    {file.status}
                  </span>
                  <span className="truncate text-fg-muted">{file.path}</span>
                </li>
              ))}
            </ul>

            <p className="mt-2.5 border-t border-hairline pt-2 text-[13px] leading-relaxed text-fg-faint">
              目标目录已偏离部署锚点。请在下方检查重置、收编或忽略。
            </p>

            {skill ? (
              <div className="mt-2 flex items-center justify-between font-mono text-[13px] text-fg-faint">
                <span className="truncate">{skill.slug}</span>
                <span>源库只读</span>
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </span>
  );
}
