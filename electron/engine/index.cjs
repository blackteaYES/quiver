const { BrowserWindow } = require('electron');
const { AsyncLocalStorage } = require('node:async_hooks');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { generateWebToken, loadConfig, saveConfig } = require('./config.cjs');
const { Db } = require('./db.cjs');
const { assertImportable, hashDirectory } = require('./hash.cjs');
const {
  builtinHarness,
  CATEGORY_LABELS,
  candidateMatchesTarget,
  collectProjectCandidateDirs,
  defaultHarness,
  discoveryLabel,
  findCandidate,
  isAgentsSharedPath,
  isDirectory,
  normalizeHarness,
  preferredCandidate,
  resolveGlobalBase,
  roleLabel,
  sortCandidates,
} = require('./harnesses.cjs');
const {
  copyVersion,
  mount,
  resolveTarget,
  unmount,
} = require('./mount.cjs');
const { reconcile, scanUnmanaged, unmanagedId } = require('./reconcile.cjs');
const { ensureSeeded } = require('./seed.cjs');
const { WebServer, localIPv4Addresses, localIPv4Entries } = require('./server.cjs');
const {
  DEFAULT_ADOPT_COMMENT,
  copyIntoStore,
  ensureAvailableLink,
  exportBackup,
  importBackup,
  importDirectory,
  importGit,
  readSkillPreview,
  readStoredSkillDescription,
  refreshDefaultSkillComments,
  storeDir,
} = require('./store.cjs');
const {
  EngineError,
  expandHome,
  expandPath,
  formatStamp,
  isPermissionError,
  lstatOrNull,
  permissionFromError,
  relativeLabel,
  removeEntry,
  sanitizeSlug,
  sha256,
  shortSha,
  stripHome,
  toPosix,
  uuid,
  within,
} = require('./util.cjs');

const WATCH_DEBOUNCE = 2200;
const WATCHDOG_INTERVAL = 30_000;

const AUDIT_ACTION_LABELS = {
  seed_demo: '初始化演示数据',
  import_skill: '导入技能',
  enable: '启用',
  disable: '禁用',
  disable_split: '拆分共享解绑',
  disable_shared: '彻底移除共享入口',
  convert_copy: '转为副本',
  update: '更新版本',
  reset: '重置漂移',
  adopt: '收编修改',
  ignore_drift: '忽略漂移',
  switch_version: '切换版本',
  adopt_unmanaged: '收编外部技能',
  adopt_unmanaged_batch: '批量收编外部技能',
  register_unmanaged: '登记外部技能',
  resync_skill_comment: '重新同步技能简介',
  ignore_unmanaged: '忽略外部技能',
  scan_harness: '扫描工具',
  add_project: '添加项目',
  relocate_project: '迁移项目',
  clean_project: '清理项目',
  convert_project_only: '转为项目专属',
  edit_skill: '编辑技能',
  delete_skill: '删除技能',
  toggle_favorite: '收藏技能',
  export_backup: '导出备份',
  import_backup: '导入备份',
  export_project: '导出项目配置',
  restore_project: '恢复项目入口',
  save_config: '保存设置',
  switch_mode: '切换运行模式',
  export_audit_logs: '导出操作日志',
  revive_project: '项目自动恢复',
  configure_web: '配置 Web 服务',
  set_tray_on_close: '托盘驻留设置',
};

const AUDIT_SOURCE_LABELS = {
  desktop: '桌面端',
  web: 'Web 端',
};

