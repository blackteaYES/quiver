import { useState } from 'react';
import { Code2, Copy, FolderOpen, FolderTree, SquareTerminal } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { copyPath, openInEditor, openTerminalAt, revealPath } from '@/lib/desktop';
import { cn, displayPath } from '@/lib/utils';

export function PathPill({
  path,
  localRel,
  realPath,
  homeDir,
  actions = true,
  className,
}: {
  path: string;
  localRel: string;
  realPath?: string;
  homeDir?: string;
  actions?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = displayPath(path, homeDir);
  const target = realPath ?? localRel;

  return (
    <span
      className={cn(
        'group/path flex min-w-0 items-center gap-1.5 rounded-[6px] border border-hairline bg-soft py-1 pl-2 pr-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]',
        className,
      )}
    >
      <FolderTree className="h-3 w-3 shrink-0 text-fg-subtle" strokeWidth={1.8} />
      <button
        type="button"
        title={expanded ? `${path}（点击收起）` : path}
        aria-expanded={expanded}
        onClick={(event) => {
          event.stopPropagation();
          setExpanded((value) => !value);
        }}
        className={cn(
          'min-w-0 rounded-[3px] text-left font-mono text-[13px] leading-[1.6] text-fg-subtle outline-none transition-colors hover:text-fg-muted focus-visible:ring-1 focus-visible:ring-fg/30 max-sm:min-h-10',
          expanded ? 'whitespace-normal break-all' : 'truncate',
        )}
      >
        {label}
      </button>
      {actions ? (
        <span className="ml-auto flex shrink-0 items-center gap-0.5 border-l border-hairline pl-1 opacity-45 transition-opacity duration-150 group-hover/row:opacity-100 group-hover/path:opacity-100 focus-within:opacity-100 max-lg:opacity-100">
          <IconButton
            label="在文件夹中显示"
            className="h-5 w-5 rounded-[4px] max-lg:h-7 max-lg:w-7 max-sm:h-10 max-sm:w-10"
            onClick={(event) => {
              event.stopPropagation();
              void revealPath(target, path);
            }}
          >
            <FolderOpen className="h-3 w-3" strokeWidth={1.8} />
          </IconButton>
          <IconButton
            label="使用 VS Code 打开"
            className="h-5 w-5 rounded-[4px] max-lg:h-7 max-lg:w-7 max-sm:h-10 max-sm:w-10"
            onClick={(event) => {
              event.stopPropagation();
              void openInEditor(target, path);
            }}
          >
            <Code2 className="h-3 w-3" strokeWidth={1.8} />
          </IconButton>
          <IconButton
            label="在终端中打开"
            className="h-5 w-5 rounded-[4px] max-lg:h-7 max-lg:w-7 max-sm:h-10 max-sm:w-10"
            onClick={(event) => {
              event.stopPropagation();
              void openTerminalAt(target, path);
            }}
          >
            <SquareTerminal className="h-3 w-3" strokeWidth={1.8} />
          </IconButton>
          <IconButton
            label="复制路径"
            className="h-5 w-5 rounded-[4px] max-lg:h-7 max-lg:w-7 max-sm:h-10 max-sm:w-10"
            onClick={(event) => {
              event.stopPropagation();
              void copyPath(realPath ?? path, path);
            }}
          >
            <Copy className="h-3 w-3" strokeWidth={1.8} />
          </IconButton>
        </span>
      ) : null}
    </span>
  );
}
