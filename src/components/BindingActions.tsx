import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArchiveRestore,
  ArrowUpRight,
  EyeOff,
  RotateCcw,
  Share2,
  Trash2,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import type {
  Binding,
  DependentBinding,
  SharedBindingImpact,
} from '@/lib/types';
import { shortSha } from '@/lib/utils';

const spring = { type: 'spring' as const, stiffness: 400, damping: 30 };

export function DriftResolution({
  binding,
  onReset,
  onAdopt,
  onIgnore,
}: {
  binding: Binding;
  onReset: () => void;
  onAdopt: () => void;
  onIgnore: () => void;
}) {
  const actions = [
    {
      label: '从技能库恢复',
      icon: <RotateCcw className="h-2.5 w-2.5" />,
      onClick: onReset,
      variant: 'secondary' as const,
      title: '丢弃目标目录中的本地修改，按部署锚点重建',
    },
    {
      label: '将更改保存回技能库',
      icon: <ArchiveRestore className="h-2.5 w-2.5" />,
      onClick: onAdopt,
      variant: 'primary' as const,
      title: '计算新哈希并写入只读中央库，作为新版本',
    },
    {
      label: '保留本地修改',
      icon: <EyeOff className="h-2.5 w-2.5" />,
      onClick: onIgnore,
      variant: 'ghost' as const,
      title: '保留本地分叉，不再高亮提醒',
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, height: 0, y: 2 }}
      animate={{ opacity: 1, height: 'auto', y: 0 }}
      exit={{ opacity: 0, height: 0, y: -2 }}
      transition={spring}
      className="overflow-hidden"
    >
      <div className="mt-2 rounded-[7px] border border-amber/[0.14] bg-amber/[0.025] p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[14px] font-medium text-amber/90">
              <AlertTriangle className="h-3 w-3" strokeWidth={1.8} />
              目标文件与技能库不一致
            </div>
            <p className="mt-1 truncate font-mono text-[13px] text-fg-subtle">
              @{shortSha(binding.resolvedSha)} → @
              {shortSha(binding.currentSha ?? binding.resolvedSha)}
              <span className="px-1 text-fg-faint">/</span>
              {binding.driftFiles?.length ?? 0} 个文件
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 max-sm:w-full max-sm:flex-col max-sm:items-stretch">
            {actions.map((action, index) => (
              <motion.span
                key={action.label}
                initial={{ opacity: 0, x: -3 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...spring, delay: 0.03 + index * 0.045 }}
                title={action.title}
                className="max-sm:w-full"
              >
                <Button
                  size="xs"
                  variant={action.variant}
                  onClick={action.onClick}
                  className="gap-1 max-lg:min-h-10 max-sm:w-full max-sm:justify-start"
                >
                  {action.icon}
                  {action.label}
                </Button>
              </motion.span>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function RowActions({
  binding,
  onConvert,
  onUpdate,
  onDisable,
  onRedeploy,
  onRemove,
  onRelocate,
}: {
  binding: Binding;
  onConvert: (id: string) => void;
  onUpdate: (id: string) => void;
  onDisable: (id: string) => void;
  onRedeploy: (id: string) => void;
  onRemove: (id: string) => void;
  onRelocate?: (id: string) => void;
}) {
  if (binding.state === 'missing') {
    return (
      <div className="flex flex-wrap items-center justify-end gap-1.5 max-lg:[&_button]:min-h-10 max-sm:grid max-sm:w-full max-sm:grid-cols-2 max-sm:items-stretch max-sm:gap-1.5 max-sm:[&_button]:w-full max-sm:[&_button]:justify-center">
        <Button
          size="xs"
          variant="secondary"
          onClick={() => onRedeploy(binding.id)}
          className="gap-1"
        >
          <Undo2 className="h-2.5 w-2.5" />
          重新恢复
        </Button>
        <Button
          size="xs"
          variant="danger"
          onClick={() => onRemove(binding.id)}
          className="gap-1"
        >
          <Trash2 className="h-2.5 w-2.5" />
          移除记录
        </Button>
      </div>
    );
  }

  if (binding.state === 'orphaned') {
    return (
      <div className="flex flex-wrap items-center justify-end gap-1.5 max-lg:[&_button]:min-h-10 max-sm:grid max-sm:w-full max-sm:grid-cols-2 max-sm:items-stretch max-sm:gap-1.5 max-sm:[&_button]:w-full max-sm:[&_button]:justify-center">
        <Button
          size="xs"
          variant="secondary"
          onClick={() => onRelocate?.(binding.id)}
        >
          重新定位路径…
        </Button>
        <Button size="xs" variant="ghost" onClick={() => onRemove(binding.id)}>
          清理记录
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5 max-lg:[&_button]:min-h-10 max-sm:grid max-sm:w-full max-sm:grid-cols-2 max-sm:items-stretch max-sm:gap-1.5 max-sm:[&_button]:w-full max-sm:[&_button]:justify-center">
      {binding.updateAvailable ? (
        <Button
          size="xs"
          variant="secondary"
          onClick={() => onUpdate(binding.id)}
          className="gap-1 border-sky/20 text-sky hover:border-sky/30 hover:bg-sky/[0.08]"
          title={`更新到 @${shortSha(binding.updateAvailable)}`}
        >
          <ArrowUpRight className="h-2.5 w-2.5" />
          更新到最新
        </Button>
      ) : null}
      {binding.syncMode === 'link' ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => onConvert(binding.id)}
          title="解除链接，复制为可写的本地副本"
        >
          转为本地副本
        </Button>
      ) : null}
      <Button
        size="xs"
        variant="ghost"
        onClick={() => onDisable(binding.id)}
        className="text-fg-subtle hover:text-rose"
      >
        禁用
      </Button>
    </div>
  );
}

export function DisableDependencyDialog({
  open,
  dependents,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  dependents: DependentBinding[];
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const names = dependents.map((item) => item.skillName || item.skillSlug).join('、');
  const visible = dependents.slice(0, 4);
  const rest = dependents.length - visible.length;

  return (
    <ConfirmDialog
      open={open}
      title="禁用前确认"
      description={
        <>
          当前已启用的技能
          <span className="px-1 font-medium text-fg">{names}</span>
          依赖此技能，禁用后可能影响其正常工作。确定仍要禁用吗？
        </>
      }
      note={
        <ul className="space-y-1">
          {visible.map((item) => (
            <li key={item.bindingId} className="flex items-center gap-1.5">
              <span className="min-w-0 truncate font-mono text-fg-muted">
                {item.skillSlug}
              </span>
              <span className="shrink-0 text-fg-faint">
                · {item.harnessName} · {item.scopeLabel}
                {item.projectName ? ` · ${item.projectName}` : ''}
              </span>
            </li>
          ))}
          {rest > 0 ? <li>另有 {rest} 个依赖入口</li> : null}
        </ul>
      }
      confirmLabel={busy ? '禁用中…' : '仍要禁用'}
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export function SharedDisableDialog({
  open,
  shared,
  dependents,
  busy,
  onCancel,
  onChoose,
}: {
  open: boolean;
  shared: SharedBindingImpact | null;
  dependents: DependentBinding[];
  busy?: boolean;
  onCancel: () => void;
  onChoose: (mode: 'split' | 'all') => void;
}) {
  const readers = shared?.readers ?? [];
  const dependentNames = dependents
    .map((item) => item.skillName || item.skillSlug)
    .join('、');

  return (
    <Modal
      open={open}
      onClose={onCancel}
      ariaLabel="跨工具共享目录解绑确认"
      className="max-w-[480px]"
    >
      <div className="flex-1 overflow-y-auto px-5 pb-4 pt-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-amber/[0.22] bg-amber/[0.07] text-amber">
            <Share2 className="h-3.5 w-3.5" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold text-fg">
              跨工具共享目录解绑确认
            </h2>
            <div className="mt-1.5 text-[14px] leading-relaxed text-fg-subtle">
              当前绑定位于多个工具共用的扫描目录
              <span className="px-1 font-mono text-fg-muted">
                {shared?.path ?? ''}
              </span>
              ，直接移除会让下列工具同时看不到该技能。
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-[7px] border border-hairline bg-soft px-3 py-2">
          <div className="text-[12.5px] font-medium uppercase tracking-[0.06em] text-fg-faint">
            共用此目录的工具 · {readers.length}
          </div>
          <ul className="mt-1.5 space-y-1">
            {readers.map((reader) => (
              <li
                key={`${reader.harnessId}-${reader.candidateId}`}
                className="flex items-center justify-between gap-2"
              >
                <span className="min-w-0 truncate text-[14px] text-fg">
                  {reader.harnessName}
                </span>
                <span className="mono-pill max-w-[58%] truncate">
                  {reader.candidatePath} · {reader.candidateRoleLabel}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {dependents.length > 0 ? (
          <div className="mt-2.5 rounded-[7px] border border-amber/[0.16] bg-amber/[0.04] px-3 py-2 text-[13px] leading-relaxed text-fg-subtle">
            <span className="font-medium text-amber/90">
              {dependents.length} 个已启用技能依赖此技能
            </span>
            <span className="px-1 font-mono text-fg-muted">{dependentNames}</span>
            若彻底移除，所有共用工具中的依赖入口都会失效；智能拆分会把当前版本重新部署到其他工具的首选目录。
          </div>
        ) : null}
      </div>

      <footer className="flex flex-col gap-2 border-t border-hairline px-5 py-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onChoose('split')}
          disabled={busy || !shared?.canSplit}
          className="h-auto min-h-10 whitespace-normal py-2 text-left"
        >
          仅在当前工具停用，保留其他活跃工具（智能拆分）
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => onChoose('all')}
          disabled={busy}
          className="h-auto min-h-10 whitespace-normal py-2 text-left"
        >
          从共享目录彻底移除（所有共用工具同步停用）
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          取消
        </Button>
      </footer>
    </Modal>
  );
}
