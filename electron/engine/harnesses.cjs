const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { expandPath, sanitizeSlug, toPosix } = require('./util.cjs');

const CATEGORY_VALUES = new Set(['shared', 'domestic', 'global', 'custom']);
const ROLE_VALUES = new Set(['primary', 'shared', 'compat', 'synced', 'custom']);
const DISCOVERY_VALUES = new Set(['exact', 'parent-chain', 'nested-monorepo']);
const NESTED_SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  '.next',
  'out',
]);

const CATEGORY_LABELS = {
  shared: '跨工具共享',
  domestic: '国内主流',
  global: '国际主力',
  custom: '自定义',
};

const ROLE_LABELS = {
  primary: '原生首选',
  shared: '跨工具共享',
  compat: '兼容联动',
  synced: '云端同步',
  custom: '自定义扫描',
};

const DISCOVERY_LABELS = {
  exact: '精确目录',
  'parent-chain': '父级目录 (↑)',
  'nested-monorepo': '子包目录 (↓)',
};

const LEGACY_HARNESS_NAMES = {
  cline: new Map([
    ['cline / roo code', 'Cline'],
    ['cline/roo code', 'Cline'],
    ['cline / roo', 'Cline'],
  ]),
};

const LEGACY_CANDIDATE_LABELS = new Map([
  ['codex_home', '原生主目录'],
  ['codexhome', '原生主目录'],
]);

const AGENTS_GLOBAL = '~/.agents/skills';
const AGENTS_PROJECT = '.agents/skills';

function withPriorities(list) {
  return list.map((item, index) => ({ ...item, priority: index }));
}

function sharedGlobal() {
  return { id: 'g-shared', path: AGENTS_GLOBAL, scope: 'global', role: 'shared', discovery: 'exact', label: '跨工具共享层' };
}

function sharedProject(discovery = 'exact') {
  return { id: 'p-shared', path: AGENTS_PROJECT, scope: 'project', role: 'shared', discovery, label: '跨工具共享层' };
}

function primaryGlobal(id, value, extra = {}) {
  return { id, path: value, scope: 'global', role: 'primary', discovery: 'exact', ...extra };
}

function primaryProject(id, value, extra = {}) {
  return { id, path: value, scope: 'project', role: 'primary', discovery: 'exact', ...extra };
}

function compatGlobal(pathValue, extra = {}) {
  return { id: 'g-compat', path: pathValue, scope: 'global', role: 'compat', discovery: 'exact', ...extra };
}

function compatProject(pathValue, extra = {}) {
  return { id: 'p-compat', path: pathValue, scope: 'project', role: 'compat', discovery: 'exact', ...extra };
}

