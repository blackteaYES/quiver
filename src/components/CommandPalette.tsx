import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Command } from 'cmdk';
import {
  Boxes,
  Check,
  Download,
  FolderGit2,
  Layers,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { SkillGlyph } from '@/components/HarnessMark';
import type { QuiverActions } from '@/lib/actions';
import type { AppData, View } from '@/lib/types';
import { shortSha } from '@/lib/utils';

const itemClass =
  'flex cursor-pointer items-center gap-2.5 rounded-[6px] px-2 py-[7px] text-[14px] text-fg-muted outline-none transition-colors data-[selected=true]:bg-soft-strong data-[selected=true]:text-fg';

const groupClass =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[13px] [&_[cmdk-group-heading]]:text-fg-subtle';

export function CommandPalette({
  open,
  onOpenChange,
  data,
  selectedSkillId,
  selectedProjectId,
  currentView,
  actions,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: AppData;
  selectedSkillId: string;
  selectedProjectId: string;
  currentView: View;
  actions: QuiverActions;
  onNavigate: (view: View) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  const run = (action: () => void) => {
    onOpenChange(false);
    window.setTimeout(action, 0);
  };

  const skill = data.skills.find((item) => item.id === selectedSkillId);
  const project = data.projects.find((item) => item.id === selectedProjectId);

  const views: { view: View; label: string; icon: typeof Layers }[] = [
    { view: 'skills', label: '技能库', icon: Layers },
    { view: 'harness', label: 'Harness', icon: Boxes },
    { view: 'projects', label: '项目', icon: FolderGit2 },
  ];

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[80] flex items-start justify-center bg-overlay px-4 pt-[13vh] backdrop-blur-[3px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onOpenChange(false);
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.99 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="w-full max-w-[600px] overflow-hidden rounded-[11px] border border-hairline bg-raised shadow-float"
            role="dialog"
            aria-modal="true"
            aria-label="全局命令面板"
          >
            <Command loop className="flex flex-col">
              <div className="flex items-center gap-2.5 border-b border-hairline px-3.5">
                <Search className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                <Command.Input
                  autoFocus
                  placeholder="搜索技能、视图或动作…"
                  className="h-[48px] flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-subtle"
                />
                <span className="kbd">esc</span>
              </div>

              <Command.List className="max-h-[378px] overflow-y-auto p-1.5 pt-2.5">
                <Command.Empty className="flex flex-col items-center justify-center gap-2 py-10 text-[14px] text-fg-subtle">
                  <Search className="h-4 w-4 text-fg-faint" />
                  没有匹配的结果
                </Command.Empty>

                <Command.Group heading="跳转" className={groupClass}>
                  {views.map((item) => {
                    const Icon = item.icon;
                    const active = currentView === item.view;
                    return (
                      <Command.Item
                        key={item.view}
                        value={`跳转 ${item.label} ${item.view}`}
                        onSelect={() => run(() => onNavigate(item.view))}
                        className={itemClass}
                      >
                        <Icon className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.7} />
                        <span>{item.label}</span>
                        {active ? (
                          <Check className="ml-auto h-3 w-3 text-fg-subtle" />
                        ) : null}
                      </Command.Item>
                    );
                  })}
                </Command.Group>

                <Command.Group heading="技能" className={groupClass}>
                  {data.skills.map((item) => (
                    <Command.Item
                      key={item.id}
                      value={`${item.slug} ${item.displayName} ${item.alias ?? ''} ${item.tags.join(' ')}`}
                      onSelect={() => run(() => actions.openSkill(item.id))}
                      className={itemClass}
                    >
                      <SkillGlyph slug={item.slug} className="h-6 w-6 text-[13px]" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[15px] font-medium">
                        {item.slug}
                      </span>
                      <span className="truncate text-[13px] text-fg-subtle">
                        {item.displayName}
                      </span>
                      <span className="ml-2 shrink-0 font-mono text-[13px] text-fg-subtle">
                        @{shortSha(item.activeSha)}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>

                <Command.Group heading="操作" className={groupClass}>
                  <Command.Item
                    value="刷新 对账 重新扫描 refresh"
                    onSelect={() => run(actions.refresh)}
                    className={itemClass}
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.7} />
                    立即刷新对账
                    <span className="ml-auto font-mono text-[13px] text-fg-faint">
                      Ctrl R
                    </span>
                  </Command.Item>
                  <Command.Item
                    value="启用到 分发 绑定 deploy"
                    onSelect={() => run(() => actions.openEnable(selectedSkillId))}
                    className={itemClass}
                  >
                    <Sparkles className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.7} />
                    启用到…
                    <span className="ml-auto truncate font-mono text-[13px] text-fg-faint">
                      {skill?.slug ?? '选择技能'}
                    </span>
                  </Command.Item>
                  <Command.Item
                    value="导出 项目 配置 manifest export"
                    onSelect={() => run(() => actions.exportProject(selectedProjectId))}
                    className={itemClass}
                  >
                    <Download className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.7} />
                    导出项目配置
                    <span className="ml-auto truncate font-mono text-[13px] text-fg-faint">
                      {project?.name ?? '未选择项目'}
                    </span>
                  </Command.Item>
                  <Command.Item
                    value="设置 路径映射 settings preferences"
                    onSelect={() => run(actions.openSettings)}
                    className={itemClass}
                  >
                    <Settings2 className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.7} />
                    打开设置与路径映射
                  </Command.Item>
                </Command.Group>
              </Command.List>

              <div className="flex items-center justify-between border-t border-hairline px-3.5 py-2.5 font-mono text-[13px] text-fg-subtle">
                <span className="flex items-center gap-2">
                  <span>↑↓ 浏览</span>
                  <span className="text-fg-subtle">/</span>
                  <span>↵ 执行</span>
                  <span className="text-fg-subtle">/</span>
                  <span>esc 关闭</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-1 w-1 rounded-full bg-jade/70" />
                  快捷命令面板
                </span>
              </div>
            </Command>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
