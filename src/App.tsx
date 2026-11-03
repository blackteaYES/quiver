import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Toaster, toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Info,
  Layers,
  RefreshCw,
} from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import { TitleBar } from '@/components/TitleBar';
import { MobileTabBar } from '@/components/MobileTabBar';
import { MobileStatusSheet } from '@/components/MobileStatusSheet';
import { SkillsView } from '@/components/SkillsView';
import { HarnessView } from '@/components/HarnessView';
import { ProjectsView } from '@/components/ProjectsView';
import { EnableDialog } from '@/components/EnableDialog';
import { CommandPalette } from '@/components/CommandPalette';
import { SettingsDialog } from '@/components/SettingsDialog';
import { EditSkillDialog } from '@/components/EditSkillDialog';
import { ImportDialog } from '@/components/ImportDialog';
import { AuditLogDialog } from '@/components/AuditLogDialog';
import { WebUnlock } from '@/components/WebUnlock';
import { PermissionDialog } from '@/components/PermissionDialog';
import { DisableDependencyDialog, SharedDisableDialog } from '@/components/BindingActions';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import type { QuiverActions, EnableIntent } from '@/lib/actions';
import {
  engine,
  getSnapshot,
  isDesktop,
  pickFolder,
} from '@/lib/desktop';
import {
  WEB_UNAUTHORIZED_EVENT,
  clearWebToken,
  consumeWebTokenFromUrl,
  hasWebToken,
  setWebToken,
} from '@/lib/web';
import {
  applyScale,
  applyTheme,
  NAV_WIDTH,
  readNavWidth,
  readScale,
  readTheme,
  writeNavWidth,
} from '@/lib/preferences';
import { useBreakpoint } from '@/lib/responsive';
import { copyTextToClipboard } from '@/lib/utils';
import type { Theme, UiScale } from '@/lib/preferences';
import type {
  AppData,
  DependentBinding,
  EnableSelection,
  EngineResult,
  HarnessId,
  PermissionIssue,
  ScopeMode,
  SharedBindingImpact,
  View,
} from '@/lib/types';

const viewLabels: Record<View, string> = {
  skills: '技能库',
  harness: 'Harness',
  projects: '项目',
};

type ToastKind = 'success' | 'error' | 'warning' | 'info';

