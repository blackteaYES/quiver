import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowLeftRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  ExternalLink,
  FileCode2,
  FileText,
  Folder,
  FolderGit2,
  GitBranch,
  GitFork,
  Globe,
  ListTree,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';
import { HarnessMark, SkillGlyph } from '@/components/HarnessMark';
import { PathPill } from '@/components/PathPill';
import { StatusBadge } from '@/components/StatusBadge';
import { VersionPill } from '@/components/VersionPill';
import { DriftResolution, RowActions } from '@/components/BindingActions';
import { TopologyMap } from '@/components/TopologyMap';
import type { QuiverActions } from '@/lib/actions';
import type {
  Binding,
  Harness,
  Project,
  Settings,
  Skill,
  SkillPreview,
  SkillPreviewFile,
} from '@/lib/types';
import { cn, displayPath, formatBytes, shortSha } from '@/lib/utils';

const spring = { type: 'spring' as const, stiffness: 400, damping: 30 };

interface PreviewNode {
  name: string;
  path: string;
  size: number | null;
  children: PreviewNode[];
}

function buildPreviewTree(files: SkillPreviewFile[]): PreviewNode[] {
  const root: PreviewNode[] = [];
  files.forEach((file) => {
    const parts = file.path.split('/');
    let level = root;
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      const path = parts.slice(0, index + 1).join('/');
      let node = level.find((item) => item.name === part && item.size === null);
      if (!node && !isFile) {
        node = { name: part, path, size: null, children: [] };
        level.push(node);
      }
      if (isFile) {
        level.push({ name: part, path, size: file.size, children: [] });
        return;
      }
      if (!node) return;
      level = node.children;
    });
  });
  const sort = (nodes: PreviewNode[]) => {
    nodes.sort((left, right) => {
      if (left.size === null && right.size !== null) return -1;
      if (left.size !== null && right.size === null) return 1;
      return left.name.localeCompare(right.name);
    });
    nodes.forEach((node) => sort(node.children));
  };
  sort(root);
  return root;
}

function PreviewTreeRows({
  nodes,
  depth = 0,
}: {
  nodes: PreviewNode[];
  depth?: number;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.size === null ? (
          <div key={node.path}>
            <div
              className="flex items-center gap-1.5 rounded-[4px] px-1.5 py-1 text-[13px] text-fg-muted"
              style={{ paddingLeft: `${depth * 14 + 6}px` }}
            >
              <Folder className="h-3 w-3 shrink-0 text-fg-faint" strokeWidth={1.8} />
              <span className="truncate font-mono">{node.name}</span>
            </div>
            <PreviewTreeRows nodes={node.children} depth={depth + 1} />
          </div>
        ) : (
          <div
            key={node.path}
            className="flex items-center gap-1.5 rounded-[4px] px-1.5 py-1 text-[13px] text-fg-subtle"
            style={{ paddingLeft: `${depth * 14 + 6}px` }}
            title={node.path}
          >
            {node.name.toLowerCase() === 'skill.md' ? (
              <FileText className="h-3 w-3 shrink-0 text-fg-muted" strokeWidth={1.8} />
            ) : (
              <FileCode2 className="h-3 w-3 shrink-0 text-fg-faint" strokeWidth={1.8} />
            )}
            <span
              className={cn(
                'truncate font-mono',
                node.name.toLowerCase() === 'skill.md' && 'text-fg',
              )}
            >
              {node.name}
            </span>
            <span className="ml-auto shrink-0 pl-2 font-mono text-[12.5px] text-fg-faint">
              {formatBytes(node.size)}
            </span>
          </div>
        ),
      )}
    </>
  );
}

