import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const tones = {
  neutral: 'border-hairline bg-soft text-fg-muted',
  outline: 'border-hairline bg-transparent text-fg-subtle',
  jade: 'border-jade/20 bg-jade/[0.07] text-jade',
  amber: 'border-amber/20 bg-amber/[0.07] text-amber',
  rose: 'border-rose/20 bg-rose/[0.07] text-rose',
  sky: 'border-sky/20 bg-sky/[0.07] text-sky',
  violet: 'border-violet/20 bg-violet/[0.07] text-violet',
  muted: 'border-hairline bg-soft text-fg-subtle',
} as const;

export type PillTone = keyof typeof tones;

interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
  mono?: boolean;
}

export function Pill({ className, tone = 'neutral', mono = false, children, ...props }: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-[4px] border px-2.5 py-1 text-[13px] leading-none',
        tones[tone],
        mono && 'font-mono tracking-tight',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