function auditStamp(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function findFreePort(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

class Engine {
  constructor(app) {
    this.app = app;
    this.mode = 'real';
    this.root = '';
    this.config = null;
    this.db = null;
    this.lastChecked = new Date();
    this.watcher = null;
    this.watchTimer = null;
    this.broadcastTimer = null;
    this.cache = null;
    this.webServer = null;
    this.notices = [];
    this.permissionIssue = null;
    this.watchdogTimer = null;
    this.watchdogBusy = false;
    this.revivingProjects = new Set();
    this.auditContext = new AsyncLocalStorage();
    this.candidateStatsCache = new Map();
  }

  pointerFile() {
    return path.join(this.app.getPath('userData'), 'engine-mode.json');
  }

  async readMode() {
    try {
      const payload = JSON.parse(await fsp.readFile(this.pointerFile(), 'utf8'));
      if (payload?.mode === 'real' || payload?.mode === 'sandbox') return payload.mode;
    } catch {
      /* default */
    }
    return 'real';
  }

  sandboxRoot() {
    return this.app.isPackaged
      ? path.join(this.app.getPath('userData'), 'quiver-sandbox')
      : path.join(this.app.getAppPath(), '.quiver-demo');
  }

  realRoot() {
    return path.join(os.homedir(), '.quiver');
  }

  async init() {
    this.mode = await this.readMode();
    await this.openRoot();
  }

  async openRoot() {
    this.stopWatcher();
    this.stopWatchdog();
    await this.stopWebServer();
    if (this.db) this.db.close();
    this.root = this.mode === 'real' ? this.realRoot() : this.sandboxRoot();
    this.notices = [];
    this.permissionIssue = null;
    this.candidateStatsCache.clear();
    await fsp.mkdir(this.root, { recursive: true });
    await fsp.mkdir(path.join(this.root, 'store', 'sha256'), { recursive: true });
    await fsp.mkdir(path.join(this.root, 'available'), { recursive: true });
    await fsp.mkdir(path.join(this.root, 'staging'), { recursive: true });

    const configFile = path.join(this.root, 'config.toml');
    this.config = await loadConfig(configFile, this.mode);
    this.config.mode = this.mode;
    if (!this.config.web_token) this.config.web_token = generateWebToken();
    await saveConfig(configFile, this.config);

    this.db = new Db(path.join(this.root, 'metadata.db'));
    this.cache = {
      get: (absPath, size, mtimeMs) => {
        const row = this.db.get(
          'SELECT size, mtime_ms, sha256 FROM file_hash_cache WHERE abs_path = ?',
          absPath,
        );
        if (!row) return null;
        if (row.size !== size) return null;
        if (Math.abs(row.mtime_ms - mtimeMs) > 0.001) return null;
        return row.sha256;
      },
      set: (absPath, size, mtimeMs, sha256) => {
        this.db.run(
          `INSERT INTO file_hash_cache (abs_path, size, mtime_ms, sha256) VALUES (?, ?, ?, ?)
           ON CONFLICT(abs_path) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, sha256 = excluded.sha256`,
          absPath,
          size,
          mtimeMs,
          sha256,
        );
      },
    };

    const seeded = await ensureSeeded(this);
    if (!seeded) await reconcile(this);
    await refreshDefaultSkillComments(this);
    await this.startWebServer();
    this.startWatcher();
    this.startWatchdog();
  }

  async startWebServer() {
    await this.stopWebServer();
    if (!this.config.web_enabled) return;
    this.webServer = new WebServer(this, {
      port: this.config.web_port,
      lan: Boolean(this.config.web_lan),
    });
    await this.webServer.start(this.config.web_port, Boolean(this.config.web_lan));
  }

  async stopWebServer() {
    const server = this.webServer;
    this.webServer = null;
    if (server) await server.stop();
  }

  webStatus() {
    const port = this.config?.web_port ?? 4310;
    const lan = Boolean(this.config?.web_lan);
    const status = this.webServer?.status;
    const lanAddresses =
      status?.lanAddresses ??
      (lan
        ? localIPv4Entries().map((entry) => ({
            ...entry,
            url: `http://${entry.address}:${port}`,
          }))
        : []);
    return {
      running: Boolean(status?.running),
      url: status?.url ?? `http://127.0.0.1:${port}`,
      lan,
      lanUrls: status?.lanUrls ?? lanAddresses.map((entry) => entry.url),
      lanAddresses,
      error: status?.error ?? null,
    };
  }

  harness(harnessId) {
    return this.config.harnesses.find((item) => item.id === harnessId) ?? null;
  }

  globalRoot(harness) {
    const candidate = this.preferredCandidateFor(harness, 'global');
    const base = candidate ? this.candidateBase(harness, candidate) : null;
    if (base) return base;
    const configured = harness.global_path || `~/.${harness.id}/skills`;
    if (this.mode === 'sandbox') {
      return path.join(this.root, 'home', stripHome(configured));
    }
    return expandHome(configured);
  }

  globalBase(candidate) {
    const resolved = resolveGlobalBase(candidate);
    if (!resolved) return null;
    if (this.mode !== 'sandbox') return resolved;
    if (within(this.root, resolved)) return resolved;
    const sandboxHome = path.join(this.root, 'home');
    if (within(os.homedir(), resolved)) {
      return path.join(sandboxHome, path.relative(os.homedir(), resolved));
    }
    return path.join(
      sandboxHome,
      '__external__',
      sha256(resolved).slice(0, 8),
      path.basename(resolved) || 'skills',
    );
  }

  candidateBase(harness, candidate, project = null) {
    if (!candidate) return null;
    if (candidate.scope === 'project') {
      if (!project) return null;
      return path.join(project.path, candidate.path);
    }
    return this.globalBase(candidate);
  }

  preferredCandidateFor(harness, scope, project = null) {
    // Resolvability only: picking whichever fallback directory happens to
    // exist would silently override the configured primary path.
    return preferredCandidate(harness, scope, (candidate) =>
      Boolean(
        this.candidateBase(
          harness,
          candidate,
          candidate.scope === 'project' ? project : null,
        ),
      ),
    );
  }

  primaryCandidateFor(harness, scope, project = null) {
    const scoped = sortCandidates(
      harness.candidates.filter((item) => item.scope === scope && item.role !== 'shared'),
    );
    const primaries = scoped.filter((item) => item.role === 'primary');
    const pool = primaries.length > 0 ? primaries : scoped;
    return (
      pool.find((candidate) => {
        const base = this.candidateBase(harness, candidate, project);
        return Boolean(base && isDirectory(base));
      }) ??
      pool[0] ??
      null
    );
  }

  candidateForTarget(harness, project, targetPath) {
    if (!harness || !targetPath) return null;
    const scope = project ? 'project' : 'global';
    const dir = path.resolve(path.dirname(targetPath));
    const scoped = sortCandidates(harness.candidates.filter((item) => item.scope === scope));
    for (const candidate of scoped) {
      const base = this.candidateBase(harness, candidate, project);
      if (base && path.resolve(base) === dir) return candidate;
    }
    return (
      scoped.find(
        (candidate) =>
          candidate.discovery !== 'exact' &&
          candidateMatchesTarget(candidate, dir, project?.path),
      ) ?? null
    );
  }

  candidateDisplay(harness, candidate, project = null) {
    const base = this.candidateBase(harness, candidate, project);
    return base ? this.displayFor(base) : candidate.path;
  }

  harnessActive(harness, scope, project = null) {
    const candidates = harness.candidates.filter((item) => item.scope === scope);
    const hasDir = candidates.some((candidate) => {
      const base = this.candidateBase(
        harness,
        candidate,
        candidate.scope === 'project' ? project : null,
      );
      return Boolean(base && isDirectory(base));
    });
    if (hasDir) return true;
    const binding = this.db.get(
      `SELECT 1 FROM bindings WHERE harness_id = ? AND scope = ?${
        scope === 'project' ? ' AND project_id = ?' : ''
      }`,
      ...(scope === 'project'
        ? [harness.id, scope, project?.project_id ?? '']
        : [harness.id, scope]),
    );
    return Boolean(binding);
  }

  candidateDirStats(base) {
    if (!base) return { exists: false, skillCount: 0 };
    const key = path.resolve(base);
    const now = Date.now();
    const cached = this.candidateStatsCache.get(key);
    if (cached && now - cached.at < 2000) return cached.value;
    let value = { exists: false, skillCount: 0 };
    try {
      if (fs.statSync(base).isDirectory()) {
        const entries = fs.readdirSync(base, { withFileTypes: true });
        value = {
          exists: true,
          skillCount: entries.filter(
            (entry) => entry.isDirectory() && !entry.name.startsWith('.'),
          ).length,
        };
      }
    } catch {
      /* missing or unreadable */
    }
    this.candidateStatsCache.set(key, { at: now, value });
    return value;
  }

  candidateSnapshot(harness, candidate, projects, managedCount) {
    if (candidate.scope === 'global') {
      const base = this.candidateBase(harness, candidate);
      const stats = this.candidateDirStats(base);
      return {
        id: candidate.id,
        path: candidate.path,
        scope: 'global',
        role: candidate.role,
        discovery: candidate.discovery,
        priority: candidate.priority,
        label: candidate.label ?? '',
        roleLabel: roleLabel(candidate),
        discoveryLabel: discoveryLabel(candidate),
        displayPath: base ? this.displayFor(base) : candidate.path,
        physicalPath: base,
        exists: stats.exists,
        skillCount: stats.skillCount,
        managedCount,
        shared: candidate.role === 'shared' || isAgentsSharedPath(candidate.path),
      };
    }
    let exists = false;
    let skillCount = 0;
    let baseCount = 0;
    for (const project of projects) {
      const base = this.candidateBase(harness, candidate, project);
      if (!base) continue;
      const stats = this.candidateDirStats(base);
      if (stats.exists) {
        exists = true;
        baseCount += 1;
      }
      skillCount += stats.skillCount;
    }
    return {
      id: candidate.id,
      path: candidate.path,
      scope: 'project',
      role: candidate.role,
      discovery: candidate.discovery,
      priority: candidate.priority,
      label: candidate.label ?? '',
      roleLabel: roleLabel(candidate),
      discoveryLabel: discoveryLabel(candidate),
      displayPath: candidate.path,
      physicalPath: null,
      exists,
      skillCount,
      managedCount,
      projectDirCount: baseCount,
      shared: candidate.role === 'shared' || isAgentsSharedPath(candidate.path),
    };
  }

  sharedReadersFor(binding) {
    const harness = this.harness(binding.harness_id);
    if (!harness) return { shared: false, candidate: null, readers: [] };
    const project =
      binding.scope === 'project' ? this.projectById(binding.project_id) : null;
    if (binding.scope === 'project' && !project) {
      return { shared: false, candidate: null, readers: [] };
    }
    const targetDir = path.resolve(path.dirname(binding.target_path));
    const candidate = this.candidateForTarget(harness, project, binding.target_path);
    const readers = [];
    for (const other of this.config.harnesses) {
      if (other.id === harness.id) continue;
      for (const item of other.candidates) {
        if (item.scope !== binding.scope) continue;
        const base = this.candidateBase(
          other,
          item,
          binding.scope === 'project' ? project : null,
        );
        if (!base || path.resolve(base) !== targetDir) continue;
        readers.push({
          harnessId: other.id,
          harnessName: other.name,
          candidateId: item.id,
          candidatePath: item.path,
          candidateRole: item.role,
          candidateRoleLabel: roleLabel(item),
        });
        break;
      }
    }
    return {
      shared:
        readers.length > 0 ||
        Boolean(candidate && (candidate.role === 'shared' || isAgentsSharedPath(candidate.path))),
      candidate,
      readers,
    };
  }

  displayFor(absPath) {
    const homeRoot = path.join(this.root, 'home');
    if (within(homeRoot, absPath)) {
      return `~/${toPosix(path.relative(homeRoot, absPath))}`;
    }
    return absPath;
  }

  relFor(absPath) {
    if (this.mode === 'sandbox') {
      return toPosix(path.relative(this.root, absPath));
    }
    return absPath;
  }

  assertAllowedPath(absPath) {
    const resolved = path.resolve(absPath);
    if (within(this.root, resolved)) return resolved;
    if (this.mode === 'real' && within(os.homedir(), resolved)) return resolved;
    const projects = this.db.all('SELECT path FROM projects');
    if (projects.some((project) => within(project.path, resolved))) return resolved;
    throw new EngineError('路径超出 Quiver 的工作范围，已拒绝访问', 'PATH_ESCAPE');
  }

  assertAllowedTarget(absPath) {
    return this.assertAllowedPath(absPath);
  }

  resolveRequestPath(input) {
    if (typeof input !== 'string' || input.trim() === '') {
      throw new EngineError('缺少路径', 'NO_PATH');
    }
    const expanded = input.startsWith('~') ? expandHome(input) : input;
    const resolved = path.isAbsolute(expanded)
      ? path.resolve(expanded)
      : path.resolve(this.root, expanded);
    return this.assertAllowedPath(resolved);
  }

  runWithSource(source, fn) {
    return this.auditContext.run({ source }, fn);
  }

  notePermission(permission) {
    if (!permission) return;
    this.permissionIssue = {
      ...permission,
      ts: Date.now(),
      key: permission.key ?? `${permission.code}:${permission.path ?? ''}`,
    };
  }

  audit(action, bindingId = null, skillId = null, detail = null, source = null) {
    if (!this.db) return;
    const resolved = source ?? this.auditContext.getStore()?.source ?? 'desktop';
    this.db.run(
      'INSERT INTO audit_logs (ts, source, action, binding_id, skill_id, detail) VALUES (?, ?, ?, ?, ?, ?)',
      Date.now(),
      resolved,
      action,
      bindingId,
      skillId,
      detail,
    );
  }

  auditRows({ limit = 200, source = 'all', query = '' } = {}) {
    const clauses = [];
    const params = [];
    if (source === 'desktop' || source === 'web') {
      clauses.push('a.source = ?');
      params.push(source);
    }
    const keyword = String(query ?? '').trim();
    if (keyword) {
      const like = `%${keyword}%`;
      const parts = [
        's.display_name LIKE ?',
        's.slug LIKE ?',
        'a.action LIKE ?',
        'a.detail LIKE ?',
        'b.harness_id LIKE ?',
        'b.target_path LIKE ?',
        'p.name LIKE ?',
        'p.path LIKE ?',
      ];
      params.push(like, like, like, like, like, like, like, like);
      const matchedActions = Object.entries(AUDIT_ACTION_LABELS)
        .filter(([, label]) => label.includes(keyword))
        .map(([action]) => action);
      if (matchedActions.length > 0) {
        parts.push(`a.action IN (${matchedActions.map(() => '?').join(', ')})`);
        params.push(...matchedActions);
      }
      const matchedSources = Object.entries(AUDIT_SOURCE_LABELS)
        .filter(([, label]) => label.includes(keyword))
        .map(([key]) => key);
      if (matchedSources.length > 0) {
        parts.push(`a.source IN (${matchedSources.map(() => '?').join(', ')})`);
        params.push(...matchedSources);
      }
      const matchedHarnesses = this.config.harnesses
        .filter(
          (harness) =>
            harness.name.includes(keyword) ||
            String(harness.short_name ?? '').includes(keyword),
        )
        .map((harness) => harness.id);
      if (matchedHarnesses.length > 0) {
        parts.push(`b.harness_id IN (${matchedHarnesses.map(() => '?').join(', ')})`);
        params.push(...matchedHarnesses);
      }
      clauses.push(`(${parts.join(' OR ')})`);
    }
    const cap = Math.max(1, Math.min(Number(limit) || 200, 5000));
    const projectLookup = new Map();
    this.db.all('SELECT project_id, name, path FROM projects').forEach((project) => {
      projectLookup.set(project.project_id, project.name);
      projectLookup.set(project.path, project.name);
    });
    const rows = this.db.all(
      `SELECT a.id, a.ts, a.source, a.action, a.binding_id, a.skill_id, a.detail,
              s.slug AS skill_slug, s.display_name AS skill_name,
              b.harness_id, b.scope, b.target_path,
              p.project_id AS project_id, p.name AS project_name
         FROM audit_logs a
         LEFT JOIN skills s ON s.skill_id = a.skill_id
         LEFT JOIN bindings b ON b.binding_id = a.binding_id
         LEFT JOIN projects p ON p.project_id = b.project_id
        ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY a.id DESC
        LIMIT ?`,
      ...params,
      cap,
    );
    return rows.map((row) => {
      const harness = row.harness_id ? this.harness(row.harness_id) : null;
      const projectName =
        row.project_name ?? (row.detail ? (projectLookup.get(row.detail) ?? null) : null);
      return {
        id: row.id,
        ts: row.ts,
        source: row.source,
        sourceLabel: AUDIT_SOURCE_LABELS[row.source] ?? row.source,
        action: row.action,
        actionLabel: AUDIT_ACTION_LABELS[row.action] ?? row.action,
        detail: row.detail ?? '',
        skillId: row.skill_id ?? null,
        skillSlug: row.skill_slug ?? null,
        skillName: row.skill_name ?? null,
        harnessId: row.harness_id ?? null,
        harnessName: harness?.name ?? row.harness_id ?? null,
        scope: row.scope ?? null,
        scopeLabel:
          row.scope === 'project' ? '项目级' : row.scope === 'global' ? '全局' : null,
        projectId: row.project_id ?? null,
        projectName,
        targetPath: row.target_path ?? null,
        displayPath:
          row.scope === 'global' && harness && row.skill_slug
            ? `${harness.global_path.replace(/\/$/, '')}/${row.skill_slug}`
            : (row.target_path ?? null),
      };
    });
  }

  listAuditLogs(options) {
    return { ok: true, logs: this.auditRows(options) };
  }

  async exportAuditLogs({ format = 'json', path: destination, source = 'all', query = '' } = {}) {
    if (typeof destination !== 'string' || destination.trim() === '') {
      throw new EngineError('缺少导出路径', 'NO_PATH');
    }
    const logs = this.auditRows({ limit: 5000, source, query });
    const target = path.resolve(destination);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    if (format === 'csv') {
      const header = ['时间', '来源', '动作', '技能', '工具', '范围', '项目', '路径', '详情'];
      const lines = [header.join(',')];
      logs.forEach((log) => {
        lines.push(
          [
            auditStamp(log.ts),
            log.sourceLabel,
            log.actionLabel,
            log.skillName ?? log.skillSlug ?? '',
            log.harnessName ?? '',
            log.scopeLabel ?? '',
            log.projectName ?? '',
            log.displayPath ?? '',
            log.detail,
          ]
            .map(csvCell)
            .join(','),
        );
      });
      // BOM keeps Excel from mangling Chinese headers.
      await fsp.writeFile(target, `\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
    } else {
      const payload = {
        schema_version: 1,
        app: 'Quiver',
        exported_at: new Date().toISOString(),
        filters: { source, query: String(query ?? '').trim() },
        count: logs.length,
        logs,
      };
      await fsp.writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    }
    this.audit('export_audit_logs', null, null, target);
    return {
      ok: true,
      path: target,
      count: logs.length,
      message: '操作日志已导出',
      description: `${target}（${logs.length} 条）`,
    };
  }

  projectById(projectId) {
    if (!projectId) return null;
    return this.db.get('SELECT * FROM projects WHERE project_id = ?', projectId);
  }

  skillById(skillId) {
    return this.db.get('SELECT * FROM skills WHERE skill_id = ?', skillId);
  }

  async startWatcher() {
    this.stopWatcher();
    const chokidar = require('chokidar');
    const watched = [path.join(this.root, 'store'), path.join(this.root, 'available')];
    const projects = this.db.all('SELECT path FROM projects');
    this.config.harnesses.forEach((harness) => {
      harness.candidates
        .filter((candidate) => candidate.scope === 'global')
        .forEach((candidate) => {
          const base = this.globalBase(candidate);
          if (base) watched.push(base);
        });
    });
    this.config.harnesses.forEach((harness) => {
      harness.candidates
        .filter((candidate) => candidate.scope === 'project')
        .forEach((candidate) => {
          projects.forEach((project) => {
            watched.push(...collectProjectCandidateDirs(candidate, project.path));
          });
        });
    });
    projects.forEach((project) => {
      watched.push(project.path);
    });
    const unique = Array.from(new Set(watched));
    try {
      this.watcher = chokidar.watch(unique, {
        ignoreInitial: true,
        persistent: true,
        depth: 6,
        followSymlinks: false,
        ignored: (target) =>
          /(?:^|[\\/])(?:metadata\.db(?:-wal|-shm)?|staging)(?:[\\/]|$)/.test(target),
      });
      this.watcher.on('all', () => this.scheduleReconcile());
      this.watcher.on('error', () => {});
    } catch {
      this.watcher = null;
    }
  }

  stopWatcher() {
    if (this.watchTimer) {
      clearTimeout(this.watchTimer);
      this.watchTimer = null;
    }
    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    if (this.watcher) {
      const watcher = this.watcher;
      this.watcher = null;
      watcher.close().catch(() => {});
    }
  }

  startWatchdog() {
    this.stopWatchdog();
    this.watchdogTimer = setInterval(() => {
      void this.inspectProjects();
    }, WATCHDOG_INTERVAL);
    this.watchdogTimer.unref?.();
  }

  stopWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  pushNotice(notice) {
    this.notices.push(notice);
    if (this.notices.length > 20) this.notices.shift();
  }

  async reviveProject(project) {
    const bindings = this.db.all(
      'SELECT * FROM bindings WHERE project_id = ?',
      project.project_id,
    );
    let restored = 0;
    for (const binding of bindings) {
      const skill = this.skillById(binding.skill_id);
      if (!skill) continue;
      const existing = await lstatOrNull(binding.target_path).catch(() => null);
      if (existing) continue;
      try {
        await fsp.mkdir(path.dirname(binding.target_path), { recursive: true });
        const mounted = await mount(this, {
          slug: skill.slug,
          sha: binding.resolved_sha,
          syncMode: binding.sync_mode,
          targetPath: binding.target_path,
        });
        if (mounted.mode !== binding.sync_mode) {
          this.db.run(
            'UPDATE bindings SET sync_mode = ? WHERE binding_id = ?',
            mounted.mode,
            binding.binding_id,
          );
        }
        restored += 1;
      } catch (error) {
        if (error?.permission) this.notePermission(error.permission);
      }
    }
    return restored;
  }

  async handleProjectRevival(project) {
    const current = this.db.get(
      'SELECT missing FROM projects WHERE project_id = ?',
      project.project_id,
    );
    if (!current || current.missing !== 1) return 0;
    if (this.revivingProjects.has(project.project_id)) return 0;
    this.revivingProjects.add(project.project_id);
    try {
      const restored = await this.reviveProject(project);
      this.db.run(
        'UPDATE projects SET missing = 0, last_active = ? WHERE project_id = ?',
        Date.now(),
        project.project_id,
      );
      if (this.watcher) {
        try {
          this.watcher.add(project.path);
        } catch {
          /* watcher will be rebuilt on next openRoot */
        }
      }
      this.pushNotice({
        id: `project-revive-${project.project_id}-${Date.now()}`,
        kind: 'project_revive',
        message: `检测到项目 ${project.name} 路径已恢复，已自动同步技能绑定`,
        description:
          restored > 0 ? `已按原版本恢复 ${restored} 个技能入口。` : '项目目录已重新纳入监听。',
        createdAt: Date.now(),
      });
      this.audit('revive_project', null, null, project.path);
      return restored;
    } finally {
      this.revivingProjects.delete(project.project_id);
    }
  }

  async inspectProjects() {
    if (this.watchdogBusy || !this.db) return;
    this.watchdogBusy = true;
    try {
      let changed = false;
      const projects = this.db.all('SELECT * FROM projects');
      for (const project of projects) {
        const exists = fs.existsSync(project.path);
        if (!exists) {
          if (!project.missing) {
            this.db.run(
              'UPDATE projects SET missing = 1 WHERE project_id = ?',
              project.project_id,
            );
            changed = true;
          }
          continue;
        }
        if (!project.missing) continue;
        await this.handleProjectRevival(project);
        changed = true;
      }
      if (changed) {
        const result = await this.refresh();
        this.broadcast(result.snapshot);
      }
    } catch {
      /* the next tick retries */
    } finally {
      this.watchdogBusy = false;
    }
  }

  scheduleReconcile() {
    if (this.watchTimer) clearTimeout(this.watchTimer);
    this.watchTimer = setTimeout(() => {
      this.watchTimer = null;
      this.refresh()
        .then((result) => this.broadcast(result.snapshot))
        .catch(() => {});
    }, WATCH_DEBOUNCE);
  }

  broadcast(snapshot) {
    if (!snapshot) return;
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) window.webContents.send('engine:changed', snapshot);
    });
    this.webServer?.broadcast(snapshot);
  }

  async refresh() {
    await reconcile(this);
    await refreshDefaultSkillComments(this);
    const snapshot = await this.snapshot();
    return { ok: true, snapshot };
  }

  async snapshot() {
    const projectRows = this.db.all('SELECT * FROM projects ORDER BY created_at ASC');
    const projectMap = new Map(projectRows.map((project) => [project.project_id, project]));
    const configHarnesses = new Map(this.config.harnesses.map((item) => [item.id, item]));

    const bindingRows = this.db.all(
      'SELECT * FROM bindings ORDER BY deployed_at ASC, rowid ASC',
    );
    const bindingCandidateMap = new Map();
    const managedCounts = new Map();
    for (const binding of bindingRows) {
      const harness = configHarnesses.get(binding.harness_id);
      if (!harness) continue;
      const project = binding.project_id ? projectMap.get(binding.project_id) : null;
      if (binding.scope === 'project' && !project) continue;
      const candidate = this.candidateForTarget(harness, project, binding.target_path);
      bindingCandidateMap.set(binding.binding_id, candidate);
      if (!candidate || binding.state === 'orphaned') continue;
      const key = `${binding.harness_id}|${candidate.id}`;
      managedCounts.set(key, (managedCounts.get(key) ?? 0) + 1);
    }

    const harnesses = this.config.harnesses.map((harness) => {
      const candidates = sortCandidates(harness.candidates).map((candidate) =>
        this.candidateSnapshot(
          harness,
          candidate,
          projectRows,
          managedCounts.get(`${harness.id}|${candidate.id}`) ?? 0,
        ),
      );
      const defaults = defaultHarness(harness.id);
      const bindingCount = bindingRows.filter(
        (binding) => binding.harness_id === harness.id && binding.state !== 'orphaned',
      ).length;
      return {
        id: harness.id,
        name: harness.name,
        shortName: harness.short_name,
        command: harness.command,
        category: harness.category,
        categoryLabel: CATEGORY_LABELS[harness.category] ?? CATEGORY_LABELS.custom,
        isBuiltin: Boolean(harness.is_builtin),
        globalPath: harness.global_path,
        projectRelPath: harness.project_rel_path,
        physicalGlobalPath: this.globalRoot(harness),
        // A shared layer (~/.agents/skills) exists for every reader at once;
        // letting it mark each tool as detected would make "active" meaningless.
        detected:
          candidates.some((candidate) => candidate.exists && !candidate.shared) ||
          bindingCount > 0,
        managedCount: bindingCount,
        candidates,
        defaultCandidates: defaults
          ? sortCandidates(defaults.candidates).map((candidate) => ({
              id: candidate.id,
              path: candidate.path,
              scope: candidate.scope,
              role: candidate.role,
              discovery: candidate.discovery,
              priority: candidate.priority,
              label: candidate.label ?? '',
            }))
          : [],
      };
    });
    const harnessMap = new Map(harnesses.map((harness) => [harness.id, harness]));

    const versionRows = this.db.all(
      'SELECT * FROM skill_versions ORDER BY created_at DESC, version_sha ASC',
    );
    const versionsBySkill = new Map();
    versionRows.forEach((version) => {
      const list = versionsBySkill.get(version.skill_id) ?? [];
      list.push({
        sha: version.version_sha,
        createdAt: formatStamp(version.created_at),
        note: version.note ?? '',
      });
      versionsBySkill.set(version.skill_id, list);
    });

    const skills = this.db.all('SELECT * FROM skills ORDER BY rowid ASC').map((skill) => ({
      id: skill.skill_id,
      slug: skill.slug,
      displayName: skill.display_name,
      alias: skill.alias ?? undefined,
      comment: skill.comment ?? '',
      tags: safeJson(skill.tags),
      dependsOn: safeJson(skill.depends_on).filter((item) => typeof item === 'string'),
      sourceType: skill.source_type,
      sourceUri: skill.source_uri ?? '',
      activeSha: skill.active_sha ?? '',
      versions: versionsBySkill.get(skill.skill_id) ?? [],
      importedAt: formatStamp(skill.imported_at),
      isFavorite: Boolean(skill.is_favorite),
      readOnly: true,
    }));
    const skillMap = new Map(skills.map((skill) => [skill.id, skill]));

    const harnessBindings = new Map();
    bindingRows.forEach((binding) => {
      const list = harnessBindings.get(binding.project_id) ?? [];
      list.push(binding);
      harnessBindings.set(binding.project_id, list);
    });

    const bindings = bindingRows.map((binding) => {
      const skill = skillMap.get(binding.skill_id);
      const harness = harnessMap.get(binding.harness_id);
      const project = binding.project_id ? projectMap.get(binding.project_id) : null;
      const targetPath = binding.target_path;
      const candidate = bindingCandidateMap.get(binding.binding_id);
      const candidateView = candidate
        ? harness?.candidates.find((item) => item.id === candidate.id)
        : null;
      const displayPath =
        binding.scope === 'project' && project
          ? targetPath
          : candidateView
            ? `${candidateView.displayPath.replace(/\/$/, '')}/${skill?.slug ?? ''}`
            : harness
              ? `${harness.globalPath.replace(/\/$/, '')}/${skill?.slug ?? ''}`
              : targetPath;
      return {
        id: binding.binding_id,
        skillId: binding.skill_id,
        harnessId: binding.harness_id,
        scope: binding.scope,
        projectId: binding.project_id ?? undefined,
        displayPath,
        localRel: this.relFor(targetPath),
        realPath: targetPath,
        candidateId: candidate?.id ?? binding.candidate_id ?? undefined,
        candidatePath: candidate?.path ?? undefined,
        candidateRole: candidate?.role ?? undefined,
        candidateLabel: candidate ? roleLabel(candidate) : undefined,
        shared: Boolean(
          candidate && (candidate.role === 'shared' || isAgentsSharedPath(candidate.path)),
        ),
        state: binding.state,
        syncMode: binding.sync_mode,
        resolvedSha: binding.resolved_sha,
        currentSha: binding.current_sha ?? undefined,
        driftFiles: binding.drift_files ? safeJson(binding.drift_files) : undefined,
        ignoredDrift: Boolean(binding.ignored_drift),
        updateAvailable: binding.update_available ?? undefined,
        deployedAt: formatStamp(binding.deployed_at),
      };
    });

    const projects = projectRows.map((project) => {
      const specific = (harnessBindings.get(project.project_id) ?? []).map(
        (binding) => binding.harness_id,
      );
      const inherited = bindingRows
        .filter((binding) => binding.scope === 'global')
        .map((binding) => binding.harness_id);
      const harnessIds = Array.from(new Set([...specific, ...inherited])).filter((id) =>
        harnessMap.has(id),
      );
      return {
        id: project.project_id,
        name: project.name,
        path: project.path,
        realPath: project.path,
        localRel: this.relFor(project.path),
        harnesses: harnessIds,
        manifestExported: Boolean(project.manifest_exported),
        missing: Boolean(project.missing),
        lastActive: relativeLabel(project.last_active),
      };
    });

    const unmanaged = await scanUnmanaged(this);
    const web = this.webStatus();

    return {
      skills,
      bindings,
      projects,
      unmanaged,
      harnesses,
      notices: this.notices.slice(-12),
      permission: this.permissionIssue,
      settings: {
        mode: this.mode,
        editorCommand: this.config.editor_command,
        workRoot: this.root,
        availableRoot: path.join(this.root, 'available'),
        storeRoot: path.join(this.root, 'store', 'sha256'),
        homeDir: os.homedir(),
        sandboxRoot: this.sandboxRoot(),
        realRoot: this.realRoot(),
        trayOnClose: Boolean(this.config.tray_on_close),
        lastChecked: this.lastChecked.getTime(),
        web: {
          enabled: Boolean(this.config.web_enabled),
          port: this.config.web_port,
          url: web.url,
          lan: web.lan,
          lanUrls: web.lanUrls,
          lanAddresses: web.lanAddresses ?? [],
          token: this.config.web_token,
          running: web.running,
          error: web.error ?? undefined,
        },
      },
    };
  }

  async done(message, description, extra = {}) {
    await reconcile(this);
    return {
      ok: true,
      message,
      description,
      ...extra,
      snapshot: await this.snapshot(),
    };
  }

  async enable({ skillId, harnessIds, targets, scope, projectId, syncMode }) {
    const skill = this.skillById(skillId);
    if (!skill) throw new EngineError('技能不存在', 'NO_SKILL');
    const requested = [];
    if (Array.isArray(targets) && targets.length > 0) {
      for (const target of targets) {
        const harnessId = String(target?.harnessId ?? '').trim();
        if (!harnessId) continue;
        requested.push({
          harnessId,
          candidateId: target?.candidateId ? String(target.candidateId) : null,
        });
      }
    } else if (Array.isArray(harnessIds)) {
      for (const harnessId of harnessIds) {
        if (harnessId) requested.push({ harnessId: String(harnessId), candidateId: null });
      }
    }
    if (requested.length === 0) {
      throw new EngineError('请至少选择一个目标 Harness', 'NO_HARNESS');
    }
    const project = scope === 'project' ? this.projectById(projectId) : null;
    if (scope === 'project' && !project) throw new EngineError('请选择一个有效项目', 'NO_PROJECT');

    const created = [];
    const failed = [];
    const usedTargets = new Set();
    let fallbackCount = 0;
    let permissionIssue = null;

    for (const request of requested) {
      const harness = this.harness(request.harnessId);
      if (!harness) {
        failed.push(`${request.harnessId}：未配置该工具`);
        continue;
      }
      const candidate = request.candidateId
        ? findCandidate(harness, request.candidateId)
        : this.preferredCandidateFor(harness, scope, project);
      if (!candidate) {
        failed.push(`${harness.name}：没有可用的候选路径`);
        continue;
      }
      if (candidate.scope !== scope) {
        failed.push(`${harness.name}：候选路径作用域与请求不一致`);
        continue;
      }
      let targetPath;
      try {
        ({ targetPath } = resolveTarget(this, {
          harness,
          project,
          scope,
          slug: skill.slug,
          candidate,
        }));
      } catch (error) {
        failed.push(`${harness.name}：${error.message}`);
        continue;
      }
      const resolvedTarget = path.resolve(targetPath);
      if (usedTargets.has(resolvedTarget)) continue;
      usedTargets.add(resolvedTarget);
      const existing = this.db.get(
        'SELECT binding_id FROM bindings WHERE skill_id = ? AND target_path = ?',
        skillId,
        targetPath,
      );
      if (existing) continue;

      try {
        const stat = await lstatOrNull(targetPath);
        if (stat) {
          const real = await fsp.realpath(targetPath).catch(() => null);
          const managed =
            real &&
            (within(path.join(this.root, 'store'), real) ||
              within(path.join(this.root, 'available'), real));
          if (!stat.isSymbolicLink() || !managed) {
            throw new EngineError('目标目录已存在，请先处理该目录');
          }
          await removeEntry(targetPath);
        }
        const mounted = await mount(this, {
          slug: skill.slug,
          sha: skill.active_sha,
          syncMode: syncMode ?? 'link',
          targetPath,
          allowCopyFallback: false,
        });
        if (mounted.mode !== syncMode && mounted.fallbackReason) fallbackCount += 1;
        this.db.run(
          `INSERT INTO bindings (binding_id, skill_id, harness_id, scope, project_path, project_id, target_path, candidate_id, state, sync_mode, resolved_sha, current_sha, drift_files, ignored_drift, update_available, deployed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'enabled', ?, ?, NULL, NULL, 0, NULL, ?)`,
          uuid(),
          skillId,
          harness.id,
          scope,
          project?.path ?? '',
          project?.project_id ?? null,
          targetPath,
          candidate.id,
          mounted.mode,
          skill.active_sha,
          Date.now(),
        );
        created.push(harness.name);
      } catch (error) {
        if (error?.permission) permissionIssue = error.permission;
        else if (isPermissionError(error)) {
          permissionIssue = permissionFromError(error, targetPath);
        }
        failed.push(`${harness.name}：${error.message}`);
      }
    }

    this.audit('enable', null, skillId, `${created.join('、')} ${scope === 'global' ? '全局' : '项目'}`);
    if (created.length === 0) {
      throw new EngineError(failed[0] ?? '没有可启用的目标', 'ENABLE_FAILED', {
        permission: permissionIssue,
        suggestion: permissionIssue ? 'copy' : null,
      });
    }
    const fallbackNote = fallbackCount > 0 ? '部分目标因权限降级为副本模式。' : '';
    return this.done(
      `已启用 ${created.length} 处`,
      `${skill.slug} · ${created.join('、')}${failed.length > 0 ? `；失败：${failed.join('；')}` : ''}${fallbackNote}`,
      {
        warning: failed.length > 0,
        permission: permissionIssue,
        suggestion: permissionIssue ? 'copy' : null,
      },
    );
  }

  async disable(bindingId, mode = 'single') {
    const binding = this.db.get('SELECT * FROM bindings WHERE binding_id = ?', bindingId);
    if (!binding) throw new EngineError('绑定不存在', 'NO_BINDING');
    const skill = this.skillById(binding.skill_id);
    if (!skill) throw new EngineError('技能不存在', 'NO_SKILL');
    const shared = this.sharedReadersFor(binding);
    const readers = shared.readers;
    if (readers.length > 0 && mode !== 'split' && mode !== 'all') {
      throw new EngineError('该目录被多个工具共用，请选择解绑方式', 'SHARED_CONFIRM', {
        shared: {
          path: this.displayFor(path.dirname(binding.target_path)),
          readers,
        },
      });
    }
    try {
      await unmount(this, binding.target_path, {
        allowRecursive: binding.sync_mode === 'copy',
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    this.db.run('DELETE FROM bindings WHERE binding_id = ?', bindingId);

    const warnings = [];
    let remounted = 0;
    if (mode === 'split' && readers.length > 0) {
      const project = binding.scope === 'project' ? this.projectById(binding.project_id) : null;
      const sharedDir = path.resolve(path.dirname(binding.target_path));
      for (const reader of readers) {
        const harness = this.harness(reader.harnessId);
        if (!harness) continue;
        const alternatives = sortCandidates(harness.candidates).filter((candidate) => {
          if (candidate.scope !== binding.scope) return false;
          const base = this.candidateBase(harness, candidate, project);
          return !base || path.resolve(base) !== sharedDir;
        });
        const candidate =
          alternatives.find((item) => item.role === 'primary') ?? alternatives[0];
        if (!candidate) {
          warnings.push(`${harness.name}：没有共享目录之外的首选路径，已跳过`);
          continue;
        }
        let targetPath;
        try {
          ({ targetPath } = resolveTarget(this, {
            harness,
            project,
            scope: binding.scope,
            slug: skill.slug,
            candidate,
          }));
        } catch (error) {
          warnings.push(`${harness.name}：${error.message}`);
          continue;
        }
        const existing = this.db.get(
          'SELECT binding_id FROM bindings WHERE skill_id = ? AND target_path = ?',
          skill.skill_id,
          targetPath,
        );
        if (existing) continue;
        try {
          const stat = await lstatOrNull(targetPath);
          if (stat) {
            const real = await fsp.realpath(targetPath).catch(() => null);
            const managed =
              real &&
              (within(path.join(this.root, 'store'), real) ||
                within(path.join(this.root, 'available'), real));
            if (!stat.isSymbolicLink() || !managed) {
              throw new EngineError('目标目录已存在，已跳过');
            }
            await removeEntry(targetPath);
          }
          await mount(this, {
            slug: skill.slug,
            sha: binding.resolved_sha,
            syncMode: binding.sync_mode,
            targetPath,
          });
          this.db.run(
            `INSERT INTO bindings (binding_id, skill_id, harness_id, scope, project_path, project_id, target_path, candidate_id, state, sync_mode, resolved_sha, current_sha, drift_files, ignored_drift, update_available, deployed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'enabled', ?, ?, NULL, NULL, 0, NULL, ?)`,
            uuid(),
            skill.skill_id,
            harness.id,
            binding.scope,
            project?.path ?? '',
            project?.project_id ?? null,
            targetPath,
            candidate.id,
            binding.sync_mode,
            binding.resolved_sha,
            Date.now(),
          );
          remounted += 1;
        } catch (error) {
          warnings.push(`${harness.name}：${error.message}`);
        }
      }
    }

    this.audit(
      mode === 'split' ? 'disable_split' : mode === 'all' ? 'disable_shared' : 'disable',
      bindingId,
      binding.skill_id,
      `${skill.slug}${
        readers.length > 0
          ? ` · ${mode === 'split' ? '智能拆分' : '彻底移除'}`
          : ''
      }`,
    );
    if (mode === 'split' && readers.length > 0) {
      return this.done(
        '已在当前工具停用',
        `共享入口已移除，并向 ${remounted} 个其他活跃工具重新部署${
          warnings.length > 0 ? `；${warnings.join('；')}` : ''
        }`,
        { warning: warnings.length > 0 },
      );
    }
    if (mode === 'all' && readers.length > 0) {
      return this.done(
        '已从共享目录彻底移除',
        `${skill.slug} 的共享入口已删除，${readers.length} 个共用工具将不再看到该技能。`,
      );
    }
    return this.done('绑定已禁用', `${skill.slug} 的入口已移除，中央库源文件未被改动。`);
  }

  checkDisableImpact(bindingId) {
    const binding = this.db.get('SELECT * FROM bindings WHERE binding_id = ?', bindingId);
    if (!binding) throw new EngineError('绑定不存在', 'NO_BINDING');
    const skill = this.skillById(binding.skill_id);
    if (!skill) throw new EngineError('技能不存在', 'NO_SKILL');

    const rows = this.db.all(
      `SELECT b.binding_id, b.skill_id, b.harness_id, b.scope, b.project_id, b.state,
              s.slug, s.display_name, s.depends_on
         FROM bindings b
         JOIN skills s ON s.skill_id = b.skill_id
        WHERE b.binding_id != ?
          AND b.state IN ('enabled', 'drifted')`,
      bindingId,
    );
    const inScope = rows.filter((row) => {
      if (binding.scope === 'global') return row.scope === 'global';
      return (
        row.scope === 'global' ||
        (row.scope === 'project' && row.project_id === binding.project_id)
      );
    });

    const dependents = [];
    inScope.forEach((row) => {
      const dependencies = safeJson(row.depends_on);
      if (!dependencies.includes(skill.slug)) return;
      const harness = this.harness(row.harness_id);
      const project = row.project_id ? this.projectById(row.project_id) : null;
      dependents.push({
        bindingId: row.binding_id,
        skillId: row.skill_id,
        skillSlug: row.slug,
        skillName: row.display_name,
        harnessId: row.harness_id,
        harnessName: harness?.name ?? row.harness_id,
        scope: row.scope,
        scopeLabel: row.scope === 'project' ? '项目级' : '全局',
        state: row.state,
        projectId: row.project_id ?? null,
        projectName: project?.name ?? null,
      });
    });

    const shared = this.sharedReadersFor(binding);
    return {
      ok: true,
      bindingId,
      skill: {
        id: skill.skill_id,
        slug: skill.slug,
        displayName: skill.display_name,
      },
      dependents,
      shared: {
        active: shared.readers.length > 0,
        path: this.displayFor(path.dirname(binding.target_path)),
        candidateId: shared.candidate?.id ?? null,
        candidatePath: shared.candidate?.path ?? null,
        candidateRole: shared.candidate?.role ?? null,
        candidateRoleLabel: shared.candidate ? roleLabel(shared.candidate) : null,
        canSplit: shared.readers.length > 0,
        readers: shared.readers,
      },
    };
  }

  async convertToCopy(bindingId) {
    const binding = this.db.get('SELECT * FROM bindings WHERE binding_id = ?', bindingId);
    if (!binding) throw new EngineError('绑定不存在', 'NO_BINDING');
    if (binding.sync_mode === 'copy') {
      return this.done('已经是本地副本', '目标目录可独立修改。');
    }
    const skill = this.skillById(binding.skill_id);
    if (!skill) throw new EngineError('技能不存在', 'NO_SKILL');
    const sha = binding.resolved_sha || skill.active_sha;
    const stat = await lstatOrNull(binding.target_path);
    if (stat && !stat.isSymbolicLink()) {
      throw new EngineError(
        '目标路径已被真实目录占用，无法转为副本；请先移除该目录或重新启用。',
        'TARGET_EXISTS',
      );
    }
    await copyVersion(this, sha, binding.target_path);
    this.db.run(
      "UPDATE bindings SET sync_mode = 'copy', state = 'enabled', ignored_drift = 0, current_sha = NULL, drift_files = NULL, update_available = NULL WHERE binding_id = ?",
      bindingId,
    );
    this.audit('convert_copy', bindingId, binding.skill_id, skill?.slug);
    return this.done('已转为本地副本', '目标目录现在可写，修改会被识别为本地分叉。');
  }

  async updateBinding(bindingId) {
    const binding = this.db.get('SELECT * FROM bindings WHERE binding_id = ?', bindingId);
    if (!binding) throw new EngineError('绑定不存在', 'NO_BINDING');
    const skill = this.skillById(binding.skill_id);
    if (!skill) throw new EngineError('技能不存在', 'NO_SKILL');
    const nextSha = skill.active_sha;
    const stat = await lstatOrNull(binding.target_path);
    if (stat) {
      await removeEntry(binding.target_path, { recursive: !stat.isSymbolicLink() });
      await mount(this, {
        slug: skill.slug,
        sha: nextSha,
        syncMode: binding.sync_mode,
        targetPath: binding.target_path,
      });
    }
    this.db.run(
      `UPDATE bindings SET resolved_sha = ?, update_available = NULL, current_sha = NULL, drift_files = NULL, ignored_drift = 0, state = 'enabled' WHERE binding_id = ?`,
      nextSha,
      bindingId,
    );
    this.audit('update', bindingId, binding.skill_id, shortSha(nextSha));
    return this.done(
      `已更新到 @${shortSha(nextSha)}`,
      '目标视图已按技能库当前激活版本重新部署。',
    );
  }

  async resetBinding(bindingId) {
    const binding = this.db.get('SELECT * FROM bindings WHERE binding_id = ?', bindingId);
    if (!binding) throw new EngineError('绑定不存在', 'NO_BINDING');
    const skill = this.skillById(binding.skill_id);
    if (!skill) throw new EngineError('技能不存在', 'NO_SKILL');
    const sha = binding.resolved_sha || skill.active_sha;
    const stat = await lstatOrNull(binding.target_path);
    if (stat) {
      if (binding.sync_mode === 'link' && !stat.isSymbolicLink()) {
        throw new EngineError(
          '目标路径已被真实目录占用，未自动删除；请先处理该目录后再恢复。',
          'TARGET_EXISTS',
        );
      }
      await removeEntry(binding.target_path, { recursive: !stat.isSymbolicLink() });
    }
    await mount(this, {
      slug: skill.slug,
      sha,
      syncMode: binding.sync_mode,
      targetPath: binding.target_path,
    });
    this.db.run(
      `UPDATE bindings SET state = 'enabled', current_sha = NULL, drift_files = NULL, ignored_drift = 0 WHERE binding_id = ?`,
      bindingId,
    );
    this.audit('reset', bindingId, binding.skill_id, shortSha(sha));
    return this.done(
      '已从技能库恢复',
      `目标目录已回到 @${shortSha(sha)}，本地修改被丢弃。`,
    );
  }

  async redeployBinding(bindingId) {
    return this.resetBinding(bindingId);
  }

  async adoptBinding(bindingId) {
    const binding = this.db.get('SELECT * FROM bindings WHERE binding_id = ?', bindingId);
    if (!binding) throw new EngineError('绑定不存在', 'NO_BINDING');
    if (binding.sync_mode === 'link') {
      throw new EngineError('链接模式直接指向中央库，没有可收编的本地修改', 'LINK_ADOPT');
    }
    const skill = this.skillById(binding.skill_id);
    if (!skill) throw new EngineError('技能不存在', 'NO_SKILL');
    await assertImportable(binding.target_path);
    const result = await importDirectory(this, binding.target_path, {
      slug: skill.slug,
      note: '从本地修改收编',
    });
    this.db.run(
      `UPDATE bindings SET resolved_sha = ?, state = 'enabled', current_sha = NULL, drift_files = NULL, ignored_drift = 0, update_available = NULL WHERE binding_id = ?`,
      result.versionSha,
      bindingId,
    );
    this.audit('adopt', bindingId, binding.skill_id, result.versionSha);
    return this.done(
      '更改已保存回技能库',
      `${skill.slug}@${shortSha(result.versionSha)} 已写入只读中央库并成为激活版本。`,
    );
  }

  async ignoreDrift(bindingId) {
    const binding = this.db.get('SELECT * FROM bindings WHERE binding_id = ?', bindingId);
    if (!binding) throw new EngineError('绑定不存在', 'NO_BINDING');
    this.db.run('UPDATE bindings SET ignored_drift = 1 WHERE binding_id = ?', bindingId);
    this.audit('ignore_drift', bindingId, binding.skill_id);
    return this.done('已保留本地修改', '分叉仍被记录，但不再高亮提醒。');
  }

  async switchVersion(skillId, sha) {
    const skill = this.skillById(skillId);
    if (!skill) throw new EngineError('技能不存在', 'NO_SKILL');
    const version = this.db.get(
      'SELECT * FROM skill_versions WHERE version_sha = ? AND skill_id = ?',
      sha,
      skillId,
    );
    if (!version) throw new EngineError('版本不存在', 'NO_VERSION');
    await ensureAvailableLink(this, skill.slug, sha);
    this.db.run('UPDATE skills SET active_sha = ? WHERE skill_id = ?', sha, skillId);
    const bindings = this.db.all(
      'SELECT * FROM bindings WHERE skill_id = ?',
      skillId,
    );
    for (const binding of bindings) {
      if (binding.sync_mode !== 'link') continue;
      const stat = await lstatOrNull(binding.target_path);
      if (stat) {
        await removeEntry(binding.target_path, { recursive: !stat.isSymbolicLink() });
        await mount(this, {
          slug: skill.slug,
          sha,
          syncMode: 'link',
          targetPath: binding.target_path,
        });
      }
      this.db.run(
        'UPDATE bindings SET resolved_sha = ?, current_sha = NULL, drift_files = NULL, ignored_drift = 0 WHERE binding_id = ?',
        sha,
        binding.binding_id,
      );
    }
    this.audit('switch_version', null, skillId, sha);
    return this.done(
      `已切换激活版本 @${shortSha(sha)}`,
      `${skill.slug} 的链接型绑定已同步指向新版本；副本模式会提示可更新。`,
    );
  }

  async adoptUnmanagedTarget(target, mode) {
    const existing = this.db.get('SELECT * FROM skills WHERE slug = ?', target.name);
    const result = await importDirectory(this, target.fsPath, {
      slug: existing?.slug ?? target.name,
      displayName: existing?.display_name ?? target.name,
      alias: existing?.alias ?? undefined,
      fallbackComment: DEFAULT_ADOPT_COMMENT,
      tags: ['外部', '本地'],
      sourceType: 'local',
      sourceUri: target.fsPath,
      note: mode === 'adopt' ? '从外部目录收编' : '原地登记',
    });

    if (mode === 'adopt') {
      const stat = await lstatOrNull(target.fsPath);
      if (stat) await removeEntry(target.fsPath, { recursive: !stat.isSymbolicLink() });
      try {
        await mount(this, {
          slug: result.slug,
          sha: result.versionSha,
          syncMode: 'link',
          targetPath: target.fsPath,
        });
      } catch {
        await copyVersion(this, result.versionSha, target.fsPath).catch(() => {});
      }
    }

    const scope = target.scope === 'project' ? 'project' : 'global';
    const project =
      scope === 'project' && target.projectId
        ? this.projectById(target.projectId)
        : null;
    const candidate = this.candidateForTarget(
      this.harness(target.harnessId),
      project,
      target.fsPath,
    );
    const existingBinding = this.db.get(
      'SELECT binding_id FROM bindings WHERE skill_id = ? AND target_path = ?',
      result.skillId,
      target.fsPath,
    );
    if (!existingBinding) {
      this.db.run(
        `INSERT INTO bindings (binding_id, skill_id, harness_id, scope, project_path, project_id, target_path, candidate_id, state, sync_mode, resolved_sha, current_sha, drift_files, ignored_drift, update_available, deployed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'enabled', ?, ?, NULL, NULL, 0, NULL, ?)`,
        uuid(),
        result.skillId,
        target.harnessId,
        scope,
        project?.path ?? '',
        project?.project_id ?? null,
        target.fsPath,
        candidate?.id ?? null,
        mode === 'adopt' ? 'link' : 'copy',
        result.versionSha,
        Date.now(),
      );
    }
    this.audit(
      mode === 'adopt' ? 'adopt_unmanaged' : 'register_unmanaged',
      null,
      result.skillId,
      target.fsPath,
    );
    return { target, result };
  }

  async adoptUnmanaged(id, mode) {
    if (mode !== 'adopt' && mode !== 'register') {
      throw new EngineError('未知的收编方式', 'BAD_ADOPT_MODE');
    }
    const current = await scanUnmanaged(this);
    const target = current.find((item) => item.id === id);
    if (!target) throw new EngineError('外部技能不存在或已被处理', 'NO_UNMANAGED');
    const harness = this.harness(target.harnessId);
    if (!harness) throw new EngineError('Harness 未配置', 'NO_HARNESS');

    const { result } = await this.adoptUnmanagedTarget(target, mode);
    return this.done(
      mode === 'adopt' ? '已收编到技能库' : '已原地登记',
      mode === 'adopt'
        ? `${result.slug} 已写入中央库，原目录替换为链接入口。`
        : `${result.slug} 现在由 Quiver 跟踪，物理文件保持原位。`,
    );
  }

  async adoptUnmanagedBatch(ids, mode) {
    if (mode !== 'adopt' && mode !== 'register') {
      throw new EngineError('未知的收编方式', 'BAD_ADOPT_MODE');
    }
    const wanted = new Set(
      (Array.isArray(ids) ? ids : []).map((id) => String(id)).filter(Boolean),
    );
    if (wanted.size === 0) {
      throw new EngineError('请选择要处理的外部技能', 'NO_UNMANAGED');
    }
    const current = await scanUnmanaged(this);
    const targets = current.filter((item) => wanted.has(item.id));
    if (targets.length === 0) {
      throw new EngineError('所选外部技能不存在或已被处理', 'NO_UNMANAGED');
    }
    const failed = [];
    let succeeded = 0;
    for (const target of targets) {
      try {
        await this.adoptUnmanagedTarget(target, mode);
        succeeded += 1;
      } catch (error) {
        failed.push({
          name: target.name,
          error: error?.message ?? String(error),
        });
        if (error?.permission) this.notePermission(error.permission);
      }
    }
    this.audit(
      'adopt_unmanaged_batch',
      null,
      null,
      `${mode === 'adopt' ? '收编' : '登记'} ${succeeded}/${targets.length}`,
    );
    const verb = mode === 'adopt' ? '收编' : '登记';
    const message =
      failed.length > 0
        ? `已${verb} ${succeeded} 个，${failed.length} 个失败`
        : `已批量${verb} ${succeeded} 个外部技能`;
    const description =
      failed.length > 0
        ? `${failed
            .slice(0, 3)
            .map((item) => `${item.name}：${item.error}`)
            .join('；')}${failed.length > 3 ? '…' : ''}`
        : mode === 'adopt'
          ? '中央库已保存只读副本，原目录已替换为链接入口。'
          : '原目录与文件保持原位，已纳入受管清单。';
    return this.done(message, description, {
      warning: failed.length > 0,
      count: succeeded,
    });
  }

  async resyncSkillComment(skillId) {
    const skill = this.skillById(skillId);
    if (!skill) throw new EngineError('技能不存在', 'NO_SKILL');
    const description = await readStoredSkillDescription(this, skill.active_sha);
    if (!description) {
      throw new EngineError(
        '该版本的 SKILL.md 为空或没有可提取的简介',
        'NO_SKILL_DESCRIPTION',
      );
    }
    this.db.run(
      'UPDATE skills SET comment = ? WHERE skill_id = ?',
      description,
      skillId,
    );
    this.audit('resync_skill_comment', null, skillId, description.slice(0, 120));
    return this.done('简介已从 SKILL.md 重新同步', description);
  }

  async skillPreview(skillId, sha = null) {
    const skill = this.skillById(skillId);
    if (!skill) throw new EngineError('技能不存在', 'NO_SKILL');
    const targetSha = String(sha || skill.active_sha || '');
    const preview = await readSkillPreview(this, targetSha);
    if (!preview) {
      throw new EngineError('无法读取该版本的文件预览', 'STORE_UNREADABLE');
    }
    return { ok: true, preview };
  }

  async ignoreUnmanaged(id) {
    const current = await scanUnmanaged(this);
    const target = current.find((item) => item.id === id);
    if (!target) throw new EngineError('外部技能不存在或已被处理', 'NO_UNMANAGED');
    this.db.run(
      'INSERT OR IGNORE INTO ignored_unmanaged (path, harness_id, created_at) VALUES (?, ?, ?)',
      path.resolve(target.fsPath),
      target.harnessId,
      Date.now(),
    );
    this.audit('ignore_unmanaged', null, null, target.fsPath);
    return this.done('已忽略外部技能', '该目录不再出现在外部技能列表中。');
  }

  async scanHarness(harnessId) {
    const harness = this.harness(harnessId);
    if (!harness) throw new EngineError('Harness 未配置', 'NO_HARNESS');
    await reconcile(this);
    const unmanaged = await scanUnmanaged(this);
    const managed = this.db.get(
      "SELECT COUNT(*) AS count FROM bindings WHERE harness_id = ? AND scope = 'global' AND state != 'orphaned'",
      harnessId,
    );
    const external = unmanaged.filter((item) => item.harnessId === harnessId).length;
    this.audit('scan_harness', null, null, harnessId);
    return {
      ok: true,
      message: `${harness.name} 扫描完成`,
      description: `${managed?.count ?? 0} 个已管理绑定 · ${external} 个外部技能`,
      snapshot: await this.snapshot(),
    };
  }

  async addProject(folderPath) {
    const chosen = path.resolve(folderPath);
    let projectPath;
    if (this.mode === 'sandbox') {
      const base = sanitizeSlug(path.basename(chosen)) || `project-${Date.now()}`;
      let candidate = path.join(this.root, 'projects', base);
      let index = 2;
      while (await fsp.stat(candidate).catch(() => null)) {
        candidate = path.join(this.root, 'projects', `${base}-${index}`);
        index += 1;
      }
      projectPath = candidate;
      await fsp.mkdir(projectPath, { recursive: true });
    } else {
      const stat = await fsp.stat(chosen).catch(() => null);
      if (!stat?.isDirectory()) throw new EngineError('所选路径不是目录', 'BAD_PROJECT');
      projectPath = chosen;
    }
    const existing = this.db.get('SELECT * FROM projects WHERE path = ?', projectPath);
    if (existing) throw new EngineError('该目录已在项目列表中', 'PROJECT_EXISTS');
    const projectId = sanitizeSlug(path.basename(projectPath)) || uuid();
    const finalId = this.db.get('SELECT 1 FROM projects WHERE project_id = ?', projectId)
      ? `${projectId}-${Date.now().toString(36)}`
      : projectId;
    this.db.run(
      'INSERT INTO projects (project_id, name, path, missing, manifest_exported, last_active, created_at) VALUES (?, ?, ?, 0, 0, ?, ?)',
      finalId,
      path.basename(projectPath),
      projectPath,
      Date.now(),
      Date.now(),
    );
    this.audit('add_project', null, null, projectPath);
    await this.startWatcher();
    return this.done(
      '项目已添加',
      this.mode === 'sandbox' ? `演示沙盒内已创建镜像目录：${projectPath}` : projectPath,
    );
  }

  async relocateProject(projectId, folderPath) {
    const project = this.projectById(projectId);
    if (!project) throw new EngineError('项目不存在', 'NO_PROJECT');
    const chosen = path.resolve(folderPath);
    let nextPath;
    if (this.mode === 'sandbox') {
      nextPath = path.join(this.root, 'projects', sanitizeSlug(path.basename(chosen)));
      await fsp.mkdir(nextPath, { recursive: true });
    } else {
      const stat = await fsp.stat(chosen).catch(() => null);
      if (!stat?.isDirectory()) throw new EngineError('所选路径不是目录', 'BAD_PROJECT');
      nextPath = chosen;
    }
    this.db.run(
      'UPDATE projects SET path = ?, missing = 0, last_active = ? WHERE project_id = ?',
      nextPath,
      Date.now(),
      projectId,
    );
    const bindings = this.db.all('SELECT * FROM bindings WHERE project_id = ?', projectId);
    for (const binding of bindings) {
      const harness = this.harness(binding.harness_id);
      const skill = this.skillById(binding.skill_id);
      if (!harness || !skill) continue;
      const stat = await lstatOrNull(binding.target_path);
      if (stat) {
        await removeEntry(binding.target_path, { recursive: !stat.isSymbolicLink() }).catch(
          () => {},
        );
      }
      const { targetPath } = resolveTarget(this, {
        harness,
        project: { ...project, path: nextPath },
        scope: 'project',
        slug: skill.slug,
      });
      this.db.run(
        'UPDATE bindings SET project_path = ?, target_path = ? WHERE binding_id = ?',
        nextPath,
        targetPath,
        binding.binding_id,
      );
      try {
        await mount(this, {
          slug: skill.slug,
          sha: binding.resolved_sha,
          syncMode: binding.sync_mode,
          targetPath,
        });
      } catch {
        this.db.run(
          "UPDATE bindings SET state = 'missing' WHERE binding_id = ?",
          binding.binding_id,
        );
      }
    }
    this.audit('relocate_project', null, null, nextPath);
    await this.startWatcher();
    return this.done('项目路径已更新', nextPath);
  }

  async cleanProject(projectId) {
    const project = this.projectById(projectId);
    if (!project) throw new EngineError('项目不存在', 'NO_PROJECT');
    const bindings = this.db.all('SELECT * FROM bindings WHERE project_id = ?', projectId);
    for (const binding of bindings) {
      await unmount(this, binding.target_path, {
        allowRecursive: binding.sync_mode === 'copy',
      }).catch(() => {});
    }
    this.db.run('DELETE FROM bindings WHERE project_id = ?', projectId);
    this.db.run('DELETE FROM projects WHERE project_id = ?', projectId);
    this.audit('clean_project', null, null, project.path);
    return this.done('孤儿项目记录已清理', `${project.name} 的绑定记录已移除。`);
  }

  async convertToProjectOnly(skillId, projectId) {
    const skill = this.skillById(skillId);
    const project = this.projectById(projectId);
    if (!skill) throw new EngineError('技能不存在', 'NO_SKILL');
    if (!project) throw new EngineError('项目不存在', 'NO_PROJECT');
    const globals = this.db.all(
      "SELECT * FROM bindings WHERE skill_id = ? AND scope = 'global'",
      skillId,
    );
    let moved = 0;
    for (const binding of globals) {
      const harness = this.harness(binding.harness_id);
      if (!harness) continue;
      const existing = this.db.get(
        'SELECT 1 FROM bindings WHERE skill_id = ? AND harness_id = ? AND scope = ? AND project_path = ?',
        skillId,
        binding.harness_id,
        'project',
        project.path,
      );
      await unmount(this, binding.target_path, {
        allowRecursive: binding.sync_mode === 'copy',
      }).catch(() => {});
      this.db.run('DELETE FROM bindings WHERE binding_id = ?', binding.binding_id);
      if (existing) continue;
      const { targetPath } = resolveTarget(this, {
        harness,
        project,
        scope: 'project',
        slug: skill.slug,
      });
      try {
        await mount(this, {
          slug: skill.slug,
          sha: binding.resolved_sha,
          syncMode: 'link',
          targetPath,
        });
        this.db.run(
          `INSERT INTO bindings (binding_id, skill_id, harness_id, scope, project_path, project_id, target_path, state, sync_mode, resolved_sha, current_sha, drift_files, ignored_drift, update_available, deployed_at)
           VALUES (?, ?, ?, 'project', ?, ?, ?, 'enabled', 'link', ?, NULL, NULL, 0, NULL, ?)`,
          uuid(),
          skillId,
          binding.harness_id,
          project.path,
          projectId,
          targetPath,
          binding.resolved_sha,
          Date.now(),
        );
        moved += 1;
      } catch {
        /* target conflicts are reported by reconcile */
      }
    }
    this.audit('convert_project_only', null, skillId, projectId);
    return this.done(
      '已转为仅项目启用',
      `${skill.slug} 的全局入口已移除，改为在 ${project.name} 内生效。`,
    );
  }

  async editSkill(skillId, patch) {
    const skill = this.skillById(skillId);
    if (!skill) throw new EngineError('技能不存在', 'NO_SKILL');
    const tagList = Array.isArray(patch?.tags)
      ? patch.tags.map((tag) => String(tag).trim()).filter(Boolean)
      : safeJson(skill.tags);
    const dependsOn = Array.isArray(patch?.dependsOn)
      ? Array.from(
          new Set(
            patch.dependsOn
              .map((item) => String(item).trim())
              .filter(
                (item) =>
                  item &&
                  item !== skill.slug &&
                  /^[\p{L}\p{N}._-]+$/u.test(item) &&
                  this.db.get('SELECT 1 FROM skills WHERE slug = ?', item),
              ),
          ),
        ).slice(0, 40)
      : safeJson(skill.depends_on);
    this.db.run(
      'UPDATE skills SET display_name = ?, alias = ?, comment = ?, tags = ?, depends_on = ? WHERE skill_id = ?',
      String(patch?.displayName ?? skill.display_name).trim() || skill.display_name,
      patch?.alias ? String(patch.alias).trim() : null,
      String(patch?.comment ?? skill.comment ?? '').trim() || null,
      JSON.stringify(tagList),
      JSON.stringify(dependsOn),
      skillId,
    );
    this.audit('edit_skill', null, skillId);
    return this.done('技能信息已更新', skill.slug);
  }

  async deleteSkill(skillId) {
    const skill = this.skillById(skillId);
    if (!skill) throw new EngineError('技能不存在', 'NO_SKILL');
    const bindings = this.db.all('SELECT * FROM bindings WHERE skill_id = ?', skillId);
    for (const binding of bindings) {
      await unmount(this, binding.target_path, {
        allowRecursive: binding.sync_mode === 'copy',
      }).catch(() => {});
    }
    this.db.run('DELETE FROM bindings WHERE skill_id = ?', skillId);
    const versions = this.db.all(
      'SELECT version_sha FROM skill_versions WHERE skill_id = ?',
      skillId,
    );
    for (const version of versions) {
      const link = path.join(
        this.root,
        'available',
        `${skill.slug}@${shortSha(version.version_sha)}`,
      );
      await removeEntry(link).catch(() => {});
    }
    this.db.run('DELETE FROM skill_versions WHERE skill_id = ?', skillId);
    this.db.run('DELETE FROM skills WHERE skill_id = ?', skillId);
    this.audit('delete_skill', null, skillId, skill.slug);
    return this.done(
      '技能已删除',
      `${skill.slug} 的绑定入口与版本记录已移除，中央库内容按内容寻址保留。`,
    );
  }

  async importLocal(folderPath) {
    const result = await importDirectory(this, folderPath, {
      slug: sanitizeSlug(path.basename(folderPath)),
      displayName: path.basename(folderPath),
      tags: ['本地'],
      sourceType: 'local',
      sourceUri: path.resolve(folderPath),
      note: '本地目录导入',
    });
    return this.done('技能已入库', `${result.slug}@${shortSha(result.versionSha)}（只读中央库）`);
  }

  async importGitRepo(url) {
    const result = await importGit(this, url);
    return this.done('Git 技能已入库', `${result.slug}@${shortSha(result.versionSha)}`);
  }

  async importBackupFile(file) {
    const result = await importBackup(this, file);
    const skipped = result.skipped.length;
    return this.done(
      '备份包已导入',
      `共恢复 ${result.skills} 个技能 · ${result.versions} 个版本 · ${result.bindings} 个全局绑定${
        skipped > 0 ? `（${skipped} 项跳过）` : ''
      }`,
      { warning: skipped > 0 },
    );
  }

  async exportBackupTo(file) {
    const result = await exportBackup(this, file);
    return this.done(
      '备份包已导出',
      `${result.path}（${result.skills} 个技能 · ${result.bindings} 个全局绑定）`,
    );
  }

  async exportProject(projectId) {
    const project = this.projectById(projectId);
    if (!project) throw new EngineError('项目不存在', 'NO_PROJECT');
    if (!(await fsp.stat(project.path).catch(() => null))) {
      throw new EngineError('项目目录不存在，无法导出配置', 'PROJECT_MISSING');
    }
    const bindings = this.db.all(
      "SELECT * FROM bindings WHERE project_id = ? AND state != 'orphaned'",
      projectId,
    );
    const payload = {
      schema_version: 1,
      app: 'Quiver',
      project: project.name,
      generated_at: new Date().toISOString(),
      mode: 'partial',
      bindings: bindings.map((binding) => {
        const skill = this.skillById(binding.skill_id);
        const harness = this.harness(binding.harness_id);
        return {
          slug: skill?.slug,
          skill_id: binding.skill_id,
          harness_id: binding.harness_id,
          scope: binding.scope,
          target_path: harness
            ? `${harness.project_rel_path.replace(/\/$/, '')}/${skill?.slug ?? ''}`
            : binding.target_path,
          sync_mode: binding.sync_mode,
          resolved_sha: binding.resolved_sha,
        };
      }),
    };
    const dir = path.join(project.path, '.quiver');
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'manifest.json');
    await fsp.writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    this.db.run(
      'UPDATE projects SET manifest_exported = 1 WHERE project_id = ?',
      projectId,
    );
    this.audit('export_project', null, null, projectId);
    return this.done('项目配置已导出', file);
  }

  async restoreProject(projectId) {
    const project = this.projectById(projectId);
    if (!project) throw new EngineError('项目不存在', 'NO_PROJECT');
    const file = path.join(project.path, '.quiver', 'manifest.json');
    let payload;
    try {
      payload = JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch {
      throw new EngineError('项目还没有可用的 manifest.json', 'NO_MANIFEST');
    }
    if (payload?.schema_version !== 1 || !Array.isArray(payload.bindings)) {
      throw new EngineError('manifest.json 格式不受支持', 'BAD_MANIFEST');
    }
    const missingSkills = [];
    let restored = 0;
    for (const item of payload.bindings) {
      const skill = this.db.get('SELECT * FROM skills WHERE slug = ?', item.slug);
      const harness = this.harness(item.harness_id);
      if (!skill) {
        missingSkills.push(item.slug);
        continue;
      }
      if (!harness) continue;
      const existing = this.db.get(
        'SELECT * FROM bindings WHERE skill_id = ? AND harness_id = ? AND scope = ? AND project_path = ?',
        skill.skill_id,
        item.harness_id,
        'project',
        project.path,
      );
      if (existing) {
        const targetExists = await lstatOrNull(existing.target_path);
        if (!targetExists) {
          try {
            await mount(this, {
              slug: skill.slug,
              sha: skill.active_sha,
              syncMode: existing.sync_mode,
              targetPath: existing.target_path,
            });
            restored += 1;
          } catch {
            /* leave missing */
          }
        }
        continue;
      }
      const { targetPath } = resolveTarget(this, {
        harness,
        project,
        scope: 'project',
        slug: skill.slug,
      });
      const syncMode = item.sync_mode === 'copy' ? 'copy' : 'link';
      try {
        await mount(this, {
          slug: skill.slug,
          sha: skill.active_sha,
          syncMode,
          targetPath,
        });
        this.db.run(
          `INSERT INTO bindings (binding_id, skill_id, harness_id, scope, project_path, project_id, target_path, state, sync_mode, resolved_sha, current_sha, drift_files, ignored_drift, update_available, deployed_at)
           VALUES (?, ?, ?, 'project', ?, ?, ?, 'enabled', ?, ?, NULL, NULL, 0, NULL, ?)`,
          uuid(),
          skill.skill_id,
          item.harness_id,
          project.path,
          project.project_id,
          targetPath,
          syncMode,
          skill.active_sha,
          Date.now(),
        );
        restored += 1;
      } catch {
        /* report via missing count */
      }
    }
    this.audit('restore_project', null, null, projectId);
    return this.done(
      '项目配置已校验',
      missingSkills.length > 0
        ? `已恢复 ${restored} 个绑定；技能库缺少：${missingSkills.join('、')}`
        : `已恢复 ${restored} 个绑定。`,
      { warning: missingSkills.length > 0 },
    );
  }

  async saveHarnessConfig(patch) {
    const previous = this.config;
    const editorCommand = String(
      patch?.editorCommand ?? previous.editor_command ?? 'code',
    ).trim();
    if (!editorCommand) throw new EngineError('默认编辑器命令不能为空', 'BAD_EDITOR');

    const incoming = Array.isArray(patch?.harnesses) ? patch.harnesses : previous.harnesses;
    const merged = [];
    const seen = new Set();
    for (const item of incoming) {
      const id = sanitizeSlug(item?.id ?? item?.name ?? '');
      if (!id) continue;
      if (seen.has(id)) {
        throw new EngineError(`工具标识「${id}」重复，请修改后再保存`, 'DUPLICATE_HARNESS');
      }
      if (Array.isArray(item.candidates) && item.candidates.length === 0) {
        throw new EngineError('每个工具至少需要保留一个候选路径', 'BAD_HARNESS');
      }
      const normalized = normalizeHarness({ ...item, id });
      if (!normalized) continue;
      if (!normalized.command) {
        normalized.command = defaultHarness(id)?.command || normalized.name;
      }
      for (const candidate of normalized.candidates) {
        if (candidate.scope === 'project') {
          if (
            path.isAbsolute(candidate.path) ||
            candidate.path.split(/[\\/]/).includes('..')
          ) {
            throw new EngineError(
              `「${normalized.name}」的项目候选路径必须是安全的相对路径：${candidate.path}`,
              'BAD_HARNESS',
            );
          }
          continue;
        }
        const expanded = expandPath(candidate.path);
        if (expanded && !path.isAbsolute(expanded)) {
          throw new EngineError(
            `「${normalized.name}」的全局候选路径必须是绝对路径、~ 路径或环境变量：${candidate.path}`,
            'BAD_HARNESS',
          );
        }
      }
      if (!normalized.candidates.some((candidate) => candidate.scope === 'global')) {
        throw new EngineError(
          `「${normalized.name}」至少需要一个全局候选路径`,
          'BAD_HARNESS',
        );
      }
      seen.add(id);
      merged.push(normalized);
    }
    if (merged.length === 0) throw new EngineError('至少需要保留一个 Harness', 'NO_HARNESS');

    const oldById = new Map(previous.harnesses.map((item) => [item.id, item]));
    const newById = new Map(merged.map((item) => [item.id, item]));
    const removed = new Set(
      (Array.isArray(patch?.removedHarnesses) ? patch.removedHarnesses : []).map((item) =>
        String(item),
      ),
    );
    for (const old of previous.harnesses) {
      const next = newById.get(old.id);
      if (!next) {
        const activeBindings = this.db.all(
          "SELECT * FROM bindings WHERE harness_id = ? AND state != 'orphaned'",
          old.id,
        );
        if (activeBindings.length > 0) {
          throw new EngineError(
            `「${old.name}」仍有 ${activeBindings.length} 个生效绑定，请先在 Harness 视图停用后再删除该工具`,
            'HARNESS_IN_USE',
          );
        }
        this.db.run('DELETE FROM bindings WHERE harness_id = ?', old.id);
        if (old.is_builtin) removed.add(old.id);
        continue;
      }
      const nextCandidateIds = new Set(next.candidates.map((candidate) => candidate.id));
      for (const oldCandidate of old.candidates) {
        if (nextCandidateIds.has(oldCandidate.id)) continue;
        const activeBindings = this.db
          .all("SELECT * FROM bindings WHERE harness_id = ? AND state != 'orphaned'", old.id)
          .filter((binding) => {
            const project = binding.project_id
              ? this.projectById(binding.project_id)
              : null;
            const resolved = this.candidateForTarget(old, project, binding.target_path);
            return resolved?.id === oldCandidate.id;
          });
        if (activeBindings.length > 0) {
          throw new EngineError(
            `「${old.name}」的候选路径「${oldCandidate.path}」仍有 ${activeBindings.length} 个生效绑定，请先停用后再删除该候选路径`,
            'CANDIDATE_IN_USE',
          );
        }
      }
    }
    for (const harness of merged) removed.delete(harness.id);

    this.config = {
      ...previous,
      editor_command: editorCommand,
      harnesses: merged,
      removed_harnesses: Array.from(removed),
    };
    await saveConfig(path.join(this.root, 'config.toml'), this.config);
    this.candidateStatsCache.clear();

    let moved = 0;
    const warnings = [];
    const bindings = this.db.all('SELECT * FROM bindings');
    for (const binding of bindings) {
      const harness = newById.get(binding.harness_id);
      if (!harness) continue;
      const project = binding.project_id ? this.projectById(binding.project_id) : null;
      const skill = this.skillById(binding.skill_id);
      if (!skill) continue;
      let candidate = binding.candidate_id
        ? findCandidate(harness, binding.candidate_id)
        : null;
      if (!candidate) {
        const oldHarness = oldById.get(binding.harness_id);
        const oldCandidate = oldHarness
          ? this.candidateForTarget(oldHarness, project, binding.target_path)
          : null;
        candidate = oldCandidate
          ? findCandidate(harness, oldCandidate.id)
          : this.candidateForTarget(harness, project, binding.target_path);
      }
      if (!candidate) {
        candidate = this.preferredCandidateFor(harness, binding.scope, project);
      }
      if (!candidate || candidate.scope !== binding.scope) {
        warnings.push(`${skill.slug}：找不到匹配的候选路径`);
        continue;
      }
      if (binding.state === 'orphaned') {
        this.db.run(
          'UPDATE bindings SET candidate_id = ? WHERE binding_id = ?',
          candidate.id,
          binding.binding_id,
        );
        continue;
      }
      let targetPath;
      try {
        ({ targetPath } = resolveTarget(this, {
          harness,
          project,
          scope: binding.scope,
          slug: skill.slug,
          candidate,
        }));
      } catch (error) {
        warnings.push(`${skill.slug}：${error.message}`);
        continue;
      }
      if (path.resolve(targetPath) === path.resolve(binding.target_path)) {
        this.db.run(
          'UPDATE bindings SET candidate_id = ? WHERE binding_id = ?',
          candidate.id,
          binding.binding_id,
        );
        continue;
      }
      const oldStat = await lstatOrNull(binding.target_path);
      let movedContent = false;
      if (binding.sync_mode === 'copy' && oldStat && !oldStat.isSymbolicLink()) {
        try {
          await fsp.mkdir(path.dirname(targetPath), { recursive: true });
          await fsp.rename(binding.target_path, targetPath);
          movedContent = true;
        } catch {
          movedContent = false;
        }
      }
      if (!movedContent) {
        if (oldStat) {
          await removeEntry(binding.target_path, {
            recursive: !oldStat.isSymbolicLink(),
          }).catch(() => {});
        }
        try {
          await mount(this, {
            slug: skill.slug,
            sha: binding.resolved_sha,
            syncMode: binding.sync_mode,
            targetPath,
          });
        } catch (error) {
          warnings.push(`${skill.slug}：${error.message}`);
        }
      }
      this.db.run(
        'UPDATE bindings SET target_path = ?, candidate_id = ? WHERE binding_id = ?',
        targetPath,
        candidate.id,
        binding.binding_id,
      );
      moved += 1;
    }

    await this.startWatcher();
    this.audit('save_config', null, null, `${merged.length} 个工具 · ${moved} 个目标更新`);
    return this.done(
      '设置已保存',
      `${merged.length} 个工具已写入 config.toml${
        moved > 0 ? `，已按新路径重新部署 ${moved} 个绑定` : ''
      }${warnings.length > 0 ? `；${warnings.join('；')}` : ''}`,
      { warning: warnings.length > 0 },
    );
  }

  harnessPayload(harness) {
    return {
      id: harness.id,
      name: harness.name,
      shortName: harness.short_name,
      command: harness.command,
      category: harness.category,
      candidates: harness.candidates.map((candidate) => ({ ...candidate })),
    };
  }

  async addHarnessCandidate({
    harnessId,
    path: candidatePath,
    scope = 'global',
    role = 'custom',
    discovery = 'exact',
    label = '',
  } = {}) {
    const harness = this.harness(harnessId);
    if (!harness) throw new EngineError('Harness 未配置', 'NO_HARNESS');
    const value = String(candidatePath ?? '').trim();
    if (!value) throw new EngineError('扫描目录不能为空', 'BAD_CANDIDATE');
    if (scope !== 'global' && scope !== 'project') {
      throw new EngineError('未知的候选路径作用域', 'BAD_CANDIDATE');
    }
    const normalized = toPosix(value).replace(/\/$/, '');
    if (
      harness.candidates.some(
        (candidate) =>
          candidate.scope === scope &&
          toPosix(candidate.path).replace(/\/$/, '').toLowerCase() ===
            normalized.toLowerCase(),
      )
    ) {
      throw new EngineError('该扫描目录已存在', 'CANDIDATE_EXISTS');
    }
    const payload = this.config.harnesses.map((item) =>
      this.harnessPayload(item.id === harnessId
        ? {
            ...item,
            candidates: [
              ...item.candidates,
              {
                id: `custom-${Date.now().toString(36)}`,
                path: value,
                scope,
                role,
                discovery,
                priority: item.candidates.length,
                label: label || '自定义扫描',
              },
            ],
          }
        : item),
    );
    await this.saveHarnessConfig({
      harnesses: payload,
      removedHarnesses: this.config.removed_harnesses,
    });
    this.candidateStatsCache.clear();
    return this.done('扫描目录已添加', `${harness.name} · ${value}`);
  }

  async resetHarnessDefaults(harnessId) {
    const harness = this.harness(harnessId);
    if (!harness) throw new EngineError('Harness 未配置', 'NO_HARNESS');
    const defaults = defaultHarness(harnessId);
    if (!defaults) throw new EngineError('只有内置工具可以恢复默认路径链', 'NO_BUILTIN');
    const payload = this.config.harnesses.map((item) =>
      this.harnessPayload(
        item.id === harnessId
          ? {
              ...item,
              candidates: defaults.candidates.map((candidate) => ({ ...candidate })),
            }
          : item,
      ),
    );
    await this.saveHarnessConfig({
      harnesses: payload,
      removedHarnesses: this.config.removed_harnesses,
    });
    return this.done('已恢复默认路径链', `${harness.name} · ${defaults.candidates.length} 个候选路径`);
  }

  async createCandidateDir({ harnessId, candidateId, scope, projectId } = {}) {
    const harness = this.harness(harnessId);
    if (!harness) throw new EngineError('Harness 未配置', 'NO_HARNESS');
    const candidate = findCandidate(harness, candidateId);
    if (!candidate) throw new EngineError('候选路径不存在', 'NO_CANDIDATE');
    const actualScope = candidate.scope ?? scope;
    const project =
      actualScope === 'project' && projectId ? this.projectById(projectId) : null;
    if (actualScope === 'project' && !project) {
      throw new EngineError('请选择一个有效项目', 'NO_PROJECT');
    }
    const base = this.candidateBase(harness, { ...candidate, scope: actualScope }, project);
    if (!base) throw new EngineError('候选路径暂时不可用', 'NO_CANDIDATE');
    await fsp.mkdir(base, { recursive: true });
    await this.startWatcher();
    return this.done('扫描目录已创建', this.displayFor(base));
  }

  async toggleFavorite(skillId) {
    const skill = this.skillById(skillId);
    if (!skill) throw new EngineError('技能不存在', 'NO_SKILL');
    const next = skill.is_favorite ? 0 : 1;
    this.db.run('UPDATE skills SET is_favorite = ? WHERE skill_id = ?', next, skillId);
    this.audit('toggle_favorite', null, skillId, next ? '已收藏' : '已取消收藏');
    return this.done(
      next ? '已加入收藏' : '已取消收藏',
      skill.slug,
    );
  }

  async setTrayOnClose(enabled) {
    const next = Boolean(enabled);
    if (Boolean(this.config.tray_on_close) === next) {
      return {
        ok: true,
        message: '托盘驻留未变化',
        description: next ? '关闭窗口时仍会隐藏到系统托盘。' : '关闭窗口时仍会直接退出。',
        snapshot: await this.snapshot(),
      };
    }
    this.config = { ...this.config, tray_on_close: next };
    await saveConfig(path.join(this.root, 'config.toml'), this.config);
    this.audit('set_tray_on_close', null, null, next ? '已开启' : '已关闭');
    return {
      ok: true,
      message: next ? '已开启托盘驻留' : '已关闭托盘驻留',
      description: next
        ? '点击窗口关闭按钮将隐藏到系统托盘，本地 Web 服务保持在线；可从托盘菜单彻底退出。'
        : '点击窗口关闭按钮将直接退出 Quiver，本地 Web 服务也会停止。',
      snapshot: await this.snapshot(),
    };
  }

  async configureWeb(patch = {}) {
    const previous = this.config;
    const next = { ...previous };
    if (patch.enabled !== undefined) next.web_enabled = Boolean(patch.enabled);
    if (patch.lan !== undefined) next.web_lan = Boolean(patch.lan);
    if (patch.port !== undefined) {
      const port = Number.parseInt(String(patch.port), 10);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new EngineError('端口必须是 1024-65535 之间的整数', 'BAD_PORT');
      }
      next.web_port = port;
    }
    const rotated = Boolean(patch.regenerateToken);
    if (rotated || !next.web_token) next.web_token = generateWebToken();

    this.config = next;
    await saveConfig(path.join(this.root, 'config.toml'), this.config);
    await this.startWebServer();

    const lanUrls = next.web_lan
      ? localIPv4Addresses().map((ip) => `http://${ip}:${next.web_port}`)
      : [];
    this.audit(
      'configure_web',
      null,
      null,
      next.web_enabled
        ? `${next.web_lan ? '0.0.0.0' : '127.0.0.1'}:${next.web_port}`
        : '已关闭',
    );
    const status = this.webServer?.status;
    const running = Boolean(status?.running);
    const message = next.web_enabled
      ? running
        ? '本地 Web 服务已启动'
        : 'Web 配置已保存，但服务未能启动'
      : '本地 Web 服务已关闭';
    const description = next.web_enabled
      ? running
        ? next.web_lan
          ? `${lanUrls[0] ?? '未检测到可用的局域网 IPv4 地址'}（同时监听 127.0.0.1）${
              rotated ? ' · Token 已重新生成' : ''
            }`
          : `http://127.0.0.1:${next.web_port}${rotated ? ' · Token 已重新生成' : ''}`
        : (status?.error ?? '请检查端口是否被占用')
      : '桌面端不受影响，可随时重新开启。';
    return this.done(message, description, {
      warning: next.web_enabled && !running,
      webTokenRotated: rotated,
    });
  }

  async autoAllocateWebPort() {
    let port = this.config.web_port;
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      port = await findFreePort(this.config.web_lan ? '0.0.0.0' : '127.0.0.1');
      this.config = { ...this.config, web_enabled: true, web_port: port };
      await saveConfig(path.join(this.root, 'config.toml'), this.config);
      await this.startWebServer();
      if (this.webServer?.status?.running) {
        lastError = null;
        break;
      }
      lastError = this.webServer?.status?.error ?? null;
    }
    const running = Boolean(this.webServer?.status?.running);
    const lanUrls = this.config.web_lan
      ? localIPv4Addresses().map((ip) => `http://${ip}:${port}`)
      : [];
    this.audit('configure_web', null, null, `自动分配 · 端口 ${port}`);
    return this.done(
      running ? `已自动分配端口 ${port} 并启动 Web 服务` : '未能自动启动 Web 服务',
      running
        ? this.config.web_lan
          ? `${lanUrls[0] ?? '未检测到可用的局域网 IPv4 地址'}（同时监听 127.0.0.1）`
          : `http://127.0.0.1:${port}`
        : (lastError ?? '请稍后重试'),
      { warning: !running },
    );
  }

  async setMode(mode) {
    if (mode !== 'sandbox' && mode !== 'real') {
      throw new EngineError('未知的运行模式', 'BAD_MODE');
    }
    if (mode === this.mode) {
      return this.done('模式未变化', this.root);
    }
    await fsp.mkdir(path.dirname(this.pointerFile()), { recursive: true });
    await fsp.writeFile(this.pointerFile(), JSON.stringify({ mode }), 'utf8');
    this.mode = mode;
    await this.openRoot();
    this.audit('switch_mode', null, null, mode === 'sandbox' ? '演示沙盒' : '真实目录');
    return this.done(
      mode === 'sandbox' ? '已切换到演示沙盒模式' : '已切换到真实本地目录',
      mode === 'sandbox'
        ? this.root
        : `${this.root}（路径快捷操作会作用于真实目录，请谨慎操作）`,
      { warning: mode === 'real' },
    );
  }

  async getWorkRoot() {
    return { ok: true, path: this.root };
  }

  async close() {
    this.stopWatcher();
    this.stopWatchdog();
    await this.stopWebServer();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

function safeJson(value) {
  if (value === null || value === undefined) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

module.exports = { Engine, safeJson };
