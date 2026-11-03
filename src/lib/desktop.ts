import { toast } from 'sonner';
import type {
  AppData,
  AuditExportFormat,
  AuditLogQuery,
  AuditSourceFilter,
  EnableSelection,
  EngineResult,
  EngineMode,
  WebConfigPatch,
} from './types';
import { hasWebToken, isWebMode, webEngine } from './web';
import { copyTextToClipboard } from './utils';

export interface DialogResponse {
  ok: boolean;
  error?: string;
  path?: string | null;
}

export interface ShellResponse {
  ok: boolean;
  error?: string;
  path?: string;
  command?: string;
}

export interface EngineBridge {
  snapshot: () => Promise<EngineResult>;
  refresh: () => Promise<EngineResult>;
  enable: (payload: EnableSelection & { skillId: string }) => Promise<EngineResult>;
  disable: (id: string, mode?: 'single' | 'split' | 'all') => Promise<EngineResult>;
  checkDisableImpact: (id: string) => Promise<EngineResult>;
  convertToCopy: (id: string) => Promise<EngineResult>;
  updateBinding: (id: string) => Promise<EngineResult>;
  resetBinding: (id: string) => Promise<EngineResult>;
  redeployBinding: (id: string) => Promise<EngineResult>;
  adoptBinding: (id: string) => Promise<EngineResult>;
  ignoreDrift: (id: string) => Promise<EngineResult>;
  switchVersion: (payload: { skillId: string; sha: string }) => Promise<EngineResult>;
  adoptUnmanaged: (payload: { id: string; mode: 'register' | 'adopt' }) => Promise<EngineResult>;
  adoptUnmanagedBatch: (payload: {
    ids: string[];
    mode: 'register' | 'adopt';
  }) => Promise<EngineResult>;
  ignoreUnmanaged: (id: string) => Promise<EngineResult>;
  resyncSkillComment: (skillId: string) => Promise<EngineResult>;
  skillPreview: (payload: { skillId: string; sha?: string | null }) => Promise<EngineResult>;
  scanHarness: (id: string) => Promise<EngineResult>;
  addProject: (path: string) => Promise<EngineResult>;
  relocateProject: (payload: { projectId: string; path: string }) => Promise<EngineResult>;
  cleanProject: (id: string) => Promise<EngineResult>;
  convertToProjectOnly: (payload: { skillId: string; projectId: string }) => Promise<EngineResult>;
  editSkill: (payload: {
    skillId: string;
    patch: {
      displayName?: string;
      alias?: string;
      comment?: string;
      tags?: string[];
      dependsOn?: string[];
    };
  }) => Promise<EngineResult>;
  deleteSkill: (id: string) => Promise<EngineResult>;
  importLocal: (path: string) => Promise<EngineResult>;
  importGit: (url: string) => Promise<EngineResult>;
  importBackup: (path: string) => Promise<EngineResult>;
  exportBackup: (path: string) => Promise<EngineResult>;
  exportProject: (id: string) => Promise<EngineResult>;
  restoreProject: (id: string) => Promise<EngineResult>;
  saveConfig: (payload: {
    editorCommand?: string;
    harnesses?: Array<{
      id: string;
      name: string;
      shortName?: string;
      command?: string;
      category?: string;
      candidates?: Array<{
        id?: string;
        path: string;
        scope: 'global' | 'project';
        role?: string;
        discovery?: string;
        priority?: number;
        label?: string;
      }>;
      globalPath?: string;
      projectRelPath?: string;
    }>;
    removedHarnesses?: string[];
  }) => Promise<EngineResult>;
  addHarnessCandidate: (payload: {
    harnessId: string;
    path: string;
    scope: 'global' | 'project';
    role?: string;
    discovery?: string;
    label?: string;
  }) => Promise<EngineResult>;
  resetHarnessDefaults: (harnessId: string) => Promise<EngineResult>;
  createCandidateDir: (payload: {
    harnessId: string;
    candidateId: string;
    scope?: 'global' | 'project';
    projectId?: string;
  }) => Promise<EngineResult>;
  toggleFavorite: (skillId: string) => Promise<EngineResult>;
  configureWeb: (payload: WebConfigPatch) => Promise<EngineResult>;
  autoAllocateWebPort?: () => Promise<EngineResult>;
  setMode: (mode: EngineMode) => Promise<EngineResult>;
  getWorkRoot: () => Promise<{ ok: boolean; path?: string; error?: string }>;
  listAuditLogs: (payload?: AuditLogQuery) => Promise<EngineResult>;
  exportAuditLogs: (payload: {
    format: AuditExportFormat;
    path: string;
    source?: AuditSourceFilter;
    query?: string;
  }) => Promise<EngineResult>;
  onChange: (callback: (snapshot: AppData) => void) => () => void;
}

export interface QuiverBridge {
  isElectron: boolean;
  platform: string;
  engine: EngineBridge;
  dialog: {
    pickFolder: (options?: {
      title?: string;
      defaultPath?: string;
    }) => Promise<DialogResponse>;
    pickFile: (options?: {
      title?: string;
      defaultPath?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    }) => Promise<DialogResponse>;
    saveFile: (options?: {
      title?: string;
      defaultPath?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    }) => Promise<DialogResponse>;
  };
  shell: {
    reveal: (input: string) => Promise<ShellResponse>;
    openEditor: (input: string) => Promise<ShellResponse>;
    openTerminal: (input: string) => Promise<ShellResponse>;
    copyText: (text: string) => Promise<ShellResponse>;
    openWorkRoot: () => Promise<ShellResponse>;
    openExternal: (url: string) => Promise<ShellResponse>;
    saveQr: (dataUrl: string, defaultName?: string) => Promise<ShellResponse>;
  };
  window: {
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
    setTrayOnClose: (enabled: boolean) => Promise<EngineResult>;
    setZoomFactor?: (scale: number) => void;
    onMaximized: (callback: (maximized: boolean) => void) => () => void;
  };
}

