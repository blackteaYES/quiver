import { Boxes, FolderGit2, Layers, Settings2 } from 'lucide-react';
import type { View } from '@/lib/types';
import { cn } from '@/lib/utils';

const tabs: { key: View | 'status'; label: string; icon: typeof Layers }[] = [
  { key: 'skills', label: '技能库', icon: Layers },
  { key: 'harness', label: 'Harness', icon: Boxes },
  { key: 'projects', label: '项目', icon: FolderGit2 },
  { key: 'status', label: '设置/状态', icon: Settings2 },
];

export function MobileTabBar({
  view,
  statusOpen,
  driftCount,
  onNavigate,
  onOpenStatus,
}: {
  view: View;
  statusOpen: boolean;
  driftCount: number;
  onNavigate: (view: View) => void;
  onOpenStatus: () => void;
}) {
  return (
    <nav
      aria-label="移动端主导航"
      className="flex shrink-0 items-stretch border-t border-hairline bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      {tabs.map((tab) => {
        const active =
          tab.key === 'status' ? statusOpen : !statusOpen && view === tab.key;
        const Icon = tab.icon;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              if (tab.key === 'status') onOpenStatus();
              else onNavigate(tab.key);
            }}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 px-1 py-1.5 text-[12.5px] transition-colors',
              active ? 'text-fg' : 'text-fg-subtle',
            )}
          >
            {active ? (
              <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-fg/70" />
            ) : null}
            <span className="relative">
              <Icon
                className={cn('h-5 w-5', active ? 'text-fg' : 'text-fg-subtle')}
                strokeWidth={1.7}
              />
              {tab.key === 'skills' && driftCount > 0 ? (
                <span className="absolute -right-1.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber shadow-[0_0_6px_rgba(251,191,36,0.6)]" />
              ) : null}
            </span>
            <span className="truncate">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