const BUILTINS = [
  {
    id: 'agents-common',
    name: 'Agents 跨工具共享',
    shortName: 'Agents',
    command: '',
    category: 'shared',
    candidates: withPriorities([
      primaryGlobal('g-primary', AGENTS_GLOBAL, { label: '跨工具共享层' }),
      primaryProject('p-primary', AGENTS_PROJECT, { label: '跨工具共享层' }),
    ]),
  },
  {
    id: 'qoder',
    name: 'Qoder',
    shortName: 'Qoder',
    command: 'qoder',
    category: 'domestic',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.qoder/skills'),
      primaryGlobal('g-primary-alt', '~/.qoderwork/skills', { label: 'QoderWork 变体' }),
      sharedGlobal(),
      primaryProject('p-primary', '.qoder/skills'),
      compatProject('.qoderwork/skills'),
      sharedProject(),
    ]),
  },
  {
    id: 'qoder-cn',
    name: 'Qoder CN',
    shortName: 'Qoder CN',
    command: 'qoder-cn',
    category: 'domestic',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.qoder-cn/skills'),
      primaryGlobal('g-primary-alt', '~/.lingma/skills', { label: 'Lingma 变体' }),
      compatGlobal('~/.tonyi/skills'),
      sharedGlobal(),
      primaryProject('p-primary', '.qoder-cn/skills'),
      primaryProject('p-primary-alt', '.lingma/skills', { label: 'Lingma 变体' }),
      sharedProject(),
    ]),
  },
  {
    id: 'workbuddy',
    name: 'WorkBuddy',
    shortName: 'WorkBuddy',
    command: 'workbuddy',
    category: 'domestic',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.workbuddy/skills'),
      primaryGlobal('g-primary-alt', '~/.workbuddy/connectors/skills', { label: 'Connectors 目录' }),
      compatGlobal('~/.codebuddy/skills'),
      sharedGlobal(),
      primaryProject('p-primary', '.codebuddy/skills'),
      compatProject('.workbuddy/skills'),
      sharedProject(),
    ]),
  },
  {
    id: 'deepseek-harness',
    name: 'DeepSeek Harness',
    shortName: 'DeepSeek',
    command: 'dsh',
    category: 'domestic',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.dsh/skills'),
      compatGlobal('~/.deepseek/skills'),
      sharedGlobal(),
      primaryProject('p-primary', '.dsh/skills'),
      compatProject('.deepseek/skills'),
      sharedProject(),
    ]),
  },
  {
    id: 'trae',
    name: 'Trae',
    shortName: 'Trae',
    command: 'trae',
    category: 'domestic',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.trae/skills'),
      sharedGlobal(),
      primaryProject('p-primary', '.trae/skills'),
      sharedProject(),
    ]),
  },
  {
    id: 'trae-cn',
    name: 'Trae CN',
    shortName: 'Trae CN',
    command: 'trae-cn',
    category: 'domestic',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.trae-cn/skills'),
      compatGlobal('~/.trae/skills'),
      compatGlobal('~/.mars/skills'),
      sharedGlobal(),
      primaryProject('p-primary', '.trae-cn/skills'),
      compatProject('.trae/skills'),
      sharedProject(),
    ]),
  },
  {
    id: 'comate',
    name: 'Comate',
    shortName: 'Comate',
    command: 'comate',
    category: 'domestic',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.comate/skills'),
      compatGlobal('~/.zulu/skills'),
      sharedGlobal(),
      primaryProject('p-primary', '.comate/skills'),
      compatProject('.zulu/skills'),
      sharedProject(),
    ]),
  },
  {
    id: 'codegeex',
    name: 'CodeGeeX',
    shortName: 'CodeGeeX',
    command: 'codegeex',
    category: 'domestic',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.codegeex/skills'),
      sharedGlobal(),
      primaryProject('p-primary', '.codegeex/skills'),
      sharedProject(),
    ]),
  },
  {
    id: 'iflycode',
    name: '讯飞星火 Code',
    shortName: 'iFlyCode',
    command: 'iflycode',
    category: 'domestic',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.iflycode/skills'),
      sharedGlobal(),
      primaryProject('p-primary', '.iflycode/skills'),
      sharedProject(),
    ]),
  },
  {
    id: 'joycoder',
    name: 'JoyCoder',
    shortName: 'JoyCoder',
    command: 'joycoder',
    category: 'domestic',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.joycoder/skills'),
      sharedGlobal(),
      primaryProject('p-primary', '.joycoder/skills'),
      sharedProject(),
    ]),
  },
  {
    id: 'fittencode',
    name: 'Fitten Code',
    shortName: 'Fitten',
    command: 'fittencode',
    category: 'domestic',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.fittencode/skills'),
      sharedGlobal(),
      primaryProject('p-primary', '.fittencode/skills'),
      sharedProject(),
    ]),
  },
  {
    id: 'antigravity',
    name: 'Antigravity IDE',
    shortName: 'Antigravity',
    command: 'antigravity',
    category: 'global',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.gemini/antigravity/skills'),
      compatGlobal('~/.gemini/config/skills'),
      sharedGlobal(),
      primaryProject('p-primary', AGENTS_PROJECT, { label: '跨工具共享层' }),
      compatProject('.agent/skills'),
    ]),
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    shortName: 'Claude',
    command: 'claude',
    category: 'global',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.claude/skills'),
      { id: 'g-synced', path: '~/.claude/skills/synced', scope: 'global', role: 'synced', discovery: 'exact', label: '云端同步目录' },
      sharedGlobal(),
      primaryProject('p-primary', '.claude/skills', { discovery: 'parent-chain' }),
      sharedProject(),
    ]),
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    shortName: 'Codex',
    command: 'codex',
    category: 'global',
    candidates: withPriorities([
      primaryGlobal('g-primary', '$CODEX_HOME/skills', { label: '原生主目录' }),
      primaryGlobal('g-primary-home', '~/.codex/skills'),
      sharedGlobal(),
      primaryProject('p-primary', '.codex/skills', { discovery: 'parent-chain' }),
      sharedProject(),
    ]),
  },
  {
    id: 'cursor',
    name: 'Cursor',
    shortName: 'Cursor',
    command: 'cursor',
    category: 'global',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.cursor/skills'),
      sharedGlobal(),
      primaryProject('p-primary', '.cursor/skills', { discovery: 'nested-monorepo' }),
      sharedProject('nested-monorepo'),
    ]),
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    shortName: 'OpenCode',
    command: 'opencode',
    category: 'global',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.config/opencode/skills'),
      compatGlobal('~/.opencode/skills'),
      compatGlobal('~/.claude/skills'),
      sharedGlobal(),
      primaryProject('p-primary', '.opencode/skills'),
      compatProject('.claude/skills'),
      sharedProject(),
    ]),
  },
  {
    id: 'cline',
    name: 'Cline',
    shortName: 'Cline',
    command: 'cline',
    category: 'global',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.cline/skills'),
      compatGlobal('~/.cline/rules'),
      sharedGlobal(),
      primaryProject('p-primary', '.clinerules/skills', { discovery: 'nested-monorepo' }),
      compatProject('.cline/skills'),
      sharedProject(),
    ]),
  },
  {
    id: 'roo-code',
    name: 'Roo Code',
    shortName: 'Roo',
    command: 'roo',
    category: 'global',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.roo/skills'),
      sharedGlobal(),
      primaryProject('p-primary', '.roo/skills', { discovery: 'nested-monorepo' }),
      sharedProject(),
    ]),
  },
  {
    id: 'kilo-code',
    name: 'Kilo Code',
    shortName: 'Kilo',
    command: 'kilo',
    category: 'global',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.kilo/skills'),
      compatGlobal('~/.kilocode/skills'),
      compatGlobal('~/.claude/skills'),
      sharedGlobal(),
      primaryProject('p-primary', '.kilo/skills'),
      compatProject('.kilocode/skills'),
      compatProject('.claude/skills'),
      sharedProject(),
    ]),
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    shortName: 'Gemini',
    command: 'gemini',
    category: 'global',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.gemini/skills'),
      compatGlobal('~/.gemini/config/skills'),
      sharedGlobal(),
      primaryProject('p-primary', '.gemini/skills'),
      sharedProject(),
    ]),
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    shortName: 'Windsurf',
    command: 'windsurf',
    category: 'global',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.codeium/windsurf/skills'),
      sharedGlobal(),
      primaryProject('p-primary', '.windsurf/skills'),
      sharedProject(),
    ]),
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    shortName: 'Copilot',
    command: 'copilot',
    category: 'global',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.copilot/skills'),
      sharedGlobal(),
      primaryProject('p-primary', '.github/skills'),
      sharedProject(),
    ]),
  },
  {
    id: 'kiro',
    name: 'Kiro',
    shortName: 'Kiro',
    command: 'kiro',
    category: 'global',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.kiro/skills'),
      sharedGlobal(),
      primaryProject('p-primary', '.kiro/skills'),
      sharedProject(),
    ]),
  },
  {
    id: 'goose',
    name: 'Goose',
    shortName: 'Goose',
    command: 'goose',
    category: 'global',
    candidates: withPriorities([
      primaryGlobal('g-primary', '~/.config/goose/skills'),
      sharedGlobal(),
      primaryProject('p-primary', '.goose/skills'),
      sharedProject(),
    ]),
  },
];

