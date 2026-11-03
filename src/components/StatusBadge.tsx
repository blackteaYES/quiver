import { ArrowUpRight, EyeOff } from 'lucide-react';
import type { BindingState } from '@/lib/types';
import { cn } from '@/lib/utils';

type VisualState = BindingState | 'unmanaged';

const states: Record<
  VisualState,
  { label: string; chip: string; dot: string; pulse?: boolean }
> = {
  enabled: {
    label: '已启用',
    chip: 'border-jade/[0.18] bg-jade/[0.06] text-jade',
    dot: 'bg-jade shadow-[0_0_8px_rgba(52,211,153,0.55)]',
  },
  drifted: {
    label: '已修改',
    chip: 'border-amber/[0.2] bg-amber/[0.07] text-amber',
    dot: 'bg-amber shadow-[0_0_8px_rgba(251,191,36,0.5)]',
    pulse: true,
  },
  missing: {
    label: '未找到',
    chip: 'border-rose/[0.2] bg-rose/[0.07] text-rose',
    dot: 'bg-rose shadow-[0_0_8px_rgba(251,113,133,0.45)]',
  },
  orphaned: {
    label: '未找到对应项目',
    chip: 'border-hairline bg-soft text-fg-muted',
    dot: 'bg-fg-faint',
  },
  unmanaged: {
    label: '发现外部技能',
    chip: 'border-violet/[0.18] bg-violet/[0.06] text-violet',
    dot: 'bg-violet shadow-[0_0_8px_rgba(196,181,253,0.4)]',
  },
};

export function StatusBadge({
  state,
  updatable = false,
  ignored = false,
  className,
}: {
  state: VisualState;
  updatable?: boolean;
  ignored?: boolean;
  className?: string;
}) {
  const ignoredFork = ignored && state === 'drifted';
  const config = ignoredFork
    ? {
        label: '保留本地修改',
        chip: 'border-hairline bg-soft text-fg-muted',
        dot: 'bg-fg-faint',
        pulse: false,
      }
    : states[state];

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[4px] border px-2.5 py-1 text-[13px] leading-none',
          config.chip,
        )}
      >
        {ignoredFork ? (
          <EyeOff className="h-2.5 w-2.5" strokeWidth={2} />
        ) : (
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              config.dot,
              config.pulse && 'animate-soft-pulse',
            )}
          />
        )}
        {config.label}
      </span>
      {updatable ? (
        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-[4px] border border-sky/[0.2] bg-sky/[0.06] px-2.5 py-1 text-[13px] leading-none text-sky">
          <ArrowUpRight className="h-2.5 w-2.5" strokeWidth={2} />
          可更新
        </span>
      ) : null}
    </span>
  );
}