declare global {
  interface Window {
    quiver?: QuiverBridge;
  }
}

export const isDesktop = () =>
  typeof window !== 'undefined' && Boolean(window.quiver?.isElectron);

export const engine = (): EngineBridge | null => {
  if (typeof window === 'undefined') return null;
  if (window.quiver?.isElectron) return window.quiver.engine;
  return hasWebToken() ? webEngine : null;
};

export const platform = (): string => {
  if (typeof window !== 'undefined' && window.quiver?.platform) {
    return window.quiver.platform;
  }
  if (typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)) {
    return 'darwin';
  }
  return 'win32';
};

export const isMac = () => platform() === 'darwin';

function noBridge() {
  toast.info('桌面端专属操作', {
    description: '请通过 npm run dev 启动 Electron 窗口后使用。',
  });
}

function failure(error: string): EngineResult {
  return { ok: false, error };
}

export async function getSnapshot(): Promise<EngineResult> {
  const api = engine();
  if (!api) return failure('请通过 npm run dev 启动 Electron 窗口');
  return api.snapshot();
}

export async function pickFolder(options?: {
  title?: string;
  defaultPath?: string;
}): Promise<string | null> {
  if (!window.quiver) {
    noBridge();
    return null;
  }
  const result = await window.quiver.dialog.pickFolder(options);
  if (!result.ok) {
    toast.error('无法打开目录选择器', { description: result.error });
    return null;
  }
  return result.path ?? null;
}

export async function pickFile(options?: {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | null> {
  if (!window.quiver) {
    noBridge();
    return null;
  }
  const result = await window.quiver.dialog.pickFile(options);
  if (!result.ok) {
    toast.error('无法打开文件选择器', { description: result.error });
    return null;
  }
  return result.path ?? null;
}

export async function saveFile(options?: {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | null> {
  if (!window.quiver) {
    noBridge();
    return null;
  }
  const result = await window.quiver.dialog.saveFile(options);
  if (!result.ok) {
    toast.error('无法打开保存对话框', { description: result.error });
    return null;
  }
  return result.path ?? null;
}

export async function revealPath(input: string, label?: string) {
  const bridge = window.quiver;
  if (!bridge) return noBridge();
  const res = await bridge.shell.reveal(input);
  if (!res.ok) {
    toast.error('无法打开目录', { description: res.error ?? input });
    return;
  }
  toast.success('已在文件夹中显示', {
    description: label ?? res.path ?? input,
    duration: 2200,
  });
}

export async function openInEditor(input: string, label?: string) {
  const bridge = window.quiver;
  if (!bridge) return noBridge();
  const res = await bridge.shell.openEditor(input);
  if (!res.ok) {
    toast.error('无法在编辑器中打开', {
      description: res.error ?? '请确认编辑器命令已加入 PATH。',
    });
    return;
  }
  toast.success('正在编辑器中打开', {
    description: label ?? res.path ?? input,
    duration: 2200,
  });
}

export async function openTerminalAt(input: string, label?: string) {
  const bridge = window.quiver;
  if (!bridge) return noBridge();
  const res = await bridge.shell.openTerminal(input);
  if (!res.ok) {
    toast.error('无法打开终端', {
      description: res.error ?? '请确认系统终端可用。',
    });
    return;
  }
  toast.success('终端已打开', {
    description: label ?? res.path ?? input,
    duration: 2200,
  });
}

export async function copyPath(text: string, label?: string) {
  const bridge = window.quiver;
  if (!bridge) {
    if (!isWebMode()) return noBridge();
    const copied = await copyTextToClipboard(text);
    if (!copied) {
      toast.error('复制失败', {
        description: '当前环境未授权剪贴板访问，请手动选择并复制。',
      });
      return;
    }
  } else {
    const res = await bridge.shell.copyText(text);
    if (!res.ok) {
      toast.error('复制失败', { description: res.error });
      return;
    }
  }
  toast.success('已复制', {
    description: label ?? text,
    duration: 1800,
  });
}

export async function openExternal(url: string, label?: string) {
  const bridge = window.quiver;
  if (bridge) {
    const res = await bridge.shell.openExternal(url);
    if (!res.ok) {
      toast.error('无法打开外部链接', { description: res.error ?? url });
    }
    return;
  }
  if (!isWebMode()) return noBridge();
  if (url.startsWith('http://') || url.startsWith('https://')) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  toast.info(label ?? '该操作需要在桌面端完成', {
    description: '请通过 npm run dev 启动 Electron 窗口后使用。',
  });
}

export async function openWorkRoot() {
  const bridge = window.quiver;
  if (!bridge) return noBridge();
  const res = await bridge.shell.openWorkRoot();
  if (!res.ok) {
    toast.error('无法打开工作目录', { description: res.error });
  }
}

export async function setTrayOnClosePreference(enabled: boolean): Promise<EngineResult> {
  if (!window.quiver) return failure('托盘驻留仅支持桌面端');
  return window.quiver.window.setTrayOnClose(enabled);
}

export async function saveQrImage(dataUrl: string, defaultName?: string): Promise<boolean> {
  const bridge = window.quiver;
  if (!bridge) {
    noBridge();
    return false;
  }
  const res = await bridge.shell.saveQr(dataUrl, defaultName);
  if (!res.ok) {
    toast.error('保存二维码失败', {
      description: res.error ?? '请换一个目录后重试。',
    });
    return false;
  }
  if (res.path) {
    toast.success('二维码已保存', {
      description: res.path,
      duration: 2600,
    });
    return true;
  }
  return false;
}
