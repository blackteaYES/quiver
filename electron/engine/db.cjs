const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS skills (
  skill_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  alias TEXT,
  comment TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  source_type TEXT NOT NULL,
  source_uri TEXT,
  active_sha TEXT,
  depends_on TEXT NOT NULL DEFAULT '[]',
  is_favorite INTEGER NOT NULL DEFAULT 0,
  imported_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS skill_versions (
  version_sha TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  parent_sha TEXT,
  created_at INTEGER NOT NULL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_versions_skill ON skill_versions(skill_id, created_at DESC);
CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  missing INTEGER NOT NULL DEFAULT 0,
  manifest_exported INTEGER NOT NULL DEFAULT 0,
  last_active INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bindings (
  binding_id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  harness_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  project_path TEXT NOT NULL DEFAULT '',
  project_id TEXT,
  target_path TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'enabled',
  sync_mode TEXT NOT NULL DEFAULT 'link',
  resolved_sha TEXT NOT NULL,
  current_sha TEXT,
  drift_files TEXT,
  ignored_drift INTEGER NOT NULL DEFAULT 0,
  update_available TEXT,
  candidate_id TEXT,
  deployed_at INTEGER NOT NULL,
  UNIQUE(skill_id, harness_id, scope, project_path)
);
CREATE INDEX IF NOT EXISTS idx_bindings_skill ON bindings(skill_id);
CREATE INDEX IF NOT EXISTS idx_bindings_harness ON bindings(harness_id);
CREATE TABLE IF NOT EXISTS file_hash_cache (
  abs_path TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  sha256 TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  source TEXT NOT NULL,
  action TEXT NOT NULL,
  binding_id TEXT,
  skill_id TEXT,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS ignored_unmanaged (
  path TEXT PRIMARY KEY,
  harness_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

class Db {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    const skillColumns = this.db
      .prepare('PRAGMA table_info(skills)')
      .all()
      .map((column) => column.name);
    if (!skillColumns.includes('is_favorite')) {
      this.db.exec('ALTER TABLE skills ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0');
    }
    const bindingColumns = this.db
      .prepare('PRAGMA table_info(bindings)')
      .all()
      .map((column) => column.name);
    if (!bindingColumns.includes('candidate_id')) {
      this.db.exec('ALTER TABLE bindings ADD COLUMN candidate_id TEXT');
    }
    const version = this.db
      .prepare("SELECT value FROM app_meta WHERE key = 'schema_version'")
      .get();
    if (!version) {
      this.db
        .prepare("INSERT INTO app_meta (key, value) VALUES ('schema_version', '1')")
        .run();
    }
    this.statements = new Map();
  }

  stmt(sql) {
    let prepared = this.statements.get(sql);
    if (!prepared) {
      prepared = this.db.prepare(sql);
      this.statements.set(sql, prepared);
    }
    return prepared;
  }

  run(sql, ...params) {
    return this.stmt(sql).run(...params);
  }

  get(sql, ...params) {
    return this.stmt(sql).get(...params);
  }

  all(sql, ...params) {
    return this.stmt(sql).all(...params);
  }

  transaction(fn) {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* ignore rollback failures */
      }
      throw error;
    }
  }

  close() {
    try {
      this.db.close();
    } catch {
      /* ignore */
    }
  }
}

module.exports = { Db };
