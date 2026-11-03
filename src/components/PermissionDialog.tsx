import { Copy, RefreshCw, Settings2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { openExternal, platform } from '@/lib/desktop';
import type { PermissionIssue } from '@/lib/types';

const MAC_PRIVACY_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

export function PermissionDialog({
  issue,
  canDowngrade,
  onClose,
  onRetry,
  onDowngrade,
}: {
  issue: PermissionIssue | null;
  canDowngrade: boolean;
  onClose: () => void;
  onRetry: () => void;
  onDowngrade: () => void;
}) {
  if (!issue) return null;
  const mac = platform() === 'darwin';

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel="系统权限受阻"
      className="max-w-[480px]"
    >
      <header className="flex items-start gap-3 border-b border-hairline px-5 py-4">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-amber/[0.22] bg-amber/[0.06] text-amber">
          <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold text-fg">系统权限受阻</h2>
          <p className="mt-0.5 text-[13px] leading-relaxed text-fg-subtle">
            操作没有完成，目标目录未被修改。Quiver 不会自动修改系统权限。
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <p className="text-[14px] leading-relaxed text-fg-subtle">
          系统拒绝了 Quiver 对以下路径的访问
          <span className="px-1 font-mono text-fg-muted">（{issue.code}）</span>。
        </p>
        <div className="mt-2 rounded-[7px] border border-hairline bg-soft px-3 py-2">
          <p className="break-all font-mono text-[13px] leading-relaxed text-fg-muted">
            {issue.path || '未知路径'}
          </p>
          {issue.syscall ? (
            <p className="mt-1 font-mono text-[13px] text-fg-faint">
              syscall: {issue.syscall}
            </p>
          ) : null}
        </div>

        {mac ? (
          <div className="mt-3 rounded-[7px] border border-hairline bg-soft px-3 py-2.5">
            <p className="text-[14px] leading-relaxed text-fg-muted">
              请在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」中勾选 Quiver
              （若通过终端启动，也需授权该终端），然后回到这里重试。
            </p>
            <Button
              size="xs"
              variant="secondary"
              className="mt-2 gap-1"
              onClick={() => void openExternal(MAC_PRIVACY_URL, '系统设置')}
            >
              <Settings2 className="h-2.5 w-2.5" />
              打开系统设置
            </Button>
          </div>
        ) : (
          <div className="mt-3 rounded-[7px] border border-hairline bg-soft px-3 py-2.5">
            <p className="text-[14px] leading-relaxed text-fg-muted">
              {canDowngrade
                ? 'Windows 上创建符号链接通常需要管理员权限或开发者模式。也可以先改用本地副本模式：技能内容会复制到目标目录，不再依赖链接权限。'
                : '请确认目标目录可写，并检查安全软件是否拦截了文件操作；必要时以管理员身份运行 Quiver。'}
            </p>
          </div>
        )}

        <p className="mt-2.5 text-[13px] leading-relaxed text-fg-faint">
          若该路径位于受保护的系统目录，请先把项目或技能库放到当前用户可写的目录后再试。
        </p>
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-1.5 border-t border-hairline px-5 py-3">
        <Button size="sm" variant="ghost" onClick={onClose}>
          关闭
        </Button>
        {canDowngrade ? (
          <Button size="sm" variant="secondary" className="gap-1" onClick={onDowngrade}>
            <Copy className="h-3 w-3" strokeWidth={1.8} />
            一键降级为本地副本模式
          </Button>
        ) : null}
        <Button size="sm" variant="primary" className="gap-1" onClick={onRetry}>
          <RefreshCw className="h-3 w-3" strokeWidth={1.8} />
          {mac ? '授权后重试' : '重试'}
        </Button>
      </footer>
    </Modal>
  );
}