const BUILTIN_MAP = new Map(BUILTINS.map((item) => [item.id, item]));

function cloneCandidates(candidates) {
  return candidates.map((item) => ({ ...item }));
}

function sortCandidates(candidates) {
  return [...candidates].sort(
    (left, right) => Number(left.priority) - Number(right.priority) || left.id.localeCompare(right.id),
  );
}

function primaryPath(harness, scope) {
  const scoped = sortCandidates(harness.candidates.filter((item) => item.scope === scope));
  const primary = scoped.find((item) => item.role === 'primary') ?? scoped[0];
  if (primary) return primary.path;
  return scope === 'global' ? `~/.${harness.id}/skills` : `.${harness.id}/skills`;
}

function normalizeCandidate(raw, index, fallbackScope) {
  if (!raw || typeof raw !== 'object') return null;
  const candidatePath = String(raw.path ?? '').trim();
  if (!candidatePath) return null;
  const scope =
    raw.scope === 'global' || raw.scope === 'project' ? raw.scope : fallbackScope;
  const role = ROLE_VALUES.has(raw.role) ? raw.role : 'custom';
  const discovery = DISCOVERY_VALUES.has(raw.discovery) ? raw.discovery : 'exact';
  const priority = Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : index;
  let id = String(raw.id ?? '')
    .trim()
    .replace(/[^\w.-]+/g, '-');
  if (!id) id = `${scope === 'global' ? 'g' : 'p'}-${index + 1}`;
  const label = String(raw.label ?? '').trim();
  return {
    id,
    path: candidatePath,
    scope,
    role,
    discovery,
    priority,
    ...(label ? { label } : {}),
  };
}

