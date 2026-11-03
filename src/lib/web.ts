import type {
  AppData,
  AuditExportFormat,
  AuditLogQuery,
  AuditSourceFilter,
  EnableSelection,
  EngineMode,
  EngineResult,
  WebConfigPatch,
} from './types';

const TOKEN_KEY = 'quiver.web.token';
const UNAUTHORIZED_EVENT = 'quiver:web-unauthorized';

export const isWebMode = () =>
  typeof window !== 'undefined' && !window.quiver?.isElectron;

export function getWebToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setWebToken(token: string) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token.trim());
  } catch {
    /* sessionStorage unavailable */
  }
}

export function clearWebToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sessionStorage unavailable */
  }
}

export function hasWebToken(): boolean {
  return getWebToken().length > 0;
}

export function consumeWebTokenFromUrl(): string {
  if (typeof window === 'undefined') return '';
  const { location } = window;
  const query = new URLSearchParams(location.search);
  const hashRaw = location.hash.replace(/^#/, '');
  const hash = new URLSearchParams(hashRaw);
  const token = (query.get('token') ?? hash.get('token') ?? '').trim();
  if (!token) return '';
  query.delete('token');
  hash.delete('token');
  const nextQuery = query.toString();
  const nextHash = hash.toString();
  try {
    window.history.replaceState(
      null,
      '',
      `${location.pathname}${nextQuery ? `?${nextQuery}` : ''}${nextHash ? `#${nextHash}` : ''}`,
    );
  } catch {
    /* history unavailable */
  }
  return /^[0-9a-f]{32,128}$/i.test(token) ? token : '';
}

export const WEB_UNAUTHORIZED_EVENT = UNAUTHORIZED_EVENT;

async function rpc(action: string, payload?: unknown): Promise<EngineResult> {
  const token = getWebToken();
  if (!token) {
    return {
      ok: false,
      error: '请输入桌面端设置中显示的访问 Token',
      code: 'NO_TOKEN',
    };
  }
  try {
    const response = await fetch('/api/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Quiver-Token': token,
      },
      body: JSON.stringify({ action, payload }),
      cache: 'no-store',
    });
    if (response.status === 401) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      return {
        ok: false,
        error: 'Token 无效或已被重新生成，请重新解锁',
        code: 'UNAUTHORIZED',
      };
    }
    const data = (await response.json().catch(() => null)) as EngineResult | null;
    if (!data) {
      return {
        ok: false,
        error: `本地服务返回了无法解析的响应（HTTP ${response.status}）`,
        code: 'BAD_RESPONSE',
      };
    }
    return data;
  } catch {
    return {
      ok: false,
      error: '无法连接本地 Web 服务，请确认 Quiver 桌面端正在运行',
      code: 'WEB_UNREACHABLE',
    };
  }
}

