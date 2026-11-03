export type View = 'skills' | 'harness' | 'projects';

export type HarnessId = string;

export type BindingState = 'enabled' | 'drifted' | 'missing' | 'orphaned';
export type SyncMode = 'link' | 'copy';
export type Scope = 'global' | 'project';
export type SourceType = 'git' | 'local' | 'archive';
export type DriftStatus = 'M' | 'A' | 'D';
export type EngineMode = 'sandbox' | 'real';
export type HarnessCategory = 'shared' | 'domestic' | 'global' | 'custom';
export type CandidateRole = 'primary' | 'shared' | 'compat' | 'synced' | 'custom';
export type CandidateDiscovery = 'exact' | 'parent-chain' | 'nested-monorepo';

export interface HarnessCandidateDraft {
  id: string;
  path: string;
  scope: Scope;
  role: CandidateRole;
  discovery: CandidateDiscovery;
  priority: number;
  label?: string;
}

export interface HarnessCandidate extends HarnessCandidateDraft {
  roleLabel: string;
  discoveryLabel: string;
  displayPath: string;
  physicalPath: string | null;
  exists: boolean;
  skillCount: number;
  managedCount: number;
  projectDirCount?: number;
  shared: boolean;
}

export interface Harness {
  id: HarnessId;
  name: string;
  shortName: string;
  globalPath: string;
  projectRelPath: string;
  physicalGlobalPath?: string;
  command: string;
  category: HarnessCategory;
  categoryLabel: string;
  isBuiltin: boolean;
  detected: boolean;
  managedCount: number;
  candidates: HarnessCandidate[];
  defaultCandidates: HarnessCandidateDraft[];
}

export interface Project {
  id: string;
  name: string;
  path: string;
  realPath?: string;
  localRel: string;
  harnesses: HarnessId[];
  manifestExported?: boolean;
  missing?: boolean;
  lastActive?: string;
}

export interface DriftFile {
  status: DriftStatus;
  path: string;
}

export interface Binding {
  id: string;
  skillId: string;
  harnessId: HarnessId;
  scope: Scope;
  projectId?: string;
  displayPath: string;
  localRel: string;
  realPath?: string;
  candidateId?: string;
  candidatePath?: string;
  candidateRole?: CandidateRole;
  candidateLabel?: string;
  shared?: boolean;
  state: BindingState;
  syncMode: SyncMode;
  resolvedSha: string;
  currentSha?: string;
  driftFiles?: DriftFile[];
  ignoredDrift?: boolean;
  updateAvailable?: string;
  deployedAt: string;
}

export interface SkillVersion {
  sha: string;
  createdAt: string;
  note?: string;
}

export interface Skill {
  id: string;
  slug: string;
  displayName: string;
  alias?: string;
  comment?: string;
  tags: string[];
  dependsOn: string[];
  sourceType: SourceType;
  sourceUri: string;
  activeSha: string;
  versions: SkillVersion[];
  importedAt: string;
  isFavorite?: boolean;
  readOnly: boolean;
}

export interface UnmanagedSkill {
  id: string;
  harnessId: HarnessId;
  harnessIds?: HarnessId[];
  name: string;
  fsPath?: string;
  displayPath: string;
  localRel: string;
  fileCount: number;
  scope?: Scope;
  projectId?: string;
  projectName?: string;
  candidateId?: string;
  candidatePath?: string;
  candidateRole?: CandidateRole;
  candidateLabel?: string;
  discoveryLabel?: string;
  priority?: number;
  shared?: boolean;
  sharedHarnessIds?: HarnessId[];
  shadowedBy?: {
    candidateId: string;
    candidatePath: string;
    candidateLabel: string;
    priority: number;
    managed: boolean;
    bindingId: string | null;
  } | null;
}

export interface LanAddress {
  address: string;
  name: string;
  virtual: boolean;
  url: string;
}

export interface WebSettings {
  enabled: boolean;
  port: number;
  url: string;
  token: string;
  running: boolean;
  lan: boolean;
  lanUrls: string[];
  lanAddresses: LanAddress[];
  error?: string;
}

export interface Settings {
  mode: EngineMode;
  editorCommand: string;
  workRoot: string;
  availableRoot: string;
  storeRoot: string;
  homeDir?: string;
  sandboxRoot?: string;
  realRoot?: string;
  trayOnClose: boolean;
  lastChecked: number;
  web: WebSettings;
}

export interface SkillPreviewFile {
  path: string;
  size: number;
}

export interface SkillPreview {
  sha: string;
  files: SkillPreviewFile[];
  skillMarkdown: string | null;
  truncated: boolean;
  overflow: boolean;
}

export interface PermissionIssue {
  code: string;
  path: string;
  syscall: string;
  platform: string;
  message: string;
  key: string;
  ts?: number;
}

export interface EngineNotice {
  id: string;
  kind: string;
  message: string;
  description?: string;
  createdAt: number;
}

export interface DependentBinding {
  bindingId: string;
  skillId: string;
  skillSlug: string;
  skillName: string;
  harnessId: HarnessId;
  harnessName: string;
  scope: Scope;
  scopeLabel: string;
  state: BindingState;
  projectId: string | null;
  projectName: string | null;
}

export interface SharedBindingReader {
  harnessId: HarnessId;
  harnessName: string;
  candidateId: string;
  candidatePath: string;
  candidateRole: CandidateRole;
  candidateRoleLabel: string;
}

export interface SharedBindingImpact {
  active: boolean;
  path: string;
  candidateId: string | null;
  candidatePath: string | null;
  candidateRole: CandidateRole | null;
  candidateRoleLabel: string | null;
  canSplit: boolean;
  readers: SharedBindingReader[];
}

export interface WebConfigPatch {
  enabled?: boolean;
  port?: number;
  lan?: boolean;
  regenerateToken?: boolean;
}

export interface AuditLogEntry {
  id: number;
  ts: number;
  source: string;
  sourceLabel: string;
  action: string;
  actionLabel: string;
  detail: string;
  skillId: string | null;
  skillSlug: string | null;
  skillName: string | null;
  harnessId: string | null;
  harnessName: string | null;
  scope: Scope | null;
  scopeLabel: string | null;
  projectId: string | null;
  projectName: string | null;
  targetPath: string | null;
  displayPath: string | null;
}

export type AuditSourceFilter = 'all' | 'desktop' | 'web';
export type AuditExportFormat = 'json' | 'csv';

export interface AuditLogQuery {
  limit?: number;
  source?: AuditSourceFilter;
  query?: string;
}

export interface AppData {
  skills: Skill[];
  bindings: Binding[];
  projects: Project[];
  unmanaged: UnmanagedSkill[];
  harnesses: Harness[];
  settings: Settings;
  notices?: EngineNotice[];
  permission?: PermissionIssue | null;
}

export interface EngineResult {
  ok: boolean;
  error?: string;
  code?: string;
  message?: string;
  description?: string;
  warning?: boolean;
  path?: string;
  count?: number;
  logs?: AuditLogEntry[];
  snapshot?: AppData;
  permission?: PermissionIssue | null;
  suggestion?: string | null;
  dependents?: DependentBinding[];
  shared?: SharedBindingImpact;
  skill?: { id: string; slug: string; displayName: string };
  bindingId?: string;
  webTokenRotated?: boolean;
  preview?: SkillPreview;
}

export type ScopeMode = 'global' | 'overlay';

export interface EnableTarget {
  harnessId: HarnessId;
  candidateId?: string;
}

export interface EnableSelection {
  harnessIds: HarnessId[];
  targets?: EnableTarget[];
  scope: Scope;
  projectId?: string;
  syncMode: SyncMode;
}
