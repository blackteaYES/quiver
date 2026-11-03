import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, GitFork, Lock, RotateCcw } from 'lucide-react';
import { HarnessMark, SkillGlyph } from '@/components/HarnessMark';
import { PathPill } from '@/components/PathPill';
import { StatusBadge } from '@/components/StatusBadge';
import { VersionPill } from '@/components/VersionPill';
import { Button } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';
import type { QuiverActions } from '@/lib/actions';
import type {
  Binding,
  Harness,
  Project,
  Settings,
  Skill,
} from '@/lib/types';
import { cn, displayPath, shortSha } from '@/lib/utils';

const spring = { type: 'spring' as const, stiffness: 400, damping: 30 };

const endpointColor: Record<Binding['state'], string> = {
  enabled: 'var(--color-jade)',
  drifted: 'var(--color-amber)',
  missing: 'var(--color-rose)',
  orphaned: 'var(--color-fg-subtle)',
};

export function TopologyMap({
  skill,
  bindings,
  projects,
  harnesses,
  settings,
  mobile = false,
  actions,
}: {
  skill: Skill;
  bindings: Binding[];
  projects: Project[];
  harnesses: Harness[];
  settings: Settings;
  mobile?: boolean;
  actions: QuiverActions;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  const [start, setStart] = useState({ x: 0, y: 0 });
  const [ends, setEnds] = useState<Record<string, { x: number; y: number }>>({});
  const [hovered, setHovered] = useState<string | null>(null);

  const bindingKey = bindings.map((binding) => binding.id).join('|');

  const measure = useCallback(() => {
    if (mobile) return;
    const container = containerRef.current;
    const node = nodeRef.current;
    if (!container || !node) return;
    const base = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const nextStart = {
      x: nodeRect.right - base.left + 3,
      y: nodeRect.top - base.top + nodeRect.height / 2,
    };
    const nextEnds: Record<string, { x: number; y: number }> = {};
    bindingsRef.current.forEach((binding) => {
      const element = cardRefs.current.get(binding.id);
      if (!element) return;
      const rect = element.getBoundingClientRect();
      nextEnds[binding.id] = {
        x: rect.left - base.left - 3,
        y: rect.top - base.top + rect.height / 2,
      };
    });
    setStart(nextStart);
    setEnds(nextEnds);
  }, [mobile]);

  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(() => measure());
    if (containerRef.current) observer.observe(containerRef.current);
    if (nodeRef.current) observer.observe(nodeRef.current);
    cardRefs.current.forEach((element) => observer.observe(element));
    const timer = window.setTimeout(measure, 420);
    void document.fonts?.ready.then(() => measure());
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      window.removeEventListener('resize', measure);
    };
  }, [bindingKey, measure]);

  useEffect(() => {
    if (bindings.length === 0) setHovered(null);
  }, [bindings.length]);

  if (bindings.length === 0) return null;

  const separator = settings.availableRoot.includes('\\') ? '\\' : '/';
  const availablePath = `${settings.availableRoot.replace(/[\\/]$/, '')}${separator}${skill.slug}@${shortSha(skill.activeSha)}`;

  return (
    <div className="mt-2.5">
      <div
        ref={containerRef}
        className="dot-grid relative overflow-visible rounded-[10px] border border-hairline bg-sunken/50 shadow-inset-top"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(520px_220px_at_0%_45%,var(--color-soft),transparent_70%)]" />

        <svg
          className={cn(
            'pointer-events-none absolute inset-0 z-0 h-full w-full',
            mobile && 'hidden',
          )}
        >
          {!mobile && start.x > 0
            ? bindings.map((binding) => {
                const end = ends[binding.id];
                if (!end) return null;
                const hover = hovered === binding.id;
                const distance = Math.max(46, (end.x - start.x) * 0.56);
                const d = `M ${start.x} ${start.y} C ${start.x + distance} ${start.y}, ${end.x - distance} ${end.y}, ${end.x} ${end.y}`;
                const color = endpointColor[binding.state];
                return (
                  <g key={binding.id}>
                    {hover ? (
                      <path
                        d={d}
                        fill="none"
                        stroke="var(--color-soft-strong)"
                        strokeWidth={7}
                      />
                    ) : null}
                    <path
                      d={d}
                      fill="none"
                      stroke={
                        hover
                          ? 'var(--color-hairline-strong)'
                          : 'var(--color-hairline)'
                      }
                      strokeWidth={1}
                    />
                    <path
                      d={d}
                      fill="none"
                      className="animate-cable-flow"
                      stroke={
                        hover
                          ? 'var(--color-fg-muted)'
                          : 'var(--color-fg-subtle)'
                      }
                      strokeWidth={1.1}
                      strokeDasharray="1.5 18"
                      strokeLinecap="round"
                    />
                    <circle
                      cx={start.x}
                      cy={start.y}
                      r={hover ? 2.4 : 1.8}
                      fill="var(--color-fg-muted)"
                      opacity={0.85}
                    />
                    <circle
                      cx={end.x}
                      cy={end.y}
                      r={5}
                      fill="none"
                      stroke={color}
                      strokeOpacity={hover ? 0.4 : 0.18}
                    />
                    <circle cx={end.x} cy={end.y} r={2.3} fill={color} opacity={0.9} />
                  </g>
                );
              })
            : null}
        </svg>

        <div
          className={cn(
            'relative z-10 flex p-4',
            mobile ? 'flex-col gap-3' : 'items-start gap-10',
          )}
        >
          <div
            ref={nodeRef}
            className={cn('shrink-0', mobile ? 'w-full' : 'w-[216px]')}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={spring}
              className="relative rounded-[9px] border border-hairline bg-raised p-3 shadow-float"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[13px] tracking-[0.08em] text-fg-subtle">
                  中央库源版本
                </span>
                <Lock className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.7} />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <SkillGlyph slug={skill.slug} />
                <span className="min-w-0 truncate font-mono text-[15px] font-medium text-fg">
                  {skill.slug}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="rounded-[4px] border border-hairline bg-soft px-2 py-1 font-mono text-[13px] text-fg-muted">
                  @{shortSha(skill.activeSha)}
                </span>
                <span className="font-mono text-[13px] text-fg-subtle">只读保护</span>
              </div>
              <div className="mt-3 border-t border-hairline pt-2">
                <div className="font-mono text-[13px] tracking-wide text-fg-faint">
                  可用版本别名
                </div>
                <div
                  title={availablePath}
                  className="mt-1 truncate font-mono text-[13px] text-fg-subtle"
                >
                  {displayPath(availablePath, settings.homeDir)}
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between font-mono text-[13px] text-fg-faint">
                <span>{bindings.length} 处已挂载</span>
                <span className="flex items-center gap-1">
                  <span className="h-1 w-1 rounded-full bg-jade/80" />
                  已同步
                </span>
              </div>
            </motion.div>
          </div>

          {mobile ? (
            <div className="flex items-center gap-2 pl-2">
              <span className="h-5 w-px bg-hairline-strong" />
              <span className="font-mono text-[13px] text-fg-subtle">
                向下分发到 {bindings.length} 个目标
              </span>
            </div>
          ) : null}

          <div
            className={cn(
              'flex min-w-0 flex-1 flex-col gap-2',
              mobile && 'w-full flex-none',
            )}
          >
            {bindings.map((binding, index) => {
              const harness = harnesses.find((item) => item.id === binding.harnessId);
              const project = projects.find((item) => item.id === binding.projectId);
              const syncLabel = binding.syncMode === 'link' ? '链接' : '本地副本';
              return (
                <motion.div
                  key={binding.id}
                  ref={(element) => {
                    if (element) cardRefs.current.set(binding.id, element);
                    else cardRefs.current.delete(binding.id);
                  }}
                  initial={{ opacity: 0, y: 7 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...spring, delay: 0.04 + index * 0.045 }}
                  onAnimationComplete={measure}
                  onMouseEnter={() => setHovered(binding.id)}
                  onMouseLeave={() => setHovered(null)}
                  className={cn(
                    'group/row rounded-[9px] border bg-raised p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors duration-150',
                    hovered === binding.id
                      ? 'border-hairline-strong'
                      : 'border-hairline',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <HarnessMark harnessId={binding.harnessId} size="xs" />
                    <span className="truncate text-[15px] font-medium text-fg">
                      {harness?.name ?? binding.harnessId}
                    </span>
                    <span className="shrink-0 font-mono text-[13px] text-fg-subtle">
                      {binding.scope === 'global'
                        ? '全局'
                        : (project?.name ?? '项目')}
                    </span>
                    <Pill mono tone="muted" className="ml-auto shrink-0">
                      {syncLabel}
                    </Pill>
                  </div>
                  <div className="mt-2.5 flex items-center gap-2">
                    <PathPill
                      path={binding.displayPath}
                      localRel={binding.localRel}
                      realPath={binding.realPath}
                      homeDir={settings.homeDir}
                      className="min-w-0 flex-1"
                    />
                    <VersionPill binding={binding} skill={skill} align="right" />
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <StatusBadge
                        state={binding.state}
                        updatable={Boolean(binding.updateAvailable)}
                        ignored={binding.ignoredDrift}
                      />
                      <span className="font-mono text-[13px] text-fg-subtle">
                        链路 {String(index + 1).padStart(2, '0')}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1 max-sm:[&_button]:min-h-10 max-sm:w-full max-sm:justify-start">
                      {binding.state === 'missing' ? (
                        <>
                          <Button
                            size="xs"
                            variant="secondary"
                            className="gap-1.5"
                            onClick={() => actions.redeployBinding(binding.id)}
                          >
                            <RotateCcw className="h-3 w-3" />
                            重新恢复
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            className="text-fg-subtle hover:text-rose"
                            onClick={() => actions.disableBinding(binding.id)}
                          >
                            移除记录
                          </Button>
                        </>
                      ) : binding.state === 'orphaned' ? (
                        <>
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => {
                              if (binding.projectId) actions.relocateProject(binding.projectId);
                            }}
                          >
                            重新定位路径…
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => actions.disableBinding(binding.id)}
                          >
                            清理记录
                          </Button>
                        </>
                      ) : (
                        <>
                          {binding.updateAvailable ? (
                            <Button
                              size="xs"
                              variant="secondary"
                              className="gap-1.5 border-sky/20 text-sky hover:border-sky/30 hover:bg-sky/[0.08]"
                              onClick={() => actions.updateBinding(binding.id)}
                              title={`更新到 @${shortSha(binding.updateAvailable)}`}
                            >
                              <ArrowUpRight className="h-3 w-3" />
                              更新到最新
                            </Button>
                          ) : null}
                          {binding.syncMode === 'link' ? (
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => actions.convertToCopy(binding.id)}
                            >
                              转为本地副本
                            </Button>
                          ) : null}
                          <Button
                            size="xs"
                            variant="ghost"
                            className="text-fg-subtle hover:text-rose"
                            onClick={() => actions.disableBinding(binding.id)}
                          >
                            禁用
                          </Button>
                        </>
                      )}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 font-mono text-[13px] text-fg-subtle">
        <span className="flex min-w-0 items-center gap-1.5">
          <GitFork className="h-3 w-3 shrink-0" strokeWidth={1.6} />
          <span className="min-w-0 truncate md:whitespace-normal">
            中央库按内容寻址，每个目标只保留链接或副本入口
          </span>
        </span>
        <span className="shrink-0">{bindings.length} 处目标</span>
      </div>
    </div>
  );
}