function subscribeSnapshots(callback: (snapshot: AppData) => void): () => void {
  const controller = new AbortController();
  let closed = false;

  const consume = async () => {
    while (!closed) {
      const token = getWebToken();
      if (!token) {
        window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
        return;
      }
      try {
        const response = await fetch('/api/events', {
          headers: { 'X-Quiver-Token': token, Accept: 'text/event-stream' },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (response.status === 401) {
          window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
          return;
        }
        if (!response.ok || !response.body) {
          throw new Error(`SSE ${response.status}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const chunk = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = chunk
              .split(/\r?\n/)
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim())
              .join('');
            if (data) {
              try {
                const parsed = JSON.parse(data) as {
                  type?: string;
                  snapshot?: AppData;
                };
                if (parsed.type === 'snapshot' && parsed.snapshot) {
                  callback(parsed.snapshot);
                }
              } catch {
                /* ignore malformed frames */
              }
            }
            boundary = buffer.indexOf('\n\n');
          }
        }
      } catch {
        if (closed) return;
      }
      if (!closed) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  };

  void consume();
  return () => {
    closed = true;
    controller.abort();
  };
}

export const webEngine = {
  snapshot: () => rpc('snapshot'),
  refresh: () => rpc('refresh'),
  enable: (payload: EnableSelection & { skillId: string }) => rpc('enable', payload),
  disable: (id: string, mode: 'single' | 'split' | 'all' = 'single') =>
    rpc('disable', { bindingId: id, mode }),
  checkDisableImpact: (id: string) => rpc('checkDisableImpact', { bindingId: id }),
  convertToCopy: (id: string) => rpc('convertToCopy', id),
  updateBinding: (id: string) => rpc('updateBinding', id),
  resetBinding: (id: string) => rpc('resetBinding', id),
  redeployBinding: (id: string) => rpc('redeployBinding', id),
  adoptBinding: (id: string) => rpc('adoptBinding', id),
  ignoreDrift: (id: string) => rpc('ignoreDrift', id),
  switchVersion: (payload: { skillId: string; sha: string }) =>
    rpc('switchVersion', payload),
  adoptUnmanaged: (payload: { id: string; mode: 'register' | 'adopt' }) =>
    rpc('adoptUnmanaged', payload),
  adoptUnmanagedBatch: (payload: { ids: string[]; mode: 'register' | 'adopt' }) =>
    rpc('adoptUnmanagedBatch', payload),
  ignoreUnmanaged: (id: string) => rpc('ignoreUnmanaged', id),
  resyncSkillComment: (skillId: string) => rpc('resyncSkillComment', { skillId }),
  skillPreview: (payload: { skillId: string; sha?: string | null }) =>
    rpc('skillPreview', payload),
  scanHarness: (id: string) => rpc('scanHarness', id),
  addProject: (path: string) => rpc('addProject', path),
  relocateProject: (payload: { projectId: string; path: string }) =>
    rpc('relocateProject', payload),
  cleanProject: (id: string) => rpc('cleanProject', id),
  convertToProjectOnly: (payload: { skillId: string; projectId: string }) =>
    rpc('convertToProjectOnly', payload),
  editSkill: (payload: {
    skillId: string;
    patch: {
      displayName?: string;
      alias?: string;
      comment?: string;
      tags?: string[];
      dependsOn?: string[];
    };
  }) => rpc('editSkill', payload),
  deleteSkill: (id: string) => rpc('deleteSkill', id),
  importLocal: (path: string) => rpc('importLocal', path),
  importGit: (url: string) => rpc('importGit', url),
  importBackup: (path: string) => rpc('importBackup', path),
  exportBackup: (path: string) => rpc('exportBackup', path),
  exportProject: (id: string) => rpc('exportProject', id),
  restoreProject: (id: string) => rpc('restoreProject', id),
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
  }) => rpc('saveConfig', payload),
  addHarnessCandidate: (payload: {
    harnessId: string;
    path: string;
    scope: 'global' | 'project';
    role?: string;
    discovery?: string;
    label?: string;
  }) => rpc('addHarnessCandidate', payload),
  resetHarnessDefaults: (harnessId: string) => rpc('resetHarnessDefaults', { harnessId }),
  createCandidateDir: (payload: {
    harnessId: string;
    candidateId: string;
    scope?: 'global' | 'project';
    projectId?: string;
  }) => rpc('createCandidateDir', payload),
  toggleFavorite: (skillId: string) => rpc('toggleFavorite', { skillId }),
  configureWeb: (payload: WebConfigPatch) => rpc('configureWeb', payload),
  setMode: (mode: EngineMode) => rpc('setMode', mode),
  getWorkRoot: () => rpc('getWorkRoot') as Promise<{
    ok: boolean;
    path?: string;
    error?: string;
  }>,
  listAuditLogs: (payload?: AuditLogQuery) => rpc('listAuditLogs', payload),
  exportAuditLogs: (payload: {
    format: AuditExportFormat;
    path: string;
    source?: AuditSourceFilter;
    query?: string;
  }) => rpc('exportAuditLogs', payload),
  onChange: subscribeSnapshots,
};
