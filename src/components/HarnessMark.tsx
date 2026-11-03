import {
  Asterisk,
  Bot,
  Boxes,
  Layers,
  MousePointer2,
  Orbit,
  SquareTerminal,
  Wind,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { HarnessId } from '@/lib/types';
import { cn } from '@/lib/utils';

type MarkIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

const marks: Record<string, MarkIcon> = {
  'claude-code': Asterisk,
  codex: SquareTerminal,
  cursor: MousePointer2,
  windsurf: Wind,
  cline: Bot,
  antigravity: Orbit,
};

export function HarnessMark({
  harnessId,
  size = 'sm',
  className,
}: {
  harnessId: HarnessId;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}) {
  const Icon = marks[harnessId] ?? Boxes;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[5px] border border-hairline bg-soft text-fg-muted shadow-inset-top',
        size === 'xs' && 'h-4 w-4 rounded-[4px]',
        size === 'sm' && 'h-5 w-5',
        size === 'md' && 'h-7 w-7 rounded-[6px]',
        className,
      )}
    >
      <Icon
        className={cn(
          size === 'xs' ? 'h-2.5 w-2.5' : size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5',
        )}
        strokeWidth={1.7}
      />
    </span>
  );
}

export function SkillGlyph({ slug, className }: { slug: string; className?: string }) {
  return (
    <span
      title={slug}
      aria-hidden="true"
      className={cn(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-hairline bg-soft text-fg-subtle shadow-inset-top',
        className,
      )}
    >
      <Layers className="h-1/2 w-1/2" strokeWidth={1.6} />
    </span>
  );
}
