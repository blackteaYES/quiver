import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Copy,
  Download,
  Eye,
  EyeOff,
  FlaskConical,
  FolderOpen,
  Globe2,
  HardDrive,
  Keyboard,
  Maximize2,
  Minimize2,
  Monitor,
  Plus,
  QrCode,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  Upload,
  Wifi,
  X,
} from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal, inputClass } from '@/components/ui/Modal';
import { Segmented } from '@/components/ui/Segmented';
import { HarnessMark } from '@/components/HarnessMark';
import qrcode from 'qrcode-generator';
import {
  copyPath,
  engine,
  isDesktop,
  openExternal,
  openWorkRoot,
  pickFile,
  pickFolder,
  saveFile,
  saveQrImage,
  setTrayOnClosePreference,
} from '@/lib/desktop';
import type {
  AppData,
  CandidateDiscovery,
  CandidateRole,
  EngineMode,
  EngineResult,
  HarnessCategory,
  Scope,
} from '@/lib/types';
import { cn, displayPath } from '@/lib/utils';
import { toast } from 'sonner';

function createQrSvg(data: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(data);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
}

function createQrPngDataUrl(data: string, target = 1024): string {
  const qr = qrcode(0, 'M');
  qr.addData(data);
  qr.make();
  const count = qr.getModuleCount();
  const cell = Math.max(4, Math.floor(target / (count + 8)));
  const margin = cell * 4;
  const size = count * cell + margin * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前环境无法创建画布');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  context.fillStyle = '#000000';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) {
        context.fillRect(col * cell + margin, row * cell + margin, cell, cell);
      }
    }
  }
  return canvas.toDataURL('image/png');
}

function qrFileName(url: string): string {
  const host = url.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '-');
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `quiver-qr-${host}-${stamp}.png`;
}

interface CandidateDraft {
  key: string;
  id: string;
  path: string;
  scope: Scope;
  role: CandidateRole;
  discovery: CandidateDiscovery;
  priority: number;
  label?: string;
}

interface HarnessDraft {
  key: string;
  id: string;
  name: string;
  shortName: string;
  command: string;
  category: HarnessCategory;
  candidates: CandidateDraft[];
  isNew: boolean;
  isBuiltin: boolean;
  idTouched: boolean;
  autoShared: boolean;
  expanded: boolean;
}

type ChainFilter = 'all' | 'active' | 'domestic' | 'global' | 'custom';

const CHAIN_FILTERS: { value: ChainFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '本机活跃' },
  { value: 'domestic', label: '国内主流' },
  { value: 'global', label: '国际主力' },
  { value: 'custom', label: '自定义' },
];

const CATEGORY_LABELS: Record<HarnessCategory, string> = {
  shared: '共享',
  domestic: '国内主流',
  global: '国际主力',
  custom: '自定义',
};

const ROLE_OPTIONS: { value: CandidateRole; label: string }[] = [
  { value: 'primary', label: '原生首选' },
  { value: 'shared', label: '跨工具共享' },
  { value: 'compat', label: '兼容联动' },
  { value: 'synced', label: '云端同步' },
  { value: 'custom', label: '自定义' },
];

const DISCOVERY_OPTIONS: { value: CandidateDiscovery; label: string }[] = [
  { value: 'exact', label: '精确路径' },
  { value: 'parent-chain', label: '父级目录 (↑)' },
  { value: 'nested-monorepo', label: '子包目录 (↓)' },
];

const smallInput =
  'h-6 min-w-0 rounded-[5px] border border-hairline bg-soft px-1.5 text-[13px] text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-hairline-strong focus:bg-soft max-sm:h-10';

const smallSelect =
  'h-6 min-w-0 rounded-[5px] border border-hairline bg-soft px-1 text-[13px] text-fg-muted outline-none transition-colors focus:border-hairline-strong max-sm:h-10';

function candidateKey(id: string, index: number) {
  return `${id || 'candidate'}-${index}`;
}

