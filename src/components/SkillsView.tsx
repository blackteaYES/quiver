import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronRight,
  Layers,
  PanelLeftClose,
  Plus,
  Search,
  Star,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { SkillDetail } from '@/components/SkillDetail';
import type { QuiverActions } from '@/lib/actions';
import { favoritesFirst } from '@/lib/favorites';
import { LIST_WIDTH, readListWidth, writeListWidth } from '@/lib/preferences';
import type { AppData } from '@/lib/types';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'fav' | 'drift' | 'idle';

const spring = { type: 'spring' as const, stiffness: 400, damping: 30 };

export function SkillsView({
  data,
  selectedSkillId,
  onSelectSkill,
  mobile,
  detailOpen,
  onOpenDetail,
  onCloseDetail,
  uiScale,
  actions,
}: {
  data: AppData;
  selectedSkillId: string;
  onSelectSkill: (id: string) => void;
  mobile: boolean;
  detailOpen: boolean;
  onOpenDetail: (id: string) => void;
  onCloseDetail: () => void;
  uiScale: number;
  actions: QuiverActions;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [listWidth, setListWidth] = useState<number>(
    () => readListWidth() ?? LIST_WIDTH.defaultValue,
  );
  const [listDragging, setListDragging] = useState(false);
  const lastListWidth = useRef(listWidth > 0 ? listWidth : LIST_WIDTH.defaultValue);
  const listWidthRef = useRef(listWidth);
  listWidthRef.current = listWidth;
  const listHidden = !mobile && listWidth <= 0;

  const commitListWidth = (raw: number) => {
    if (raw < 32) return 0;
    if (raw < 160) return LIST_WIDTH.min;
    return Math.min(LIST_WIDTH.max, raw);
  };

  const beginListResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (mobile) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = listWidth;
    setListDragging(true);
    const move = (moveEvent: PointerEvent) => {
      const next = commitListWidth(startWidth + moveEvent.clientX - startX);
      setListWidth(next);
      if (next > 0) lastListWidth.current = next;
    };
    const stop = () => {
      setListDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      writeListWidth(listWidthRef.current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  const toggleList = () => {
    const next = listHidden ? lastListWidth.current : 0;
    setListWidth(next);
    writeListWidth(next);
  };

  const stats = useMemo(() => {
    const map = new Map<
      string,
      { total: number; drift: number; missing: number; update: number }
    >();
    data.bindings.forEach((binding) => {
      if (binding.state === 'orphaned') return;
      const entry = map.get(binding.skillId) ?? {
        total: 0,
        drift: 0,
        missing: 0,
        update: 0,
      };
      entry.total += 1;
      if (binding.state === 'drifted' && !binding.ignoredDrift) entry.drift += 1;
      if (binding.state === 'missing') entry.missing += 1;
      if (binding.updateAvailable) entry.update += 1;
      map.set(binding.skillId, entry);
    });
    return map;
  }, [data.bindings]);

  const driftSkills = useMemo(
    () =>
      new Set(
        data.bindings
          .filter(
            (binding) =>
              binding.state === 'drifted' && !binding.ignoredDrift,
          )
          .map((binding) => binding.skillId),
      ),
    [data.bindings],
  );

  const idleCount = data.skills.filter(
    (skill) => (stats.get(skill.id)?.total ?? 0) === 0,
  ).length;

  const normalized = query.trim().toLowerCase();
  const visible = favoritesFirst(
    data.skills.filter((skill) => {
      const entry = stats.get(skill.id);
      const matchesQuery =
        !normalized ||
        [
          skill.slug,
          skill.displayName,
          skill.alias ?? '',
          skill.comment ?? '',
          skill.tags.join(' '),
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalized);
      if (!matchesQuery) return false;
      if (filter === 'fav') return Boolean(skill.isFavorite);
      if (filter === 'drift') return driftSkills.has(skill.id);
      if (filter === 'idle') return (entry?.total ?? 0) === 0;
      return true;
    }),
  );

  const selected =
    data.skills.find((skill) => skill.id === selectedSkillId) ?? data.skills[0] ?? null;
  const selectedBindings = selected
    ? data.bindings.filter((binding) => binding.skillId === selected.id)
    : [];

  const filters: { key: Filter; label: string; count?: number; dot?: string }[] = [
    { key: 'all', label: '全部' },
    {
      key: 'fav',
      label: '★ 收藏',
      count: data.skills.filter((skill) => skill.isFavorite).length,
    },
    {
      key: 'drift',
      label: '已修改',
      count: driftSkills.size,
      dot: driftSkills.size > 0 ? 'bg-amber' : undefined,
    },
    { key: 'idle', label: '未分发', count: idleCount },
  ];

  return (
    <section className="flex h-full min-w-0 flex-1">
      {!listHidden ? (
        <div
          style={mobile ? undefined : { width: listWidth }}
          className={cn(
            'relative flex shrink-0 flex-col border-hairline bg-panel/20 @container',
            mobile ? 'w-full' : 'border-r',
            !listDragging && !mobile && 'transition-[width] duration-150 ease-out',
            mobile && detailOpen && 'hidden md:flex',
          )}
        >
          {!mobile ? (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="拖动调整列表宽度，双击收起"
              title="拖动调整宽度，双击收起"
              tabIndex={0}
              onPointerDown={beginListResize}
              onDoubleClick={toggleList}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                const next = commitListWidth(
                  listWidth + (event.key === 'ArrowLeft' ? -16 : 16),
                );
                setListWidth(next);
                if (next > 0) lastListWidth.current = next;
                writeListWidth(next);
              }}
              className="absolute -right-[3px] top-0 z-30 h-full w-[7px] cursor-col-resize touch-none outline-none hover:bg-fg/10 focus-visible:bg-jade/30"
            />
          ) : null}
          <div className="border-b border-hairline p-2.5 pb-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setQuery('');
              }}
              aria-label="搜索技能、别名或标签"
              placeholder="搜索技能、别名或标签…"
              className="h-8 w-full rounded-[6px] border border-hairline bg-soft pl-7 pr-7 text-[14px] text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-hairline-strong focus:bg-soft"
            />
            {query ? (
              <button
                type="button"
                aria-label="清除搜索"
                onClick={() => setQuery('')}
                className="absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-[3px] text-fg-faint hover:bg-soft-strong hover:text-fg-muted"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            ) : null}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1">
            {filters.map((item) => {
              const active = filter === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setFilter(item.key)}
                  className={cn(
                    'flex h-7 items-center gap-1 rounded-[5px] border px-2 text-[13px] transition-colors max-sm:h-10 max-sm:px-3',
                    active
                      ? 'border-hairline bg-soft-strong text-fg'
                      : 'border-transparent text-fg-subtle hover:bg-soft hover:text-fg-muted',
                  )}
                >
                  {item.dot ? (
                    <span className={cn('h-1 w-1 rounded-full', item.dot)} />
                  ) : null}
                  {item.label}
                  {item.count ? (
                    <span className="font-mono text-[13px] text-fg-faint">
                      {item.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-2.5">
          <span className="text-[13px] text-fg-subtle">
            {filter === 'all' && !query ? '全部技能' : '筛选结果'}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[13px] text-fg-faint">
              {visible.length} / {data.skills.length}
            </span>
            {!mobile ? (
              <button
                type="button"
                onClick={toggleList}
                aria-label="收起技能列表"
                title="收起技能列表"
                className="flex h-6 w-6 items-center justify-center rounded-[4px] text-fg-faint transition-colors hover:bg-soft-strong hover:text-fg-muted"
              >
                <PanelLeftClose className="h-3 w-3" strokeWidth={1.8} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {data.skills.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-hairline bg-soft">
                <Layers className="h-3.5 w-3.5 text-fg-faint" />
              </span>
              <p className="mt-3 text-[14px] text-fg-muted">技能库还是空的</p>
              <p className="mt-1 text-[13px] leading-relaxed text-fg-faint">
                导入本地目录、Git 仓库或备份包开始使用。
              </p>
              <Button
                size="xs"
                variant="secondary"
                onClick={actions.openImport}
                className="mt-3 gap-1"
              >
                <Upload className="h-2.5 w-2.5" />
                导入技能
              </Button>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-hairline bg-soft">
                <Search className="h-3.5 w-3.5 text-fg-faint" />
              </span>
              <p className="mt-3 text-[14px] text-fg-muted">没有匹配的技能</p>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
                className="mt-2 text-[13px] text-fg-subtle underline decoration-fg/30 underline-offset-2 hover:text-fg-muted"
              >
                清除筛选
              </button>
            </div>
          ) : (
            <div className="space-y-px">
              {visible.map((skill) => {
                const active = skill.id === selected.id;
                const entry = stats.get(skill.id);
                const drift = driftSkills.has(skill.id);
                const total = entry?.total ?? 0;
                const chip = drift
                  ? {
                      label: entry && entry.drift > 1 ? `已修改 ${entry.drift}` : '已修改',
                      title: `${entry?.drift ?? 1} 处本地修改待处理`,
                      tone: 'border-amber/25 bg-amber/[0.08] text-amber',
                      dot: 'bg-amber shadow-[0_0_6px_rgba(251,191,36,0.55)]',
                    }
                  : (entry?.missing ?? 0) > 0
                    ? {
                        label: '有缺失',
                        title: `${entry?.missing} 处入口未找到`,
                        tone: 'border-rose/25 bg-rose/[0.08] text-rose',
                        dot: 'bg-rose',
                      }
                    : (entry?.update ?? 0) > 0
                      ? {
                          label: '可更新',
                          title: `${entry?.update} 处副本有新版本`,
                          tone: 'border-sky/25 bg-sky/[0.08] text-sky',
                          dot: 'bg-sky',
                        }
                      : total > 0
                        ? {
                            label: `${total} 处`,
                            title: `${total} 处生效`,
                            tone: 'border-jade/25 bg-jade/[0.07] text-jade',
                            dot: 'bg-jade',
                          }
                        : {
                            label: '未分发',
                            title: '尚未启用',
                            tone: 'border-hairline bg-soft text-fg-subtle',
                            dot: 'bg-fg-subtle',
                          };
                const name = skill.displayName?.trim() || skill.slug;
                const intro =
                  skill.comment?.trim() ||
                  skill.tags.map((tag) => `#${tag}`).join(' ') ||
                  '暂无简介';

                return (
                  <div key={skill.id} className="group/row relative">
                    <button
                      type="button"
                      onClick={() =>
                        mobile ? onOpenDetail(skill.id) : onSelectSkill(skill.id)
                      }
                      aria-current={active ? 'true' : undefined}
                      className={cn(
                        'relative block w-full rounded-[8px] px-2.5 py-2.5 pr-9 text-left transition-colors max-sm:pr-12',
                        active ? 'text-fg' : 'hover:bg-soft',
                      )}
                    >
                      {active ? (
                        <motion.span
                          layoutId="skill-row-active"
                          transition={spring}
                          className="absolute inset-0 rounded-[8px] border border-hairline bg-soft-strong shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                        />
                      ) : null}
                      <div className="relative z-10 min-w-0">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span
                            title={chip.title}
                            className={cn(
                              'h-1.5 w-1.5 shrink-0 rounded-full',
                              chip.dot,
                            )}
                          />
                          <span
                            title={name}
                            className={cn(
                              'truncate text-[14.5px] font-medium leading-[1.4]',
                              active ? 'text-fg' : 'text-fg-muted',
                            )}
                          >
                            {name}
                          </span>
                        </div>
                        <div className="mt-1 flex min-w-0 items-center gap-2 pl-3">
                          {skill.alias?.trim() ? (
                            <span
                              title={`别名：${skill.alias}`}
                              className="max-w-[72px] shrink-0 truncate font-mono text-[12.5px] text-fg-faint"
                            >
                              @{skill.alias}
                            </span>
                          ) : null}
                          <span
                            title={skill.comment?.trim() || undefined}
                            className="min-w-0 flex-1 truncate text-[13px] text-fg-subtle"
                          >
                            {intro}
                          </span>
                          <span
                            title={chip.title}
                            className={cn(
                              'shrink-0 rounded-[4px] border px-1.5 py-0.5 text-[12.5px] leading-none',
                              chip.tone,
                            )}
                          >
                            {chip.label}
                          </span>
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={skill.isFavorite ? '取消收藏' : '收藏技能'}
                      aria-pressed={Boolean(skill.isFavorite)}
                      title={
                        skill.isFavorite
                          ? '取消收藏'
                          : '收藏技能（在列表与启用面板中置顶）'
                      }
                      onClick={() => actions.toggleFavorite(skill.id)}
                      className={cn(
                        'absolute right-1.5 top-1.5 z-20 flex h-7 w-7 items-center justify-center rounded-[5px] transition-[color,background-color,opacity] max-sm:h-10 max-sm:w-10',
                        skill.isFavorite
                          ? 'text-amber hover:bg-soft-strong'
                          : 'text-fg-faint opacity-0 hover:bg-soft-strong hover:text-amber focus-visible:opacity-100 group-hover/row:opacity-100 max-sm:opacity-100',
                      )}
                    >
                      <Star
                        className="h-3 w-3"
                        fill={skill.isFavorite ? 'currentColor' : 'none'}
                        strokeWidth={1.8}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-hairline p-2">
          <button
            type="button"
            onClick={actions.openImport}
            className="flex h-9 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] border border-hairline bg-soft text-[14px] text-fg-muted shadow-inset-top transition-colors hover:border-hairline-strong hover:bg-soft-strong hover:text-fg max-md:h-10"
          >
            <Plus className="h-3 w-3 shrink-0" strokeWidth={1.9} />
            <span className="shrink-0">导入技能</span>
            <span className="ml-1 hidden shrink-0 whitespace-nowrap font-mono text-[13px] text-fg-faint @min-[280px]:inline">
              本地 / Git / 备份
            </span>
          </button>
        </div>
      </div>
      ) : null}

      {selected && (!mobile || detailOpen) ? (
        <div className="relative min-w-0 flex-1">
          {listHidden ? (
            <button
              type="button"
              onClick={toggleList}
              aria-label="展开技能列表"
              title="展开技能列表"
              className="absolute left-0 top-1/2 z-30 flex h-12 w-5 -translate-y-1/2 items-center justify-center rounded-r-[6px] border border-l-0 border-hairline bg-panel/90 text-fg-subtle shadow-[0_10px_24px_-18px_rgba(0,0,0,0.8)] backdrop-blur transition-colors hover:bg-soft-strong hover:text-fg"
            >
              <ChevronRight className="h-3 w-3" strokeWidth={1.9} />
            </button>
          ) : null}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${selected.id}-${mobile ? 'mobile' : 'desktop'}`}
              initial={mobile ? { x: 36, opacity: 0 } : { opacity: 0, y: 5 }}
              animate={mobile ? { x: 0, opacity: 1 } : { opacity: 1, y: 0 }}
              exit={mobile ? { x: 24, opacity: 0 } : { opacity: 0, y: -3 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-0 overflow-y-auto"
            >
              <SkillDetail
                skill={selected}
                bindings={selectedBindings}
                projects={data.projects}
                harnesses={data.harnesses}
                settings={data.settings}
                uiScale={uiScale}
                mobile={mobile}
                onBack={mobile ? onCloseDetail : undefined}
                actions={actions}
              />
            </motion.div>
          </AnimatePresence>
        </div>
      ) : !mobile ? (
        <div className="relative min-w-0 flex-1">
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-hairline bg-soft">
              <Layers className="h-4 w-4 text-fg-faint" strokeWidth={1.7} />
            </span>
            <p className="mt-3 text-[14px] text-fg-muted">技能库为空</p>
            <p className="mt-1 max-w-[320px] text-[13px] leading-relaxed text-fg-faint">
              导入的第一个技能会写入只读中央库，之后可以链接到任意 Harness 目录。
            </p>
            <Button
              size="sm"
              variant="primary"
              onClick={actions.openImport}
              className="mt-3 gap-1.5"
            >
              <Upload className="h-3 w-3" />
              导入技能
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