function dedupeCandidates(candidates) {
  const ids = new Set();
  const paths = new Set();
  const result = [];
  candidates.forEach((candidate, index) => {
    const key = `${candidate.scope}:${toPosix(candidate.path).replace(/\/$/, '').toLowerCase()}`;
    if (paths.has(key)) return;
    let id = candidate.id;
    let suffix = 2;
    while (ids.has(id)) {
      id = `${candidate.id}-${suffix}`;
      suffix += 1;
    }
    ids.add(id);
    paths.add(key);
    result.push({ ...candidate, id, priority: index });
  });
  return result;
}

function legacyCandidates(harness, builtin) {
  const globalPath = String(harness.global_path ?? '').trim();
  const projectPath = String(harness.project_rel_path ?? '').trim();
  const defaults = builtin ? builtin.candidates : [];
  const result = [];
  for (const scope of ['global', 'project']) {
    const legacyPath = scope === 'global' ? globalPath : projectPath;
    const scoped = cloneCandidates(defaults.filter((item) => item.scope === scope));
    if (scoped.length === 0) {
      if (legacyPath) {
        result.push({
          id: scope === 'global' ? 'g-primary' : 'p-primary',
          path: legacyPath,
          scope,
          role: 'primary',
          discovery: 'exact',
          priority: 0,
        });
      }
      continue;
    }
    const primaryIndex = scoped.findIndex((item) => item.role === 'primary');
    if (legacyPath && primaryIndex === -1) {
      scoped.unshift({
        id: scope === 'global' ? 'g-primary' : 'p-primary',
        path: legacyPath,
        scope,
        role: 'primary',
        discovery: 'exact',
        priority: 0,
      });
    } else if (legacyPath && primaryIndex >= 0) {
      scoped[primaryIndex].path = legacyPath;
    }
    scoped.forEach((item, index) => {
      item.priority = index;
    });
    result.push(...scoped);
  }
  return result;
}

function migrateCandidateLabels(candidates) {
  return candidates.map((candidate) => {
    if (!candidate.label) return candidate;
    const label = LEGACY_CANDIDATE_LABELS.get(
      String(candidate.label).trim().toLowerCase(),
    );
    return label ? { ...candidate, label } : candidate;
  });
}

