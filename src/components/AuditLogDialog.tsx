import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download,
  RefreshCw,
  ScrollText,
  Search,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, IconButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Segmented } from '@/components/ui/Segmented';
import { engine, isDesktop, saveFile } from '@/lib/desktop';
import type {
  AuditExportFormat,
  AuditLogEntry,
  AuditSourceFilter,
} from '@/lib/types';
import { cn, displayPath } from '@/lib/utils';

const sourceOptions: { value: AuditSourceFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'desktop', label: '桌面端' },
  { value: 'web', label: 'Web 端' },
];

const destructiveActions = new Set(['delete_skill', 'disable', 'clean_project']);
const driftActions = new Set([
  'reset',
  'adopt',
  'ignore_drift',
  'update',
  'convert_copy',
]);
const importActions = new Set([
  'import_skill',
  'import_backup',
  'adopt_unmanaged',
  'register_unmanaged',
]);
const positiveActions = new Set([
  'enable',
  'restore_project',
  'switch_version',
  'add_project',
]);

function actionDot(action: string) {
  if (destructiveActions.has(action)) return 'bg-rose';
  if (driftActions.has(action)) return 'bg-amber';
  if (importActions.has(action)) return 'bg-sky';
  if (positiveActions.has(action)) return 'bg-jade';
  return 'bg-fg-subtle';
}

