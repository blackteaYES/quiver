import { useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  Download,
  FileJson,
  FolderGit2,
  FolderOpen,
  Globe2,
  History,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';
import { HarnessMark, SkillGlyph } from '@/components/HarnessMark';
import { PathPill } from '@/components/PathPill';
import { StatusBadge } from '@/components/StatusBadge';
import { VersionPill } from '@/components/VersionPill';
import { DriftResolution, RowActions } from '@/components/BindingActions';
import type { QuiverActions } from '@/lib/actions';
import type { AppData, Binding, Harness, Project, Skill } from '@/lib/types';
import { cn, displayPath } from '@/lib/utils';

const spring = { type: 'spring' as const, stiffness: 400, damping: 30 };

function ProjectBindingRow({
  binding,
  skill,
  harnesses,
  homeDir,
  actions,
}: {
  binding: Binding;
  skill: Skill;
  harnesses: Harness[];
  homeDir?: string;
  actions: QuiverActions;
}) {
  const harness = harnesses.find((item) => item.id === binding.harnessId);
  const isDrift = binding.state === 'drifted' && !binding.ignoredDrift;

  return (
    <div className="group/row px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <HarnessMark harnessId={binding.harnessId} size="xs" />
            <span className="text-[14px] text-fg-subtle">{harness?.name}</span>
            <span className="text-fg-subtle">/</span>
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
            <StatusBadge
              state={binding.state}
              updatable={Boolean(binding.updateAvailable)}
              ignored={binding.ignoredDrift}
            />
            <Pill mono tone="outline">
              {binding.syncMode === 'link' ? '链接' : '副本'}
            </Pill>
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

export function ProjectsView({
  data,
  selectedProjectId,
  onSelectProject,
  activeProjects,
  mobile,
  detailOpen,
  onOpenDetail,
  onCloseDetail,
  actions,
}: {
  data: AppData;
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  activeProjects: Project[];
  mobile: boolean;
  detailOpen: boolean;
  onOpenDetail: (id: string) => void;
  onCloseDetail: () => void;
  actions: QuiverActions;
}) {
  const project = activeProjects.find((item) => item.id === selectedProjectId);
  const detailVisible = Boolean(project) && (!mobile || detailOpen);
  const missingProjects = data.projects.filter((item) => item.missing);

  const projectStats = useMemo(() => {
    const map = new Map<
      string,
      { total: number; drift: number; updatable: number; orphaned: number }
    >();
    data.bindings.forEach((binding) => {
      if (!binding.projectId) return;
      const entry = map.get(binding.projectId) ?? {
        total: 0,
        drift: 0,
        updatable: 0,
        orphaned: 0,
      };
      if (binding.state === 'orphaned') {
        entry.orphaned += 1;
      } else {
        entry.total += 1;
        if (binding.state === 'drifted' && !binding.ignoredDrift) entry.drift += 1;
        if (binding.updateAvailable) entry.updatable += 1;
      }
      map.set(binding.projectId, entry);
    });
    return map;
  }, [data.bindings]);

  const projectBindings = project
    ? data.bindings.filter(
        (binding) =>
          binding.projectId === project.id && binding.state !== 'orphaned',
      )
    : [];

  const inherited = project
    ? data.bindings.filter(
        (binding) =>
          binding.scope === 'global' &&
          binding.state !== 'orphaned' &&
          project.harnesses.includes(binding.harnessId),
      )
    : [];

  const projectHarnesses = project
    ? data.harnesses.filter((harness) => project.harnesses.includes(harness.id))
    : [];

  const stats = {
    drift: projectBindings.filter(
      (binding) => binding.state === 'drifted' && !binding.ignoredDrift,
    ).length,
    missing: projectBindings.filter((binding) => binding.state === 'missing').length,
    updatable: projectBindings.filter((binding) => binding.updateAvailable).length,
  };

  return (
    <section className="flex h-full min-w-0 flex-1">
      <div
        className={cn(
          'flex w-full shrink-0 flex-col border-r-0 border-hairline bg-panel/20 md:w-[260px] md:border-r lg:w-[288px]',
          mobile && detailVisible && 'hidden md:flex',
        )}
      >
        <div className="flex items-center justify-between border-b border-hairline px-3 pb-2.5 pt-3.5">
          <span className="text-[14px] font-medium text-fg-muted">项目</span>
          <span className="font-mono text-[13px] text-fg-subtle">
            {activeProjects.length} 个可用项目
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
          <div className="space-y-px">
            {activeProjects.map((item) => {
              const active = item.id === selectedProjectId;
              const entry = projectStats.get(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    mobile ? onOpenDetail(item.id) : onSelectProject(item.id)
                  }
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'relative block w-full rounded-[8px] p-3 text-left transition-colors',
                    active ? 'text-fg' : 'hover:bg-soft',
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="project-row-active"
                      transition={spring}
                      className="absolute inset-0 rounded-[8px] border border-hairline bg-soft-strong shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                    />
                  ) : null}
                  <div className="relative z-10">
                    <div className="flex items-center gap-2">
                      <FolderGit2
                        className={cn(
                          'h-3.5 w-3.5 shrink-0',
                          active ? 'text-fg-muted' : 'text-fg-subtle',
                        )}
                        strokeWidth={1.7}
                      />
                      <span className="truncate font-mono text-[15px] font-medium text-fg-muted">
                        {item.name}
                      </span>
                      {item.manifestExported ? (
                        <FileJson
                          className="ml-auto h-3 w-3 shrink-0 text-sky/80"
                          aria-label="已导出项目配置"
                        />
                      ) : null}
                    </div>
                    <div
                      className="mt-1.5 truncate font-mono text-[13px] text-fg-subtle"
                      title={item.path}
                    >
                      {displayPath(item.path, data.settings.homeDir)}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[13px]">
                      <span className="flex min-w-0 items-center gap-1 overflow-hidden">
                        {item.harnesses.slice(0, 3).map((harnessId) => (
                          <HarnessMark
                            key={harnessId}
                            harnessId={harnessId}
                            size="xs"
                            className="h-3.5 w-3.5 rounded-[3px]"
                          />
                        ))}
                        <span className="truncate text-fg-subtle">{item.lastActive}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {(entry?.drift ?? 0) > 0 ? (
                          <>
                            <span className="h-1 w-1 rounded-full bg-amber shadow-[0_0_6px_rgba(251,191,36,0.55)]" />
                            <span className="text-amber">{entry?.drift} 处修改</span>
                          </>
                        ) : (
                          <span className="text-fg-subtle">
                            {entry?.total ?? 0} 处生效
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {missingProjects.length > 0 ? (
            <div className="mt-2 border-t border-hairline pt-2">
              <div className="flex items-center gap-1.5 px-1.5 pb-1 text-[13px] text-fg-faint">
                <AlertTriangle className="h-2.5 w-2.5" strokeWidth={1.8} />
                失效项目记录
              </div>
              {missingProjects.map((item) => {
                const entry = projectStats.get(item.id);
                return (
                  <div
                    key={item.id}
                    className="rounded-[6px] border border-transparent px-2 py-2 opacity-80"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-[13px] text-fg-muted">
                        {item.name}
                      </span>
                      <Pill tone="rose" className="ml-auto shrink-0">
                        路径失效
                      </Pill>
                    </div>
                    <div
                      className="mt-1.5 truncate font-mono text-[13px] text-fg-subtle"
                      title={item.path}
                    >
                      {displayPath(item.path, data.settings.homeDir)}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-[13px] text-fg-subtle">
                        {entry?.orphaned ?? 0} 条孤儿绑定
                      </span>
                      <span className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => actions.relocateProject(item.id)}
                          className="text-[13px] text-fg-subtle underline decoration-fg/30 underline-offset-2 hover:text-fg-muted"
                        >
                          重新定位
                        </button>
                        <button
                          type="button"
                          onClick={() => actions.cleanProject(item.id)}
                          className="text-[13px] text-rose/70 underline decoration-rose/25 underline-offset-2 hover:text-rose"
                        >
                          清理
                        </button>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="border-t border-hairline p-2">
          <button
            type="button"
            onClick={actions.addProject}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-[6px] border border-hairline bg-soft text-[14px] text-fg-muted shadow-inset-top transition-colors hover:border-hairline-strong hover:bg-soft-strong hover:text-fg"
          >
            <Plus className="h-3 w-3" strokeWidth={1.9} />
            添加项目目录
          </button>
        </div>
      </div>

      <div
        className={cn(
          'relative min-w-0 flex-1',
          mobile && !detailVisible && 'hidden md:block',
        )}
      >
        {detailVisible && project ? (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${project.id}-${mobile ? 'mobile' : 'desktop'}`}
              initial={mobile ? { x: 36, opacity: 0 } : { opacity: 0, y: 5 }}
              animate={mobile ? { x: 0, opacity: 1 } : { opacity: 1, y: 0 }}
              exit={mobile ? { x: 24, opacity: 0 } : { opacity: 0, y: -3 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-0 overflow-y-auto"
            >
              <div className="min-h-full pb-10">
                <header className="sticky top-0 z-20 border-b border-hairline bg-void/90 px-4 pb-3 pt-2.5 backdrop-blur-xl md:px-5 lg:px-6 lg:pb-3.5 lg:pt-4">
                  {mobile ? (
                    <button
                      type="button"
                      onClick={onCloseDetail}
                      className="mb-1 flex h-10 items-center gap-1 rounded-[6px] px-2 text-[14px] text-fg-muted transition-colors hover:bg-soft hover:text-fg"
                    >
                      <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
                      返回列表
                    </button>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h1 className="truncate font-mono text-[22px] font-semibold tracking-[-0.02em] text-fg">
                        {project.name}
                      </h1>
                      <Pill tone="jade">
                        <span className="h-1.5 w-1.5 rounded-full bg-jade shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
                        路径可达
                      </Pill>
                      {project.manifestExported ? (
                        <Pill tone="sky">
                          <FileJson className="h-3 w-3" />
                          配置已导出
                        </Pill>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5 max-sm:w-full">
                      <Button
                        size="md"
                        variant="primary"
                        onClick={() => actions.exportProject(project.id)}
                        className="gap-1.5 max-sm:flex-1"
                        title="生成 .quiver/manifest.json，记录绑定锚点与部署方式"
                      >
                        <Download className="h-3 w-3" strokeWidth={1.9} />
                        导出项目配置
                      </Button>
                      <Button
                        size="md"
                        variant="secondary"
                        onClick={() => actions.restoreProject(project.id)}
                        className="gap-1.5 max-sm:flex-1"
                        title="按项目清单重新校验并补齐绑定"
                      >
                        <History className="h-3 w-3" strokeWidth={1.9} />
                        按配置恢复
                      </Button>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <PathPill
                      path={project.path}
                      localRel={project.localRel}
                      realPath={project.realPath ?? project.path}
                      homeDir={data.settings.homeDir}
                      className="min-w-0 max-w-full lg:max-w-[460px]"
                    />
                    <span className="mono-pill">
                      <Globe2 className="h-3 w-3" />
                      {projectHarnesses.length} 个工具
                    </span>
                    <span className="text-[13px] text-fg-subtle">
                      最近活跃 {project.lastActive}
                    </span>
                  </div>
                </header>

                <div className="px-4 pt-3 md:px-5 lg:px-6 lg:pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-hairline bg-soft px-4 py-3 shadow-inset-top">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <FileJson className="h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.8} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[14px] font-medium text-fg-muted">
                          项目清单
                          <span className="font-mono text-[13px] font-normal text-fg-subtle">
                            .quiver/manifest.json
                          </span>
                        </div>
                        <p className="mt-1 text-[13px] leading-relaxed text-fg-subtle">
                          记录该项目的绑定锚点、部署方式与目标路径，可随仓库一起版本化。
                          {data.settings.mode === 'sandbox'
                            ? `演示沙盒模式写入 ${displayPath(
                                data.settings.sandboxRoot ?? '.quiver-demo',
                                data.settings.homeDir,
                              )}，不触碰真实目录。`
                            : '当前为真实本地目录模式，导出会写入项目内的 .quiver 目录。'}
                        </p>
                      </div>
                    </div>
                    {project.manifestExported ? (
                      <Pill tone="sky">
                        <FileJson className="h-3 w-3" />
                        已导出
                      </Pill>
                    ) : (
                      <Pill tone="muted">未导出</Pill>
                    )}
                  </div>

                  <div className="@container mt-3 overflow-hidden rounded-[9px] border border-hairline bg-soft shadow-inset-top">
                    <div className="grid grid-cols-2 gap-px bg-hairline @min-[400px]:grid-cols-3 @min-[600px]:grid-cols-5">
                      {[
                        { label: '项目级绑定', value: projectBindings.length, tone: 'text-fg' },
                        { label: '继承全局', value: inherited.length, tone: 'text-fg-muted' },
                        { label: '已修改', value: stats.drift, tone: 'text-amber' },
                        { label: '未找到', value: stats.missing, tone: 'text-rose' },
                        { label: '可更新', value: stats.updatable, tone: 'text-sky' },
                      ].map((item, index) => (
                        <div
                          key={item.label}
                          className={cn(
                            'flex min-w-0 items-baseline gap-1.5 bg-soft px-3 py-2.5',
                            index === 4 && 'col-span-2 @min-[600px]:col-span-1',
                          )}
                        >
                          <span
                            className={cn(
                              'shrink-0 font-mono text-[20px] leading-none',
                              item.tone,
                            )}
                          >
                            {String(item.value).padStart(2, '0')}
                          </span>
                          <span className="whitespace-nowrap text-[13px] text-fg-subtle">
                            {item.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <section className="mt-5">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <div>
                        <h2 className="text-[16px] font-medium text-fg">项目级绑定</h2>
                        <p className="mt-1 text-[13px] text-fg-subtle">
                          只在该项目目录内生效，与全局入口互不影响。
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {projectHarnesses.map((harness) => {
                          const count = projectBindings.filter(
                            (binding) => binding.harnessId === harness.id,
                          ).length;
                          return (
                            <span
                              key={harness.id}
                              className="flex h-7 items-center gap-1.5 rounded-[5px] border border-hairline bg-soft px-2 text-[13px] text-fg-subtle"
                              title={`${harness.name} · ${count} 个技能`}
                            >
                              <HarnessMark
                                harnessId={harness.id}
                                size="xs"
                                className="h-3.5 w-3.5 rounded-[3px]"
                              />
                              {harness.shortName}
                              <span className="font-mono text-[13px] text-fg-faint">
                                {count}
                              </span>
                            </span>
                          );
                        })}
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            actions.openEnable(undefined, {
                              scope: 'project',
                              projectId: project.id,
                            })
                          }
                          className="gap-1"
                        >
                          <Plus className="h-3 w-3" />
                          增加分发
                        </Button>
                      </div>
                    </div>

                    {projectBindings.length === 0 ? (
                      <div className="mt-2 flex flex-col items-center justify-center rounded-[10px] border border-dashed border-hairline bg-soft px-6 py-10 text-center">
                        <FolderGit2 className="h-4 w-4 text-fg-faint" strokeWidth={1.6} />
                        <p className="mt-3 text-[15px] font-medium text-fg">
                          还没有项目级绑定
                        </p>
                        <p className="mt-1.5 max-w-[400px] text-[14px] leading-relaxed text-fg-subtle">
                          项目级绑定写入项目内的 Harness 目录，适合只在这个仓库生效的规则。
                        </p>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            actions.openEnable(undefined, {
                              scope: 'project',
                              projectId: project.id,
                            })
                          }
                          className="mt-3 gap-1.5"
                        >
                          <Plus className="h-3 w-3" />
                          建立项目级绑定
                        </Button>
                      </div>
                    ) : (
                      <div className="mt-2 divide-y divide-hairline overflow-visible rounded-[9px] border border-hairline bg-panel/35 shadow-inset-top">
                        {projectBindings.map((binding) => {
                          const skill = data.skills.find(
                            (item) => item.id === binding.skillId,
                          );
                          if (!skill) return null;
                          return (
                            <ProjectBindingRow
                              key={binding.id}
                              binding={binding}
                              skill={skill}
                              harnesses={data.harnesses}
                              homeDir={data.settings.homeDir}
                              actions={actions}
                            />
                          );
                        })}
                      </div>
                    )}
                  </section>

                  <section className="mt-5">
                    <div className="flex items-end justify-between gap-2">
                      <div>
                        <h2 className="text-[16px] font-medium text-fg">继承的全局技能</h2>
                        <p className="mt-1 text-[13px] text-fg-subtle">
                          全局入口会自动被项目继承；如只想在此项目生效，可把入口收窄。
                        </p>
                      </div>
                      <span className="font-mono text-[13px] text-fg-faint">
                        {inherited.length} 项全局继承
                      </span>
                    </div>

                    {inherited.length === 0 ? (
                      <div className="mt-2 flex items-center justify-between gap-3 rounded-[8px] border border-hairline bg-soft px-3 py-2.5">
                        <span className="text-[14px] text-fg-subtle">
                          没有适用于该项目的全局技能。
                        </span>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            actions.openEnable(undefined, {
                              scope: 'global',
                            })
                          }
                          className="gap-1"
                        >
                          <Globe2 className="h-2.5 w-2.5" />
                          启用全局技能
                        </Button>
                      </div>
                    ) : (
                      <div className="mt-2 divide-y divide-hairline overflow-visible rounded-[9px] border border-hairline bg-soft shadow-inset-top">
                        {inherited.map((binding) => {
                          const skill = data.skills.find(
                            (item) => item.id === binding.skillId,
                          );
                          const harness = data.harnesses.find(
                            (item) => item.id === binding.harnessId,
                          );
                          if (!skill) return null;
                          return (
                            <div
                              key={binding.id}
                              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <SkillGlyph
                                  slug={skill.slug}
                                  className="h-6 w-6 rounded-[5px] text-[13px]"
                                />
                                <button
                                  type="button"
                                  onClick={() => actions.openSkill(skill.id)}
                                  className="truncate font-mono text-[15px] font-medium text-fg transition-colors hover:text-fg-muted"
                                  title="在技能库中查看"
                                >
                                  {skill.slug}
                                </button>
                                <span className="flex items-center gap-1.5 text-[14px] text-fg-subtle">
                                  <HarnessMark
                                    harnessId={binding.harnessId}
                                    size="xs"
                                    className="h-3.5 w-3.5 rounded-[3px]"
                                  />
                                  {harness?.shortName}
                                </span>
                                <StatusBadge
                                  state={binding.state}
                                  updatable={Boolean(binding.updateAvailable)}
                                  ignored={binding.ignoredDrift}
                                />
                                <VersionPill binding={binding} skill={skill} />
                              </div>
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() =>
                                  actions.convertToProjectOnly(skill.id, project.id)
                                }
                                className="shrink-0 gap-1.5 text-fg-subtle"
                                title={`移除全局入口，改为仅在 ${project.name} 内生效`}
                              >
                                <ArrowRight className="h-3 w-3" />
                                转为仅指定项目启用…
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 px-1 text-[13px] text-fg-subtle">
                    <span className="flex items-center gap-1.5">
                      <FolderOpen className="h-3 w-3" />
                      路径来自本地文件系统，Quiver 不维护第二份项目副本。
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        ) : activeProjects.length === 0 ? (
          <div className="flex h-full items-center justify-center overflow-y-auto p-6">
            <div className="dot-grid w-full max-w-[460px] rounded-[12px] border border-hairline bg-soft px-6 py-8 text-center shadow-inset-top">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[11px] border border-hairline bg-raised text-fg-muted shadow-float">
                <FolderGit2 className="h-5 w-5" strokeWidth={1.7} />
              </div>
              <h2 className="mt-4 text-[18px] font-semibold text-fg">还没有项目目录</h2>
              <p className="mx-auto mt-2 max-w-[360px] text-[14px] leading-relaxed text-fg-subtle">
                项目视图用于给特定代码仓库配置专属技能。Quiver 直接读写仓库内的 Harness
                技能目录，无需生成或同步任何配置文件。
              </p>
              <div className="mx-auto mt-4 grid max-w-[360px] gap-1.5 text-left text-[13px] text-fg-subtle">
                {[
                  '项目级绑定只在该仓库内生效，全局技能仍然继承。',
                  '中央库保持只读，移除项目不会删除仓库中的既有文件。',
                  '路径失效的项目会进入巡检，可重新定位或显式清理。',
                ].map((line) => (
                  <div key={line} className="flex items-start gap-2">
                    <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-jade/80" />
                    <span className="leading-relaxed">{line}</span>
                  </div>
                ))}
              </div>
              <Button
                size="md"
                variant="primary"
                onClick={actions.addProject}
                className="mt-5 gap-1.5"
              >
                <Plus className="h-3 w-3" strokeWidth={2} />
                添加第一个项目目录
              </Button>
              <p className="mt-2 text-[13px] text-fg-faint">
                可选择任意本地 Git 仓库或普通目录。
              </p>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-[14px] text-fg-faint">
            选择左侧项目查看详情
          </div>
        )}
      </div>
    </section>
  );
}