function normalizeCandidates(rawList, builtin, legacyHarness) {
  if (Array.isArray(rawList) && rawList.length > 0) {
    const normalized = rawList
      .map((item, index) => normalizeCandidate(item, index, 'global'))
      .filter(Boolean);
    if (normalized.length > 0) {
      return dedupeCandidates(migrateCandidateLabels(normalized));
    }
  }
  const fallback = legacyCandidates(legacyHarness ?? {}, builtin);
  if (fallback.length > 0) return dedupeCandidates(fallback);
  const id = legacyHarness?.id ?? builtin?.id ?? 'tool';
  return dedupeCandidates([
    {
      id: 'g-primary',
      path: `~/.${id}/skills`,
      scope: 'global',
      role: 'primary',
      discovery: 'exact',
      priority: 0,
    },
    {
      id: 'p-primary',
      path: `.${id}/skills`,
      scope: 'project',
      role: 'primary',
      discovery: 'exact',
      priority: 1,
    },
  ]);
}

function finalizeHarness(raw, builtin, candidates) {
  const id = sanitizeSlug(raw.id ?? builtin?.id ?? 'tool');
  const legacyNames = builtin ? LEGACY_HARNESS_NAMES[builtin.id] : null;
  const legacyName = (value) =>
    legacyNames?.get(String(value ?? '').trim().toLowerCase()) ?? '';
  const fallbackName = builtin?.name ?? id;
  const name =
    legacyName(raw.name) ||
    String(raw.name ?? fallbackName).trim() ||
    fallbackName;
  const shortSource = raw.short_name ?? raw.shortName;
  const shortName =
    legacyName(shortSource) ||
    String(shortSource ?? builtin?.shortName ?? name).trim() ||
    name;
  const command = String(raw.command ?? builtin?.command ?? '').trim();
  const category = builtin
    ? builtin.category
    : CATEGORY_VALUES.has(raw.category)
      ? raw.category
      : 'custom';
  const harness = {
    id,
    name,
    short_name: shortName,
    command,
    category,
    is_builtin: Boolean(builtin),
    candidates,
  };
  harness.global_path = primaryPath(harness, 'global');
  harness.project_rel_path = primaryPath(harness, 'project');
  return harness;
}

function builtinHarness(builtin) {
  return finalizeHarness({ id: builtin.id, name: builtin.name }, builtin, cloneCandidates(builtin.candidates));
}

function normalizeHarness(raw) {
  const id = sanitizeSlug(raw?.id ?? '');
  if (!id) return null;
  const builtin = BUILTIN_MAP.get(id) ?? null;
  const legacy = {
    id,
    global_path: raw.globalPath ?? raw.global_path,
    project_rel_path: raw.projectRelPath ?? raw.project_rel_path,
  };
  const candidates = normalizeCandidates(raw.candidates, builtin, legacy);
  return finalizeHarness({ ...raw, id }, builtin, candidates);
}

function builtinHarnesses() {
  return BUILTINS.map(builtinHarness);
}

function defaultHarness(id) {
  const builtin = BUILTIN_MAP.get(id);
  return builtin ? builtinHarness(builtin) : null;
}

