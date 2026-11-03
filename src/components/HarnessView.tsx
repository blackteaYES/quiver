import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArchiveRestore,
  Check,
  ChevronDown,
  Cloud,
  EyeOff,
  FolderGit2,
  FolderPlus,
  Globe2,
  Layers,
  Link2,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Share2,
  Star,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Pill } from '@/components/ui/Pill';
import { HarnessMark, SkillGlyph } from '@/components/HarnessMark';
import { PathPill } from '@/components/PathPill';
import { StatusBadge } from '@/components/StatusBadge';
import { VersionPill } from '@/components/VersionPill';
import { DriftResolution, RowActions } from '@/components/BindingActions';
import { pickFolder } from '@/lib/desktop';
import type { QuiverActions } from '@/lib/actions';
import type {
  AppData,
  Binding,
  HarnessCandidate,
  HarnessId,
  Project,
  ScopeMode,
  Skill,
  UnmanagedSkill,
} from '@/lib/types';
import { cn, displayPath } from '@/lib/utils';

const spring = { type: 'spring' as const, stiffness: 400, damping: 30 };

type BindingFilter = 'all' | 'enabled' | 'drifted' | 'missing' | 'updatable';
type HarnessFilter = 'active' | 'all' | 'domestic' | 'global' | 'custom';

const HARNESS_FILTERS: { value: HarnessFilter; label: string }[] = [
  { value: 'active', label: '本机活跃' },
  { value: 'all', label: '全部' },
  { value: 'domestic', label: '国内主流' },
  { value: 'global', label: '国际主力' },
  { value: 'custom', label: '自定义' },
];

const ROLE_ICONS = {
  primary: Star,
  shared: Share2,
  compat: Link2,
  synced: Cloud,
  custom: FolderPlus,
} as const;

function harnessIsActive(harness: AppData['harnesses'][number]) {
  return (
    harness.detected ||
    harness.managedCount > 0 ||
    harness.category === 'shared' ||
    !harness.isBuiltin
  );
}

function normalizedPath(value: string | null | undefined) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

const FILTER_LABELS: Record<Exclude<BindingFilter, 'all'>, string> = {
  enabled: '已启用',
  drifted: '已修改',
  missing: '未找到',
  updatable: '可更新',
};

