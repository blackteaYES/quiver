import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  FolderGit2,
  Globe2,
  Link2,
  Plus,
  Search,
  Share2,
  Star,
  X,
} from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { HarnessMark, SkillGlyph } from '@/components/HarnessMark';
import type { EnableIntent } from '@/lib/actions';
import { favoritesFirst } from '@/lib/favorites';
import type {
  AppData,
  EnableSelection,
  Harness,
  HarnessCandidate,
  HarnessId,
  Project,
  Scope,
  SyncMode,
} from '@/lib/types';
import { cn, displayPath } from '@/lib/utils';

const spring = { type: 'spring' as const, stiffness: 400, damping: 30 };
const AGENTS_PATHS: Record<Scope, string> = {
  global: '~/.agents/skills',
  project: '.agents/skills',
};

function normalizedPath(value: string | null | undefined) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

const scopes: { value: Scope; label: string; hint: string; icon: typeof Globe2 }[] = [
  { value: 'global', label: '全局', hint: '所有项目可见', icon: Globe2 },
  { value: 'project', label: '项目', hint: '仅在指定项目内生效', icon: FolderGit2 },
];

const modes: { value: SyncMode; label: string; hint: string; icon: typeof Link2 }[] = [
  { value: 'link', label: '链接', hint: '目标目录指向中央库，随版本切换即时生效', icon: Link2 },
  { value: 'copy', label: '本地副本', hint: '复制到目标目录，可独立修改并产生分叉', icon: Copy },
];

type HarnessFilter = 'active' | 'domestic' | 'global' | 'all';

const HARNESS_FILTERS: { value: HarnessFilter; label: string }[] = [
  { value: 'active', label: '本机活跃' },
  { value: 'domestic', label: '国内主流' },
  { value: 'global', label: '国际主力' },
  { value: 'all', label: '全部' },
];