function mergeHarnesses(parsedHarnesses, removedIds = []) {
  const removed = new Set(
    (Array.isArray(removedIds) ? removedIds : []).map((item) => String(item)),
  );
  const result = [];
  const seen = new Set();
  for (const raw of Array.isArray(parsedHarnesses) ? parsedHarnesses : []) {
    const id = sanitizeSlug(raw?.id ?? '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const builtin = BUILTIN_MAP.get(id);
    const candidates = normalizeCandidates(raw?.candidates, builtin, raw);
    result.push(finalizeHarness({ ...raw, id }, builtin, candidates));
  }
  for (const builtin of BUILTINS) {
    if (seen.has(builtin.id) || removed.has(builtin.id)) continue;
    result.push(builtinHarness(builtin));
  }
  return result;
}

function findCandidate(harness, candidateId) {
  if (!candidateId) return null;
  return harness.candidates.find((item) => item.id === candidateId) ?? null;
}

function preferredCandidate(harness, scope, exists = null) {
  const scoped = sortCandidates(harness.candidates.filter((item) => item.scope === scope));
  const primaries = scoped.filter((item) => item.role === 'primary');
  const pool = primaries.length > 0 ? primaries : scoped.filter((item) => item.role !== 'shared');
  const candidates = pool.length > 0 ? pool : scoped;
  if (typeof exists === 'function') {
    const found = candidates.find((item) => exists(item));
    if (found) return found;
  }
  return candidates[0] ?? null;
}

function roleLabel(candidate) {
  if (/\$(?:\{)?CODEX_HOME(?:\})?/i.test(String(candidate.path ?? ''))) {
    return process.env.CODEX_HOME ? '环境变量主目录' : '原生主目录';
  }
  return candidate.label || ROLE_LABELS[candidate.role] || '候选路径';
}

function discoveryLabel(candidate) {
  return DISCOVERY_LABELS[candidate.discovery] ?? DISCOVERY_LABELS.exact;
}

function isAgentsSharedPath(candidatePath) {
  const normalized = toPosix(String(candidatePath ?? '')).replace(/\/$/, '');
  return normalized === '~/.agents/skills' || normalized === '.agents/skills' || /(^|\/)\.agents\/skills$/.test(normalized);
}

function resolveGlobalBase(candidate, { homeDir = os.homedir(), env = process.env } = {}) {
  const expanded = expandPath(candidate.path, { homeDir, env });
  if (!expanded) return null;
  return path.isAbsolute(expanded) ? path.resolve(expanded) : null;
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function collectProjectCandidateDirs(candidate, projectPath) {
  const rel = candidate.path;
  const bases = [];
  const seen = new Set();
  const push = (base) => {
    const resolved = path.resolve(base);
    if (seen.has(resolved)) return;
    if (!isDirectory(resolved)) return;
    seen.add(resolved);
    bases.push(resolved);
  };
  if (candidate.discovery === 'parent-chain') {
    let current = path.resolve(projectPath);
    for (let depth = 0; depth < 4; depth += 1) {
      push(path.join(current, rel));
      if (fs.existsSync(path.join(current, '.git'))) break;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return bases;
  }
  if (candidate.discovery === 'nested-monorepo') {
    const queue = [{ dir: path.resolve(projectPath), depth: 0 }];
    while (queue.length > 0) {
      const current = queue.shift();
      push(path.join(current.dir, rel));
      if (current.depth >= 3) continue;
      let entries = [];
      try {
        entries = fs.readdirSync(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        if (entry.name.startsWith('.') || NESTED_SKIP.has(entry.name)) continue;
        queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
      }
    }
    return bases;
  }
  push(path.join(projectPath, rel));
  return bases;
}

function candidateMatchesTarget(candidate, targetDir, projectPath) {
  const rel = toPosix(candidate.path).replace(/\/$/, '');
  const resolved = path.resolve(targetDir);
  if (candidate.discovery === 'exact') {
    const base = projectPath ? path.join(projectPath, candidate.path) : resolved;
    return path.resolve(base) === resolved;
  }
  const normalized = toPosix(resolved).replace(/\/$/, '').toLowerCase();
  return normalized.endsWith(`/${rel.toLowerCase()}`);
}

module.exports = {
  AGENTS_GLOBAL,
  AGENTS_PROJECT,
  BUILTINS,
  CATEGORY_LABELS,
  CATEGORY_VALUES,
  DISCOVERY_LABELS,
  ROLE_LABELS,
  ROLE_VALUES,
  builtinHarness,
  builtinHarnesses,
  candidateMatchesTarget,
  collectProjectCandidateDirs,
  defaultHarness,
  discoveryLabel,
  findCandidate,
  isAgentsSharedPath,
  isDirectory,
  legacyCandidates,
  mergeHarnesses,
  normalizeCandidate,
  normalizeCandidates,
  normalizeHarness,
  preferredCandidate,
  primaryPath,
  resolveGlobalBase,
  roleLabel,
  sortCandidates,
};