function HarnessBindingRow({
  binding,
  skill,
  project,
  showScope,
  homeDir,
  actions,
}: {
  binding: Binding;
  skill: Skill;
  project?: Project;
  showScope: boolean;
  homeDir?: string;
  actions: QuiverActions;
}) {
  const isDrift = binding.state === 'drifted' && !binding.ignoredDrift;

  return (
    <div className="group/row px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => actions.openSkill(skill.id)}
              className="flex min-w-0 items-center gap-1.5 rounded-[4px] text-left outline-none focus-visible:ring-1 focus-visible:ring-fg/30"
              title="在技能库中查看"
            >
              <SkillGlyph slug={skill.slug} className="h-6 w-6 rounded-[5px] text-[13px]" />
              <span className="truncate font-mono text-[15px] font-medium text-fg transition-colors hover:text-fg-muted">
                {skill.slug}
              </span>
            </button>
            <span className="hidden truncate text-[14px] text-fg-subtle sm:inline">
              {skill.displayName}
            </span>
            <StatusBadge
              state={binding.state}
              updatable={Boolean(binding.updateAvailable)}
              ignored={binding.ignoredDrift}
            />
            <Pill mono tone="outline">
              {binding.syncMode === 'link' ? '链接' : '副本'}
            </Pill>
            {showScope ? (
              <Pill mono tone={binding.scope === 'global' ? 'muted' : 'neutral'}>
                {binding.scope === 'global' ? (
                  <Globe2 className="h-3 w-3" />
                ) : (
                  <FolderGit2 className="h-3 w-3" />
                )}
                {binding.scope === 'global' ? '全局' : project?.name ?? '项目'}
              </Pill>
            ) : null}
            <VersionPill binding={binding} skill={skill} />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
            <PathPill
              path={binding.displayPath}
              localRel={binding.localRel}
              realPath={binding.realPath}
              homeDir={homeDir}
              className="max-w-[540px] max-sm:w-full"
            />
            <span className="whitespace-nowrap font-mono text-[13px] text-fg-subtle opacity-45 transition-opacity duration-150 max-lg:opacity-100 group-hover/row:opacity-100">
              部署于 {binding.deployedAt}
            </span>
          </div>
        </div>
        <div className="w-full shrink-0 sm:w-auto sm:pt-0.5">
          <RowActions
            binding={binding}
            onConvert={actions.convertToCopy}
            onUpdate={actions.updateBinding}
            onDisable={actions.disableBinding}
            onRedeploy={actions.redeployBinding}
            onRemove={actions.disableBinding}
            onRelocate={() => {
              if (binding.projectId) actions.relocateProject(binding.projectId);
            }}
          />
        </div>
      </div>

      <AnimatePresence initial={false}>
        {isDrift ? (
          <DriftResolution
            binding={binding}
            onReset={() => actions.resetBinding(binding.id)}
            onAdopt={() => actions.adoptBinding(binding.id)}
            onIgnore={() => actions.ignoreDrift(binding.id)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function HarnessView({
  data,
  selectedHarnessId,
  onSelectHarness,
  scopeMode,
  onScopeModeChange,
  selectedProjectId,
  onSelectProject,
  activeProjects,
  actions,
  scanningHarness,
  onCreateHarness,
  onEditHarnessChain,
}: {
  data: AppData;
  selectedHarnessId: HarnessId;
  onSelectHarness: (id: HarnessId) => void;
  scopeMode: ScopeMode;
  onScopeModeChange: (mode: ScopeMode) => void;
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  activeProjects: Project[];
  actions: QuiverActions;
  scanningHarness: HarnessId | null;
  onCreateHarness: () => void;
  onEditHarnessChain: (harnessId: HarnessId) => void;
}) {
  const harness = data.harnesses.find((item) => item.id === selectedHarnessId) ?? data.harnesses[0];
  const project = activeProjects.find((item) => item.id === selectedProjectId);
  const [bindingFilter, setBindingFilter] = useState<BindingFilter>('all');
  const [harnessFilter, setHarnessFilter] = useState<HarnessFilter>('active');
  const [harnessQuery, setHarnessQuery] = useState('');
  const [candidateFilter, setCandidateFilter] = useState<string>('all');
  const [uncreatedExpanded, setUncreatedExpanded] = useState(false);
  const [externalExpanded, setExternalExpanded] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingBatch, setPendingBatch] = useState<{
    mode: 'adopt' | 'register';
    ids: string[];
  } | null>(null);
  const managedRef = useRef<HTMLElement>(null);
  const externalRef = useRef<HTMLElement>(null);

  const harnessCounts = useMemo(() => {
    const map = new Map<HarnessId, number>();
    data.bindings.forEach((binding) => {
      if (binding.state === 'orphaned') return;
      if (binding.scope === 'global') {
        map.set(binding.harnessId, (map.get(binding.harnessId) ?? 0) + 1);
        return;
      }
      if (scopeMode === 'overlay' && binding.projectId === selectedProjectId) {
        map.set(binding.harnessId, (map.get(binding.harnessId) ?? 0) + 1);
      }
    });
    return map;
  }, [data.bindings, scopeMode, selectedProjectId]);

  const matchedHarnesses = useMemo(() => {
    const normalized = harnessQuery.trim().toLowerCase();
    return data.harnesses.filter((item) => {
      if (
        (harnessFilter === 'domestic' ||
          harnessFilter === 'global' ||
          harnessFilter === 'custom') &&
        item.category !== harnessFilter
      ) {
        return false;
      }
      if (!normalized) return true;
      return [
        item.id,
        item.name,
        item.shortName,
        item.categoryLabel,
        ...item.candidates.map((candidate) => candidate.path),
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalized);
    });
  }, [data.harnesses, harnessFilter, harnessQuery]);

  const activeHarnesses = useMemo(
    () => matchedHarnesses.filter(harnessIsActive),
    [matchedHarnesses],
  );
  const inactiveHarnesses = useMemo(
    () => matchedHarnesses.filter((item) => !harnessIsActive(item)),
    [matchedHarnesses],
  );
  const visibleHarnesses = useMemo(() => {
    if (harnessFilter === 'active' && !harnessQuery.trim()) return activeHarnesses;
    return [...activeHarnesses, ...inactiveHarnesses];
  }, [activeHarnesses, harnessFilter, harnessQuery, inactiveHarnesses]);

  const filterCount = (value: HarnessFilter) => {
    if (value === 'all') return data.harnesses.length;
    if (value === 'active') return data.harnesses.filter(harnessIsActive).length;
    return data.harnesses.filter((item) => item.category === value).length;
  };

  const candidates = useMemo(
    () =>
      harness
        ? [...harness.candidates].sort(
            (left, right) => left.priority - right.priority,
          )
        : [],
    [harness],
  );
  const scopedCandidates = useMemo(
    () =>
      scopeMode === 'global'
        ? candidates.filter((candidate) => candidate.scope === 'global')
        : candidates,
    [candidates, scopeMode],
  );
  const primaryCandidate =
    candidates.find(
      (candidate) => candidate.scope === 'global' && candidate.role === 'primary',
    ) ??
    candidates.find((candidate) => candidate.role === 'primary') ??
    candidates[0];
  const primaryPathLabel = primaryCandidate
    ? displayPath(
        primaryCandidate.displayPath || primaryCandidate.path,
        data.settings.homeDir,
      ) || primaryCandidate.path
    : '';
  const createdCandidates = scopedCandidates.filter(
    (candidate) =>
      candidate.exists || candidate.skillCount > 0 || candidate.managedCount > 0,
  );
  const uncreatedCandidates = scopedCandidates.filter(
    (candidate) => !createdCandidates.includes(candidate),
  );
  const activeCandidate =
    candidateFilter === 'all'
      ? null
      : scopedCandidates.find((candidate) => candidate.id === candidateFilter) ?? null;

  const candidateMatches = (candidatePath?: string | null) =>
    candidateFilter === 'all' ||
    (activeCandidate
      ? normalizedPath(candidatePath) === normalizedPath(activeCandidate.path)
      : false);

  const visibleBindings = useMemo(() => {
    return data.bindings.filter((binding) => {
      if (binding.harnessId !== selectedHarnessId) return false;
      if (binding.state === 'orphaned') return false;
      if (binding.scope === 'global') return candidateMatches(binding.candidatePath);
      return (
        scopeMode === 'overlay' &&
        binding.projectId === selectedProjectId &&
        candidateMatches(binding.candidatePath)
      );
    });
  }, [activeCandidate, candidateFilter, data.bindings, scopeMode, selectedHarnessId, selectedProjectId]);

  const stats = useMemo(() => {
    return {
      enabled: visibleBindings.filter((binding) => binding.state === 'enabled').length,
      drifted: visibleBindings.filter(
        (binding) => binding.state === 'drifted' && !binding.ignoredDrift,
      ).length,
      missing: visibleBindings.filter((binding) => binding.state === 'missing').length,
      updatable: visibleBindings.filter((binding) => binding.updateAvailable).length,
    };
  }, [visibleBindings]);

  const sharedUnmanaged = data.unmanaged.filter(
    (item) =>
      item.harnessId === selectedHarnessId ||
      item.harnessIds?.includes(selectedHarnessId),
  );
  const unmanaged = sharedUnmanaged.filter((item) =>
    candidateMatches(item.candidatePath),
  );
  const scanning = scanningHarness === selectedHarnessId;
  const listKey = `${selectedHarnessId}-${scopeMode}-${selectedProjectId}-${candidateFilter}`;

  const sharedReadersFor = (candidate: HarnessCandidate) => {
    const key = normalizedPath(candidate.physicalPath ?? candidate.path);
    return data.harnesses
      .filter(
        (other) =>
          (other.detected || other.managedCount > 0) &&
          other.candidates.some(
            (item) =>
              item.scope === candidate.scope &&
              normalizedPath(item.physicalPath ?? item.path) === key,
          ),
      )
      .map((item) => item.name);
  };

  const sharedToolNames = (item: UnmanagedSkill) => {
    const ids = item.sharedHarnessIds ?? item.harnessIds ?? [];
    return data.harnesses
      .filter(
        (entry) =>
          ids.includes(entry.id) && (entry.detected || entry.managedCount > 0),
      )
      .map((entry) => entry.name);
  };

  const duplicateCount = (item: UnmanagedSkill) =>
    unmanaged.filter(
      (other) =>
        other.name === item.name &&
        other.scope === item.scope &&
        other.projectId === item.projectId,
    ).length;

  const openCandidateChain = () => onEditHarnessChain(selectedHarnessId);

  const addScanDirectory = async () => {
    if (!harness) return;
    const picked = await pickFolder({ title: '添加扫描目录' });
    if (!picked) return;
    const value = displayPath(picked, data.settings.homeDir) || picked;
    actions.addHarnessCandidate(harness.id, value);
  };

  const filteredBindings = useMemo(() => {
    if (bindingFilter === 'all') return visibleBindings;
    if (bindingFilter === 'enabled') {
      return visibleBindings.filter((binding) => binding.state === 'enabled');
    }
    if (bindingFilter === 'drifted') {
      return visibleBindings.filter(
        (binding) => binding.state === 'drifted' && !binding.ignoredDrift,
      );
    }
    if (bindingFilter === 'missing') {
      return visibleBindings.filter((binding) => binding.state === 'missing');
    }
    return visibleBindings.filter((binding) => Boolean(binding.updateAvailable));
  }, [bindingFilter, visibleBindings]);

  const visibleUnmanaged = externalExpanded ? unmanaged : unmanaged.slice(0, 5);
  const selectedCount = selectedIds.filter((id) =>
    unmanaged.some((item) => item.id === id),
  ).length;

  useEffect(() => {
    setBindingFilter('all');
    setCandidateFilter('all');
    setUncreatedExpanded(false);
    setExternalExpanded(false);
    setSelectMode(false);
    setSelectedIds([]);
    setPendingBatch(null);
  }, [selectedHarnessId, scopeMode, selectedProjectId]);

  useEffect(() => {
    if (visibleHarnesses.length === 0) return;
    if (!visibleHarnesses.some((item) => item.id === selectedHarnessId)) {
      onSelectHarness(visibleHarnesses[0].id);
    }
  }, [onSelectHarness, selectedHarnessId, visibleHarnesses]);

  const scrollTo = (ref: RefObject<HTMLElement | null>) => {
    requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleStatClick = (filter: BindingFilter | 'external') => {
    if (filter === 'external') {
      setExternalExpanded(true);
      scrollTo(externalRef);
      return;
    }
    setBindingFilter((current) => (current === filter ? 'all' : filter));
    scrollTo(managedRef);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const requestBatch = (mode: 'adopt' | 'register', ids: string[]) => {
    if (ids.length === 0) return;
    setPendingBatch({ mode, ids });
  };

  const confirmBatch = () => {
    if (!pendingBatch) return;
    const { mode, ids } = pendingBatch;
    setPendingBatch(null);
    setSelectedIds([]);
    actions.adoptUnmanagedBatch(ids, mode);
  };

  if (!harness) return null;

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-hairline px-4 py-2.5 md:px-5 lg:px-6 lg:py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-faint" />
            <input
              value={harnessQuery}
              onChange={(event) => setHarnessQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setHarnessQuery('');
              }}
              aria-label="搜索 Harness 名称、ID 或扫描路径"
              placeholder="搜索工具名称、ID 或扫描路径…"
              className="h-8 w-full rounded-[6px] border border-hairline bg-soft pl-7 pr-2.5 text-[14px] text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-hairline-strong focus:bg-soft max-sm:h-10"
            />
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-0.5 rounded-[8px] border border-hairline bg-soft p-1">
            {HARNESS_FILTERS.map((option) => {
              const active = harnessFilter === option.value;
              const count = filterCount(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setHarnessFilter(option.value)}
                  aria-pressed={active}
                  className={cn(
                    'relative flex h-7 shrink-0 items-center gap-1 rounded-[5px] px-2.5 text-[13px] transition-colors max-sm:h-10',
                    active ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted',
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="harness-filter-active"
                      transition={spring}
                      className="absolute inset-0 rounded-[5px] border border-hairline bg-soft-strong shadow-inset-top"
                    />
                  ) : null}
                  <span className="relative">{option.label}</span>
                  <span className="relative font-mono text-[12.5px] text-fg-faint">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-start gap-2 md:gap-3">
          <div
            role="tablist"
            aria-label="选择 Harness"
            className="flex min-w-0 flex-1 flex-wrap items-center gap-1 rounded-[8px] border border-hairline bg-soft p-1"
          >
            {visibleHarnesses.map((item) => {
              const active = item.id === harness.id;
              const count = harnessCounts.get(item.id) ?? 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSelectHarness(item.id)}
                  className={cn(
                    'relative flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] px-2.5 text-[13px] transition-colors max-sm:h-10',
                    active ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted',
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="harness-tab-active"
                      transition={spring}
                      className="absolute inset-0 rounded-[6px] border border-hairline bg-soft-strong shadow-inset-top"
                    />
                  ) : null}
                  <HarnessMark harnessId={item.id} size="xs" className="relative" />
                  <span className="relative whitespace-nowrap">{item.shortName}</span>
                  <span
                    className={cn(
                      'relative font-mono text-[13px]',
                      active ? 'text-fg-subtle' : 'text-fg-faint',
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
            {visibleHarnesses.length === 0 ? (
              <span role="presentation" className="px-2 text-[13px] text-fg-faint">
                无匹配工具
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 max-sm:w-full max-sm:justify-between">
            <Button
              size="xs"
              variant="ghost"
              onClick={onCreateHarness}
              className="gap-1 max-lg:min-h-10"
            >
              <Plus className="h-2.5 w-2.5" />
              新增自定义工具
            </Button>
            <span className="text-[14px] text-fg-subtle max-sm:ml-auto">视角</span>
            <div className="relative flex rounded-[7px] border border-hairline bg-soft p-0.5">
              {(
                [
                  { value: 'global' as const, label: '仅全局', icon: Globe2 },
                  { value: 'overlay' as const, label: '叠加项目', icon: Layers },
                ] as const
              ).map((option) => {
                const active = scopeMode === option.value;
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onScopeModeChange(option.value)}
                    aria-pressed={active}
                    className={cn(
                      'relative flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[13px] transition-colors max-sm:h-10',
                      active ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted',
                    )}
                  >
                    {active ? (
                      <motion.span
                        layoutId="harness-scope-active"
                        transition={spring}
                        className="absolute inset-0 rounded-[5px] border border-hairline bg-soft-strong shadow-inset-top"
                      />
                    ) : null}
                    <Icon className="relative h-3 w-3" strokeWidth={1.8} />
                    <span className="relative whitespace-nowrap">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {!harnessQuery.trim() &&
        harnessFilter === 'active' &&
        inactiveHarnesses.length > 0 ? (
          <button
            type="button"
            onClick={() => setHarnessFilter('all')}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[6px] border border-dashed border-hairline px-3 py-2 text-[13px] text-fg-subtle transition-colors hover:border-hairline-strong hover:text-fg-muted max-sm:min-h-10"
          >
            <ChevronDown className="h-3 w-3" />
            展开其余 {inactiveHarnesses.length} 个未检出工具
          </button>
        ) : null}

        <AnimatePresence initial={false}>
          {scopeMode === 'overlay' ? (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring}
              className="overflow-hidden"
            >
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] text-fg-subtle">叠加项目</span>
                {activeProjects.map((item) => {
                  const active = item.id === selectedProjectId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectProject(item.id)}
                      className={cn(
                        'flex h-7 items-center gap-1.5 rounded-[5px] border px-2.5 font-mono text-[13px] transition-colors max-sm:h-10',
                        active
                          ? 'border-hairline-strong bg-soft-strong text-fg'
                          : 'border-hairline text-fg-subtle hover:bg-soft hover:text-fg-muted',
                      )}
                    >
                      <FolderGit2 className="h-3 w-3" strokeWidth={1.8} />
                      {item.name}
                    </button>
                  );
                })}
                <span className="ml-1 text-[13px] text-fg-subtle">
                  全局绑定始终叠加显示
                </span>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </header>

      {visibleHarnesses.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-10 md:px-5 lg:px-6">
          <div className="mx-auto flex max-w-[480px] flex-col items-center rounded-[10px] border border-dashed border-hairline bg-soft px-6 py-12 text-center">
            <ScanLine className="h-6 w-6 text-fg-faint" strokeWidth={1.7} />
            <p className="mt-3 text-[15px] font-medium text-fg">没有匹配的 Harness</p>
            <p className="mt-1.5 max-w-[380px] text-[14px] leading-relaxed text-fg-subtle">
              {harnessQuery.trim()
                ? `没有工具匹配「${harnessQuery.trim()}」。清空搜索或切换到「全部」可继续浏览。`
                : `当前分类下还没有工具。切换到「全部」可查看 ${data.harnesses.length} 个内置工具，或新增自定义工具。`}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 max-sm:w-full">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setHarnessFilter('all');
                  setHarnessQuery('');
                }}
                className="max-sm:flex-1"
              >
                查看全部 {data.harnesses.length} 个工具
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={onCreateHarness}
                className="gap-1.5 max-sm:flex-1"
              >
                <Plus className="h-3 w-3" strokeWidth={2} />
                新增自定义工具
              </Button>
            </div>
          </div>
        </div>
      ) : (
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="w-full px-4 pb-10 pt-3 md:px-5 lg:px-6 lg:pt-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <HarnessMark harnessId={harness.id} size="md" />
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-fg">
                    {harness.name}
                  </h1>
                  <span className="font-mono text-[13px] text-fg-subtle">
                    {scopeMode === 'global'
                      ? '全局作用域'
                      : project
                        ? `全局作用域 + ${project.name}`
                        : '全局作用域'}
                  </span>
                  {primaryPathLabel ? (
                    <span
                      title={primaryCandidate?.path}
                      className="max-w-[260px] truncate rounded-[4px] border border-hairline bg-soft px-1.5 py-0.5 font-mono text-[12.5px] text-fg-subtle max-sm:max-w-full"
                    >
                      原生路径 · {primaryPathLabel}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 max-sm:w-full">
              <Button
                size="sm"
                variant="secondary"
                disabled={scanning}
                onClick={() => actions.scanHarness(harness.id)}
                className="shrink-0 gap-1.5 whitespace-nowrap max-sm:flex-1"
                title="重新扫描该 Harness 目录，发现外部技能与缺失入口"
              >
                <RefreshCw
                  className={cn('h-3 w-3', scanning && 'animate-spin-slow')}
                  strokeWidth={1.8}
                />
                {scanning ? '扫描中…' : '扫描目录'}
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  actions.openEnable(undefined, {
                    harnessId: harness.id,
                    scope: scopeMode === 'overlay' ? 'project' : 'global',
                    projectId:
                      scopeMode === 'overlay' ? selectedProjectId : undefined,
                  })
                }
                className="shrink-0 gap-1.5 whitespace-nowrap max-sm:flex-1"
              >
                <Plus className="h-3 w-3" strokeWidth={2} />
                从技能库启用
              </Button>
            </div>
          </div>

          <div className="mt-3 w-full rounded-[8px] border border-hairline bg-soft/60 px-1.5 py-1.5">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="px-1 text-[12.5px] text-fg-faint">扫描路径链</span>
                    <button
                      type="button"
                      onClick={() => setCandidateFilter('all')}
                      aria-pressed={candidateFilter === 'all'}
                      className={cn(
                        'flex h-7 items-center gap-1 rounded-[5px] border px-2 text-[13px] transition-colors max-sm:h-10',
                        candidateFilter === 'all'
                          ? 'border-hairline-strong bg-soft-strong text-fg'
                          : 'border-transparent text-fg-subtle hover:bg-soft hover:text-fg-muted',
                      )}
                    >
                      全部候选路径
                      <span className="font-mono text-[12.5px] text-fg-faint">
                        {visibleBindings.length + unmanaged.length}
                      </span>
                    </button>
                    {createdCandidates.map((candidate) => {
                      const Icon = ROLE_ICONS[candidate.role];
                      const readers = sharedReadersFor(candidate);
                      const active = candidateFilter === candidate.id;
                      const pathLabel =
                        displayPath(candidate.displayPath || candidate.path, data.settings.homeDir) ||
                        candidate.path;
                      const roleLabel =
                        candidate.role === 'shared' && readers.length > 0
                          ? `${candidate.roleLabel} · 本机 ${readers.length} 个活跃工具可见`
                          : candidate.roleLabel;
                      return (
                        <button
                          key={candidate.id}
                          type="button"
                          onClick={() =>
                            setCandidateFilter(active ? 'all' : candidate.id)
                          }
                          aria-pressed={active}
                          title={[
                            candidate.path,
                            candidate.discoveryLabel,
                            readers.length > 0
                              ? `可见工具：${readers.join('、')}`
                              : '',
                          ]
                            .filter(Boolean)
                            .join('\n')}
                          className={cn(
                            'flex h-7 max-w-full items-center gap-1 rounded-[5px] border px-2 text-[13px] transition-colors max-sm:h-10',
                            active
                              ? 'border-hairline-strong bg-soft-strong text-fg'
                              : 'border-transparent text-fg-subtle hover:bg-soft hover:text-fg-muted',
                          )}
                        >
                          <Icon
                            className={cn(
                              'h-2.5 w-2.5 shrink-0',
                              candidate.role === 'primary'
                                ? 'text-amber'
                                : candidate.role === 'shared'
                                  ? 'text-jade'
                                  : 'text-fg-faint',
                            )}
                            strokeWidth={1.9}
                          />
                          <span className="shrink-0">{roleLabel}:</span>
                          <span className="max-w-[190px] truncate font-mono text-fg-muted max-sm:max-w-[130px]">
                            {pathLabel}
                          </span>
                          <span className="shrink-0 font-mono text-[12.5px] text-fg-faint">
                            ({candidate.skillCount || candidate.managedCount || 0})
                          </span>
                          {candidate.discovery !== 'exact' ? (
                            <span className="shrink-0 text-[12.5px] text-fg-faint">
                              {candidate.discoveryLabel}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => void addScanDirectory()}
                      className="gap-1 max-sm:min-h-10"
                      title="选择一个目录，作为当前工具的额外扫描路径"
                    >
                      <Plus className="h-2.5 w-2.5" />
                      添加扫描目录…
                    </Button>
                  </div>

                  {uncreatedCandidates.length > 0 ? (
                    <div className="mt-1 border-t border-hairline/70 pt-1">
                      <button
                        type="button"
                        onClick={() => setUncreatedExpanded((value) => !value)}
                        aria-expanded={uncreatedExpanded}
                        className="flex w-full items-center gap-1 rounded-[4px] px-1 py-1 text-left text-[12.5px] text-fg-faint transition-colors hover:text-fg-muted max-sm:min-h-10"
                      >
                        <ChevronDown
                          className={cn(
                            'h-2.5 w-2.5 transition-transform duration-200',
                            uncreatedExpanded && 'rotate-180',
                          )}
                        />
                        {uncreatedExpanded
                          ? '收起未创建候选路径'
                          : `展开其余 ${uncreatedCandidates.length} 个未创建候选路径`}
                      </button>
                      <AnimatePresence initial={false}>
                        {uncreatedExpanded ? (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={spring}
                            className="overflow-hidden"
                          >
                            <div className="mt-1 space-y-1">
                              {uncreatedCandidates.map((candidate) => (
                                <div
                                  key={candidate.id}
                                  className="flex flex-wrap items-center gap-1.5 rounded-[5px] border border-hairline bg-void/20 px-2 py-1.5"
                                >
                                  <span className="font-mono text-[12.5px] text-fg-faint">
                                    #{candidate.priority + 1}
                                  </span>
                                  <span className="rounded-[4px] border border-hairline px-1.5 py-0.5 text-[12.5px] text-fg-subtle">
                                    {candidate.scope === 'global' ? '全局' : '项目'} ·{' '}
                                    {candidate.roleLabel}
                                  </span>
                                  <span
                                    title={candidate.path}
                                    className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg-subtle"
                                  >
                                    {displayPath(candidate.path, data.settings.homeDir) ||
                                      candidate.path}
                                  </span>
                                  <Button
                                    size="xs"
                                    variant="secondary"
                                    onClick={() =>
                                      actions.createCandidateDir(
                                        harness.id,
                                        candidate.id,
                                        candidate.scope === 'project'
                                          ? selectedProjectId
                                          : undefined,
                                      )
                                    }
                                    className="gap-1 max-sm:min-h-10"
                                  >
                                    <FolderPlus className="h-2.5 w-2.5" />
                                    创建目录
                                  </Button>
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={openCandidateChain}
                                    className="max-sm:min-h-10"
                                  >
                                    编辑路径链
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </div>
                  ) : null}
                </div>

          <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[9px] border border-hairline bg-hairline shadow-inset-top sm:grid-cols-3 lg:grid-cols-5">
            {(
              [
                { label: '已启用', value: stats.enabled, tone: 'text-jade', filter: 'enabled' },
                { label: '已修改', value: stats.drifted, tone: 'text-amber', filter: 'drifted' },
                { label: '未找到', value: stats.missing, tone: 'text-rose', filter: 'missing' },
                { label: '可更新', value: stats.updatable, tone: 'text-sky', filter: 'updatable' },
                {
                  label: '外部目录',
                  value: unmanaged.length,
                  tone: 'text-violet',
                  filter: 'external',
                },
              ] as const
            ).map((item, index) => {
              const active =
                item.filter !== 'external' && bindingFilter === item.filter;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => handleStatClick(item.filter)}
                  aria-pressed={item.filter === 'external' ? undefined : active}
                  title={
                    item.filter === 'external'
                      ? '查看外部技能目录'
                      : active
                        ? '再次点击清除筛选'
                        : `筛选${item.label}的绑定`
                  }
                  className={cn(
                    'flex min-w-0 items-baseline gap-2 bg-soft px-4 py-2.5 text-left transition-colors hover:bg-soft-strong',
                    index === 4 && 'col-span-2 lg:col-span-1',
                    active && 'bg-soft-strong',
                  )}
                >
                  <span className={cn('font-mono text-[20px] leading-none', item.tone)}>
                    {String(item.value).padStart(2, '0')}
                  </span>
                  <span
                    className={cn(
                      'truncate text-[14px]',
                      active ? 'text-fg' : 'text-fg-subtle',
                    )}
                  >
                    {item.label}
                  </span>
                  {active ? (
                    <span className="ml-auto shrink-0 font-mono text-[12.5px] text-fg-faint">
                      筛选中
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={listKey}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            >
              <section ref={managedRef} className="mt-4 scroll-mt-4">
                <div className="flex flex-wrap items-end justify-between gap-2 px-0.5">
                  <div>
                    <h2 className="text-[16px] font-medium text-fg">
                      {scopeMode === 'global' ? '全局已启用技能' : '当前视角下的绑定'}
                    </h2>
                    <p className="mt-1 text-[13px] text-fg-subtle">
                      {scopeMode === 'global'
                        ? '这些入口对所有项目可见；项目级绑定在「叠加项目」中查看。'
                        : `全局入口与 ${project?.name ?? '所选项目'} 的项目级入口叠加呈现。`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {bindingFilter !== 'all' ? (
                      <button
                        type="button"
                        onClick={() => setBindingFilter('all')}
                        className="flex h-6 items-center gap-1 rounded-[4px] border border-hairline bg-soft px-2 font-mono text-[12.5px] text-fg-subtle transition-colors hover:text-fg"
                        title="清除筛选"
                      >
                        筛选中：{FILTER_LABELS[bindingFilter]} ×
                      </button>
                    ) : null}
                    <span className="font-mono text-[13px] text-fg-faint">
                      {bindingFilter === 'all'
                        ? `${visibleBindings.length} 处生效`
                        : `${filteredBindings.length} / ${visibleBindings.length} 处`}
                    </span>
                  </div>
                </div>

                {visibleBindings.length === 0 ? (
                  unmanaged.length > 0 ? (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-dashed border-hairline bg-soft px-3 py-2">
                      <span className="text-[14px] text-fg-subtle">
                        当前尚未启用受管技能
                      </span>
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() =>
                          actions.openEnable(undefined, {
                            harnessId: harness.id,
                            scope: scopeMode === 'overlay' ? 'project' : 'global',
                            projectId:
                              scopeMode === 'overlay' ? selectedProjectId : undefined,
                          })
                        }
                        className="shrink-0 gap-1 max-sm:min-h-10"
                      >
                        <Plus className="h-2.5 w-2.5" />
                        从技能库启用
                      </Button>
                    </div>
                  ) : (
                  <div className="mt-2 flex flex-col items-center justify-center rounded-[10px] border border-dashed border-hairline bg-soft px-6 py-12 text-center">
                    <HarnessMark harnessId={harness.id} size="md" />
                    <p className="mt-3 text-[15px] font-medium text-fg">
                      这个 Harness 当前视角下还没有启用技能
                    </p>
                    <p className="mt-1.5 max-w-[380px] text-[14px] leading-relaxed text-fg-subtle">
                      Quiver 只做分发与对账，不会替你生成技能内容。中央库中的技能可随时启用到任意 Harness。
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        actions.openEnable(undefined, {
                          harnessId: harness.id,
                          scope: scopeMode === 'overlay' ? 'project' : 'global',
                          projectId:
                            scopeMode === 'overlay' ? selectedProjectId : undefined,
                        })
                      }
                      className="mt-3 gap-1.5"
                    >
                      <Plus className="h-3 w-3" />
                      启用第一个技能
                    </Button>
                  </div>
                  )
                ) : filteredBindings.length === 0 ? (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-[9px] border border-dashed border-hairline bg-soft px-4 py-5">
                    <div>
                      <p className="text-[14px] text-fg">当前筛选下没有匹配的绑定</p>
                      <p className="mt-1 text-[13px] text-fg-subtle">
                        清除筛选后可继续查看全部 {visibleBindings.length} 处生效入口。
                      </p>
                    </div>
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => setBindingFilter('all')}
                    >
                      清除筛选
                    </Button>
                  </div>
                ) : (
                  <div className="mt-2 divide-y divide-hairline overflow-visible rounded-[9px] border border-hairline bg-panel/35 shadow-inset-top">
                    {filteredBindings.map((binding) => {
                      const skill = data.skills.find(
                        (item) => item.id === binding.skillId,
                      );
                      if (!skill) return null;
                      return (
                        <HarnessBindingRow
                          key={binding.id}
                          binding={binding}
                          skill={skill}
                          project={data.projects.find(
                            (item) => item.id === binding.projectId,
                          )}
                          showScope={scopeMode === 'overlay'}
                          homeDir={data.settings.homeDir}
                          actions={actions}
                        />
                      );
                    })}
                  </div>
                )}

                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-[13px] text-fg-subtle">
                  <span className="min-w-0">
                    技能库激活版本通过链接实时生效，副本模式按锚点对账。
                  </span>
                  <span className="shrink-0 font-mono">
                    {harness.name} · 本地文件系统
                  </span>
                </div>
              </section>

              {unmanaged.length > 0 ? (
                <section ref={externalRef} className="mt-4 scroll-mt-4">
                  <div className="rounded-[9px] border border-violet/[0.16] bg-violet/[0.025] shadow-inset-top">
                    <div className="flex flex-wrap items-center gap-2 border-b border-violet/[0.12] px-4 py-3">
                      <ScanLine className="h-3.5 w-3.5 text-violet" strokeWidth={1.8} />
                      <span className="text-[14px] font-medium text-violet">发现外部技能</span>
                      <span className="text-[13px] text-fg-subtle">
                        非 Quiver 创建的目录，默认不自动接管
                      </span>
                      <span className="ml-auto font-mono text-[13px] text-fg-subtle">
                        {unmanaged.length}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 border-b border-violet/[0.1] px-4 py-2.5 max-sm:[&_button]:min-h-9">
                      <Button
                        size="xs"
                        variant={selectMode ? 'secondary' : 'ghost'}
                        onClick={() => {
                          setSelectMode((value) => !value);
                          setSelectedIds([]);
                        }}
                        className="gap-1"
                      >
                        <Check className="h-2.5 w-2.5" />
                        {selectMode ? '退出批量选择' : '批量选择'}
                      </Button>
                      <span className="mx-0.5 hidden h-3 w-px bg-hairline sm:block" />
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() =>
                          requestBatch(
                            'register',
                            unmanaged.map((item) => item.id),
                          )
                        }
                        className="gap-1"
                        title="保持物理文件原位，仅登记为受管技能"
                      >
                        <FolderPlus className="h-2.5 w-2.5" />
                        一键全部原地登记
                      </Button>
                      <Button
                        size="xs"
                        variant="primary"
                        onClick={() =>
                          requestBatch(
                            'adopt',
                            unmanaged.map((item) => item.id),
                          )
                        }
                        className="gap-1"
                        title="复制进中央只读库，目标目录改为链接"
                      >
                        <ArchiveRestore className="h-2.5 w-2.5" />
                        一键全部收编到技能库
                      </Button>
                    </div>

                    {selectMode ? (
                      <div className="flex flex-wrap items-center gap-2 border-b border-violet/[0.1] bg-soft/40 px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedIds(
                              selectedCount === unmanaged.length
                                ? []
                                : unmanaged.map((item) => item.id),
                            )
                          }
                          className="flex items-center gap-1.5 text-[13px] text-fg-subtle transition-colors hover:text-fg"
                        >
                          <span
                            className={cn(
                              'flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border',
                              selectedCount === unmanaged.length && unmanaged.length > 0
                                ? 'border-violet bg-violet text-void'
                                : 'border-hairline-strong bg-void',
                            )}
                          >
                            {selectedCount === unmanaged.length && unmanaged.length > 0 ? (
                              <Check className="h-2.5 w-2.5" strokeWidth={2.4} />
                            ) : null}
                          </span>
                          全选
                        </button>
                        <span className="font-mono text-[13px] text-fg-faint">
                          已选 {selectedCount} 项
                        </span>
                        <span className="ml-auto flex flex-wrap items-center gap-1.5 max-sm:w-full max-sm:[&_button]:min-h-9">
                          <Button
                            size="xs"
                            variant="secondary"
                            disabled={selectedCount === 0}
                            onClick={() => requestBatch('register', selectedIds)}
                            className="gap-1"
                          >
                            <FolderPlus className="h-2.5 w-2.5" />
                            登记所选
                          </Button>
                          <Button
                            size="xs"
                            variant="primary"
                            disabled={selectedCount === 0}
                            onClick={() => requestBatch('adopt', selectedIds)}
                            className="gap-1"
                          >
                            <ArchiveRestore className="h-2.5 w-2.5" />
                            收编所选
                          </Button>
                        </span>
                      </div>
                    ) : null}

                    <div className="divide-y divide-hairline">
                      {visibleUnmanaged.map((item) => {
                        const selected = selectedIds.includes(item.id);
                        const sharedNames = item.shared ? sharedToolNames(item) : [];
                        return (
                          <div
                            key={item.id}
                            className={cn(
                              'flex flex-wrap items-center justify-between gap-2.5 px-4 py-3.5',
                              selected && 'bg-violet/[0.04]',
                            )}
                          >
                            <div className="flex min-w-0 flex-1 items-start gap-2.5">
                              {selectMode ? (
                                <button
                                  type="button"
                                  onClick={() => toggleSelected(item.id)}
                                  aria-pressed={selected}
                                  aria-label={`选择 ${item.name}`}
                                  className={cn(
                                    'mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border transition-colors',
                                    selected
                                      ? 'border-violet bg-violet text-void'
                                      : 'border-hairline-strong bg-void hover:border-fg-faint',
                                  )}
                                >
                                  {selected ? (
                                    <Check className="h-3 w-3" strokeWidth={2.4} />
                                  ) : null}
                                </button>
                              ) : null}
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span className="min-w-0 truncate font-mono text-[15px] font-medium text-fg">
                                    {item.name}
                                  </span>
                                  <StatusBadge state="unmanaged" />
                                  {item.candidateLabel ? (
                                    <span className="shrink-0 rounded-[4px] border border-hairline bg-soft px-1.5 py-0.5 text-[12.5px] leading-none text-fg-subtle">
                                      {item.candidateLabel}
                                    </span>
                                  ) : null}
                                  {item.discoveryLabel &&
                                  item.discoveryLabel !== '精确目录' ? (
                                    <span className="shrink-0 rounded-[4px] border border-hairline px-1.5 py-0.5 text-[12.5px] leading-none text-fg-subtle">
                                      {item.discoveryLabel}
                                    </span>
                                  ) : null}
                                  {item.shared ? (
                                    <span
                                      title={
                                        sharedNames.length > 0
                                          ? `读取该共享目录的活跃工具：${sharedNames.join('、')}`
                                          : '该目录被多个工具同时读取'
                                      }
                                      className="inline-flex shrink-0 items-center gap-1 rounded-[4px] border border-jade/25 bg-jade/[0.07] px-1.5 py-0.5 text-[12.5px] leading-none text-jade"
                                    >
                                      <Share2 className="h-2.5 w-2.5" />
                                      {sharedNames.length > 0
                                        ? `跨工具共享 · 本机 ${sharedNames.length} 个活跃工具可见`
                                        : '跨工具共享'}
                                    </span>
                                  ) : null}
                                  {item.shadowedBy ? (
                                    <span
                                      title={`被 ${item.shadowedBy.candidateLabel} ${displayPath(
                                        item.shadowedBy.candidatePath,
                                        data.settings.homeDir,
                                      )} 覆盖（优先级 #${item.shadowedBy.priority + 1}）`}
                                      className="inline-flex shrink-0 items-center gap-1 rounded-[4px] border border-amber/25 bg-amber/[0.07] px-1.5 py-0.5 text-[12.5px] leading-none text-amber"
                                    >
                                      ○ 被高优先级同名目录覆盖
                                    </span>
                                  ) : duplicateCount(item) > 1 ? (
                                    <span
                                      title={`该目录在当前扫描路径链中的优先级为 #${(item.priority ?? 0) + 1}`}
                                      className="inline-flex shrink-0 items-center gap-1 rounded-[4px] border border-jade/25 bg-jade/[0.07] px-1.5 py-0.5 text-[12.5px] leading-none text-jade"
                                    >
                                      ● 当前生效 (优先级 #{(item.priority ?? 0) + 1})
                                    </span>
                                  ) : null}
                                  <span className="shrink-0 whitespace-nowrap font-mono text-[13px] text-fg-faint">
                                    {item.fileCount} 个文件
                                  </span>
                                </div>
                                <PathPill
                                  path={item.displayPath}
                                  localRel={item.localRel}
                                  realPath={item.fsPath}
                                  homeDir={data.settings.homeDir}
                                  className="mt-1.5 max-w-[460px] max-sm:w-full"
                                />
                              </div>
                            </div>
                            {selectMode ? null : (
                              <div className="flex shrink-0 items-center gap-1.5 max-lg:[&_button]:min-h-10 max-sm:w-full max-sm:flex-wrap">
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  onClick={() => actions.ignoreUnmanaged(item.id)}
                                  className="gap-1 text-fg-subtle"
                                >
                                  <EyeOff className="h-2.5 w-2.5" />
                                  忽略
                                </Button>
                                <Button
                                  size="xs"
                                  variant="secondary"
                                  onClick={() => actions.adoptUnmanaged(item.id, 'register')}
                                  className="gap-1"
                                  title="保持物理文件原位，仅登记为受管技能"
                                >
                                  <FolderPlus className="h-2.5 w-2.5" />
                                  原地登记
                                </Button>
                                <Button
                                  size="xs"
                                  variant="primary"
                                  onClick={() => actions.adoptUnmanaged(item.id, 'adopt')}
                                  className="gap-1"
                                  title="复制进中央只读库，目标目录改为链接"
                                >
                                  <ArchiveRestore className="h-2.5 w-2.5" />
                                  收编到技能库
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {unmanaged.length > 5 ? (
                      <button
                        type="button"
                        onClick={() => setExternalExpanded((value) => !value)}
                        className="flex w-full items-center justify-center gap-1.5 border-t border-violet/[0.1] px-4 py-2.5 text-[13px] text-fg-subtle transition-colors hover:bg-soft hover:text-fg"
                      >
                        <ChevronDown
                          className={cn(
                            'h-3 w-3 transition-transform duration-200',
                            externalExpanded && 'rotate-180',
                          )}
                        />
                        {externalExpanded
                          ? '收起外部技能'
                          : `展开其余 ${unmanaged.length - visibleUnmanaged.length} 个外部技能`}
                      </button>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingBatch)}
        title={
          pendingBatch?.mode === 'adopt'
            ? `一键收编 ${pendingBatch?.ids.length ?? 0} 个外部技能？`
            : `一键登记 ${pendingBatch?.ids.length ?? 0} 个外部技能？`
        }
        description={
          pendingBatch?.mode === 'adopt'
            ? '将把所选外部目录复制进中央只读库，并把原目录替换为指向中央库的链接入口。中央库内容只读，后续修改请通过激活版本流转。'
            : '所选外部技能将纳入 Quiver 的受管清单，物理文件与目录保持原位，不改写任何文件内容。'
        }
        note={
          pendingBatch?.mode === 'adopt'
            ? '收编过程中若某个目录权限受阻，会跳过该项并在结果中说明，不会影响其余技能。'
            : '原地登记的技能仍由 Harness 目录直接提供内容，Quiver 只跟踪其状态。'
        }
        confirmLabel={pendingBatch?.mode === 'adopt' ? '确认收编' : '确认登记'}
        danger={pendingBatch?.mode === 'adopt'}
        onCancel={() => setPendingBatch(null)}
        onConfirm={confirmBatch}
      />
    </section>
  );
}