function stamp(ts: number) {
  const date = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, '0');
  const now = new Date();
  const day =
    date.getFullYear() === now.getFullYear()
      ? `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return {
    day,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    full: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
      date.getHours(),
    )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  };
}

const pathPattern = /^(?:[A-Za-z]:[\\/]|~[\\/]|\/)|(?:^|[\\/])[\w.-]+[\\/][\w.-]+/;

const legacyDetailLabels: Record<string, string> = {
  disabled: '已关闭',
  enabled: '已开启',
  on: '已开启',
  off: '已关闭',
};

function normalizeAuditDetail(value: string) {
  const exact = legacyDetailLabels[value.toLowerCase()];
  if (exact) return exact;
  return value.replace(/ · (split|all)$/i, (_, mode: string) =>
    mode.toLowerCase() === 'split' ? ' · 智能拆分' : ' · 彻底移除',
  );
}

function AuditRow({ log, homeDir }: { log: AuditLogEntry; homeDir?: string }) {
  const time = stamp(log.ts);
  const skillLabel = log.skillName ?? log.skillSlug ?? null;
  const meta = [log.harnessName, log.projectName, log.scopeLabel]
    .filter(Boolean)
    .join(' · ');
  const detail = normalizeAuditDetail(log.detail);
  const path = log.displayPath ?? (pathPattern.test(detail) ? detail : null);
  const pathLabel = path ? displayPath(path, homeDir) : null;
  const target = skillLabel ?? (log.action === 'delete_skill' ? detail : null);
  const extra = detail && detail !== target && detail !== path ? detail : '';

  return (
    <li className="flex gap-3 px-4 py-3 hover:bg-soft/70">
      <time
        dateTime={new Date(log.ts).toISOString()}
        title={time.full}
        className="w-[76px] shrink-0 pt-px font-mono text-[13px] leading-[1.45] tabular-nums text-fg-subtle"
      >
        <span className="block">{time.day}</span>
        <span className="block">{time.time}</span>
      </time>

      <span
        aria-hidden="true"
        className={cn('mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full', actionDot(log.action))}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[14px] font-medium text-fg">{log.actionLabel}</span>
          {target ? (
            <span className="min-w-0 truncate text-[14px] text-fg-muted">{target}</span>
          ) : null}
          <span className="ml-auto shrink-0 rounded-[4px] border border-hairline bg-soft px-2 py-0.5 text-[13px] leading-none text-fg-subtle">
            {log.sourceLabel}
          </span>
        </div>

        {meta || path || extra ? (
          <p className="mt-1 truncate text-[13px] leading-relaxed text-fg-subtle">
            {meta ? <span>{meta}</span> : null}
            {meta && path ? <span className="px-1 text-fg-faint">·</span> : null}
            {pathLabel ? (
              <span className="font-mono text-fg-muted" title={path ?? undefined}>
                {pathLabel}
              </span>
            ) : null}
            {extra ? (
              <>
                {meta || path ? <span className="px-1 text-fg-faint">·</span> : null}
                <span
                  className={cn(
                    /^[0-9a-f]{7,40}$/.test(extra) && 'font-mono',
                    pathPattern.test(extra) && 'font-mono',
                  )}
                  title={extra}
                >
                  {extra}
                </span>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function AuditLogDialog({
  open,
  onClose,
  homeDir,
}: {
  open: boolean;
  onClose: () => void;
  homeDir?: string;
}) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [source, setSource] = useState<AuditSourceFilter>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<AuditExportFormat | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const requestId = useRef(0);
  const desktop = isDesktop();

  useEffect(() => {
    if (!open) return;
    const api = engine();
    if (!api) {
      setLogs([]);
      setError('请先使用桌面端设置中的 Token 解锁本地 Web 服务。');
      return;
    }
    const current = ++requestId.current;
    const timer = window.setTimeout(
      () => {
        setLoading(true);
        void api
          .listAuditLogs({ source, query: query.trim(), limit: 300 })
          .then((result) => {
            if (current !== requestId.current) return;
            setLoading(false);
            if (!result.ok) {
              setError(result.error ?? '无法读取操作日志');
              return;
            }
            setLogs(result.logs ?? []);
            setError(null);
          })
          .catch((cause) => {
            if (current !== requestId.current) return;
            setLoading(false);
            setError(cause instanceof Error ? cause.message : String(cause));
          });
      },
      query.trim() ? 220 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      requestId.current += 1;
    };
  }, [open, source, query, reloadKey]);

  const exportLogs = useCallback(
    async (format: AuditExportFormat) => {
      const api = engine();
      if (!api) {
        toast.info('桌面端专属操作', {
          description: '请通过 npm run dev 启动 Electron 窗口。',
        });
        return;
      }
      const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      const file = await saveFile({
        title: format === 'csv' ? '导出操作日志 CSV' : '导出操作日志 JSON',
        defaultPath: `quiver-audit-${today}.${format}`,
        filters: [
          format === 'csv'
            ? { name: 'CSV 表格', extensions: ['csv'] }
            : { name: 'JSON 数据', extensions: ['json'] },
        ],
      });
      if (!file) return;
      setExporting(format);
      try {
        const result = await api.exportAuditLogs({
          format,
          path: file,
          source,
          query: query.trim(),
        });
        if (!result.ok) {
          toast.error('导出失败', { description: result.error });
          return;
        }
        toast.success('操作日志已导出', {
          description: `${result.count ?? 0} 条 · ${result.path ?? file}`,
          duration: 2800,
        });
        setReloadKey((value) => value + 1);
      } catch (cause) {
        toast.error('导出失败', {
          description: cause instanceof Error ? cause.message : String(cause),
        });
      } finally {
        setExporting(null);
      }
    },
    [query, source],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="操作日志"
      className="h-[min(720px,82vh)] max-w-[860px]"
    >
      <header className="flex shrink-0 items-start justify-between border-b border-hairline px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-[16px] font-semibold text-fg">
            <ScrollText className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} />
            操作日志
          </h2>
          <p className="mt-0.5 text-[13px] text-fg-subtle">
            记录对技能、绑定与项目的每次显式改动
          </p>
        </div>
        <IconButton label="关闭操作日志" onClick={onClose} className="-mr-1">
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline px-4 py-2.5">
        <Segmented<AuditSourceFilter>
          layoutId="audit-source"
          label="日志来源"
          value={source}
          onChange={setSource}
          options={sourceOptions}
        />
        <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-[280px]">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-subtle"
            strokeWidth={1.8}
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索操作日志"
            placeholder="搜索技能、动作或路径"
            spellCheck={false}
            className="h-8 w-full rounded-[6px] border border-hairline bg-soft pl-8 pr-2.5 text-[14px] text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-hairline-strong"
          />
        </div>
        <IconButton
          label="刷新操作日志"
          onClick={() => setReloadKey((value) => value + 1)}
          disabled={loading}
        >
          <RefreshCw
            className={cn('h-3.5 w-3.5', loading && 'animate-spin-slow')}
            strokeWidth={1.8}
          />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && logs.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-[14px] text-fg-subtle">
            <RefreshCw className="h-3 w-3 animate-spin-slow" strokeWidth={1.8} />
            正在读取操作日志…
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="text-[14px] text-fg">无法读取操作日志</p>
            <p className="mt-1 max-w-[380px] text-[13px] leading-relaxed text-fg-subtle">
              {error}
            </p>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-hairline bg-soft">
              <ScrollText className="h-4 w-4 text-fg-subtle" strokeWidth={1.7} />
            </span>
            <p className="mt-3 text-[14px] text-fg">
              {query.trim() || source !== 'all' ? '没有匹配的操作记录' : '还没有操作记录'}
            </p>
            <p className="mt-1 text-[13px] text-fg-subtle">
              {query.trim() || source !== 'all'
                ? '调整来源筛选或搜索关键词后再试。'
                : '启用、导入或调整绑定后，这里会留下可追溯的记录。'}
            </p>
          </div>
        ) : (
          <ul aria-busy={loading} className="divide-y divide-hairline" aria-label="操作日志列表">
            {logs.map((log) => (
              <AuditRow key={log.id} log={log} homeDir={homeDir} />
            ))}
          </ul>
        )}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-hairline px-4 py-2.5">
        <span className="font-mono text-[13px] tabular-nums text-fg-subtle">
          {loading ? '正在同步…' : `最近 ${logs.length} 条`}
        </span>
        {desktop ? (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              className="gap-1.5"
              disabled={exporting !== null}
              onClick={() => void exportLogs('json')}
            >
              <Download className="h-3 w-3" strokeWidth={1.8} />
              {exporting === 'json' ? '导出中…' : '导出 JSON'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="gap-1.5"
              disabled={exporting !== null}
              onClick={() => void exportLogs('csv')}
            >
              <Download className="h-3 w-3" strokeWidth={1.8} />
              {exporting === 'csv' ? '导出中…' : '导出 CSV'}
            </Button>
          </div>
        ) : (
          <span className="text-[13px] text-fg-faint">
            导出日志需要在桌面端选择保存位置
          </span>
        )}
      </footer>
    </Modal>
  );
}
