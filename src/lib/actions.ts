import type { EnableSelection, EngineResult, HarnessId, Scope } from './types';

export interface EnableIntent {
  skillId?: string;
  harnessId?: HarnessId;
  scope?: Scope;
  projectId?: string;
}

export interface QuiverActions {
  refresh: () => void;
  openPalette: () => void;
  openSettings: () => void;
  openImport: () => void;
  openEnable: (skillId?: string, intent?: Omit<EnableIntent, 'skillId'>) => void;
  openSkill: (skillId: string) => void;
  editSkill: (skillId: string) => void;
  deleteSkill: (skillId: string) => void;
  enableSkill: (skillId: string, selection: EnableSelection) => void;
  disableBinding: (id: string, mode?: 'single' | 'split' | 'all') => void;
  toggleFavorite: (skillId: string) => void;
  addHarnessCandidate: (harnessId: string, path: string) => void;
  createCandidateDir: (
    harnessId: string,
    candidateId: string,
    projectId?: string,
  ) => void;
  resetHarnessDefaults: (harnessId: string) => void;
  convertToCopy: (id: string) => void;
  updateBinding: (id: string) => void;
  resetBinding: (id: string) => void;
  adoptBinding: (id: string) => void;
  ignoreDrift: (id: string) => void;
  redeployBinding: (id: string) => void;
  switchVersion: (skillId: string, sha: string) => void;
  adoptUnmanaged: (id: string, mode: 'register' | 'adopt') => void;
  adoptUnmanagedBatch: (ids: string[], mode: 'register' | 'adopt') => void;
  ignoreUnmanaged: (id: string) => void;
  resyncSkillComment: (skillId: string) => void;
  loadSkillPreview: (skillId: string, sha?: string | null) => Promise<EngineResult | null>;
  scanHarness: (harnessId: HarnessId) => void;
  exportProject: (projectId: string) => void;
  restoreProject: (projectId: string) => void;
  cleanProject: (projectId: string) => void;
  relocateProject: (projectId: string) => void;
  convertToProjectOnly: (skillId: string, projectId: string) => void;
  addProject: () => void;
}