export function EnableDialog({
  intent,
  data,
  activeProjects,
  onClose,
  onConfirm,
}: {
  intent: EnableIntent | null;
  data: AppData;
  activeProjects: Project[];
  onClose: () => void;
  onConfirm: (skillId: string, selection: EnableSelection) => void;
}) {
  const [skillId, setSkillId] = useState('');
  const [scope, setScope] = useState<Scope>('global');
  const [projectId, setProjectId] = useState('');
  const [harnessIds, setHarnessIds] = useState<HarnessId[]>([]);
  const [targets, setTargets] = useState<Record<HarnessId, string>>({});
  const [syncMode, setSyncMode] = useState<SyncMode>('link');
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [harnessQuery, setHarnessQuery] = useState('');
  const [harnessFilter, setHarnessFilter] = useState<HarnessFilter>('active');
  const [openCandidate, setOpenCandidate] = useState<HarnessId | null>(null);

  useEffect(() => {
    if (!intent) return;
    setSkillId(intent.skillId ?? '');
    setScope(intent.scope ?? 'global');
    setProjectId(intent.projectId ?? activeProjects[0]?.id ?? '');
    setHarnessIds(intent.harnessId ? [intent.harnessId] : []);
    setTargets({});
    setSyncMode('link');
    setQuery('');
    setPickerOpen(!intent.skillId);
    const preset = intent.harnessId
      ? data.harnesses.find((item) => item.id === intent.harnessId)
      : null;
    setHarnessQuery('');
    setHarnessFilter(
      preset && !(preset.detected || preset.managedCount > 0) ? 'all' : 'active',
    );
    setOpenCandidate(null);
    // Only re-initialize when a new intent arrives; activeProjects is a fresh array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  const skill = data.skills.find((item) => item.id === skillId);
  const project = activeProjects.find((item) => item.id === projectId);

  const boundHere = useMemo(() => {
    const set = new Set<HarnessId>();
    data.bindings.forEach((binding) => {
      if (binding.skillId !== skillId || binding.scope !== scope) return;
      if (scope === 'project' && binding.projectId !== projectId) return;
      set.add(binding.harnessId);
    });
    return set;
  }, [data.bindings, projectId, scope, skillId]);

  const enabledHarnessIds = harnessIds.filter((id) => !boundHere.has(id));

  const normalized = query.trim().toLowerCase();
  const visibleSkills = favoritesFirst(
    data.skills.filter(
      (item) =>
        !normalized ||
        [item.slug, item.displayName, item.alias ?? '', item.tags.join(' ')]
          .join(' ')
          .toLowerCase()
          .includes(normalized),
    ),
    (left, right) => left.displayName.localeCompare(right.displayName),
  );

  const scopeCandidates = (harness: Harness) =>
    harness.candidates.filter(
      (candidate) => candidate.scope === scope && candidate.role !== 'synced',
    );

  const normalizedHarnessQuery = harnessQuery.trim().toLowerCase();
  const visibleHarnesses = useMemo(
    () =>
      data.harnesses.filter((item) => {
        if (harnessFilter === 'active' && !(item.detected || item.managedCount > 0)) {
          return false;
        }
        if (harnessFilter === 'domestic' && item.category !== 'domestic') return false;
        if (harnessFilter === 'global' && item.category !== 'global') return false;
        if (!normalizedHarnessQuery) return true;
        return [item.name, item.shortName, item.id, item.command ?? '', ...item.candidates.map((candidate) => candidate.path)]
          .join(' ')
          .toLowerCase()
          .includes(normalizedHarnessQuery);
      }),
    [data.harnesses, harnessFilter, normalizedHarnessQuery],
  );

  const selectedCandidate = (harness: Harness): HarnessCandidate | null => {
    const scoped = scopeCandidates(harness);
    if (scoped.length === 0) return null;
    const chosen = targets[harness.id];
    const match = chosen ? scoped.find((candidate) => candidate.id === chosen) : null;
    return (
      match ??
      scoped.find((candidate) => candidate.role === 'primary') ??
      scoped[0]
    );
  };

  const quickShared = useMemo(() => {
    const wanted = normalizedPath(AGENTS_PATHS[scope]);
    const matches: { harness: Harness; candidate: HarnessCandidate }[] = [];
    data.harnesses.forEach((harness) => {
      harness.candidates.forEach((candidate) => {
        if (candidate.scope === scope && normalizedPath(candidate.path) === wanted) {
          matches.push({ harness, candidate });
        }
      });
    });
    if (matches.length === 0) return null;
    const primary =
      matches.find((item) => item.harness.id === 'agents-common') ?? matches[0];
    const readerIds = new Set(matches.map((item) => item.harness.id));
    const readers = data.harnesses.filter(
      (harness) =>
        readerIds.has(harness.id) &&
        (harness.detected || harness.managedCount > 0 || harness.id === primary.harness.id),
    );
    return { ...primary, readers, total: readerIds.size };
  }, [data.harnesses, scope]);

  const quickBound = Boolean(
    quickShared &&
      (boundHere.has(quickShared.harness.id) ||
        data.bindings.some(
          (binding) =>
            binding.skillId === skillId &&
            binding.scope === scope &&
            binding.state !== 'orphaned' &&
            (scope === 'global' || binding.projectId === projectId) &&
            normalizedPath(binding.candidatePath) ===
              normalizedPath(quickShared.candidate.path),
        ) ||
        data.unmanaged.some(
          (item) =>
            item.name === skill?.slug &&
            item.scope === scope &&
            item.shared &&
            (scope === 'global' || item.projectId === projectId),
        )),
  );
  const quickActive = Boolean(
    quickShared &&
      !quickBound &&
      harnessIds.includes(quickShared.harness.id) &&
      selectedCandidate(quickShared.harness)?.id === quickShared.candidate.id,
  );

  const previewPath = (harness: Harness) => {
    const candidate = selectedCandidate(harness);
    if (!candidate) return '';
    const base = candidate.displayPath || candidate.path;
    const joined =
      scope === 'project' && project
        ? `${(project.realPath || project.path).replace(/[\\/]$/, '')}/${candidate.path
            .replace(/^\.?\//, '')
            .replace(/\\/g, '/')}`
        : base;
    return skill ? `${joined.replace(/[\\/]$/, '')}/${skill.slug}` : joined;
  };

  const targetPayload = enabledHarnessIds
    .map((id) => {
      const harness = data.harnesses.find((item) => item.id === id);
      const candidate = harness ? selectedCandidate(harness) : null;
      return candidate ? { harnessId: id, candidateId: candidate.id } : null;
    })
    .filter((item): item is { harnessId: HarnessId; candidateId: string } => Boolean(item));

  const canConfirm =
    Boolean(skill) &&
    targetPayload.length > 0 &&
    targetPayload.length === enabledHarnessIds.length &&
    (scope === 'global' || Boolean(project));

  const toggleQuickShared = () => {
    if (!quickShared || quickBound) return;
    if (quickActive) {
      setHarnessIds((prev) => prev.filter((id) => id !== quickShared.harness.id));
      setTargets((prev) => {
        const next = { ...prev };
        delete next[quickShared.harness.id];
        return next;
      });
      return;
    }
    setHarnessIds((prev) =>
      prev.includes(quickShared.harness.id)
        ? prev
        : [...prev, quickShared.harness.id],
    );
    setTargets((prev) => ({
      ...prev,
      [quickShared.harness.id]: quickShared.candidate.id,
    }));
  };

  const chooseCandidate = (harness: Harness, candidateId: string) => {
    setTargets((prev) => ({ ...prev, [harness.id]: candidateId }));
    setHarnessIds((prev) =>
      prev.includes(harness.id) ? prev : [...prev, harness.id],
    );
  };

  return (
    <AnimatePresence>
      {intent ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-6 max-sm:p-4">
          <motion.div
            key="enable-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
            className="absolute inset-0 bg-overlay backdrop-blur-[3px]"
          />

          <motion.div
            key="enable-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="enable-title"
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 6 }}
            transition={spring}
            className="relative flex max-h-[min(740px,calc(100vh-110px))] w-[600px] max-w-full flex-col overflow-hidden rounded-[12px] border border-hairline bg-raised shadow-float"
          >
            <header className="flex items-start gap-3 border-b border-hairline px-4 py-3.5">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-hairline bg-soft text-fg-muted shadow-inset-top">
                <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="enable-title" className="text-[16px] font-semibold text-fg">
                  启用到…
                </h2>
                <p className="mt-0.5 text-[13px] text-fg-subtle">
                  在目标 Harness 目录建立入口。中央库保持只读，解链不会删除源文件。
                </p>
              </div>
              <IconButton
                label="关闭"
                onClick={onClose}
                className="-mr-1 max-sm:h-10 max-sm:w-10"
              >
                <X className="h-3.5 w-3.5" />
              </IconButton>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
              <section>
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-medium text-fg-muted">技能</span>
                  {skill && !pickerOpen ? (
                    <button
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      className="text-[14px] text-fg-subtle underline decoration-fg/30 underline-offset-2 hover:text-fg-muted max-sm:inline-flex max-sm:min-h-10 max-sm:items-center max-sm:px-2"
                    >
                      更换
                    </button>
                  ) : null}
                </div>

                {skill && !pickerOpen ? (
                  <div className="mt-1.5 flex items-center gap-2.5 rounded-[8px] border border-hairline bg-soft px-2.5 py-2 shadow-inset-top">
                    <SkillGlyph slug={skill.slug} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1 font-mono text-[14px] text-fg">
                        {skill.isFavorite ? (
                          <Star
                            className="h-2.5 w-2.5 shrink-0 text-amber"
                            fill="currentColor"
                            strokeWidth={1.6}
                          />
                        ) : null}
                        <span className="truncate">{skill.slug}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[13px] text-fg-subtle">
                        {skill.displayName}
                      </div>
                    </div>
                    <span className="mono-pill shrink-0 text-fg-subtle">
                      @{skill.activeSha.slice(0, 7)}
                    </span>
                  </div>
                ) : (
                  <div className="mt-1.5">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-subtle" />
                      <input
                        autoFocus
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        aria-label="搜索要启用的技能"
                        placeholder="搜索技能…"
                        className="h-8 w-full rounded-[6px] border border-hairline bg-soft pl-8 pr-2.5 text-[14px] text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-hairline-strong focus:bg-soft max-sm:h-10"
                      />
                    </div>
                    <div className="mt-1.5 max-h-[148px] overflow-y-auto rounded-[7px] border border-hairline bg-soft">
                      {visibleSkills.length === 0 ? (
                        <p className="px-3 py-4 text-center text-[13px] text-fg-faint">
                          没有匹配的技能
                        </p>
                      ) : (
                        visibleSkills.map((item) => {
                          const active = item.id === skillId;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                setSkillId(item.id);
                                setHarnessIds([]);
                                setPickerOpen(false);
                              }}
                              className={cn(
                                'flex w-full items-center gap-2.5 border-b border-hairline px-2.5 py-2 text-left last:border-b-0 transition-colors',
                                active ? 'bg-soft-strong' : 'hover:bg-soft',
                              )}
                            >
                              <SkillGlyph slug={item.slug} className="h-5 w-5 text-[13px]" />
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1 truncate font-mono text-[14px] text-fg-muted">
                                  {item.isFavorite ? (
                                    <Star
                                      className="h-2.5 w-2.5 shrink-0 text-amber"
                                      fill="currentColor"
                                      strokeWidth={1.6}
                                    />
                                  ) : null}
                                  <span className="truncate">{item.slug}</span>
                                </span>
                                <span className="block truncate text-[13px] text-fg-subtle">
                                  {item.displayName}
                                </span>
                              </span>
                              {active ? <Check className="h-3 w-3 text-fg" /> : null}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </section>

              <section className="mt-4">
                <span className="text-[14px] font-medium text-fg-muted">作用域</span>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5 rounded-[8px] border border-hairline bg-soft p-1">
                  {scopes.map((option) => {
                    const active = scope === option.value;
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setScope(option.value);
                          setOpenCandidate(null);
                        }}
                        aria-pressed={active}
                        className={cn(
                          'relative flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-left transition-colors',
                          active ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted',
                        )}
                      >
                        {active ? (
                          <motion.span
                            layoutId="enable-scope-active"
                            transition={spring}
                            className="absolute inset-0 rounded-[6px] border border-hairline bg-soft-strong shadow-inset-top"
                          />
                        ) : null}
                        <Icon
                          className={cn(
                            'relative h-3 w-3',
                            active ? 'text-fg' : 'text-fg-faint',
                          )}
                          strokeWidth={1.8}
                        />
                        <span className="relative min-w-0">
                          <span className="block text-[14px] leading-tight">{option.label}</span>
                          <span className="mt-0.5 block truncate text-[13px] leading-tight text-fg-subtle">
                            {option.hint}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                <AnimatePresence initial={false}>
                  {scope === 'project' ? (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={spring}
                      className="overflow-hidden"
                    >
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {activeProjects.length === 0 ? (
                          <span className="text-[13px] text-rose/80">
                            还没有可用项目，请先在「项目」视图添加。
                          </span>
                        ) : (
                          activeProjects.map((item) => {
                            const active = item.id === projectId;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => setProjectId(item.id)}
                                className={cn(
                                  'flex h-[24px] items-center gap-1.5 rounded-[5px] border px-2 font-mono text-[13px] transition-colors max-sm:h-10',
                                  active
                                    ? 'border-hairline-strong bg-soft-strong text-fg'
                                    : 'border-hairline bg-transparent text-fg-subtle hover:bg-soft hover:text-fg-muted',
                                )}
                              >
                                <FolderGit2 className="h-2.5 w-2.5" strokeWidth={1.8} />
                                {item.name}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </section>

              {quickShared ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={quickActive || quickBound}
                  aria-label="一键启用到跨工具共享层"
                  disabled={quickBound}
                  onClick={toggleQuickShared}
                  title={
                    quickBound
                      ? '该技能已存在于共享层'
                      : `将写入 ${AGENTS_PATHS[scope]}，所有读取该目录的工具都会看到`
                  }
                  className={cn(
                    'mt-4 flex w-full items-start gap-2 rounded-[8px] border p-2.5 text-left transition-colors',
                    quickActive || quickBound
                      ? 'border-hairline-strong bg-soft-strong shadow-inset-top'
                      : 'border-hairline bg-soft hover:border-hairline-strong',
                    quickBound && 'cursor-default opacity-80',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
                      quickActive || quickBound
                        ? 'border-jade/60 bg-jade/15 text-jade'
                        : 'border-hairline-strong text-transparent',
                    )}
                  >
                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5 text-[14px] text-fg-muted">
                      <Share2 className="h-3 w-3 text-fg-subtle" strokeWidth={1.8} />
                      一键启用到跨工具共享层
                      <span className="mono-pill text-fg-subtle">{AGENTS_PATHS[scope]}</span>
                      {quickBound ? (
                        <span className="rounded-[4px] border border-jade/20 bg-jade/[0.06] px-1.5 py-0.5 text-[12.5px] text-jade">
                          已生效
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-[13px] leading-relaxed text-fg-subtle">
                      {quickShared.readers.length > 0
                        ? `当前有 ${quickShared.readers.length} 个活跃工具读取该层：${quickShared.readers
                            .map((item) => item.name)
                            .join('、')}`
                        : `创建后将对 ${quickShared.total} 个工具可见`}
                      ；启用后无需在下方逐个重复建立入口。
                    </span>
                  </span>
                </button>
              ) : null}

              <section className="mt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium text-fg-muted">目标 Harness</span>
                  <span className="font-mono text-[13px] text-fg-subtle">
                    已选 {enabledHarnessIds.length} 个
                  </span>
                  <div className="relative ml-auto min-w-[150px] flex-1 sm:max-w-[210px] sm:flex-none">
                    <Search
                      className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-faint"
                      strokeWidth={1.8}
                    />
                    <input
                      value={harnessQuery}
                      onChange={(event) => setHarnessQuery(event.target.value)}
                      aria-label="搜索目标 Harness"
                      placeholder="搜索工具…"
                      spellCheck={false}
                      className="h-7 w-full rounded-[5px] border border-hairline bg-soft pl-7 pr-2 text-[13px] text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-hairline-strong max-sm:h-10"
                    />
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {HARNESS_FILTERS.map((option) => {
                    const active = harnessFilter === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setHarnessFilter(option.value)}
                        aria-pressed={active}
                        className={cn(
                          'flex h-[24px] items-center rounded-[5px] border px-2 text-[13px] transition-colors max-sm:h-10',
                          active
                            ? 'border-hairline-strong bg-soft-strong text-fg'
                            : 'border-hairline bg-transparent text-fg-subtle hover:bg-soft hover:text-fg-muted',
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                  <span className="ml-auto font-mono text-[12.5px] text-fg-faint">
                    {visibleHarnesses.length} / {data.harnesses.length}
                  </span>
                </div>

                {data.harnesses.length === 0 ? (
                  <p className="mt-2 rounded-[7px] border border-dashed border-hairline px-3 py-4 text-center text-[13px] text-fg-faint">
                    还没有可用的工具映射，请先在设置中添加。
                  </p>
                ) : visibleHarnesses.length === 0 ? (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-[7px] border border-dashed border-hairline px-3 py-4">
                    <span className="text-[13px] text-fg-faint">没有匹配的工具</span>
                    <button
                      type="button"
                      onClick={() => {
                        setHarnessFilter('all');
                        setHarnessQuery('');
                      }}
                      className="text-[13px] text-fg-subtle underline decoration-fg/30 underline-offset-2 hover:text-fg-muted max-sm:min-h-10"
                    >
                      查看全部 {data.harnesses.length} 个工具
                    </button>
                  </div>
                ) : null}
                <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {visibleHarnesses.map((item) => {
                    const bound = boundHere.has(item.id);
                    const scoped = scopeCandidates(item);
                    const candidate = selectedCandidate(item);
                    const unavailable = scoped.length === 0;
                    const active = harnessIds.includes(item.id) && !bound;
                    const preview = bound ? null : previewPath(item);
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          'rounded-[7px] border p-2.5 transition-colors duration-150',
                          bound
                            ? 'border-hairline/60 bg-soft opacity-45'
                            : active
                              ? 'border-hairline-strong bg-soft-strong shadow-inset-top'
                              : 'border-hairline bg-transparent',
                        )}
                      >
                        <button
                          type="button"
                          disabled={bound || unavailable}
                          onClick={() => {
                            if (bound || !candidate) return;
                            if (active) {
                              setHarnessIds((prev) =>
                                prev.filter((id) => id !== item.id),
                              );
                              setTargets((prev) => {
                                const next = { ...prev };
                                delete next[item.id];
                                return next;
                              });
                              return;
                            }
                            setHarnessIds((prev) =>
                              prev.includes(item.id) ? prev : [...prev, item.id],
                            );
                            setTargets((prev) => ({
                              ...prev,
                              [item.id]: candidate.id,
                            }));
                          }}
                          aria-pressed={active}
                          className="flex w-full items-center gap-2 text-left disabled:cursor-default max-sm:min-h-10"
                        >
                          <HarnessMark harnessId={item.id} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1 text-[14px] leading-tight text-fg-muted">
                              <span className="truncate">{item.name}</span>
                            </span>
                            <span
                              title={preview ?? undefined}
                              className="mt-0.5 block truncate font-mono text-[13px] leading-tight text-fg-subtle"
                            >
                              {bound
                                ? '已在此生效'
                                : unavailable
                                  ? '该作用域没有候选路径'
                                  : displayPath(
                                      preview ?? '',
                                      data.settings.homeDir,
                                    )}
                            </span>
                          </span>
                          <span
                            className={cn(
                              'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors',
                              active
                                ? 'border-primary bg-primary text-primary-fg'
                                : 'border-hairline-strong text-transparent',
                            )}
                          >
                            <Check className="h-2.5 w-2.5" strokeWidth={3} />
                          </span>
                        </button>
                        {!bound && !unavailable ? (
                          <div className="relative mt-2">
                            <button
                              type="button"
                              onClick={() =>
                                setOpenCandidate((prev) =>
                                  prev === item.id ? null : item.id,
                                )
                              }
                              aria-expanded={openCandidate === item.id}
                              aria-haspopup="listbox"
                              aria-label={`${item.name} 的写入候选路径`}
                              title="选择该工具具体写入的候选路径"
                              className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-[5px] border border-hairline bg-soft px-2 text-left transition-colors hover:border-hairline-strong focus:border-hairline-strong focus-visible:outline-none max-sm:h-10"
                            >
                              <span className="shrink-0 text-[12.5px] text-fg-faint">
                                {candidate?.roleLabel ?? '候选路径'}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg-subtle">
                                {displayPath(
                                  candidate?.displayPath || candidate?.path || '',
                                  data.settings.homeDir,
                                )}
                              </span>
                              <ChevronDown
                                className={cn(
                                  'h-3 w-3 shrink-0 text-fg-faint transition-transform',
                                  openCandidate === item.id && 'rotate-180',
                                )}
                                strokeWidth={1.8}
                              />
                            </button>
                            <AnimatePresence initial={false}>
                              {openCandidate === item.id ? (
                                <motion.ul
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: 'auto' }}
                                  exit={{ opacity: 0, height: 0 }}
                                  transition={{ duration: 0.14 }}
                                  role="listbox"
                                  aria-label={`${item.name} 的候选路径`}
                                  className="mt-1 overflow-hidden rounded-[6px] border border-hairline bg-soft"
                                >
                                  {scoped.map((entry) => {
                                    const chosen = candidate?.id === entry.id;
                                    return (
                                      <li key={entry.id}>
                                        <button
                                          type="button"
                                          role="option"
                                          aria-selected={chosen}
                                          onClick={() => {
                                            chooseCandidate(item, entry.id);
                                            setOpenCandidate(null);
                                          }}
                                          className={cn(
                                            'flex w-full items-start gap-1.5 border-b border-hairline px-2 py-1.5 text-left last:border-b-0 max-sm:min-h-10',
                                            chosen
                                              ? 'bg-soft-strong'
                                              : 'hover:bg-soft-strong/60',
                                          )}
                                        >
                                          <Check
                                            className={cn(
                                              'mt-0.5 h-2.5 w-2.5 shrink-0',
                                              chosen ? 'text-fg' : 'text-transparent',
                                            )}
                                            strokeWidth={2.6}
                                          />
                                          <span className="min-w-0 flex-1">
                                            <span className="block text-[12.5px] leading-tight text-fg-muted">
                                              {entry.roleLabel}
                                            </span>
                                            <span className="mt-0.5 block break-all font-mono text-[12.5px] leading-[1.5] text-fg-subtle">
                                              {displayPath(
                                                entry.displayPath || entry.path,
                                                data.settings.homeDir,
                                              )}
                                            </span>
                                          </span>
                                        </button>
                                      </li>
                                    );
                                  })}
                                </motion.ul>
                              ) : null}
                            </AnimatePresence>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="mt-4">
                <span className="text-[14px] font-medium text-fg-muted">部署方式</span>
                <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {modes.map((option) => {
                    const active = syncMode === option.value;
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setSyncMode(option.value)}
                        aria-pressed={active}
                        className={cn(
                          'rounded-[7px] border p-2 text-left transition-colors duration-150',
                          active
                            ? 'border-hairline-strong bg-soft-strong shadow-inset-top'
                            : 'border-hairline bg-transparent hover:border-hairline hover:bg-soft',
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          <Icon
                            className={cn(
                              'h-3 w-3',
                              active ? 'text-fg' : 'text-fg-subtle',
                            )}
                            strokeWidth={1.8}
                          />
                          <span className="text-[14px] text-fg-muted">{option.label}</span>
                          {active ? (
                            <Check className="ml-auto h-3 w-3 text-fg" />
                          ) : null}
                        </span>
                        <span className="mt-1 block text-[13px] leading-[1.5] text-fg-subtle">
                          {option.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-hairline bg-soft px-4 py-3 max-sm:flex-col max-sm:items-stretch">
              <div className="min-w-0 text-[13px] leading-[1.6] text-fg-subtle">
                {skill ? (
                  <>
                    <span className="font-mono text-fg-subtle">{skill.slug}</span>
                    <span className="px-1">/</span>
                    {scope === 'global' ? '全局' : project?.name ?? '项目未选择'}
                    <span className="px-1">/</span>
                    {syncMode === 'link' ? '链接' : '副本'}
                  </>
                ) : (
                  '选择一个技能后继续'
                )}
                <div className="mt-0.5 flex items-center gap-1">
                  <ArrowRight className="h-2.5 w-2.5" />
                  将在 {targetPayload.length} 个目录建立入口
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 max-sm:w-full">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onClose}
                  className="max-sm:min-h-10 max-sm:flex-1"
                >
                  取消
                </Button>
                <Button
                  size="md"
                  variant="primary"
                  disabled={!canConfirm}
                  onClick={() => {
                    if (!skill || !canConfirm) return;
                    onConfirm(skill.id, {
                      harnessIds: targetPayload.map((item) => item.harnessId),
                      targets: targetPayload,
                      scope,
                      projectId: scope === 'project' ? projectId : undefined,
                      syncMode,
                    });
                  }}
                  className="min-w-[92px] max-sm:min-h-10 max-sm:flex-1"
                >
                  启用
                </Button>
              </div>
            </footer>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
