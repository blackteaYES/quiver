import type { ComponentType } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

export type SegmentedOption<T extends string | number> = {
  value: T;
  label: string;
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
};

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  layoutId,
  label,
  className,
  stretch = false,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  layoutId: string;
  label: string;
  className?: string;
  stretch?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'flex items-center gap-0.5 rounded-[6px] border border-hairline bg-soft p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              'relative flex h-[22px] select-none items-center justify-center gap-1 rounded-[4px] px-2 text-[13px] transition-colors',
              stretch && 'flex-1',
              active ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted',
            )}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="absolute inset-0 rounded-[4px] border border-hairline bg-soft-strong shadow-inset-top"
              />
            ) : null}
            {Icon ? (
              <Icon className="relative h-3 w-3" strokeWidth={1.8} />
            ) : null}
            <span className="relative whitespace-nowrap">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