function autoHarnessId(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toDrafts(data: AppData): HarnessDraft[] {
  return data.harnesses.map((harness) => ({
    key: harness.id,
    id: harness.id,
    name: harness.name,
    shortName: harness.shortName,
    command: harness.command,
    category: harness.category,
    isNew: false,
    isBuiltin: harness.isBuiltin,
    idTouched: true,
    autoShared: harness.candidates.some(
      (candidate) => candidate.role === 'shared' || candidate.path.includes('.agents'),
    ),
    expanded: false,
    candidates: [...harness.candidates]
      .sort((left, right) => left.priority - right.priority)
      .map((candidate, index) => ({
        key: candidateKey(candidate.id, index),
        id: candidate.id,
        path: candidate.path,
        scope: candidate.scope,
        role: candidate.role,
        discovery: candidate.discovery,
        priority: index,
        label: candidate.label,
      })),
  }));
}

export function SettingsDialog({
  open,
  onOpenChange,
  data,
  onDone,
  createSignal = 0,
  focusHarnessId = null,
  focusSignal = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: AppData;
  onDone: (result: EngineResult) => void;
  createSignal?: number;
  focusHarnessId?: string | null;
  focusSignal?: number;
}) {
  const dataRef = useRef(data);
  dataRef.current = data;
  const qrPanelRef = useRef<HTMLDivElement | null>(null);
  const handledCreateSignal = useRef(0);
  const handledFocusSignal = useRef(0);

  const [mode, setMode] = useState<EngineMode>(data.settings.mode);
  const [editorCommand, setEditorCommand] = useState(data.settings.editorCommand);
  const [drafts, setDrafts] = useState<HarnessDraft[]>(() => toDrafts(data));
  const [chainFilter, setChainFilter] = useState<ChainFilter>('all');
  const [chainQuery, setChainQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<HarnessDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [pendingMode, setPendingMode] = useState<EngineMode | null>(null);
  const [webEnabled, setWebEnabled] = useState(data.settings.web.enabled);
  const [webPort, setWebPort] = useState(String(data.settings.web.port));
  const [webLan, setWebLan] = useState(data.settings.web.lan);
  const [trayOnClose, setTrayOnClose] = useState(Boolean(data.settings.trayOnClose));
  const [trayBusy, setTrayBusy] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrPreview, setQrPreview] = useState<{ url: string; scanUrl: string } | null>(null);
  const [qrSaving, setQrSaving] = useState(false);
  const [showVirtualLan, setShowVirtualLan] = useState(false);
  const [webBusy, setWebBusy] = useState(false);
  const [autoPortBusy, setAutoPortBusy] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [pendingRegenerate, setPendingRegenerate] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const desktop = isDesktop();

  useEffect(() => {
    if (!open) return;
    const current = dataRef.current;
    setMode(current.settings.mode);
    setEditorCommand(current.settings.editorCommand);
    setDrafts(toDrafts(current));
    setChainFilter('all');
    setChainQuery('');
    setPendingDelete(null);
    setSaving(false);
    setPendingMode(null);
    setWebEnabled(current.settings.web.enabled);
    setWebPort(String(current.settings.web.port));
    setWebLan(current.settings.web.lan);
    setTrayOnClose(Boolean(current.settings.trayOnClose));
    setTrayBusy(false);
    setWebBusy(false);
    setAutoPortBusy(false);
    setQrUrl(null);
    setQrPreview(null);
    setQrSaving(false);
    setShowVirtualLan(false);
    setTokenVisible(false);
    setPendingRegenerate(false);
    setImportBusy(false);
    // Re-initialize only when the dialog opens; live snapshots should not clobber edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!qrPreview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setQrPreview(null);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [qrPreview]);

  useEffect(() => {
    if (!qrUrl || !open) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => {
      qrPanelRef.current?.scrollIntoView({
        block: 'nearest',
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [qrUrl, open]);

  const close = () => onOpenChange(false);

  const switchMode = async () => {
    if (!pendingMode) return;
    const api = engine();
    if (!api) return;
    setModeBusy(true);
    const result = await api.setMode(pendingMode);
    setModeBusy(false);
    onDone(result);
    if (result.ok) {
      setPendingMode(null);
      close();
    }
  };

  const busyHarnessIds = useMemo(
    () =>
      new Set(
        data.bindings
          .filter((binding) => binding.state !== 'orphaned')
          .map((binding) => binding.harnessId),
      ),
    [data.bindings],
  );

  const patchDraft = (key: string, patch: Partial<HarnessDraft>) => {
    setDrafts((prev) =>
      prev.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)),
    );
  };

  const reindexCandidates = (candidates: CandidateDraft[]) =>
    candidates.map((candidate, index) => ({
      ...candidate,
      priority: index,
    }));

  const sharedCandidates = (): CandidateDraft[] => [
    {
      key: `g-agents-${Date.now()}-g`,
      id: 'g-agents',
      path: '~/.agents/skills',
      scope: 'global',
      role: 'shared',
      discovery: 'exact',
      priority: 0,
      label: '跨工具共享层',
    },
    {
      key: `p-agents-${Date.now()}-p`,
      id: 'p-agents',
      path: '.agents/skills',
      scope: 'project',
      role: 'shared',
      discovery: 'exact',
      priority: 1,
      label: '项目共享层',
    },
  ];

  const newHarnessCandidates = (id: string): CandidateDraft[] =>
    reindexCandidates([
      {
        key: 'g-primary',
        id: 'g-primary',
        path: `~/.${id}/skills`,
        scope: 'global',
        role: 'primary',
        discovery: 'exact',
        priority: 0,
        label: '原生首选',
      },
      {
        key: 'g-agents',
        id: 'g-agents',
        path: '~/.agents/skills',
        scope: 'global',
        role: 'shared',
        discovery: 'exact',
        priority: 1,
        label: '跨工具共享层',
      },
      {
        key: 'p-primary',
        id: 'p-primary',
        path: `.${id}/skills`,
        scope: 'project',
        role: 'primary',
        discovery: 'exact',
        priority: 2,
        label: '项目首选',
      },
      {
        key: 'p-agents',
        id: 'p-agents',
        path: '.agents/skills',
        scope: 'project',
        role: 'shared',
        discovery: 'exact',
        priority: 3,
        label: '项目共享层',
      },
    ]);

  const addCustomDraft = () => {
    setDrafts((prev) => {
      const existing = prev.find((draft) => draft.isNew && !draft.name.trim());
      if (existing) {
        return prev.map((draft) =>
          draft.key === existing.key
            ? { ...draft, expanded: true, autoShared: true }
            : draft,
        );
      }
      const used = new Set(prev.map((draft) => draft.id));
      let serial = prev.filter((draft) => draft.isNew).length + 1;
      let id = `custom-tool-${serial}`;
      while (used.has(id)) {
        serial += 1;
        id = `custom-tool-${serial}`;
      }
      const draft: HarnessDraft = {
        key: `new-${Date.now()}-${id}`,
        id,
        name: '',
        shortName: '',
        command: '',
        category: 'custom',
        candidates: newHarnessCandidates(id),
        isNew: true,
        isBuiltin: false,
        idTouched: false,
        autoShared: true,
        expanded: true,
      };
      return [draft, ...prev];
    });
    setChainFilter('all');
    setChainQuery('');
  };

  useEffect(() => {
    if (!open || !createSignal) return;
    if (handledCreateSignal.current === createSignal) return;
    handledCreateSignal.current = createSignal;
    addCustomDraft();
    // The signal is an explicit one-shot command from the Harness toolbar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, createSignal]);

  useEffect(() => {
    if (!open || !focusSignal || !focusHarnessId) return;
    if (handledFocusSignal.current === focusSignal) return;
    handledFocusSignal.current = focusSignal;
    setChainFilter('all');
    setChainQuery('');
    const targetKey = dataRef.current.harnesses.some(
      (harness) => harness.id === focusHarnessId,
    )
      ? focusHarnessId
      : null;
    if (!targetKey) return;
    setDrafts((prev) =>
      prev.map((draft) =>
        draft.key === targetKey ? { ...draft, expanded: true } : draft,
      ),
    );
    window.setTimeout(() => {
      const row = document.querySelector(`[data-harness-row="${targetKey}"]`);
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    // The signal is an explicit one-shot command from the Harness toolbar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focusSignal, focusHarnessId]);

  const patchHarnessName = (key: string, name: string) => {
    setDrafts((prev) => {
      const used = new Set(prev.filter((draft) => draft.key !== key).map((draft) => draft.id));
      return prev.map((draft) => {
        if (draft.key !== key) return draft;
        if (draft.idTouched) return { ...draft, name };
        let nextId = autoHarnessId(name);
        if (!nextId) return { ...draft, name };
        const base = nextId;
        let suffix = 2;
        while (used.has(nextId)) {
          nextId = `${base}-${suffix}`;
          suffix += 1;
        }
        const oldId = draft.id;
        const candidates =
          oldId && oldId !== nextId
            ? draft.candidates.map((candidate) => {
                if (candidate.path === `~/.${oldId}/skills`) {
                  return { ...candidate, path: `~/.${nextId}/skills` };
                }
                if (candidate.path === `.${oldId}/skills`) {
                  return { ...candidate, path: `.${nextId}/skills` };
                }
                return candidate;
              })
            : draft.candidates;
        return { ...draft, name, id: nextId, candidates };
      });
    });
  };

  const patchHarnessId = (key: string, value: string) => {
    setDrafts((prev) =>
      prev.map((draft) => {
        if (draft.key !== key) return draft;
        const oldId = draft.id;
        const nextId = value.replace(/[^\w.-]+/g, '-').toLowerCase();
        const candidates =
          oldId && nextId
            ? draft.candidates.map((candidate) => {
                if (candidate.path === `~/.${oldId}/skills`) {
                  return { ...candidate, path: `~/.${nextId}/skills` };
                }
                if (candidate.path === `.${oldId}/skills`) {
                  return { ...candidate, path: `.${nextId}/skills` };
                }
                return candidate;
              })
            : draft.candidates;
        return { ...draft, id: nextId, idTouched: true, candidates };
      }),
    );
  };

  const toggleAutoShared = (key: string, checked: boolean) => {
    setDrafts((prev) =>
      prev.map((draft) => {
        if (draft.key !== key) return draft;
        let candidates = draft.candidates;
        if (checked) {
          const missing = sharedCandidates();
          const exists = (scope: Scope, path: string) =>
            candidates.some(
              (candidate) =>
                candidate.scope === scope &&
                candidate.path.replace(/\/+$/, '') === path,
            );
          const additions = missing.filter(
            (candidate) => !exists(candidate.scope, candidate.path),
          );
          candidates = reindexCandidates([...candidates, ...additions]);
        } else {
          candidates = draft.candidates.filter(
            (candidate) => !candidate.path.replace(/\/+$/, '').endsWith('.agents/skills'),
          );
          if (!candidates.some((candidate) => candidate.scope === 'global')) {
            candidates = reindexCandidates([
              ...candidates,
              {
                key: `g-primary-${Date.now()}`,
                id: 'g-primary',
                path: `~/.${draft.id || 'tool'}/skills`,
                scope: 'global',
                role: 'primary',
                discovery: 'exact',
                priority: 0,
              },
            ]);
          }
        }
        return { ...draft, autoShared: checked, candidates };
      }),
    );
  };

  const patchCandidate = (
    draftKey: string,
    candidateKeyValue: string,
    patch: Partial<CandidateDraft>,
  ) => {
    setDrafts((prev) =>
      prev.map((draft) =>
        draft.key === draftKey
          ? {
              ...draft,
              candidates: draft.candidates.map((candidate) =>
                candidate.key === candidateKeyValue
                  ? { ...candidate, ...patch }
                  : candidate,
              ),
            }
          : draft,
      ),
    );
  };

  const addCandidate = (draftKey: string, scope: Scope) => {
    setDrafts((prev) =>
      prev.map((draft) => {
        if (draft.key !== draftKey) return draft;
        const serial = draft.candidates.filter(
          (candidate) => candidate.scope === scope,
        ).length + 1;
        const candidate: CandidateDraft = {
          key: `c-${scope}-${Date.now()}-${serial}`,
          id: `${scope === 'global' ? 'g' : 'p'}-custom-${serial}`,
          path: '',
          scope,
          role: 'custom',
          discovery: 'exact',
          priority: draft.candidates.length,
        };
        return {
          ...draft,
          candidates: reindexCandidates([...draft.candidates, candidate]),
        };
      }),
    );
  };

  const moveCandidate = (
    draftKey: string,
    candidateKeyValue: string,
    direction: -1 | 1,
  ) => {
    setDrafts((prev) =>
      prev.map((draft) => {
        if (draft.key !== draftKey) return draft;
        const index = draft.candidates.findIndex(
          (candidate) => candidate.key === candidateKeyValue,
        );
        if (index < 0) return draft;
        const scope = draft.candidates[index].scope;
        const peers = draft.candidates
          .map((candidate, itemIndex) => ({ candidate, itemIndex }))
          .filter((entry) => entry.candidate.scope === scope);
        const peerIndex = peers.findIndex(
          (entry) => entry.candidate.key === candidateKeyValue,
        );
        const target = peers[peerIndex + direction];
        if (!target) return draft;
        const list = [...draft.candidates];
        [list[index], list[target.itemIndex]] = [list[target.itemIndex], list[index]];
        return { ...draft, candidates: reindexCandidates(list) };
      }),
    );
  };

  const setPrimaryCandidate = (draftKey: string, candidateKeyValue: string) => {
    setDrafts((prev) =>
      prev.map((draft) => {
        if (draft.key !== draftKey) return draft;
        const current = draft.candidates.find(
          (candidate) => candidate.key === candidateKeyValue,
        );
        if (!current) return draft;
        const list = draft.candidates.map((candidate) =>
          candidate.scope === current.scope && candidate.role === 'primary'
            ? { ...candidate, role: 'custom' as const }
            : candidate.key === candidateKeyValue
              ? { ...candidate, role: 'primary' as const }
              : candidate,
        );
        const targetIndex = list.findIndex(
          (candidate) => candidate.key === candidateKeyValue,
        );
        const [moved] = list.splice(targetIndex, 1);
        const firstScopeIndex = list.findIndex(
          (candidate) => candidate.scope === current.scope,
        );
        list.splice(firstScopeIndex < 0 ? list.length : firstScopeIndex, 0, moved);
        return { ...draft, candidates: reindexCandidates(list) };
      }),
    );
  };

  const candidateInUse = (draft: HarnessDraft, candidate: CandidateDraft) =>
    !draft.isNew &&
    data.bindings.some(
      (binding) =>
        binding.harnessId === draft.id &&
        binding.state !== 'orphaned' &&
        binding.candidateId === candidate.id,
    );

  const removeCandidate = (draftKey: string, candidateKeyValue: string) => {
    const draft = drafts.find((item) => item.key === draftKey);
    const candidate = draft?.candidates.find((item) => item.key === candidateKeyValue);
    if (!draft || !candidate) return;
    if (candidate.scope === 'global') {
      const others = draft.candidates.filter(
        (item) => item.scope === 'global' && item.key !== candidateKeyValue,
      );
      if (others.length === 0) {
        toast.error('至少保留一个全局候选路径');
        return;
      }
    }
    if (candidateInUse(draft, candidate)) {
      toast.error('该候选路径仍有生效绑定', {
        description: '请先在 Harness 视图停用相关技能，再删除候选路径。',
      });
      return;
    }
    setDrafts((prev) =>
      prev.map((item) =>
        item.key === draftKey
          ? {
              ...item,
              candidates: reindexCandidates(
                item.candidates.filter(
                  (entry) => entry.key !== candidateKeyValue,
                ),
              ),
            }
          : item,
      ),
    );
  };

  const resetCandidates = (draftKey: string) => {
    const draft = drafts.find((item) => item.key === draftKey);
    if (!draft) return;
    const source = data.harnesses.find((item) => item.id === draft.id);
    if (!source || source.defaultCandidates.length === 0) {
      toast.info('该工具没有可恢复的内置默认路径链');
      return;
    }
    setDrafts((prev) =>
      prev.map((item) =>
        item.key === draftKey
          ? {
              ...item,
              candidates: reindexCandidates(
                source.defaultCandidates.map((candidate, index) => ({
                  key: candidateKey(candidate.id, index),
                  ...candidate,
                })),
              ),
            }
          : item,
      ),
    );
    toast.info('已填入默认路径链，保存后生效');
  };

  const confirmDeleteDraft = () => {
    if (!pendingDelete) return;
    const key = pendingDelete.key;
    setDrafts((prev) => prev.filter((draft) => draft.key !== key));
    setPendingDelete(null);
  };

  const browseCandidate = async (draftKey: string, candidateKeyValue: string) => {
    const picked = await pickFolder({ title: '选择扫描目录' });
    if (!picked) return;
    patchCandidate(draftKey, candidateKeyValue, {
      path: displayPath(picked, data.settings.homeDir) || picked,
    });
  };

  const visibleDrafts = useMemo(() => {
    const normalized = chainQuery.trim().toLowerCase();
    const activeIds = new Set(
      data.harnesses
        .filter(
          (harness) =>
            harness.detected ||
            harness.managedCount > 0 ||
            harness.category === 'shared' ||
            !harness.isBuiltin,
        )
        .map((harness) => harness.id),
    );
    return drafts.filter((draft) => {
      if (chainFilter === 'active' && !draft.isNew && !activeIds.has(draft.id)) {
        return false;
      }
      if (
        (chainFilter === 'domestic' ||
          chainFilter === 'global' ||
          chainFilter === 'custom') &&
        draft.category !== chainFilter
      ) {
        return false;
      }
      if (!normalized) return true;
      return [draft.id, draft.name, draft.shortName, ...draft.candidates.map((item) => item.path)]
        .join(' ')
        .toLowerCase()
        .includes(normalized);
    });
  }, [chainFilter, chainQuery, data.harnesses, drafts]);

  const parseWebPort = () => {
    const port = Number.parseInt(webPort, 10);
    return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null;
  };

  const save = async () => {
    if (saving || webBusy) return;
    const api = engine();
    if (!api) return;
    for (const draft of drafts) {
      if (!draft.id.trim() || !draft.name.trim()) {
        toast.error('工具映射不完整', { description: '每一行都需要填写名称与标识。' });
        return;
      }
      if (!draft.candidates.some((candidate) => candidate.scope === 'global')) {
        toast.error('缺少全局候选路径', {
          description: `${draft.name || draft.id} 至少需要一个全局候选路径。`,
        });
        return;
      }
      const empty = draft.candidates.find((candidate) => !candidate.path.trim());
      if (empty) {
        toast.error('扫描路径不能为空', {
          description: `${draft.name || draft.id} 中有未填写的候选路径。`,
        });
        return;
      }
    }
    const web = data.settings.web;
    const draftPort = parseWebPort();
    const webDirty =
      webEnabled !== web.enabled || webLan !== web.lan || draftPort !== web.port;
    if (webDirty && draftPort === null) {
      toast.error('端口无效', {
        description: '请填写 1024-65535 之间的整数。',
      });
      return;
    }
    setSaving(true);
    const saved = await api.saveConfig({
      editorCommand: editorCommand.trim() || 'code',
      harnesses: drafts.map((draft) => ({
        id: draft.id.trim(),
        name: draft.name.trim(),
        shortName: draft.shortName.trim() || draft.name.trim(),
        command: draft.command.trim() || draft.name.trim(),
        category: draft.category,
        candidates: draft.candidates.map((candidate, index) => ({
          id: candidate.id || `${candidate.scope}-${index + 1}`,
          path: candidate.path.trim(),
          scope: candidate.scope,
          role: candidate.role,
          discovery: candidate.discovery,
          priority: index,
          ...(candidate.label?.trim() ? { label: candidate.label.trim() } : {}),
        })),
      })),
    });
    if (!saved.ok) {
      setSaving(false);
      onDone(saved);
      return;
    }
    let result = saved;
    if (webDirty) {
      setWebBusy(true);
      try {
        result = await api.configureWeb({
          enabled: webEnabled,
          port: draftPort as number,
          lan: webLan,
        });
      } finally {
        setWebBusy(false);
      }
      setQrUrl(null);
      setQrPreview(null);
    }
    setSaving(false);
    onDone(result);
    if (result.ok) close();
  };

  const exportBackup = async () => {
    const api = engine();
    if (!api) return;
    const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    const file = await saveFile({
      title: '导出 Quiver 备份',
      defaultPath: `quiver-backup-${stamp}.json`,
      filters: [{ name: 'Quiver 备份', extensions: ['json'] }],
    });
    if (!file) return;
    onDone(await api.exportBackup(file));
  };

  const importBackup = async () => {
    const api = engine();
    if (!api || importBusy) return;
    const file = await pickFile({
      title: '导入 Quiver 备份',
      filters: [{ name: 'Quiver 备份', extensions: ['json'] }],
    });
    if (!file) return;
    setImportBusy(true);
    const result = await api.importBackup(file);
    setImportBusy(false);
    onDone(result);
  };

  const saveWeb = async () => {
    const api = engine();
    if (!api || webBusy || saving) return;
    const port = parseWebPort();
    if (port === null) {
      toast.error('端口无效', {
        description: '请填写 1024-65535 之间的整数。',
      });
      return;
    }
    setWebBusy(true);
    try {
      const result = await api.configureWeb({ enabled: webEnabled, port, lan: webLan });
      onDone(result);
    } finally {
      setWebBusy(false);
    }
    setQrUrl(null);
    setQrPreview(null);
  };

  const applyLan = async (next: boolean) => {
    if (webBusy || saving || !webEnabled) return;
    const api = engine();
    if (!api) return;
    const port = parseWebPort();
    if (next && port === null) {
      toast.error('端口无效', {
        description: '请先填写 1024-65535 之间的端口，再允许局域网访问。',
      });
      return;
    }
    const previous = webLan;
    setWebLan(next);
    setWebBusy(true);
    try {
      const result = await api.configureWeb({
        enabled: true,
        ...(port !== null ? { port } : {}),
        lan: next,
      });
      onDone(result);
      if (result.ok) {
        const webState = result.snapshot?.settings.web;
        setQrUrl(next && webState?.running ? (webState.lanUrls[0] ?? null) : null);
        setQrPreview(null);
      } else {
        setWebLan(previous);
      }
    } catch (error) {
      setWebLan(previous);
      toast.error('切换局域网访问失败', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setWebBusy(false);
    }
  };

  const applyTrayOnClose = async (next: boolean) => {
    if (trayBusy || saving) return;
    const previous = trayOnClose;
    setTrayOnClose(next);
    setTrayBusy(true);
    try {
      const result = await setTrayOnClosePreference(next);
      onDone(result);
      if (!result.ok) {
        setTrayOnClose(previous);
        return;
      }
      const actual = result.snapshot?.settings.trayOnClose;
      if (typeof actual === 'boolean') setTrayOnClose(actual);
    } catch (error) {
      setTrayOnClose(previous);
      toast.error('切换托盘驻留失败', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTrayBusy(false);
    }
  };

  const downloadQr = async (scanUrl: string, url: string) => {
    if (qrSaving) return;
    setQrSaving(true);
    try {
      await saveQrImage(createQrPngDataUrl(scanUrl), qrFileName(url));
    } catch (error) {
      toast.error('无法生成二维码图片', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setQrSaving(false);
    }
  };

  const regenerateToken = async () => {
    const api = engine();
    if (!api || webBusy) return;
    setWebBusy(true);
    const result = await api.configureWeb({ regenerateToken: true });
    setWebBusy(false);
    setPendingRegenerate(false);
    setTokenVisible(false);
    setQrUrl(null);
    setQrPreview(null);
    onDone(result);
  };

  const autoAllocatePort = async () => {
    const api = engine();
    if (!api?.autoAllocateWebPort || autoPortBusy || webBusy) return;
    setAutoPortBusy(true);
    try {
      const result = await api.autoAllocateWebPort();
      onDone(result);
      if (result.ok && result.snapshot) {
        const nextWeb = result.snapshot.settings.web;
        setWebEnabled(nextWeb.enabled);
        setWebPort(String(nextWeb.port));
        setWebLan(nextWeb.lan);
        setQrUrl(null);
        setQrPreview(null);
      }
    } catch (error) {
      toast.error('自动分配端口失败', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setAutoPortBusy(false);
    }
  };

  const web = data.settings.web;
  const lanAddresses =
    web.lanAddresses?.length > 0
      ? web.lanAddresses
      : web.lanUrls.map((url) => ({
          address: url.replace(/^https?:\/\//, '').replace(/:\d+$/, ''),
          name: '局域网',
          virtual: false,
          url,
        }));
  const physicalLan = lanAddresses.filter((entry) => !entry.virtual);
  const virtualLan = lanAddresses.filter((entry) => entry.virtual);
  const lanEntries =
    physicalLan.length > 0 && !showVirtualLan ? physicalLan : lanAddresses;
  const hiddenLanCount =
    physicalLan.length > 0 && !showVirtualLan ? virtualLan.length : 0;
  const directLink = (url: string) =>
    web.token
      ? `${url.replace(/\/+$/, '')}/#token=${encodeURIComponent(web.token)}`
      : url;

  const sandboxLabel = displayPath(
    data.settings.sandboxRoot ?? '.quiver-demo',
    data.settings.homeDir,
  );
  const tokenMask = web.token
    ? `${web.token.slice(0, 6)}${'•'.repeat(10)}${web.token.slice(-4)}`
    : '尚未生成';
  const webStateLabel = !web.enabled ? '已关闭' : web.running ? '运行中' : '未运行';

  return (
    <>
      <Modal open={open} onClose={close} ariaLabel="设置与路径映射" className="max-w-[600px]">
        <header className="flex shrink-0 items-start justify-between border-b border-hairline px-4 py-3">
          <div>
            <h2 className="text-[16px] font-semibold text-fg">设置</h2>
            <p className="mt-0.5 text-[13px] text-fg-subtle">
              运行模式、本地 Web 服务与各工具扫描目录
            </p>
          </div>
          <IconButton label="关闭设置" onClick={close} className="-mr-1">
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
          <section>
            <div className="flex items-center gap-1.5 text-[14px] font-medium text-fg-muted">
              <HardDrive className="h-3 w-3 text-fg-subtle" strokeWidth={1.8} />
              运行模式
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5 rounded-[8px] border border-hairline bg-soft p-1">
              {(
                [
                  {
                    value: 'sandbox' as const,
                    label: '演示沙盒模式',
                    hint: sandboxLabel,
                    icon: FlaskConical,
                  },
                  {
                    value: 'real' as const,
                    label: '真实本地目录',
                    hint: '~/.quiver',
                    icon: Monitor,
                  },
                ] as const
              ).map((option) => {
                const active = mode === option.value;
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={!desktop}
                    onClick={() => {
                      if (option.value !== mode) setPendingMode(option.value);
                    }}
                    aria-pressed={active}
                    className={cn(
                      'relative flex items-center gap-2 rounded-[6px] px-2.5 py-2 text-left transition-colors',
                      active ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted',
                    )}
                  >
                    {active ? (
                      <span className="absolute inset-0 rounded-[6px] border border-hairline bg-soft-strong shadow-inset-top" />
                    ) : null}
                    <Icon
                      className={cn('relative h-3.5 w-3.5', active ? 'text-fg' : 'text-fg-faint')}
                      strokeWidth={1.8}
                    />
                    <span className="relative min-w-0">
                      <span className="block text-[14px] leading-tight">{option.label}</span>
                      <span className="mt-0.5 block truncate font-mono text-[13px] leading-tight text-fg-subtle">
                        {option.hint}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <span
                title={data.settings.workRoot}
                className="min-w-0 flex-1 truncate rounded-[5px] border border-hairline bg-soft px-2 py-[5px] font-mono text-[13px] text-fg-subtle"
              >
                {displayPath(data.settings.workRoot, data.settings.homeDir)}
              </span>
              {desktop ? (
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => void openWorkRoot()}
                  className="gap-1"
                >
                  <FolderOpen className="h-2.5 w-2.5" />
                  打开工作目录
                </Button>
              ) : null}
            </div>
            {!desktop ? (
              <p className="mt-1.5 text-[13px] leading-relaxed text-fg-faint">
                运行模式只能在桌面端切换；浏览器访问始终连接到桌面端当前使用的工作目录。
              </p>
            ) : null}
          </section>

          <section className="mt-5">
            <div className="flex items-center gap-1.5 text-[14px] font-medium text-fg-muted">
              <Keyboard className="h-3 w-3 text-fg-subtle" strokeWidth={1.8} />
              默认编辑器命令
            </div>
            <input
              value={editorCommand}
              onChange={(event) => setEditorCommand(event.target.value)}
              spellCheck={false}
              placeholder="code"
              className={`${inputClass} mt-2 font-mono text-[13px]`}
            />
            <p className="mt-1 text-[13px] leading-relaxed text-fg-faint">
              路径快捷操作会执行「命令 + 目标路径」，默认 code（VS Code）。可填写带参数的完整命令。
            </p>
          </section>

          <section className="mt-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[14px] font-medium text-fg-muted">
                <Globe2 className="h-3 w-3 text-fg-subtle" strokeWidth={1.8} />
                本地 Web 服务
              </div>
              <span className="flex items-center gap-1.5 text-[13px] text-fg-subtle">
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    web.enabled
                      ? web.running
                        ? 'bg-jade'
                        : 'bg-rose'
                      : 'bg-fg-faint',
                  )}
                />
                {webStateLabel}
              </span>
            </div>

            {desktop ? (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Segmented<'on' | 'off'>
                    layoutId="settings-web-toggle"
                    label="本地 Web 服务开关"
                    value={webEnabled ? 'on' : 'off'}
                    onChange={(value) => setWebEnabled(value === 'on')}
                    options={[
                      { value: 'on', label: '开启' },
                      { value: 'off', label: '关闭' },
                    ]}
                  />
                  <label className="ml-1 flex items-center gap-1.5 text-[13px] text-fg-subtle">
                    端口
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={webPort}
                      onChange={(event) => setWebPort(event.target.value)}
                      aria-label="本地 Web 服务端口"
                      className={`${smallInput} w-[84px] font-mono`}
                    />
                  </label>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => void saveWeb()}
                    disabled={webBusy || saving}
                    className="gap-1"
                  >
                    <RefreshCw
                      className={cn('h-2.5 w-2.5', webBusy && 'animate-spin-slow')}
                      strokeWidth={1.9}
                    />
                    {webBusy ? '应用中…' : '保存并应用'}
                  </Button>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={webLan}
                  aria-busy={webBusy}
                  disabled={!webEnabled || webBusy || saving}
                  onClick={() => void applyLan(!webLan)}
                  className={cn(
                    'mt-2 flex w-full items-start gap-2.5 rounded-[7px] border border-hairline bg-soft px-3 py-2.5 text-left transition-colors hover:border-hairline-strong hover:bg-soft-strong',
                    (!webEnabled || webBusy || saving) &&
                      'cursor-not-allowed opacity-60 hover:border-hairline hover:bg-soft',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-[18px] w-8 shrink-0 items-center rounded-full border px-0.5 transition-colors',
                      webLan
                        ? 'justify-end border-jade/40 bg-jade/25'
                        : 'justify-start border-hairline bg-hover',
                    )}
                  >
                    <span
                      className={cn(
                        'h-3.5 w-3.5 rounded-full transition-colors',
                        webLan ? 'bg-jade' : 'bg-fg-subtle',
                      )}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] text-fg-muted">
                      允许局域网设备访问（手机/平板真机）
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-fg-faint">
                      {!webEnabled
                        ? '本地 Web 服务关闭时不可用；先在上方选择「开启」并保存。'
                        : webBusy
                          ? '正在应用网络监听配置…'
                          : webLan
                            ? web.running
                              ? '已立即生效：服务同时监听 0.0.0.0 与 127.0.0.1，所有请求仍需 X-Quiver-Token。'
                              : '已开启局域网监听，但服务当前未运行；请查看下方错误。'
                            : '默认关闭，仅监听 127.0.0.1。打开开关会立即生效，无需再点保存。'}
                    </span>
                  </span>
                </button>

                {webLan ? (
                  <p className="mt-1.5 rounded-[5px] border border-amber/[0.16] bg-amber/[0.04] px-2 py-1.5 text-[13px] leading-relaxed text-amber/90">
                    局域网可达意味着同网段的其他设备也能发起连接。请只在可信网络开启；
                    不要在公共 Wi-Fi 或访客网络长期保持开启，关闭开关会立即恢复仅本机访问。
                  </p>
                ) : null}

                <button
                  type="button"
                  role="switch"
                  aria-checked={trayOnClose}
                  aria-busy={trayBusy}
                  disabled={trayBusy || saving}
                  onClick={() => void applyTrayOnClose(!trayOnClose)}
                  className={cn(
                    'mt-2 flex w-full items-start gap-2.5 rounded-[7px] border border-hairline bg-soft px-3 py-2.5 text-left transition-colors hover:border-hairline-strong hover:bg-soft-strong',
                    (trayBusy || saving) &&
                      'cursor-not-allowed opacity-60 hover:border-hairline hover:bg-soft',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-[18px] w-8 shrink-0 items-center rounded-full border px-0.5 transition-colors',
                      trayOnClose
                        ? 'justify-end border-jade/40 bg-jade/25'
                        : 'justify-start border-hairline bg-hover',
                    )}
                  >
                    <span
                      className={cn(
                        'h-3.5 w-3.5 rounded-full transition-colors',
                        trayOnClose ? 'bg-jade' : 'bg-fg-subtle',
                      )}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[14px] text-fg-muted">
                      <Minimize2 className="h-3 w-3 shrink-0 text-fg-subtle" strokeWidth={1.8} />
                      关闭主窗口时最小化到系统托盘（保持 Web 服务在线）
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-fg-faint">
                      {trayBusy
                        ? '正在应用托盘设置…'
                        : trayOnClose
                          ? web.enabled && web.running
                            ? '已开启：点击 × 只隐藏窗口，Web 服务继续在线；单击托盘图标恢复，右键可彻底退出。'
                            : '已开启：点击 × 只隐藏窗口；当前本地 Web 服务未运行，托盘仍可恢复窗口或彻底退出。'
                          : '默认关闭：点击 × 会直接彻底退出 Quiver，本地 Web 服务也会停止。'}
                    </span>
                  </span>
                </button>

                <div className="mt-2 flex items-center gap-1">
                  <span className="shrink-0 text-[13px] text-fg-faint">本机地址</span>
                  <span
                    title={web.url}
                    className="min-w-0 flex-1 truncate rounded-[5px] border border-hairline bg-soft px-2 py-[5px] font-mono text-[13px] text-fg-subtle"
                  >
                    {web.url}
                  </span>
                  <IconButton
                    label="复制 Web 访问地址"
                    onClick={() => void copyPath(web.url, 'Web 访问地址')}
                  >
                    <Copy className="h-2.5 w-2.5" />
                  </IconButton>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => void openExternal(web.url, '本地 Web 服务')}
                  >
                    在浏览器打开
                  </Button>
                </div>

                {web.lan ? (
                  <div className="mt-2 rounded-[7px] border border-hairline bg-soft px-2.5 py-2">
                    <div className="flex items-center gap-1.5 text-[13px] text-fg-subtle">
                      <Wifi className="h-3 w-3 text-fg-subtle" strokeWidth={1.8} />
                      局域网访问地址
                      <span className="ml-auto font-mono text-fg-faint">
                        {physicalLan.length > 0
                          ? `物理 ${physicalLan.length}`
                          : `共 ${lanAddresses.length}`}
                        {virtualLan.length > 0 ? ` · 虚拟 ${virtualLan.length}` : ''}
                      </span>
                    </div>
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={!web.token || lanAddresses.length === 0}
                      onClick={() =>
                        void copyPath(
                          directLink(lanAddresses[0]?.url ?? web.lanUrls[0] ?? web.url),
                          '带 Token 的免输直连链接',
                        )
                      }
                      className="mt-1.5 gap-1 max-sm:h-10"
                      title="链接包含访问 Token，打开后自动解锁并立即从地址栏清除 Token"
                    >
                      <Copy className="h-2.5 w-2.5" />
                      复制带 Token 的免输直连链接
                    </Button>
                    {lanAddresses.length > 0 ? (
                      <div className="mt-1.5 space-y-1.5">
                        {lanEntries.map((entry) => {
                          const url = entry.url;
                          const open = qrUrl === url;
                          const scanUrl = web.token
                            ? `${url.replace(/\/$/, '')}/#token=${encodeURIComponent(web.token)}`
                            : '';
                          return (
                            <div key={entry.address}>
                              <div className="flex items-center gap-1">
                                <span
                                  title={`${entry.name}${entry.virtual ? ' · 虚拟网卡' : ''}`}
                                  className="max-w-[104px] shrink-0 truncate rounded-[4px] border border-hairline bg-soft px-1.5 py-0.5 text-[12.5px] text-fg-faint max-sm:hidden"
                                >
                                  {entry.name}
                                </span>
                                <span className="min-w-0 flex-1 truncate rounded-[5px] border border-hairline bg-void/40 px-2 py-1 font-mono text-[13px] text-fg-muted">
                                  {url}
                                </span>
                                <IconButton
                                  label={`复制 ${url}`}
                                  onClick={() =>
                                    void copyPath(url, '局域网访问地址')
                                  }
                                >
                                  <Copy className="h-2.5 w-2.5" />
                                </IconButton>
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  aria-label={
                                    open
                                      ? `收起 ${url} 的二维码`
                                      : `显示 ${url} 的二维码`
                                  }
                                  aria-expanded={open}
                                  disabled={!scanUrl}
                                  onClick={() => setQrUrl(open ? null : url)}
                                  className={cn(
                                    'shrink-0 gap-1 max-sm:h-10',
                                    open && 'text-fg',
                                  )}
                                >
                                  <QrCode className="h-2.5 w-2.5" />
                                  二维码
                                </Button>
                              </div>
                              {open && scanUrl ? (
                                <div
                                  ref={qrPanelRef}
                                  className="mt-1.5 flex gap-3 rounded-[7px] border border-hairline bg-void/30 p-2.5 max-sm:flex-col"
                                >
                                  <div
                                    role="img"
                                    aria-label="带 Token 的局域网访问二维码"
                                    className="h-[160px] w-[160px] shrink-0 self-center overflow-hidden rounded-[5px] bg-white p-1 [&_svg]:h-full [&_svg]:w-full"
                                    dangerouslySetInnerHTML={{
                                      __html: createQrSvg(scanUrl),
                                    }}
                                  />
                                  <div className="flex min-w-0 flex-1 flex-col text-[13px] leading-relaxed text-fg-subtle">
                                    <p className="text-fg-muted">
                                      用手机或平板扫码，页面会自动带入 Token 并解锁。
                                    </p>
                                    <p className="mt-1 text-amber/90">
                                      二维码包含访问 Token，等同于访问凭据；请只分享给可信设备，重新生成
                                      Token 后旧二维码立即失效。
                                    </p>
                                    <p className="mt-1 text-fg-faint">
                                      仅同一局域网可用；设备无法打开时请确认防火墙已放行{' '}
                                      {web.port} 端口。
                                    </p>
                                    {import.meta.env.DEV ? (
                                      <p className="mt-1 text-fg-faint">
                                        开发模式下真机页面来自最近一次 npm run build
                                        的产物，修改前端后请重新构建。
                                      </p>
                                    ) : null}
                                    <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                                      <Button
                                        size="xs"
                                        variant="secondary"
                                        disabled={qrSaving}
                                        onClick={() => void downloadQr(scanUrl, url)}
                                        className="gap-1 max-sm:h-10"
                                      >
                                        <Download className="h-2.5 w-2.5" />
                                        {qrSaving ? '保存中…' : '下载 PNG'}
                                      </Button>
                                      <Button
                                        size="xs"
                                        variant="ghost"
                                        onClick={() => setQrPreview({ url, scanUrl })}
                                        className="gap-1 max-sm:h-10"
                                      >
                                        <Maximize2 className="h-2.5 w-2.5" />
                                        放大预览
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-1 text-[13px] leading-relaxed text-fg-faint">
                        未检测到可用的局域网 IPv4 地址；服务仍同时监听 127.0.0.1。
                      </p>
                    )}
                    {physicalLan.length > 0 && virtualLan.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setShowVirtualLan((value) => !value)}
                        aria-expanded={showVirtualLan}
                        className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-[5px] border border-dashed border-hairline px-2 py-1 text-[13px] text-fg-subtle transition-colors hover:bg-soft hover:text-fg-muted max-sm:min-h-10"
                      >
                        <ChevronDown
                          className={cn(
                            'h-3 w-3 transition-transform',
                            showVirtualLan && 'rotate-180',
                          )}
                          strokeWidth={1.8}
                        />
                        {showVirtualLan
                          ? `收起 ${virtualLan.length} 个虚拟网卡地址`
                          : `展开其余 ${virtualLan.length} 个虚拟网卡地址`}
                      </button>
                    ) : null}
                    <p className="mt-1 text-[13px] leading-relaxed text-fg-faint">
                      设备需与电脑处于同一局域网；扫码会自动带入 Token，手动打开地址则需输入上方 Token。
                    </p>
                  </div>
                ) : null}

                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className="shrink-0 text-[13px] text-fg-faint">Token</span>
                  <span className="min-w-0 flex-1 truncate rounded-[5px] border border-hairline bg-soft px-2 py-[5px] font-mono text-[13px] text-fg-subtle max-sm:basis-full">
                    {tokenVisible ? web.token || '尚未生成' : tokenMask}
                  </span>
                  <IconButton
                    label={tokenVisible ? '隐藏 Token' : '显示 Token'}
                    onClick={() => setTokenVisible((value) => !value)}
                    disabled={!web.token}
                  >
                    {tokenVisible ? (
                      <EyeOff className="h-2.5 w-2.5" />
                    ) : (
                      <Eye className="h-2.5 w-2.5" />
                    )}
                  </IconButton>
                  <IconButton
                    label="复制 Token"
                    onClick={() => void copyPath(web.token, '访问 Token')}
                    disabled={!web.token}
                  >
                    <Copy className="h-2.5 w-2.5" />
                  </IconButton>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setPendingRegenerate(true)}
                    disabled={webBusy}
                  >
                    重新生成 Token
                  </Button>
                </div>

                {web.error ? (
                  <div
                    role="alert"
                    className="mt-1.5 flex flex-wrap items-center gap-2 rounded-[5px] border border-rose/[0.16] bg-rose/[0.04] px-2 py-1.5 text-[13px] leading-relaxed text-rose/90"
                  >
                    <span className="min-w-0 flex-1">{web.error}</span>
                    {web.enabled ? (
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => void autoAllocatePort()}
                        disabled={autoPortBusy || webBusy}
                        className="shrink-0 gap-1"
                      >
                        <RefreshCw
                          className={cn(
                            'h-2.5 w-2.5',
                            autoPortBusy && 'animate-spin-slow',
                          )}
                          strokeWidth={1.9}
                        />
                        {autoPortBusy ? '正在探测…' : '自动分配空闲端口并启动'}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                <p className="mt-1.5 text-[13px] leading-relaxed text-fg-faint">
                  {web.lan
                    ? '当前监听 0.0.0.0，局域网内设备可通过上方地址访问。'
                    : '默认仅监听 127.0.0.1，不会暴露到局域网。'}
                  浏览器打开地址后需输入此 Token 解锁，所有 API 请求都会校验请求头
                  X-Quiver-Token。
                </p>
              </>
            ) : (
              <>
                <div className="mt-2 flex items-center gap-1">
                  <span
                    title={web.url}
                    className="min-w-0 flex-1 truncate rounded-[5px] border border-hairline bg-soft px-2 py-[5px] font-mono text-[13px] text-fg-subtle"
                  >
                    {web.url}
                  </span>
                  <IconButton
                    label="复制 Web 访问地址"
                    onClick={() => void copyPath(web.url, 'Web 访问地址')}
                  >
                    <Copy className="h-2.5 w-2.5" />
                  </IconButton>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-fg-faint">
                  当前通过浏览器访问。Web 服务配置与 Token 只能在桌面端修改，Token
                  不会在此页面回显。
                </p>
              </>
            )}
          </section>

          <section className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[14px] font-medium text-fg-muted">
                <HardDrive className="h-3 w-3 text-fg-subtle" strokeWidth={1.8} />
                Harness 路径字典
              </div>
              <Button
                size="xs"
                variant="secondary"
                onClick={addCustomDraft}
                className="gap-1 max-sm:min-h-10"
              >
                <Plus className="h-2.5 w-2.5" />
                新增自定义工具
              </Button>
            </div>

            <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-faint" />
                <input
                  value={chainQuery}
                  onChange={(event) => setChainQuery(event.target.value)}
                  aria-label="搜索工具名称、ID 或扫描路径"
                  placeholder="搜索工具名称、ID 或扫描路径…"
                  className={`${smallInput} w-full pl-7`}
                />
              </div>
              <div className="scrollbar-none flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-[6px] border border-hairline bg-soft p-0.5 max-sm:flex-wrap max-sm:overflow-visible">
                {CHAIN_FILTERS.map((option) => {
                  const active = chainFilter === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setChainFilter(option.value)}
                      aria-pressed={active}
                      className={cn(
                        'h-6 shrink-0 rounded-[4px] px-2 text-[13px] transition-colors max-sm:h-10',
                        active
                          ? 'bg-soft-strong text-fg'
                          : 'text-fg-subtle hover:text-fg-muted',
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-2 space-y-1.5">
              {visibleDrafts.length === 0 ? (
                <div className="rounded-[7px] border border-dashed border-hairline px-3 py-5 text-center text-[13px] text-fg-faint">
                  没有匹配的工具
                </div>
              ) : null}
              {visibleDrafts.map((draft) => {
                const inUse = !draft.isNew && busyHarnessIds.has(draft.id);
                const globalPrimary =
                  draft.candidates.find(
                    (candidate) =>
                      candidate.scope === 'global' && candidate.role === 'primary',
                  ) ??
                  draft.candidates.find((candidate) => candidate.scope === 'global');
                const projectPrimary =
                  draft.candidates.find(
                    (candidate) =>
                      candidate.scope === 'project' && candidate.role === 'primary',
                  ) ??
                  draft.candidates.find((candidate) => candidate.scope === 'project');
                return (
                  <div
                    key={draft.key}
                    data-harness-row={draft.key}
                    className="rounded-[8px] border border-hairline bg-soft px-2.5 py-2 shadow-inset-top"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <HarnessMark
                        harnessId={draft.id}
                        size="xs"
                        className="h-4 w-4 rounded-[4px]"
                      />
                      <span className="min-w-0 max-w-[150px] truncate text-[14px] font-medium text-fg">
                        {draft.name || '未命名工具'}
                      </span>
                      <span className="mono-pill max-w-[150px] truncate text-fg-subtle">
                        {draft.id || '待填写 ID'}
                      </span>
                      <span className="rounded-[4px] border border-hairline px-1.5 py-0.5 text-[12.5px] text-fg-subtle">
                        {CATEGORY_LABELS[draft.category]}
                      </span>
                      <span className="font-mono text-[13px] text-fg-faint">
                        {draft.candidates.length} 个候选
                      </span>
                      {draft.isNew ? (
                        <span className="rounded-[4px] border border-sky/20 bg-sky/[0.06] px-1.5 py-0.5 text-[12.5px] text-sky">
                          未保存
                        </span>
                      ) : null}
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          patchDraft(draft.key, { expanded: !draft.expanded })
                        }
                        className="ml-auto shrink-0 gap-1 max-sm:min-h-10"
                        aria-expanded={draft.expanded}
                      >
                        编辑路径链
                        <ChevronDown
                          className={cn(
                            'h-2.5 w-2.5 transition-transform duration-200',
                            draft.expanded && 'rotate-180',
                          )}
                        />
                      </Button>
                    </div>

                    <div className="mt-1 grid gap-1 sm:grid-cols-2">
                      <span
                        title={globalPrimary?.path}
                        className="min-w-0 truncate rounded-[4px] border border-hairline/70 px-1.5 py-1 font-mono text-[13px] text-fg-subtle"
                      >
                        全局首选 · {globalPrimary?.path || '未配置'}
                      </span>
                      <span
                        title={projectPrimary?.path}
                        className="min-w-0 truncate rounded-[4px] border border-hairline/70 px-1.5 py-1 font-mono text-[13px] text-fg-subtle"
                      >
                        项目首选 · {projectPrimary?.path || '未配置'}
                      </span>
                    </div>

                    {draft.expanded ? (
                      <div className="mt-2 border-t border-hairline pt-2">
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          <label className="min-w-0">
                            <span className="text-[13px] text-fg-faint">显示名称</span>
                            <input
                              value={draft.name}
                              onChange={(event) =>
                                patchHarnessName(draft.key, event.target.value)
                              }
                              placeholder="例如 Cursor"
                              aria-label="工具名称"
                              className={`${smallInput} mt-0.5 w-full`}
                            />
                          </label>
                          <label className="min-w-0">
                            <span className="text-[13px] text-fg-faint">
                              唯一标识 ID
                            </span>
                            <input
                              value={draft.id}
                              onChange={(event) =>
                                patchHarnessId(draft.key, event.target.value)
                              }
                              placeholder="英文小写与连字符"
                              aria-label="工具标识"
                              disabled={!draft.isNew}
                              spellCheck={false}
                              title={
                                draft.isNew
                                  ? '保存后不可再修改'
                                  : '内置与已保存工具的 ID 不可修改'
                              }
                              className={`${smallInput} mt-0.5 w-full min-w-[180px] font-mono disabled:opacity-60`}
                            />
                          </label>
                          <label className="min-w-0">
                            <span className="text-[13px] text-fg-faint">分类</span>
                            <select
                              value={draft.category}
                              onChange={(event) =>
                                patchDraft(draft.key, {
                                  category: event.target.value as HarnessCategory,
                                })
                              }
                              disabled={draft.isBuiltin}
                              aria-label="工具分类"
                              className={`${smallSelect} mt-0.5 w-full disabled:opacity-60`}
                            >
                              <option value="domestic">国内主流</option>
                              <option value="global">国际主力</option>
                              <option value="custom">自定义</option>
                              <option value="shared">共享</option>
                            </select>
                          </label>
                          <label className="min-w-0">
                            <span className="text-[13px] text-fg-faint">
                              命令 / 图标键
                            </span>
                            <input
                              value={draft.command}
                              onChange={(event) =>
                                patchDraft(draft.key, { command: event.target.value })
                              }
                              placeholder="命令或图标键，可留空"
                              aria-label="工具命令"
                              spellCheck={false}
                              className={`${smallInput} mt-0.5 w-full font-mono`}
                            />
                          </label>
                        </div>

                        {draft.isNew || !draft.isBuiltin ? (
                          <label className="mt-2 flex items-start gap-1.5 text-[13px] leading-relaxed text-fg-subtle">
                            <input
                              type="checkbox"
                              checked={draft.autoShared}
                              onChange={(event) =>
                                toggleAutoShared(draft.key, event.target.checked)
                              }
                              className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-jade)]"
                            />
                            <span>
                              自动接入跨工具共享目录
                              <span className="px-1 font-mono text-fg-muted">
                                ~/.agents/skills
                              </span>
                              与
                              <span className="px-1 font-mono text-fg-muted">
                                .agents/skills
                              </span>
                            </span>
                          </label>
                        ) : null}

                        <div className="mt-2 space-y-1.5">
                          {draft.candidates.map((candidate) => {
                            const locked = candidateInUse(draft, candidate);
                            const scopePeers = draft.candidates.filter(
                              (item) => item.scope === candidate.scope,
                            );
                            const peerIndex = scopePeers.findIndex(
                              (item) => item.key === candidate.key,
                            );
                            return (
                              <div
                                key={candidate.key}
                                className="rounded-[6px] border border-hairline bg-void/20 px-1.5 py-1.5"
                              >
                                <div className="flex flex-wrap items-center gap-1">
                                  <span className="w-5 shrink-0 font-mono text-[12.5px] text-fg-faint">
                                    #{candidate.priority + 1}
                                  </span>
                                  <select
                                    value={candidate.scope}
                                    onChange={(event) =>
                                      patchCandidate(draft.key, candidate.key, {
                                        scope: event.target.value as Scope,
                                      })
                                    }
                                    aria-label="候选作用域"
                                    className={`${smallSelect} w-[68px] shrink-0`}
                                  >
                                    <option value="global">全局</option>
                                    <option value="project">项目</option>
                                  </select>
                                  <select
                                    value={candidate.role}
                                    onChange={(event) =>
                                      patchCandidate(draft.key, candidate.key, {
                                        role: event.target.value as CandidateRole,
                                      })
                                    }
                                    aria-label="候选角色"
                                    className={`${smallSelect} w-[104px] shrink-0`}
                                  >
                                    {ROLE_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    value={candidate.discovery}
                                    onChange={(event) =>
                                      patchCandidate(draft.key, candidate.key, {
                                        discovery: event.target
                                          .value as CandidateDiscovery,
                                      })
                                    }
                                    aria-label="候选发现方式"
                                    className={`${smallSelect} w-[108px] shrink-0`}
                                  >
                                    {DISCOVERY_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                  <span className="ml-auto flex shrink-0 items-center gap-0.5">
                                    <IconButton
                                      label="上移优先级"
                                      disabled={peerIndex <= 0}
                                      onClick={() =>
                                        moveCandidate(draft.key, candidate.key, -1)
                                      }
                                      className="h-5 w-5 max-sm:h-10 max-sm:w-10"
                                    >
                                      <ArrowUp className="h-2.5 w-2.5" />
                                    </IconButton>
                                    <IconButton
                                      label="下移优先级"
                                      disabled={peerIndex >= scopePeers.length - 1}
                                      onClick={() =>
                                        moveCandidate(draft.key, candidate.key, 1)
                                      }
                                      className="h-5 w-5 max-sm:h-10 max-sm:w-10"
                                    >
                                      <ArrowDown className="h-2.5 w-2.5" />
                                    </IconButton>
                                    <IconButton
                                      label="设为首选路径"
                                      disabled={candidate.role === 'primary'}
                                      onClick={() =>
                                        setPrimaryCandidate(draft.key, candidate.key)
                                      }
                                      className={cn(
                                        'h-5 w-5 max-sm:h-10 max-sm:w-10',
                                        candidate.role === 'primary' && 'text-jade',
                                      )}
                                    >
                                      <Star className="h-2.5 w-2.5" />
                                    </IconButton>
                                    <IconButton
                                      label={
                                        locked
                                          ? '仍有绑定，不能删除候选路径'
                                          : '删除候选路径'
                                      }
                                      disabled={locked}
                                      onClick={() =>
                                        removeCandidate(draft.key, candidate.key)
                                      }
                                      className="h-5 w-5 max-sm:h-10 max-sm:w-10"
                                    >
                                      <Trash2 className="h-2.5 w-2.5" />
                                    </IconButton>
                                  </span>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                  <input
                                    value={candidate.path}
                                    onChange={(event) =>
                                      patchCandidate(draft.key, candidate.key, {
                                        path: event.target.value,
                                      })
                                    }
                                    spellCheck={false}
                                    placeholder={
                                      candidate.scope === 'global'
                                        ? '~/.tool/skills'
                                        : '.tool/skills'
                                    }
                                    aria-label="候选扫描路径"
                                    className={`${smallInput} min-w-0 flex-1 font-mono max-sm:basis-full`}
                                  />
                                  {candidate.scope === 'global' ? (
                                    <IconButton
                                      label="浏览选择目录"
                                      onClick={() =>
                                        void browseCandidate(draft.key, candidate.key)
                                      }
                                      className="h-6 w-6 shrink-0 max-sm:h-10 max-sm:w-10"
                                    >
                                      <FolderOpen className="h-2.5 w-2.5" />
                                    </IconButton>
                                  ) : null}
                                  <input
                                    value={candidate.label ?? ''}
                                    onChange={(event) =>
                                      patchCandidate(draft.key, candidate.key, {
                                        label: event.target.value,
                                      })
                                    }
                                    placeholder="标签"
                                    aria-label="候选标签"
                                    className={`${smallInput} w-[88px] shrink-0 max-sm:w-auto max-sm:flex-1`}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => addCandidate(draft.key, 'global')}
                            className="gap-1 max-sm:min-h-10"
                          >
                            <Plus className="h-2.5 w-2.5" />
                            添加全局路径
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => addCandidate(draft.key, 'project')}
                            className="gap-1 max-sm:min-h-10"
                          >
                            <Plus className="h-2.5 w-2.5" />
                            添加项目路径
                          </Button>
                          {draft.isBuiltin ? (
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => resetCandidates(draft.key)}
                              className="gap-1 max-sm:min-h-10"
                            >
                              <RefreshCw className="h-2.5 w-2.5" />
                              恢复默认路径链
                            </Button>
                          ) : null}
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => setPendingDelete(draft)}
                            disabled={inUse}
                            title={
                              inUse
                                ? '仍有生效绑定，请先在 Harness 视图停用'
                                : '删除工具后保存生效'
                            }
                            className="ml-auto gap-1 text-rose/80 hover:bg-rose/[0.07] hover:text-rose max-sm:min-h-10"
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                            删除工具
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-fg-faint">
              修改首选路径后保存时，已存在的绑定会按新路径重新挂载；仍有生效绑定的工具或候选路径不能直接删除。
            </p>
          </section>

          <section className="mt-5">
            <div className="flex items-center gap-1.5 text-[14px] font-medium text-fg-muted">
              <ShieldCheck className="h-3 w-3 text-fg-subtle" strokeWidth={1.8} />
              数据与备份
            </div>
            {desktop ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => void exportBackup()}
                  className="gap-1"
                >
                  <Download className="h-2.5 w-2.5" />
                  导出备份包
                </Button>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => void importBackup()}
                  disabled={importBusy}
                  className="gap-1"
                >
                  <Upload className="h-2.5 w-2.5" />
                  {importBusy ? '导入中…' : '导入备份包'}
                </Button>
                <span className="text-[13px] text-fg-faint">
                  备份包含技能元数据、依赖声明与全部只读版本。
                </span>
              </div>
            ) : (
              <p className="mt-2 text-[13px] leading-relaxed text-fg-faint">
                备份包的导入与导出需要选择本机文件，请在桌面端「设置 → 数据与备份」中操作。
              </p>
            )}
            <ul className="mt-2 space-y-1 rounded-[7px] border border-hairline bg-soft px-2.5 py-2 text-[13px] leading-relaxed text-fg-faint">
              <li>中央库只读：按目录树 SHA-256 冻结版本，解链不会删除源文件。</li>
              <li>文件层事实优先：状态以目标目录的实际扫描结果为准。</li>
              <li>漂移必须显式裁决：重置、收编、忽略都由你决定，不做自动合并。</li>
            </ul>
          </section>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-hairline px-4 py-2.5">
          <span className="min-w-0 truncate font-mono text-[13px] text-fg-faint">
            Quiver v0.1.0 · {data.settings.mode === 'sandbox' ? '演示沙盒' : '真实目录'}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={close}>
              取消
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void save()}
              disabled={saving || webBusy}
              className="min-w-[92px] gap-1.5"
            >
              <Save className="h-2.5 w-2.5" />
              {saving ? '保存中…' : '保存设置'}
            </Button>
          </div>
        </footer>
      </Modal>

      <Modal
        open={Boolean(qrPreview)}
        onClose={() => setQrPreview(null)}
        ariaLabel="二维码放大预览"
        className="max-w-[420px]"
      >
        <div className="flex min-h-0 flex-col">
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-hairline px-4 py-3">
            <div>
              <h2 className="text-[16px] font-semibold text-fg">二维码预览</h2>
              <p className="mt-0.5 text-[13px] text-fg-subtle">
                可截图或用「下载 PNG」保存，发给可信的手机/平板。
              </p>
            </div>
            <IconButton
              label="关闭二维码预览"
              onClick={() => setQrPreview(null)}
              className="-mr-1"
            >
              <X className="h-3.5 w-3.5" />
            </IconButton>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="flex flex-col items-center gap-3">
              {qrPreview ? (
                <div
                  role="img"
                  aria-label="带 Token 的局域网访问二维码大图"
                  className="aspect-square w-full max-w-[320px] overflow-hidden rounded-[8px] bg-white p-2 [&_svg]:h-full [&_svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: createQrSvg(qrPreview.scanUrl) }}
                />
              ) : null}
              <span className="max-w-full truncate rounded-[5px] border border-hairline bg-soft px-2 py-1 font-mono text-[13px] text-fg-subtle">
                {qrPreview?.url}
              </span>
              <p className="max-w-[320px] text-center text-[13px] leading-relaxed text-fg-faint">
                二维码包含访问 Token，请只分享给可信设备；重新生成 Token 后旧二维码立即失效。
              </p>
              <div className="flex flex-wrap justify-center gap-1.5">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={qrSaving}
                  onClick={() =>
                    qrPreview && void downloadQr(qrPreview.scanUrl, qrPreview.url)
                  }
                  className="gap-1.5 max-sm:h-10"
                >
                  <Download className="h-3 w-3" />
                  {qrSaving ? '保存中…' : '下载 PNG'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setQrPreview(null)}
                  className="max-sm:h-10"
                >
                  关闭
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingMode)}
        title="切换运行模式"
        description={
          pendingMode === 'real'
            ? '切换到真实本地目录后，Quiver 会读写 ~/.quiver 作为中央库，路径操作将直接作用于真实的 Harness 目录。'
            : `切换回演示沙盒后，所有操作只写入 ${sandboxLabel}，不会触碰真实目录。`
        }
        note={
          pendingMode === 'real'
            ? '当前工作目录中的绑定不会迁移到 ~/.quiver，真实目录将使用自己的 metadata.db 与 config.toml。'
            : '演示沙盒使用独立的数据集，切换后可随时切回真实目录。'
        }
        confirmLabel={pendingMode === 'real' ? '使用真实目录' : '使用演示沙盒'}
        busy={modeBusy}
        onCancel={() => setPendingMode(null)}
        onConfirm={() => void switchMode()}
      />

      <ConfirmDialog
        open={pendingRegenerate}
        title="重新生成访问 Token"
        description="重新生成后，所有已解锁的浏览器页面会立即失效，需要用新 Token 重新解锁。"
        note="桌面端操作不受影响；新的 Token 会显示在「本地 Web 服务」区域。"
        confirmLabel={webBusy ? '生成中…' : '重新生成 Token'}
        busy={webBusy}
        onCancel={() => setPendingRegenerate(false)}
        onConfirm={() => void regenerateToken()}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除工具"
        description={
          <>
            确定删除
            <span className="px-1 font-mono text-fg-muted">
              {pendingDelete?.name || pendingDelete?.id}
            </span>
            吗？它的全部候选路径会从配置中移除，已有绑定必须先停用。
          </>
        }
        note={
          pendingDelete?.isBuiltin
            ? '这是内置工具；删除后可通过「新增自定义工具」重建，或再次保存配置恢复内置默认项。'
            : '删除后该工具不再出现在 Harness 视图，中央库内容不受影响。'
        }
        confirmLabel="删除工具"
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDeleteDraft}
      />
    </>
  );
}
