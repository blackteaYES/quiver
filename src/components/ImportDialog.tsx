import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArchiveRestore,
  FolderInput,
  FolderSearch,
  GitBranch,
  Upload,
  X,
} from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Modal, inputClass } from '@/components/ui/Modal';
import { engine, pickFile, pickFolder } from '@/lib/desktop';
import type { EngineResult } from '@/lib/types';
import { cn } from '@/lib/utils';

type Source = 'local' | 'git' | 'backup';

const sources: {
  value: Source;
  label: string;
  icon: typeof FolderInput;
  hint: string;
}[] = [
  {
    value: 'local',
    label: '本地目录',
    icon: FolderInput,
    hint: '目录根需要包含 SKILL.md；内部的符号链接与硬链接会被拒绝。',
  },
  {
    value: 'git',
    label: 'Git 仓库',
    icon: GitBranch,
    hint: '以 --depth 1 浅克隆导入，适合托管在 Git 上的技能仓库。',
  },
  {
    value: 'backup',
    label: '备份包',
    icon: ArchiveRestore,
    hint: '导入 Quiver 导出的 JSON 备份，按技能与版本去重合并。',
  },
];

export function ImportDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (result: EngineResult) => void;
}) {
  const [source, setSource] = useState<Source>('local');
  const [path, setPath] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const choose = async () => {
    if (source === 'backup') {
      const file = await pickFile({
        title: '选择 Quiver 备份包',
        filters: [{ name: 'Quiver 备份', extensions: ['json'] }],
      });
      if (file) setPath(file);
      return;
    }
    const folder = await pickFolder({ title: '选择要导入的技能目录' });
    if (folder) setPath(folder);
  };

  const submit = async () => {
    if (busy) return;
    const api = engine();
    if (!api) return;
    setBusy(true);
    const result =
      source === 'git'
        ? await api.importGit(url.trim())
        : source === 'backup'
          ? await api.importBackup(path)
          : await api.importLocal(path);
    setBusy(false);
    onDone(result);
    if (result.ok) {
      setPath('');
      setUrl('');
      onClose();
    }
  };

  const canSubmit =
    source === 'git' ? url.trim().length > 0 : path.trim().length > 0;

  const current = sources.find((item) => item.value === source)!;

  return (
    <Modal open={open} onClose={onClose} ariaLabel="导入技能">
      <header className="flex items-start gap-2.5 border-b border-hairline px-4 py-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-hairline bg-soft text-fg-muted">
          <Upload className="h-3 w-3" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold text-fg">导入技能</h2>
          <p className="mt-0.5 text-[13px] text-fg-subtle">
            源内容写入只读中央库后，再按需启用到各个 Harness。
          </p>
        </div>
        <IconButton label="关闭" onClick={onClose} className="-mr-1">
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="grid grid-cols-3 gap-1.5 rounded-[8px] border border-hairline bg-soft p-1">
          {sources.map((item) => {
            const active = source === item.value;
            const Icon = item.icon;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => {
                  setSource(item.value);
                  setPath('');
                }}
                aria-pressed={active}
                className={cn(
                  'relative flex h-[32px] items-center justify-center gap-1.5 rounded-[6px] text-[14px] transition-colors',
                  active ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted',
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="import-source-active"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    className="absolute inset-0 rounded-[6px] border border-hairline bg-soft-strong shadow-inset-top"
                  />
                ) : null}
                <Icon className="relative h-3 w-3" strokeWidth={1.8} />
                <span className="relative">{item.label}</span>
              </button>
            );
          })}
        </div>

        <p className="mt-2 text-[13px] leading-relaxed text-fg-subtle">{current.hint}</p>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={source}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.14 }}
            className="mt-3"
          >
            {source === 'git' ? (
              <label className="block">
                <span className="text-[14px] text-fg-muted">仓库地址</span>
                <input
                  autoFocus
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  className={`${inputClass} mt-1 font-mono text-[13px]`}
                  placeholder="https://github.com/user/skill-repo.git"
                  spellCheck={false}
                />
              </label>
            ) : (
              <div>
                <span className="text-[14px] text-fg-muted">
                  {source === 'backup' ? '备份文件' : '技能目录'}
                </span>
                <div className="mt-1 flex items-center gap-1.5">
                  <span
                    title={path}
                    className="min-w-0 flex-1 truncate rounded-[6px] border border-hairline bg-soft px-2 py-[6px] font-mono text-[13px] text-fg-subtle"
                  >
                    {path || '尚未选择'}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void choose()}
                    className="shrink-0 gap-1"
                  >
                    <FolderSearch className="h-2.5 w-2.5" />
                    浏览…
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-3 rounded-[7px] border border-hairline bg-soft px-2.5 py-2 text-[13px] leading-relaxed text-fg-subtle">
          导入后源文件按 SHA-256 冻结为只读版本，可用
          <span className="px-1 font-mono text-fg-subtle">@版本</span>
          切换激活版本；任何 Harness 的内部配置都不会被读取或改写。
        </div>
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-hairline px-4 py-2.5">
        <span className="min-w-0 truncate font-mono text-[13px] text-fg-subtle">
          {source === 'git' ? url || 'Git 仓库' : path || current.label}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void submit()}
            disabled={!canSubmit || busy}
            className="min-w-[88px]"
          >
            {busy ? '导入中…' : '开始导入'}
          </Button>
        </div>
      </footer>
    </Modal>
  );
}
