import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Command,
  Minus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Square,
  Sun,
  X,
} from 'lucide-react';
import { QuiverLogo } from '@/components/Logo';
import { Pill } from '@/components/ui/Pill';
import { Segmented } from '@/components/ui/Segmented';
import { isDesktop, isMac } from '@/lib/desktop';
import type { Theme } from '@/lib/preferences';
import { cn } from '@/lib/utils';

function WindowButton({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'window-no-drag flex h-[42px] w-[46px] items-center justify-center text-fg-subtle transition-colors',
        danger
          ? 'hover:bg-[#c42b1c] hover:text-white'
          : 'hover:bg-soft-strong hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

export function TitleBar({
  viewLabel,
  theme,
  onThemeChange,
  onOpenPalette,
  sidebarWidth = 216,
  sidebarHidden = false,
  onToggleSidebar,
}: {
  viewLabel: string;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onOpenPalette: () => void;
  sidebarWidth?: number;
  sidebarHidden?: boolean;
  onToggleSidebar?: () => void;
}) {
  const [maximized, setMaximized] = useState(false);
  const mac = isMac();
  const desktop = isDesktop();
  const expanded = sidebarWidth >= 150;

  useEffect(() => {
    if (!window.quiver) return;
    return window.quiver.window.onMaximized(setMaximized);
  }, []);

  return (
    <header
      className="window-drag relative z-20 flex h-[48px] shrink-0 items-stretch border-b border-hairline bg-void/95 backdrop-blur-xl md:h-[42px]"
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return;
        window.quiver?.window.toggleMaximize();
      }}
    >
      <div
        style={{ width: sidebarWidth }}
        className={cn(
          'hidden shrink-0 items-center gap-2 border-r border-hairline md:flex',
          expanded ? 'justify-start px-3' : 'justify-center px-0',
          sidebarHidden && 'md:hidden',
        )}
      >
        <QuiverLogo />
        {expanded ? (
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-fg">
            Quiver
          </span>
        ) : null}
        {expanded ? (
          <Pill
            mono
            className="ml-auto px-1.5 py-1 text-[13px] text-fg-subtle"
          >
            v0.1.0
          </Pill>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2 px-3 md:pl-4">
        <div className="flex shrink-0 items-center gap-1.5 md:hidden">
          <QuiverLogo />
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-fg">
            Quiver
          </span>
          <span className="text-fg-faint">/</span>
        </div>
        {onToggleSidebar ? (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={sidebarHidden ? '展开侧栏' : '收起侧栏'}
            title={sidebarHidden ? '展开侧栏' : '收起侧栏'}
            className="hidden h-7 w-7 items-center justify-center rounded-[5px] border border-transparent text-fg-subtle transition-colors hover:border-hairline hover:bg-soft hover:text-fg md:flex"
          >
            {sidebarHidden ? (
              <PanelLeftOpen className="h-3.5 w-3.5" strokeWidth={1.7} />
            ) : (
              <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.7} />
            )}
          </button>
        ) : null}
        <span className="truncate text-[14px] text-fg-muted">{viewLabel}</span>
        <span className="hidden text-fg-faint md:inline">/</span>
        <span className="hidden items-center gap-1.5 font-mono text-[13px] text-fg-subtle min-[1120px]:flex">
          <span className="h-1 w-1 rounded-full bg-jade/80" />
          {desktop ? '本地文件系统' : '本地 Web 服务'}
        </span>
      </div>

      <div className="window-no-drag flex items-center gap-1.5 pr-2">
        <div className="hidden md:block">
          <Segmented<Theme>
            layoutId="titlebar-theme"
            label="界面主题"
            value={theme}
            onChange={onThemeChange}
            options={[
              { value: 'dark', label: '柔和暗色', icon: Moon },
              { value: 'light', label: '清爽浅色', icon: Sun },
            ]}
          />
        </div>
        <button
          type="button"
          aria-label={theme === 'dark' ? '切换到清爽浅色' : '切换到柔和暗色'}
          title={theme === 'dark' ? '切换到清爽浅色' : '切换到柔和暗色'}
          onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
          className="flex h-10 w-10 items-center justify-center rounded-[6px] border border-hairline bg-soft text-fg-subtle transition-colors hover:border-hairline-strong hover:bg-soft-strong hover:text-fg md:hidden"
        >
          {theme === 'dark' ? (
            <Sun className="h-4 w-4" strokeWidth={1.8} />
          ) : (
            <Moon className="h-4 w-4" strokeWidth={1.8} />
          )}
        </button>
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="打开命令面板"
          title="打开命令面板"
          className="flex h-10 w-10 items-center justify-center rounded-[6px] border border-hairline bg-soft text-fg-subtle transition-colors hover:border-hairline-strong hover:bg-soft-strong hover:text-fg-muted md:h-7 md:w-auto md:gap-1.5 md:px-2"
        >
          <Search className="h-4 w-4 md:hidden" strokeWidth={1.8} />
          <Command className="hidden h-3 w-3 md:block" strokeWidth={1.8} />
          <span className="hidden md:inline">命令</span>
          <span className="ml-1 hidden items-center gap-0.5 md:flex">
            <span className="kbd">{mac ? '⌘' : 'Ctrl'}</span>
            <span className="kbd">K</span>
          </span>
        </button>
      </div>

      {desktop && !mac ? (
        <div className="flex items-stretch">
          <WindowButton
            label="最小化"
            onClick={() => window.quiver?.window.minimize()}
          >
            <Minus className="h-3 w-3" strokeWidth={1.6} />
          </WindowButton>
          <WindowButton
            label={maximized ? '还原' : '最大化'}
            onClick={() => window.quiver?.window.toggleMaximize()}
          >
            {maximized ? (
              <span className="relative h-3 w-3">
                <span className="absolute bottom-0 left-0 h-2.5 w-2.5 rounded-[1px] border border-current" />
                <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-[1px] border border-current bg-void" />
              </span>
            ) : (
              <Square className="h-2.5 w-2.5" strokeWidth={1.6} />
            )}
          </WindowButton>
          <WindowButton
            label="关闭"
            danger
            onClick={() => window.quiver?.window.close()}
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          </WindowButton>
        </div>
      ) : (
        <div className="w-2" />
      )}
    </header>
  );
}