function sourceLabel(uri: string) {
  if (!/^https?:\/\//.test(uri)) return uri;
  try {
    const url = new URL(uri);
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return uri;
  }
}

function BindingUnit({
  binding,
  skill,
  projects,
  harnesses,
  homeDir,
  actions,
  showProject = false,
}: {
  binding: Binding;
  skill: Skill;
  projects: Project[];
  harnesses: Harness[];
  homeDir?: string;
  actions: QuiverActions;
  showProject?: boolean;
}) {
  const harness = harnesses.find((item) => item.id === binding.harnessId);
  const project = projects.find((item) => item.id === binding.projectId);
  const isDrift = binding.state === 'drifted' && !binding.ignoredDrift;

  return (
    <div className="group/row px-4 py-4">
      <div className="flex flex-wrap items-start gap-2.5">
        <div className="min-w-[240px] flex-1 max-sm:min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <HarnessMark harnessId={binding.harnessId} />
            <span className="text-[15px] font-medium text-fg">
              {harness?.name ?? binding.harnessId}
            </span>
            {showProject && project ? (
              <Pill mono tone="muted">
                <FolderGit2 className="h-3 w-3" />
                {project.name}
              </Pill>
            ) : null}
            <StatusBadge
              state={binding.state}
              updatable={Boolean(binding.updateAvailable)}
              ignored={binding.ignoredDrift}
            />
            <Pill mono tone="outline">
              {binding.syncMode === 'link' ? '链接' : '本地副本'}
            </Pill>
            <VersionPill binding={binding} skill={skill} />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
            <div className="min-w-[180px] flex-1">
              <PathPill
                path={binding.displayPath}
                localRel={binding.localRel}
                realPath={binding.realPath}
                homeDir={homeDir}
                className="w-full max-w-[520px]"
              />
            </div>
            <span className="whitespace-nowrap font-mono text-[13px] text-fg-subtle opacity-45 transition-opacity duration-150 max-lg:opacity-100 group-hover/row:opacity-100">
              部署于 {binding.deployedAt}
            </span>
          </div>
        </div>
        <div className="ml-auto shrink-0 pt-0.5 max-sm:ml-0 max-sm:w-full">
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

export function SkillDetail({
  skill,
  bindings,
  projects,
  harnesses,
  settings,
  uiScale,
  mobile = false,
  onBack,
  actions,
}: {
  skill: Skill;
  bindings: Binding[];
  projects: Project[];
  harnesses: Harness[];
  settings: Settings;
  uiScale: number;
  mobile?: boolean;
  onBack?: () => void;
  actions: QuiverActions;
}) {
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<SkillPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [placementView, setPlacementView] = useState<'topology' | 'list'>(
    mobile ? 'list' : 'topology',
  );
  const [headerCompact, setHeaderCompact] = useState(false);
  const [headerTouched, setHeaderTouched] = useState(false);
  const [placementOpen, setPlacementOpen] = useState(true);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [narrowPane, setNarrowPane] = useState(false);

  const loadPreview = async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    const result = await actions.loadSkillPreview(skill.id, skill.activeSha);
    setPreviewLoading(false);
    if (!result) {
      setPreviewError('本地引擎未连接，无法读取技能文件');
      return;
    }
    if (!result.ok) {
      setPreviewError(result.error ?? '无法读取技能文件');
      return;
    }
    setPreview(result.preview ?? null);
  };

  const togglePreview = () => {
    const next = !previewOpen;
    setPreviewOpen(next);
    if (next && preview?.sha !== skill.activeSha) void loadPreview();
  };

  useEffect(() => {
    setPreviewOpen(false);
    setPreview(null);
    setPreviewError(null);
    setPreviewExpanded(false);
  }, [skill.id, skill.activeSha]);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    let frame = 0;
    const measure = () => {
      const width = node.getBoundingClientRect().width;
      if (width > 0) setNarrowPane(width < 560);
    };
    measure();
    const deadline = performance.now() + 600;
    const tick = () => {
      measure();
      if (performance.now() < deadline) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const fallback = window.setTimeout(measure, 350);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(fallback);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [uiScale]);

  useEffect(() => {
    setPlacementView(mobile || narrowPane ? 'list' : 'topology');
  }, [mobile, narrowPane]);

  useEffect(() => {
    if (!headerTouched) setHeaderCompact(mobile || narrowPane);
  }, [headerTouched, mobile, narrowPane]);

  const toggleHeader = () => {
    setHeaderTouched(true);
    setHeaderCompact((value) => !value);
  };

  const activeBindings = bindings.filter((binding) => binding.state !== 'orphaned');
  const globalBindings = bindings.filter(
    (binding) => binding.scope === 'global' && binding.state !== 'orphaned',
  );
  const projectBindings = bindings.filter(
    (binding) => binding.scope === 'project' && binding.state !== 'orphaned',
  );
  const orphanedBindings = bindings.filter(
    (binding) => binding.state === 'orphaned',
  );

  const projectGroups = useMemo(() => {
    const map = new Map<string, Binding[]>();
    projectBindings.forEach((binding) => {
      const key = binding.projectId ?? 'unknown';
      const list = map.get(key) ?? [];
      list.push(binding);
      map.set(key, list);
    });
    return Array.from(map.entries()).map(([projectId, items]) => ({
      project: projects.find((item) => item.id === projectId),
      items,
    }));
  }, [projectBindings, projects]);

  const isUrl = /^https?:\/\//.test(skill.sourceUri);
  const sourceDisplay = isUrl
    ? sourceLabel(skill.sourceUri)
    : displayPath(sourceLabel(skill.sourceUri), settings.homeDir);
  const displayName = skill.displayName?.trim() ?? '';
  const heading = displayName || skill.slug;
  const showSlug = Boolean(displayName) && displayName !== skill.slug;
  const previewTree = useMemo(
    () => (preview ? buildPreviewTree(preview.files) : []),
    [preview],
  );

  return (
    <div ref={rootRef} className="min-h-full pb-8">
      <header className="sticky top-0 z-20 border-b border-hairline bg-void/90 px-4 pb-2.5 pt-2 backdrop-blur-xl md:px-5 lg:px-6">
        {mobile && onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="mb-1 flex h-10 items-center gap-1 rounded-[6px] px-2 text-[14px] text-fg-muted transition-colors hover:bg-soft hover:text-fg"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
            返回列表
          </button>
        ) : null}
        <div className="flex flex-wrap items-start gap-3">
          <SkillGlyph
            slug={skill.slug}
            className="mt-0.5 h-8 w-8 rounded-[7px]"
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h1
                title={heading}
                className="min-w-0 max-w-full truncate text-[20px] font-semibold tracking-[-0.01em] text-fg"
              >
                {heading}
              </h1>
              {showSlug ? (
                <Pill
                  mono
                  tone="outline"
                  className="max-w-[220px]"
                  title={skill.slug}
                >
                  <span className="truncate">{skill.slug}</span>
                </Pill>
              ) : null}
              {skill.alias ? (
                <Pill
                  mono
                  tone="muted"
                  className="max-w-[150px]"
                  title={`别名：${skill.alias}`}
                >
                  <span className="truncate">别名 {skill.alias}</span>
                </Pill>
              ) : null}
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
                  'flex h-7 w-7 items-center justify-center rounded-[5px] border transition-colors max-sm:h-10 max-sm:w-10',
                  skill.isFavorite
                    ? 'border-amber/30 bg-amber/[0.08] text-amber'
                    : 'border-hairline bg-soft text-fg-subtle hover:border-hairline-strong hover:text-amber',
                )}
              >
                <Star
                  className="h-3.5 w-3.5"
                  fill={skill.isFavorite ? 'currentColor' : 'none'}
                  strokeWidth={1.8}
                />
              </button>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-fg-subtle">
              <span className="text-fg-muted">{activeBindings.length} 处生效</span>
              <span className="text-fg-faint">/</span>
              <span className="font-mono text-[12.5px]">
                @{shortSha(skill.activeSha)}
              </span>
              {headerCompact ? (
                <>
                  <span className="text-fg-faint max-sm:hidden">/</span>
                  <span className="min-w-0 max-w-[52ch] truncate max-sm:basis-full">
                    {skill.comment || '暂无简介'}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1 max-sm:ml-0 max-sm:w-full max-sm:justify-end">
            <IconButton
              label="编辑技能信息"
              onClick={() => actions.editSkill(skill.id)}
              className="max-sm:h-10 max-sm:w-10"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
            </IconButton>
            <IconButton
              label="删除技能"
              tone="danger"
              onClick={() => actions.deleteSkill(skill.id)}
              className="max-sm:h-10 max-sm:w-10"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            </IconButton>
            <Button
              size="md"
              variant="primary"
              onClick={() => actions.openEnable(skill.id)}
              className="ml-1 gap-1.5 max-sm:ml-0 max-sm:h-10"
            >
              <Plus className="h-3 w-3" strokeWidth={2} />
              启用到…
            </Button>
            <IconButton
              label={headerCompact ? '展开简介与标签' : '收起为简要信息'}
              onClick={toggleHeader}
              className="max-sm:h-10 max-sm:w-10"
            >
              {headerCompact ? (
                <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.9} />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.9} />
              )}
            </IconButton>
          </div>
        </div>

        {!headerCompact ? (
          <>
            <div className="mt-2 flex flex-wrap items-start gap-2">
              <p
                title={skill.comment}
                className="min-w-[200px] max-w-[68ch] flex-1 text-[13.5px] leading-[1.65] text-fg-muted [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] overflow-hidden"
              >
                {skill.comment || '暂无简介'}
              </p>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => actions.resyncSkillComment(skill.id)}
                className="mt-0.5 shrink-0 gap-1 text-fg-subtle max-sm:mt-0 max-sm:h-10"
                title="以当前激活版本的 SKILL.md 覆盖技能简介"
              >
                <RefreshCw className="h-2.5 w-2.5" strokeWidth={1.8} />
                从 SKILL.md 同步
              </Button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {skill.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-[4px] border border-hairline bg-soft px-2 py-1 text-[12.5px] text-fg-subtle"
                >
                  #{tag}
                </span>
              ))}
              <span className="mx-0.5 h-3 w-px bg-hairline" />
              {isUrl ? (
                <button
                  type="button"
                  title={skill.sourceUri}
                  onClick={() =>
                    window.open(skill.sourceUri, '_blank', 'noopener,noreferrer')
                  }
                  className="mono-pill gap-1 text-fg-subtle transition-colors hover:border-hairline-strong hover:text-fg-muted"
                >
                  <GitBranch className="h-2.5 w-2.5" />
                  <span className="max-w-[300px] truncate">{sourceDisplay}</span>
                  <ExternalLink className="h-2 w-2 text-fg-faint" />
                </button>
              ) : (
                <span
                  className="mono-pill max-w-[320px] gap-1"
                  title={skill.sourceUri}
                >
                  <GitBranch className="h-2.5 w-2.5" />
                  <span className="truncate">{sourceDisplay}</span>
                </span>
              )}
              <span className="mono-pill gap-1">
                <Lock className="h-2.5 w-2.5" />
                只读保护
              </span>
              <span className="mono-pill">@{shortSha(skill.activeSha)}</span>
            </div>
          </>
        ) : null}
      </header>

      <div className="px-4 pt-1 md:px-5 lg:px-6">
        <section className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setPlacementOpen((value) => !value)}
              aria-expanded={placementOpen}
              className="flex min-w-0 items-center gap-1.5 rounded-[6px] px-1 py-0.5 text-left max-sm:min-h-10"
            >
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 shrink-0 text-fg-faint transition-transform duration-200',
                  placementOpen && 'rotate-90',
                )}
              />
              <span className="text-[16px] font-medium text-fg">生效位置</span>
              <span className="font-mono text-[13px] text-fg-faint">
                {activeBindings.length}
                {orphanedBindings.length > 0
                  ? ` + ${orphanedBindings.length} 失效`
                  : ''}
              </span>
            </button>
            {placementOpen ? (
              <div
                role="tablist"
                aria-label="生效位置视图"
                className="relative flex rounded-[6px] border border-hairline bg-soft p-0.5"
              >
                {(
                  [
                    { value: 'topology' as const, label: '拓扑视图', icon: GitFork },
                    { value: 'list' as const, label: '列表视图', icon: ListTree },
                  ] as const
                ).map((option) => {
                  const active = placementView === option.value;
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setPlacementView(option.value)}
                      className={cn(
                        'relative flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[13px] transition-colors max-sm:h-10',
                        active ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted',
                      )}
                    >
                      {active ? (
                        <motion.span
                          layoutId="skill-placement-view"
                          transition={spring}
                          className="absolute inset-0 rounded-[5px] border border-hairline bg-soft-strong shadow-inset-top"
                        />
                      ) : null}
                      <Icon className="relative h-3 w-3" strokeWidth={1.8} />
                      <span className="relative">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {placementOpen ? (
            <>
              <p className="mt-2 px-1 text-[13px] text-fg-subtle">
                解链只移除入口，绝不穿透删除中央库源文件。
              </p>
              {bindings.length === 0 ? (
                <div className="dot-grid mt-2.5 flex items-center gap-3 rounded-[10px] border border-dashed border-hairline bg-soft px-5 py-5">
                  <SkillGlyph slug={skill.slug} className="h-8 w-8" />
                  <div>
                    <div className="text-[15px] font-medium text-fg">尚未分发</div>
                    <p className="mt-1 max-w-[56ch] text-[13.5px] leading-relaxed text-fg-subtle">
                      用右上角的「启用到…」把它链接到 Harness 的扫描目录，中央库源文件保持只读。
                    </p>
                  </div>
                </div>
              ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={placementView}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
              >
                {placementView === 'topology' ? (
                  <TopologyMap
                    skill={skill}
                    bindings={bindings}
                    projects={projects}
                    harnesses={harnesses}
                    settings={settings}
                    mobile={mobile}
                    actions={actions}
                  />
                ) : (
                  <div className="mt-2.5">
                    {globalBindings.length > 0 ? (
                      <div>
                        <div className="flex items-center justify-between px-1">
                          <div className="flex items-center gap-1.5 text-[14px] text-fg-muted">
                            <Globe className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.8} />
                            全局
                            <span className="font-mono text-[13px] text-fg-subtle">
                              {globalBindings.length}
                            </span>
                          </div>
                          <span className="text-[13px] text-fg-faint">所有项目可见</span>
                        </div>
                        <div className="mt-1.5 divide-y divide-hairline overflow-visible rounded-[9px] border border-hairline bg-panel/35 shadow-inset-top">
                          {globalBindings.map((binding) => (
                            <BindingUnit
                              key={binding.id}
                              binding={binding}
                              skill={skill}
                              projects={projects}
                              harnesses={harnesses}
                              homeDir={settings.homeDir}
                              actions={actions}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {projectGroups.length > 0 ? (
                      <div className={globalBindings.length > 0 ? 'mt-4' : ''}>
                        <div className="flex items-center gap-1.5 px-1">
                          <FolderGit2 className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.8} />
                          <span className="text-[14px] text-fg-muted">项目</span>
                          <span className="font-mono text-[13px] text-fg-subtle">
                            {projectBindings.length}
                          </span>
                        </div>

                        {projectGroups.map(({ project, items }) => (
                          <div key={project?.id ?? 'unknown'} className="mt-2">
                            <div className="flex items-baseline gap-1.5 px-1 pb-1.5">
                              <span className="shrink-0 whitespace-nowrap text-[13px] text-fg-muted">
                                {project?.name ?? '未知项目'}
                              </span>
                              <span
                                className="min-w-0 truncate font-mono text-[13px] text-fg-faint"
                                title={project?.path}
                              >
                                {displayPath(project?.path ?? '', settings.homeDir)}
                              </span>
                              <span className="ml-auto shrink-0 font-mono text-[13px] text-fg-faint">
                                {items.length} 处生效
                              </span>
                            </div>
                            <div className="divide-y divide-hairline overflow-visible rounded-[9px] border border-hairline bg-panel/35 shadow-inset-top">
                              {items.map((binding) => (
                                <BindingUnit
                                  key={binding.id}
                                  binding={binding}
                                  skill={skill}
                                  projects={projects}
                                  harnesses={harnesses}
                                  homeDir={settings.homeDir}
                                  actions={actions}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {orphanedBindings.length > 0 ? (
                      <details className="group mt-4 rounded-[9px] border border-hairline bg-soft">
                        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[14px] text-fg-subtle [&::-webkit-details-marker]:hidden">
                          <AlertTriangle className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.8} />
                          失效的项目绑定
                          <span className="font-mono text-[13px] text-fg-subtle">
                            {orphanedBindings.length}
                          </span>
                          <ChevronRight className="ml-auto h-3 w-3 text-fg-faint transition-transform duration-200 group-open:rotate-90" />
                        </summary>
                        <div className="divide-y divide-hairline border-t border-hairline">
                          {orphanedBindings.map((binding) => (
                            <BindingUnit
                              key={binding.id}
                              binding={binding}
                              skill={skill}
                              projects={projects}
                              harnesses={harnesses}
                              homeDir={settings.homeDir}
                              actions={actions}
                              showProject
                            />
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
              )}
            </>
          ) : null}
        </section>

        <section className="mt-5 overflow-hidden rounded-[9px] border border-hairline bg-soft">
          <button
            type="button"
            onClick={togglePreview}
            className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-soft"
            aria-expanded={previewOpen}
          >
            <FileCode2 className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.8} />
            <span className="text-[15px] font-medium text-fg">技能文件与 SKILL.md 预览</span>
            <span className="font-mono text-[13px] text-fg-subtle">
              @{shortSha(skill.activeSha)}
            </span>
            <span className="ml-auto font-mono text-[13px] text-fg-faint">
              {preview ? `${preview.files.length} 个文件` : '只读'}
            </span>
            <ChevronRight
              className={cn(
                'h-3 w-3 text-fg-faint transition-transform duration-200',
                previewOpen && 'rotate-90',
              )}
            />
          </button>

          <AnimatePresence initial={false}>
            {previewOpen ? (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="overflow-hidden"
              >
                <div className="border-t border-hairline">
                  {previewLoading ? (
                    <div className="px-4 py-6 text-[13px] text-fg-subtle">正在读取中央库…</div>
                  ) : previewError ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
                      <p className="text-[13px] text-rose">{previewError}</p>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => void loadPreview()}
                        className="gap-1.5 max-sm:h-10"
                      >
                        <RefreshCw className="h-2.5 w-2.5" />
                        重试
                      </Button>
                    </div>
                  ) : preview ? (
                    <div className="grid items-start md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                      <div
                        className={cn(
                          'overflow-auto border-b border-hairline p-3 md:border-b-0 md:border-r',
                          previewExpanded
                            ? 'max-h-[min(720px,72vh)]'
                            : 'max-h-[360px]',
                        )}
                      >
                        <div className="mb-1.5 flex items-center justify-between px-1.5 font-mono text-[12.5px] text-fg-faint">
                          <span>{preview.files.length} 个文件</span>
                          {preview.overflow ? <span>仅显示前 5000 个</span> : null}
                        </div>
                        <PreviewTreeRows nodes={previewTree} />
                      </div>
                      <div className="p-3">
                        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 px-1.5">
                          <span className="flex items-center gap-1.5 text-[13px] text-fg-muted">
                            <FileText className="h-3 w-3 text-fg-subtle" strokeWidth={1.8} />
                            SKILL.md · 只读
                          </span>
                          <div className="flex items-center gap-1">
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => setPreviewExpanded((value) => !value)}
                              className="gap-1 text-fg-subtle max-sm:h-10"
                            >
                              {previewExpanded ? (
                                <ChevronUp className="h-2.5 w-2.5" strokeWidth={1.8} />
                              ) : (
                                <ChevronDown className="h-2.5 w-2.5" strokeWidth={1.8} />
                              )}
                              {previewExpanded ? '收起' : '展开更多'}
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => void loadPreview()}
                              className="gap-1 text-fg-subtle max-sm:h-10"
                            >
                              <RefreshCw className="h-2.5 w-2.5" strokeWidth={1.8} />
                              重新读取
                            </Button>
                          </div>
                        </div>
                        {preview.skillMarkdown === null ? (
                          <p className="rounded-[7px] border border-dashed border-hairline px-3 py-4 text-[13px] text-fg-subtle">
                            该版本根目录没有 SKILL.md。
                          </p>
                        ) : (
                          <pre
                            className={cn(
                              'overflow-auto whitespace-pre-wrap break-words rounded-[7px] border border-hairline bg-void/50 p-3 font-mono text-[12.5px] leading-[1.65] text-fg-muted',
                              previewExpanded
                                ? 'max-h-[min(720px,72vh)]'
                                : 'max-h-[330px]',
                            )}
                          >
                            {preview.skillMarkdown}
                          </pre>
                        )}
                        {preview.truncated ? (
                          <p className="mt-1.5 px-1.5 text-[12.5px] text-fg-faint">
                            文件超过 512 KB，仅显示前 512 KB 内容。
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </section>

        <section className="mt-5 overflow-hidden rounded-[9px] border border-hairline bg-soft">
          <button
            type="button"
            onClick={() => setVersionsOpen((value) => !value)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-soft"
          >
            <Clock3 className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.8} />
            <span className="text-[15px] font-medium text-fg">历史版本</span>
            <span className="font-mono text-[13px] text-fg-subtle">
              {skill.versions.length}
            </span>
            <span className="ml-auto flex items-center gap-1.5 font-mono text-[13px] text-fg-subtle">
              <span className="h-1 w-1 rounded-full bg-jade/80" />
              当前激活 @{shortSha(skill.activeSha)}
            </span>
            <ChevronRight
              className={cn(
                'h-3 w-3 text-fg-faint transition-transform duration-200',
                versionsOpen && 'rotate-90',
              )}
            />
          </button>

          <AnimatePresence initial={false}>
            {versionsOpen ? (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="overflow-hidden"
              >
                <div className="border-t border-hairline">
                  {skill.versions.map((version) => {
                    const active = version.sha === skill.activeSha;
                    return (
                      <div
                        key={version.sha}
                        className={cn(
                          'flex items-center justify-between gap-3 border-b border-hairline px-4 py-3 last:border-b-0',
                          active && 'bg-soft',
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={cn(
                              'h-1 w-1 shrink-0 rounded-full',
                              active ? 'bg-jade' : 'bg-fg-faint',
                            )}
                          />
                          <span className="shrink-0 font-mono text-[13px] text-fg-muted">
                            @{shortSha(version.sha)}
                          </span>
                          <span className="truncate text-[13px] text-fg-faint">
                            {version.note || '无备注'}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2.5">
                          <span className="font-mono text-[13px] text-fg-faint">
                            {version.createdAt}
                          </span>
                          {active ? (
                            <Pill tone="jade">
                              当前激活
                            </Pill>
                          ) : (
                            <Button
                              size="xs"
                              variant="ghost"
                              className="gap-1.5"
                              onClick={() => actions.switchVersion(skill.id, version.sha)}
                            >
                              <ArrowLeftRight className="h-2.5 w-2.5" />
                              设为当前版本
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div className="border-t border-hairline px-4 py-3 text-[13px] leading-relaxed text-fg-subtle">
                    链接型绑定会随激活版本同步切换；副本模式仅标记「可更新」。
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </section>
      </div>
    </div>
  );
}