function notifyCopyable(
  kind: ToastKind,
  title: string,
  description?: string,
  duration?: number,
) {
  const text = description ? `${title}\n${description}` : title;
  toast[kind](title, {
    description,
    duration,
    action: {
      label: '复制',
      onClick: () => {
        void copyTextToClipboard(text).then((copied) => {
          if (copied) toast.success('已复制', { duration: 1400 });
          else toast.error('复制失败', { description: '当前环境未授权剪贴板访问。' });
        });
      },
    },
  });
}

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('skills');
  const [selectedSkillId, setSelectedSkillId] = useState('');
  const [selectedHarnessId, setSelectedHarnessId] = useState<HarnessId>('claude-code');
  const [harnessScope, setHarnessScope] = useState<ScopeMode>('global');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [scanningHarness, setScanningHarness] = useState<HarnessId | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCreateSignal, setSettingsCreateSignal] = useState(0);
  const [settingsFocusHarnessId, setSettingsFocusHarnessId] = useState<HarnessId | null>(null);
  const [settingsFocusSignal, setSettingsFocusSignal] = useState(0);
  const [auditOpen, setAuditOpen] = useState(false);
  const [enableIntent, setEnableIntent] = useState<EnableIntent | null>(null);
  const [editSkillId, setEditSkillId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteSkillId, setDeleteSkillId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [scale, setScale] = useState<UiScale>(readScale);
  const breakpoint = useBreakpoint(scale);
  const isMobile = breakpoint === 'mobile';
  const [navWidth, setNavWidth] = useState<number | null>(readNavWidth);
  const defaultNavWidth =
    breakpoint === 'desktop' ? NAV_WIDTH.expanded : NAV_WIDTH.rail;
  const effectiveNavWidth = navWidth ?? defaultNavWidth;
  const navHidden = effectiveNavWidth <= 0;
  const lastNavWidth = useRef(effectiveNavWidth || defaultNavWidth);
  useEffect(() => {
    if (effectiveNavWidth > 0) lastNavWidth.current = effectiveNavWidth;
  }, [effectiveNavWidth]);
  const changeNavWidth = useCallback((width: number) => {
    setNavWidth(width);
    writeNavWidth(width);
  }, []);
  const toggleNav = useCallback(() => {
    changeNavWidth(navHidden ? lastNavWidth.current || defaultNavWidth : 0);
  }, [changeNavWidth, defaultNavWidth, navHidden]);
  const [mobileSkillOpen, setMobileSkillOpen] = useState(false);
  const [mobileProjectOpen, setMobileProjectOpen] = useState(false);
  const [mobileStatusOpen, setMobileStatusOpen] = useState(false);
  const [webReady, setWebReady] = useState(() => {
    if (isDesktop()) return true;
    const fromUrl = consumeWebTokenFromUrl();
    if (fromUrl) {
      setWebToken(fromUrl);
      return true;
    }
    return hasWebToken();
  });
  const [webNotice, setWebNotice] = useState<string | null>(null);
  const [disableImpact, setDisableImpact] = useState<{
    bindingId: string;
    dependents: DependentBinding[];
    shared: SharedBindingImpact | null;
  } | null>(null);
  const [permissionState, setPermissionState] = useState<{
    issue: PermissionIssue;
    retry: (() => void) | null;
    downgrade: (() => void) | null;
  } | null>(null);
  const seenNotices = useRef<Set<string>>(new Set());
  const seenPermission = useRef<string>('');
  const dataRef = useRef<AppData | null>(null);
  dataRef.current = data;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyScale(scale);
  }, [scale]);

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    const result = await getSnapshot();
    setLoading(false);
    if (result.ok && result.snapshot) {
      setData(result.snapshot);
      setLoadError(null);
    } else {
      setLoadError(result.error ?? '无法读取本地数据');
    }
  }, []);

  useEffect(() => {
    if (!webReady) return;
    void loadSnapshot();
  }, [loadSnapshot, webReady]);

  useEffect(() => {
    if (!webReady) return;
    const api = engine();
    if (!api) return;
    return api.onChange((snapshot) => setData(snapshot));
  }, [webReady]);

  useEffect(() => {
    const onUnauthorized = () => {
      clearWebToken();
      setWebReady(false);
      setWebNotice('Token 已失效，请在桌面端重新查看并输入。');
      setData(null);
      setLoadError(null);
      setDisableImpact(null);
      setPermissionState(null);
    };
    window.addEventListener(WEB_UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(WEB_UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const applyResult = useCallback((result: EngineResult) => {
    if (!result.ok) {
      if (!result.permission) notifyCopyable('error', result.error ?? '操作失败');
      return result;
    }
    if (result.snapshot) setData(result.snapshot);
    if (result.message) {
      notifyCopyable(
        result.warning ? 'warning' : 'success',
        result.message,
        result.description,
        result.warning ? 5200 : 3200,
      );
    }
    return result;
  }, []);

  const runAction = useCallback(
    async (
      call: (api: NonNullable<ReturnType<typeof engine>>) => Promise<EngineResult>,
      options?: { downgrade?: () => void },
    ) => {
      const api = engine();
      if (!api) {
        toast.info('本地引擎未连接', {
          description: isDesktop()
            ? '请通过 npm run dev 启动 Electron 窗口。'
            : '请先使用桌面端设置中的 Token 解锁本地 Web 服务。',
        });
        return null;
      }
      try {
        const result = await call(api);
        applyResult(result);
        if (!result.ok && result.permission) {
          setPermissionState({
            issue: result.permission,
            retry: () => {
              void runAction(call);
            },
            downgrade: options?.downgrade ?? null,
          });
        }
        return result;
      } catch (error) {
        notifyCopyable(
          'error',
          '操作失败',
          error instanceof Error ? error.message : String(error),
        );
        return null;
      }
    },
    [applyResult],
  );

  useEffect(() => {
    if (!data) return;
    if (!data.skills.some((skill) => skill.id === selectedSkillId)) {
      setSelectedSkillId(data.skills[0]?.id ?? '');
    }
    if (!data.harnesses.some((harness) => harness.id === selectedHarnessId)) {
      setSelectedHarnessId(data.harnesses[0]?.id ?? '');
    }
    const active = data.projects.filter((project) => !project.missing);
    if (!active.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(active[0]?.id ?? '');
    }
  }, [data, selectedSkillId, selectedHarnessId, selectedProjectId]);

  useEffect(() => {
    setMobileSkillOpen(false);
    setMobileProjectOpen(false);
    setMobileStatusOpen(false);
  }, [view]);

  const navigateView = useCallback((next: View) => {
    setView(next);
    setMobileSkillOpen(false);
    setMobileProjectOpen(false);
    setMobileStatusOpen(false);
  }, []);

  const refresh = useCallback(() => {
    if (refreshing) return;
    const api = engine();
    if (!api) {
      toast.info('桌面端专属操作', {
        description: '请通过 npm run dev 启动 Electron 窗口。',
      });
      return;
    }
    setRefreshing(true);
    void api
      .refresh()
      .then((result) => {
        setRefreshing(false);
        if (!result.ok) {
          toast.error('对账失败', { description: result.error });
          return;
        }
        if (result.snapshot) setData(result.snapshot);
        const snapshot = result.snapshot;
        const activeBindings =
          snapshot?.bindings.filter((binding) => binding.state !== 'orphaned').length ?? 0;
        const drift =
          snapshot?.bindings.filter(
            (binding) => binding.state === 'drifted' && !binding.ignoredDrift,
          ).length ?? 0;
        toast.success('对账完成', {
          description: `${snapshot?.skills.length ?? 0} 个技能 · ${activeBindings} 处生效 · ${drift} 处本地修改`,
        });
      })
      .catch((error) => {
        setRefreshing(false);
        toast.error('对账失败', {
          description: error instanceof Error ? error.message : String(error),
        });
      });
  }, [refreshing]);

  useEffect(() => {
    const notices = data?.notices;
    if (!notices?.length) return;
    for (const notice of notices) {
      if (seenNotices.current.has(notice.id)) continue;
      seenNotices.current.add(notice.id);
      toast.success(notice.message, {
        description: notice.description,
        duration: 5200,
      });
    }
  }, [data?.notices]);

  useEffect(() => {
    const issue = data?.permission;
    if (!issue || seenPermission.current === issue.key) return;
    seenPermission.current = issue.key;
    setPermissionState({
      issue,
      retry: () => refresh(),
      downgrade: null,
    });
  }, [data?.permission, refresh]);

  const retryPermission = useCallback(() => {
    const retry = permissionState?.retry;
    setPermissionState(null);
    retry?.();
  }, [permissionState]);

  const downgradePermission = useCallback(() => {
    const downgrade = permissionState?.downgrade;
    setPermissionState(null);
    downgrade?.();
  }, [permissionState]);

  const handleWebUnlock = useCallback(() => {
    setWebNotice(null);
    setWebReady(true);
  }, []);

  const openEnable = useCallback(
    (skillId?: string, intent?: Omit<EnableIntent, 'skillId'>) => {
      setEnableIntent({ skillId, ...intent });
    },
    [],
  );

  const enableSkill = useCallback(
    (skillId: string, selection: EnableSelection) => {
      void runAction(
        (api) => api.enable({ skillId, ...selection }),
        selection.syncMode === 'link'
          ? {
              downgrade: () => {
                void runAction((api) =>
                  api.enable({ skillId, ...selection, syncMode: 'copy' }),
                );
              },
            }
          : undefined,
      ).then((result) => {
        if (result?.ok) setEnableIntent(null);
      });
    },
    [runAction],
  );

  const disableBinding = useCallback(
    (id: string) => {
      void (async () => {
        const api = engine();
        if (!api) {
          toast.info('本地引擎未连接', {
            description: isDesktop()
              ? '请通过 npm run dev 启动 Electron 窗口。'
              : '请先使用桌面端设置中的 Token 解锁本地 Web 服务。',
          });
          return;
        }
        try {
          const impact = await api.checkDisableImpact(id);
          if (!impact.ok) {
            applyResult(impact);
            return;
          }
          const dependents = impact.dependents ?? [];
          const shared = impact.shared ?? null;
          if (dependents.length > 0 || shared?.active) {
            setDisableImpact({ bindingId: id, dependents, shared });
            return;
          }
          await runAction((client) => client.disable(id));
        } catch (error) {
          toast.error('无法检查技能依赖', {
            description: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    },
    [applyResult, runAction],
  );

  const confirmDisable = useCallback(
    (mode: 'single' | 'split' | 'all') => {
      if (!disableImpact) return;
      const id = disableImpact.bindingId;
      setDisableImpact(null);
      void runAction((api) => api.disable(id, mode));
    },
    [disableImpact, runAction],
  );

  const convertToCopy = useCallback(
    (id: string) => {
      void runAction((api) => api.convertToCopy(id));
    },
    [runAction],
  );

  const updateBinding = useCallback(
    (id: string) => {
      void runAction((api) => api.updateBinding(id));
    },
    [runAction],
  );

  const resetBinding = useCallback(
    (id: string) => {
      void runAction((api) => api.resetBinding(id));
    },
    [runAction],
  );

  const adoptBinding = useCallback(
    (id: string) => {
      void runAction((api) => api.adoptBinding(id));
    },
    [runAction],
  );

  const ignoreDrift = useCallback(
    (id: string) => {
      void runAction((api) => api.ignoreDrift(id));
    },
    [runAction],
  );

  const redeployBinding = useCallback(
    (id: string) => {
      void runAction((api) => api.redeployBinding(id));
    },
    [runAction],
  );

  const switchVersion = useCallback(
    (skillId: string, sha: string) => {
      void runAction((api) => api.switchVersion({ skillId, sha }));
    },
    [runAction],
  );

  const adoptUnmanaged = useCallback(
    (id: string, mode: 'register' | 'adopt') => {
      void runAction((api) => api.adoptUnmanaged({ id, mode })).then((result) => {
        if (result?.ok && result.snapshot) {
          const current = dataRef.current;
          const added = result.snapshot.skills.find(
            (skill) => !current?.skills.some((item) => item.id === skill.id),
          );
          if (added) setSelectedSkillId(added.id);
        }
      });
    },
    [runAction],
  );

  const adoptUnmanagedBatch = useCallback(
    (ids: string[], mode: 'register' | 'adopt') => {
      if (ids.length === 0) return;
      void runAction((api) => api.adoptUnmanagedBatch({ ids, mode })).then((result) => {
        if (result?.ok && result.snapshot && mode === 'adopt') {
          const current = dataRef.current;
          const added = result.snapshot.skills.find(
            (skill) => !current?.skills.some((item) => item.id === skill.id),
          );
          if (added) setSelectedSkillId(added.id);
        }
      });
    },
    [runAction],
  );

  const ignoreUnmanaged = useCallback(
    (id: string) => {
      void runAction((api) => api.ignoreUnmanaged(id));
    },
    [runAction],
  );

  const resyncSkillComment = useCallback(
    (skillId: string) => {
      void runAction((api) => api.resyncSkillComment(skillId));
    },
    [runAction],
  );

  const loadSkillPreview = useCallback(
    (skillId: string, sha?: string | null) =>
      runAction((api) => api.skillPreview({ skillId, sha: sha ?? null })),
    [runAction],
  );

  const scanHarness = useCallback(
    (harnessId: HarnessId) => {
      if (scanningHarness) return;
      setScanningHarness(harnessId);
      void runAction((api) => api.scanHarness(harnessId)).finally(() =>
        setScanningHarness(null),
      );
    },
    [runAction, scanningHarness],
  );

  const toggleFavorite = useCallback(
    (skillId: string) => {
      void runAction((api) => api.toggleFavorite(skillId));
    },
    [runAction],
  );

  const addHarnessCandidate = useCallback(
    (harnessId: HarnessId, path: string) => {
      void runAction((api) =>
        api.addHarnessCandidate({ harnessId, path, scope: 'global' }),
      );
    },
    [runAction],
  );

  const createCandidateDir = useCallback(
    (harnessId: HarnessId, candidateId: string, projectId?: string) => {
      void runAction((api) =>
        api.createCandidateDir({ harnessId, candidateId, projectId }),
      );
    },
    [runAction],
  );

  const resetHarnessDefaults = useCallback(
    (harnessId: HarnessId) => {
      void runAction((api) => api.resetHarnessDefaults(harnessId));
    },
    [runAction],
  );

  const exportProject = useCallback(
    (projectId: string) => {
      void runAction((api) => api.exportProject(projectId));
    },
    [runAction],
  );

  const restoreProject = useCallback(
    (projectId: string) => {
      void runAction((api) => api.restoreProject(projectId));
    },
    [runAction],
  );

  const cleanProject = useCallback(
    (projectId: string) => {
      void runAction((api) => api.cleanProject(projectId));
    },
    [runAction],
  );

  const relocateProject = useCallback(
    (projectId: string) => {
      const project = dataRef.current?.projects.find((item) => item.id === projectId);
      void (async () => {
        const folder = await pickFolder({
          title: '选择项目的新目录',
          defaultPath: project?.path,
        });
        if (!folder) return;
        await runAction((api) => api.relocateProject({ projectId, path: folder }));
      })();
    },
    [runAction],
  );

  const addProject = useCallback(() => {
    void (async () => {
      const folder = await pickFolder({ title: '选择项目目录' });
      if (!folder) return;
      await runAction((api) => api.addProject(folder));
    })();
  }, [runAction]);

  const convertToProjectOnly = useCallback(
    (skillId: string, projectId: string) => {
      void runAction((api) => api.convertToProjectOnly({ skillId, projectId }));
    },
    [runAction],
  );

  const handleImportResult = useCallback(
    (result: EngineResult) => {
      const before = dataRef.current?.skills.map((skill) => skill.id) ?? [];
      applyResult(result);
      if (result.ok && result.snapshot) {
        const added = result.snapshot.skills.find((skill) => !before.includes(skill.id));
        if (added) {
          setSelectedSkillId(added.id);
          setView('skills');
          setMobileSkillOpen(true);
        }
      }
    },
    [applyResult],
  );

  const confirmDeleteSkill = useCallback(() => {
    if (!deleteSkillId) return;
    setDeleteBusy(true);
    void runAction((api) => api.deleteSkill(deleteSkillId)).then((result) => {
      setDeleteBusy(false);
      if (result?.ok) setDeleteSkillId(null);
    });
  }, [deleteSkillId, runAction]);

  const actions: QuiverActions = useMemo(
    () => ({
      refresh,
      openPalette: () => setPaletteOpen(true),
      openSettings: () => setSettingsOpen(true),
      openImport: () => setImportOpen(true),
      openEnable,
      openSkill: (skillId) => {
        setSelectedSkillId(skillId);
        setView('skills');
        setMobileSkillOpen(true);
      },
      editSkill: (skillId) => setEditSkillId(skillId),
      deleteSkill: (skillId) => setDeleteSkillId(skillId),
      enableSkill,
      disableBinding,
      toggleFavorite,
      addHarnessCandidate,
      createCandidateDir,
      resetHarnessDefaults,
      convertToCopy,
      updateBinding,
      resetBinding,
      adoptBinding,
      ignoreDrift,
      redeployBinding,
      switchVersion,
      adoptUnmanaged,
      adoptUnmanagedBatch,
      ignoreUnmanaged,
      resyncSkillComment,
      loadSkillPreview,
      scanHarness,
      exportProject,
      restoreProject,
      cleanProject,
      relocateProject,
      convertToProjectOnly,
      addProject,
    }),
    [
      addProject,
      adoptBinding,
      adoptUnmanaged,
      adoptUnmanagedBatch,
      addHarnessCandidate,
      cleanProject,
      convertToCopy,
      convertToProjectOnly,
      createCandidateDir,
      disableBinding,
      enableSkill,
      exportProject,
      ignoreDrift,
      ignoreUnmanaged,
      loadSkillPreview,
      openEnable,
      redeployBinding,
      refresh,
      relocateProject,
      resetHarnessDefaults,
      resyncSkillComment,
      resetBinding,
      restoreProject,
      scanHarness,
      switchVersion,
      toggleFavorite,
      updateBinding,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
        return;
      }
      if (modifier && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        refresh();
        return;
      }
      if (event.key === 'Escape') {
        setPaletteOpen(false);
        setSettingsOpen(false);
        setAuditOpen(false);
        setEnableIntent(null);
        setEditSkillId(null);
        setImportOpen(false);
        setDeleteSkillId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [refresh]);

  if (!isDesktop() && !webReady) {
    return <WebUnlock notice={webNotice} onUnlocked={handleWebUnlock} />;
  }

  if (!data) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <TitleBar
          viewLabel={loading ? '载入中' : '未连接'}
          theme={theme}
          onThemeChange={setTheme}
          onOpenPalette={() => {}}
        />
        <div className="relative flex flex-1 items-center justify-center px-6">
          {loading ? (
            <div className="flex flex-col items-center gap-3">
              <span className="relative flex h-10 w-10 items-center justify-center rounded-[10px] border border-hairline bg-soft shadow-inset-top">
                <Layers className="h-4 w-4 text-fg-muted" strokeWidth={1.6} />
                <span className="absolute -bottom-px left-1/2 h-px w-5 -translate-x-1/2 bg-jade/70 shadow-[0_0_10px_rgba(52,211,153,0.7)]" />
              </span>
              <div className="flex items-center gap-2 text-[14px] text-fg-muted">
                <RefreshCw className="h-3 w-3 animate-spin-slow" strokeWidth={1.8} />
                正在加载本地技能库…
              </div>
              <p className="text-[13px] text-fg-faint">
                读取 metadata.db 与只读中央库索引
              </p>
            </div>
          ) : (
            <div className="flex max-w-[400px] flex-col items-center text-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-rose/[0.22] bg-rose/[0.06] text-rose">
                <AlertTriangle className="h-4 w-4" strokeWidth={1.8} />
              </span>
              <p className="mt-3 text-[14px] text-fg">无法连接本地引擎</p>
              <p className="mt-1 break-all text-[13px] leading-relaxed text-fg-subtle">
                {loadError}
              </p>
              {!isDesktop() ? (
                <p className="mt-2 rounded-[6px] border border-hairline bg-soft px-2.5 py-1.5 text-[13px] leading-relaxed text-fg-faint">
                  请确认 Quiver 桌面端正在运行并已开启本地 Web 服务，然后使用桌面端设置中的
                  Token 解锁。
                </p>
              ) : null}
              <div className="mt-3 flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void loadSnapshot()}
                  className="gap-1.5"
                >
                  <RefreshCw className="h-3 w-3" strokeWidth={1.8} />
                  重新连接
                </Button>
                {!isDesktop() ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      clearWebToken();
                      setWebNotice(null);
                      setWebReady(false);
                    }}
                  >
                    重新输入 Token
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const driftCount = data.bindings.filter(
    (binding) => binding.state === 'drifted' && !binding.ignoredDrift,
  ).length;
  const activeProjects = data.projects.filter((project) => !project.missing);
  const editSkill = data.skills.find((skill) => skill.id === editSkillId) ?? null;
  const deleteSkill = data.skills.find((skill) => skill.id === deleteSkillId) ?? null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TitleBar
        viewLabel={viewLabels[view]}
        theme={theme}
        onThemeChange={setTheme}
        onOpenPalette={() => setPaletteOpen(true)}
        sidebarWidth={navHidden ? 0 : effectiveNavWidth}
        sidebarHidden={navHidden}
        onToggleSidebar={isMobile ? undefined : toggleNav}
      />

      <div className="flex min-h-0 flex-1">
        {!navHidden ? (
          <Sidebar
            view={view}
            onNavigate={navigateView}
            scale={scale}
            onScaleChange={setScale}
            counts={{
              skills: data.skills.length,
              harnesses: data.harnesses.length,
              projects: data.projects.length,
            }}
            driftCount={driftCount}
            refreshing={refreshing}
            lastChecked={new Date(data.settings.lastChecked)}
            onRefresh={refresh}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenAudit={() => setAuditOpen(true)}
            onOpenPalette={() => setPaletteOpen(true)}
            width={effectiveNavWidth}
            onWidthChange={changeNavWidth}
          />
        ) : null}

        <main className="relative flex min-w-0 flex-1 overflow-hidden">
          {!isMobile && navHidden ? (
            <button
              type="button"
              onClick={toggleNav}
              aria-label="展开侧栏"
              title="展开侧栏"
              className="absolute left-0 top-1/2 z-30 hidden h-12 w-5 -translate-y-1/2 items-center justify-center rounded-r-[6px] border border-l-0 border-hairline bg-panel/90 text-fg-subtle shadow-[0_10px_24px_-18px_rgba(0,0,0,0.8)] backdrop-blur transition-colors hover:bg-soft-strong hover:text-fg md:flex"
            >
              <ChevronRight className="h-3 w-3" strokeWidth={1.9} />
            </button>
          ) : null}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={view}
              className="flex h-full min-w-0 flex-1"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              {view === 'skills' ? (
                <SkillsView
                  data={data}
                  selectedSkillId={selectedSkillId}
                  onSelectSkill={setSelectedSkillId}
                  mobile={isMobile}
                  detailOpen={mobileSkillOpen}
                  onOpenDetail={(skillId) => {
                    setSelectedSkillId(skillId);
                    setMobileSkillOpen(true);
                  }}
                  onCloseDetail={() => setMobileSkillOpen(false)}
                  uiScale={scale}
                  actions={actions}
                />
              ) : null}
              {view === 'harness' ? (
                <HarnessView
                  data={data}
                  selectedHarnessId={selectedHarnessId}
                  onSelectHarness={setSelectedHarnessId}
                  scopeMode={harnessScope}
                  onScopeModeChange={setHarnessScope}
                  selectedProjectId={selectedProjectId}
                  onSelectProject={setSelectedProjectId}
                  activeProjects={activeProjects}
                  actions={actions}
                  scanningHarness={scanningHarness}
                  onCreateHarness={() => {
                    setSettingsFocusHarnessId(null);
                    setSettingsCreateSignal((value) => value + 1);
                    setSettingsOpen(true);
                  }}
                  onEditHarnessChain={(harnessId) => {
                    setSettingsFocusHarnessId(harnessId);
                    setSettingsFocusSignal((value) => value + 1);
                    setSettingsOpen(true);
                  }}
                />
              ) : null}
              {view === 'projects' ? (
                <ProjectsView
                  data={data}
                  selectedProjectId={
                    activeProjects.some((project) => project.id === selectedProjectId)
                      ? selectedProjectId
                      : (activeProjects[0]?.id ?? '')
                  }
                  onSelectProject={setSelectedProjectId}
                  activeProjects={activeProjects}
                  mobile={isMobile}
                  detailOpen={mobileProjectOpen}
                  onOpenDetail={(projectId) => {
                    setSelectedProjectId(projectId);
                    setMobileProjectOpen(true);
                  }}
                  onCloseDetail={() => setMobileProjectOpen(false)}
                  actions={actions}
                />
              ) : null}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <MobileTabBar
        view={view}
        statusOpen={mobileStatusOpen}
        driftCount={driftCount}
        onNavigate={navigateView}
        onOpenStatus={() => setMobileStatusOpen(true)}
      />

      <EnableDialog
        intent={enableIntent}
        data={data}
        activeProjects={activeProjects}
        onClose={() => setEnableIntent(null)}
        onConfirm={enableSkill}
      />
      <EditSkillDialog
        skill={editSkill}
        skills={data.skills}
        onClose={() => setEditSkillId(null)}
        onDone={applyResult}
      />
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={handleImportResult}
      />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        data={data}
        onDone={applyResult}
        createSignal={settingsCreateSignal}
        focusHarnessId={settingsFocusHarnessId}
        focusSignal={settingsFocusSignal}
      />
      <AuditLogDialog
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        homeDir={data?.settings.homeDir}
      />
      <MobileStatusSheet
        open={mobileStatusOpen}
        data={data}
        driftCount={driftCount}
        refreshing={refreshing}
        lastChecked={new Date(data.settings.lastChecked)}
        onClose={() => setMobileStatusOpen(false)}
        onRefresh={refresh}
        onOpenAudit={() => {
          setMobileStatusOpen(false);
          setAuditOpen(true);
        }}
        onOpenSettings={() => {
          setMobileStatusOpen(false);
          setSettingsOpen(true);
        }}
      />
      <DisableDependencyDialog
        open={Boolean(disableImpact) && !disableImpact?.shared?.active}
        dependents={disableImpact?.dependents ?? []}
        onCancel={() => setDisableImpact(null)}
        onConfirm={() => confirmDisable('single')}
      />
      <SharedDisableDialog
        open={Boolean(disableImpact?.shared?.active)}
        shared={disableImpact?.shared ?? null}
        dependents={disableImpact?.dependents ?? []}
        onCancel={() => setDisableImpact(null)}
        onChoose={confirmDisable}
      />
      <PermissionDialog
        issue={permissionState?.issue ?? null}
        canDowngrade={Boolean(permissionState?.downgrade)}
        onClose={() => setPermissionState(null)}
        onRetry={retryPermission}
        onDowngrade={downgradePermission}
      />
      <ConfirmDialog
        open={Boolean(deleteSkill)}
        title="删除技能"
        description={
          <>
            确定删除
            <span className="px-1 font-mono text-fg-muted">{deleteSkill?.slug}</span>
            吗？该技能的所有绑定入口会被解链，中央库内容按内容寻址保留。
          </>
        }
        note="删除后无法在 Quiver 中恢复版本记录；需要时可重新导入。"
        confirmLabel={deleteBusy ? '删除中…' : '删除技能'}
        busy={deleteBusy}
        onCancel={() => setDeleteSkillId(null)}
        onConfirm={confirmDeleteSkill}
      />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        data={data}
        selectedSkillId={selectedSkillId}
        selectedProjectId={selectedProjectId}
        currentView={view}
        actions={actions}
        onNavigate={navigateView}
      />
      <Toaster
        theme={theme}
        position={isMobile ? 'top-center' : 'bottom-right'}
        gap={8}
        visibleToasts={3}
        closeButton
        toastOptions={{
          style: {
            background: 'var(--color-raised)',
            border: '1px solid var(--color-hairline)',
            boxShadow:
              theme === 'dark'
                ? '0 24px 60px -24px rgba(0,0,0,0.95), inset 0 1px 0 rgba(255,255,255,0.05)'
                : '0 20px 50px -20px rgba(15,23,42,0.28), inset 0 1px 0 rgba(255,255,255,0.9)',
            color: 'var(--color-fg)',
            borderRadius: '9px',
            padding: '11px 13px',
            fontSize: '14px',
            width: 'min(360px, calc(100vw - 32px))',
          },
          classNames: {
            toast: '!select-text !pr-9 max-sm:!pr-12',
            title: '!text-[14px] !font-medium',
            description: '!text-[13.5px] !leading-[1.55] !text-fg-muted',
            actionButton:
              '!h-7 !rounded-[5px] !border !border-hairline !bg-soft !px-2.5 !text-[13px] !font-medium !text-fg-muted transition-colors hover:!border-hairline-strong hover:!bg-soft-strong hover:!text-fg',
            closeButton:
              '!left-auto !right-2 !top-2 !bottom-auto !h-6 !w-6 !transform-none !rounded-[5px] !border !border-hairline !bg-raised !text-fg-subtle hover:!text-fg max-sm:!right-1.5 max-sm:!top-1.5 max-sm:!h-10 max-sm:!w-10',
          },
        }}
        icons={{
          success: <CheckCircle2 className="h-4 w-4 text-jade" />,
          error: <AlertTriangle className="h-4 w-4 text-rose" />,
          info: <Info className="h-4 w-4 text-sky" />,
        }}
      />
    </div>
  );
}
