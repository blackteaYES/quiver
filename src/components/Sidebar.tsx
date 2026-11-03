import { useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { motion } from 'motion/react';
import {
  Boxes,
  FolderGit2,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  ScrollText,
  Search,
  Settings2,
} from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { isMac } from '@/lib/desktop';
import { NAV_WIDTH, SCALE_OPTIONS } from '@/lib/preferences';
import type { UiScale } from '@/lib/preferences';
import type { View } from '@/lib/types';
import { cn, formatClock } from '@/lib/utils';

type NavIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

const navItems: { view: View; label: string; icon: NavIcon }[] = [
  { view: 'skills', label: '技能库', icon: Layers },
  { view: 'harness', label: 'Harness', icon: Boxes },
  { view: 'projects', label: '项目', icon: FolderGit2 },
];

function clampWidth(raw: number) {
  if (raw < 32) return 0;
  if (raw < 128) return NAV_WIDTH.rail;
  return Math.min(NAV_WIDTH.max, Math.max(150, raw));
}

export function Sidebar({
  view,
  onNavigate,
  scale,
  onScaleChange,
  counts,
  driftCount,
  refreshing,
  lastChecked,
  onRefresh,
  onOpenSettings,
  onOpenAudit,
  onOpenPalette,
  width,
  onWidthChange,
}: {
  view: View;
  onNavigate: (view: View) => void;
  scale: UiScale;
  onScaleChange: (scale: UiScale) => void;
  counts: { skills: number; harnesses: number; projects: number };
  driftCount: number;
  refreshing: boolean;
  lastChecked: Date;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onOpenAudit: () => void;
  onOpenPalette: () => void;
  width: number;
  onWidthChange: (width: number) => void;
}) {
  const mac = isMac();
  const expanded = width >= 150;
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    setDragging(true);
    const move = (moveEvent: PointerEvent) => {
      onWidthChange(clampWidth(startWidth + moveEvent.clientX - startX));
    };
    const stop = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  const keyboardResize = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.key === 'ArrowLeft' ? -16 : 16;
    onWidthChange(clampWidth(widthRef.current + step));
  };

  return (
    <aside
      style={{ width }}
      className={cn(
        'relative hidden shrink-0 flex-col border-r border-hairline bg-panel/40 md:flex',
        !dragging && 'transition-[width] duration-200 ease-out',
      )}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整侧栏宽度，双击收起"
        title="拖动调整宽度，双击收起"
        tabIndex={0}
        onPointerDown={beginResize}
        onKeyDown={keyboardResize}
        onDoubleClick={() => onWidthChange(0)}
        className="absolute -right-[3px] top-0 z-30 h-full w-[7px] cursor-col-resize touch-none outline-none hover:bg-fg/10 focus-visible:bg-jade/30"
      />

      <div className={cn('p-2 pt-3')}>
        <div className={cn('flex items-center gap-1', expanded ? 'w-full' : 'justify-center')}>
          <button
            type="button"
            onClick={onOpenPalette}
            aria-label="搜索或跳转"
            title="搜索或跳转"
            className={cn(
              'group flex items-center rounded-[6px] border border-hairline bg-soft px-2 text-left text-[14px] text-fg-subtle shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] transition-colors hover:border-hairline-strong hover:bg-soft hover:text-fg-muted',
              expanded
                ? 'h-[30px] min-w-0 flex-1 justify-start gap-1.5'
                : 'h-10 w-10 justify-center',
            )}
          >
            <Search
              className={cn(
                'text-fg-subtle transition-colors group-hover:text-fg-muted',
                expanded ? 'h-3 w-3' : 'h-4 w-4',
              )}
              strokeWidth={1.8}
            />
            {expanded ? (
              <>
                <span className="truncate">搜索或跳转</span>
                <span className="ml-auto flex items-center gap-0.5">
                  <span className="kbd">{mac ? '⌘' : 'Ctrl'}</span>
                  <span className="kbd">K</span>
                </span>
              </>
            ) : null}
          </button>
          {expanded ? (
            <IconButton
              label="收起为图标栏"
              className="h-[30px] w-[30px]"
              onClick={() => onWidthChange(NAV_WIDTH.rail)}
            >
              <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.7} />
            </IconButton>
          ) : null}
        </div>

        <nav
          className={cn('space-y-1', expanded ? 'mt-4 space-y-0.5' : 'mt-3')}
          aria-label="主导航"
        >
          {navItems.map((item) => {
            const active = view === item.view;
            const Icon = item.icon;
            const count =
              item.view === 'skills'
                ? counts.skills
                : item.view === 'harness'
                  ? counts.harnesses
                  : counts.projects;

            return (
              <button
                key={item.view}
                type="button"
                onClick={() => onNavigate(item.view)}
                aria-current={active ? 'page' : undefined}
                aria-label={`${item.label} ${count}`}
                title={expanded ? undefined : item.label}
                className={cn(
                  'relative flex w-full select-none items-center rounded-[6px] px-2 text-[14px] transition-colors duration-150',
                  expanded
                    ? 'h-[32px] justify-start gap-2'
                    : 'h-10 justify-center',
                  active
                    ? 'text-fg'
                    : 'text-fg-muted hover:bg-soft hover:text-fg',
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="sidebar-nav-active"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    className="absolute inset-0 rounded-[6px] border border-hairline bg-soft-strong shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_20px_-16px_rgba(0,0,0,0.9)]"
                  />
                ) : null}
                <span className="relative z-10">
                  <Icon
                    className={cn(
                      'shrink-0 transition-colors',
                      expanded ? 'h-3.5 w-3.5' : 'h-4 w-4',
                      active ? 'text-fg' : 'text-fg-subtle',
                    )}
                    strokeWidth={1.7}
                  />
                  {item.view === 'skills' && driftCount > 0 ? (
                    <span
                      title={`${driftCount} 处本地修改`}
                      className={cn(
                        'absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-amber shadow-[0_0_6px_rgba(251,191,36,0.6)]',
                        expanded && 'hidden',
                      )}
                    />
                  ) : null}
                </span>
                {expanded ? (
                  <>
                    <span className="relative z-10 min-w-0 flex-1 truncate text-left">
                      {item.label}
                    </span>
                    <span
                      className={cn(
                        'relative z-10 flex items-center gap-1 font-mono text-[13px] tabular-nums',
                        active ? 'text-fg-muted' : 'text-fg-faint',
                      )}
                    >
                      {item.view === 'skills' && driftCount > 0 ? (
                        <span
                          title={`${driftCount} 处本地修改`}
                          className="h-1 w-1 rounded-full bg-amber shadow-[0_0_6px_rgba(251,191,36,0.6)]"
                        />
                      ) : null}
                      {count}
                    </span>
                  </>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto p-2">
        {expanded ? (
          <>
            <div className="mb-2 rounded-[7px] border border-hairline bg-soft p-2 shadow-inset-top">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-fg-subtle">界面缩放</span>
                <span className="font-mono text-[13px] tabular-nums text-fg-subtle">
                  {Math.round(scale * 100)}%
                </span>
              </div>
              <Segmented<UiScale>
                className="mt-1.5 w-full"
                stretch
                layoutId="sidebar-scale"
                label="界面缩放"
                value={scale}
                onChange={onScaleChange}
                options={SCALE_OPTIONS.map((item) => ({
                  value: item,
                  label: `${Math.round(item * 100)}%`,
                }))}
              />
            </div>

            <div className="mb-2 rounded-[7px] border border-hairline bg-soft p-2 shadow-inset-top">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-fg-muted">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      refreshing
                        ? 'animate-soft-pulse bg-sky shadow-[0_0_7px_rgba(125,211,252,0.6)]'
                        : 'bg-jade shadow-[0_0_7px_rgba(52,211,153,0.55)]',
                    )}
                  />
                  <span className="truncate">
                    {refreshing ? '正在对账…' : '对账在线'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={refreshing}
                  className="flex h-6 shrink-0 items-center gap-1 rounded-[4px] border border-hairline bg-panel/50 px-1.5 text-[12.5px] text-fg-subtle transition-colors hover:border-hairline-strong hover:text-fg-muted disabled:opacity-60"
                >
                  <RefreshCw
                    className={cn('h-2.5 w-2.5', refreshing && 'animate-spin-slow')}
                    strokeWidth={1.8}
                  />
                  立即对账
                </button>
              </div>
              <div className="mt-1.5 flex items-center justify-between font-mono text-[13px] text-fg-faint">
                <span>上次检查</span>
                <span className="tabular-nums">{formatClock(lastChecked)}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={onOpenAudit}
              className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-[14px] text-fg-subtle transition-colors hover:bg-soft hover:text-fg-muted"
            >
              <ScrollText className="h-3.5 w-3.5" strokeWidth={1.7} />
              操作日志
            </button>

            <button
              type="button"
              onClick={onOpenSettings}
              className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-[14px] text-fg-subtle transition-colors hover:bg-soft hover:text-fg-muted"
            >
              <Settings2 className="h-3.5 w-3.5" strokeWidth={1.7} />
              设置与路径映射
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label={refreshing ? '正在对账…' : '立即对账并刷新文件状态'}
              title={refreshing ? '正在对账…' : '立即对账并刷新文件状态（Ctrl+R）'}
              className="relative flex h-11 w-10 flex-col items-center justify-center gap-0.5 rounded-[6px] text-fg-subtle transition-colors hover:bg-soft hover:text-fg-muted disabled:opacity-60"
            >
              <RefreshCw
                className={cn('h-4 w-4', refreshing && 'animate-spin-slow')}
                strokeWidth={1.7}
              />
              <span className="text-[12.5px] leading-none">对账</span>
              <span
                className={cn(
                  'absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full',
                  refreshing ? 'bg-sky' : 'bg-jade',
                )}
              />
            </button>
            <button
              type="button"
              onClick={onOpenAudit}
              aria-label="操作日志"
              title="操作日志"
              className="flex h-10 w-10 items-center justify-center rounded-[6px] text-fg-subtle transition-colors hover:bg-soft hover:text-fg-muted"
            >
              <ScrollText className="h-4 w-4" strokeWidth={1.7} />
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="设置与路径映射"
              title="设置与路径映射"
              className="flex h-10 w-10 items-center justify-center rounded-[6px] text-fg-subtle transition-colors hover:bg-soft hover:text-fg-muted"
            >
              <Settings2 className="h-4 w-4" strokeWidth={1.7} />
            </button>
            <button
              type="button"
              onClick={() => onWidthChange(NAV_WIDTH.expanded)}
              aria-label="展开侧栏"
              title="展开侧栏"
              className="mt-1 flex h-11 w-10 flex-col items-center justify-center gap-0.5 rounded-[6px] border border-hairline bg-soft text-fg-subtle transition-colors hover:border-hairline-strong hover:text-fg-muted"
            >
              <PanelLeftOpen className="h-4 w-4" strokeWidth={1.7} />
              <span className="text-[12.5px] leading-none">展开</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
