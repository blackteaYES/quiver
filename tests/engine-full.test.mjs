import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { Engine } = require('../electron/engine/index.cjs');
const { loadConfig, parseToml, saveConfig } = require('../electron/engine/config.cjs');
const {
  BUILTINS,
  builtinHarnesses,
  collectProjectCandidateDirs,
  defaultHarness,
  resolveGlobalBase,
  roleLabel,
} = require('../electron/engine/harnesses.cjs');
const { hashDirectory } = require('../electron/engine/hash.cjs');
const {
  DEFAULT_ADOPT_COMMENT,
  parseSkillDescription,
} = require('../electron/engine/store.cjs');
const { ensureWritable, expandPath, moveEntry, removeEntry } = require('../electron/engine/util.cjs');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMP_BASE = path.join(
  os.tmpdir(),
  `quiver-engine-full-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
);
const KEEP = process.env.QUIVER_TEST_KEEP === '1';
const IGNORED_TEST_PATTERN = /(^|\/)(\.git|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/;

const results = [];
const liveHarnesses = new Set();

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content);
  }
}

async function createSkillDir(dir, files = {}) {
  const slug = path.basename(dir);
  await writeTree(dir, {
    'SKILL.md': `# ${slug}\n\n用于集成测试的技能。\n`,
    'docs/notes.md': `# ${slug} notes\n`,
    ...files,
  });
  return dir;
}

async function createHarness(label, customHarnesses = null, options = {}) {
  const root = path.join(TEMP_BASE, label);
  const mode = options.mode === 'sandbox' ? 'sandbox' : 'real';
  await fsp.mkdir(root, { recursive: true });
  const harnesses = customHarnesses ?? [
    {
      id: 'claude-code',
      name: 'Claude Code',
      short_name: 'Claude',
      command: 'claude',
      global_path: path.join(root, 'home', 'claude', 'skills'),
      project_rel_path: '.claude/skills',
    },
    {
      id: 'codex',
      name: 'OpenAI Codex',
      short_name: 'Codex',
      command: 'codex',
      global_path: path.join(root, 'home', 'codex', 'skills'),
      project_rel_path: '.codex/skills',
    },
  ];
  await saveConfig(path.join(root, 'config.toml'), {
    mode,
    editor_command: 'code',
    harnesses,
    web_enabled: false,
    web_port: 4310,
    web_lan: false,
    web_token: `test-${label}-${crypto.randomBytes(8).toString('hex')}`,
  });
  const engine = new Engine({
    getPath: () => path.join(root, 'userdata'),
    getAppPath: () => repoRoot,
    getVersion: () => '0.1.0-test',
    isPackaged: false,
  });
  engine.mode = mode;
  if (mode === 'sandbox') {
    engine.sandboxRoot = () => root;
  } else {
    engine.realRoot = () => root;
  }
  engine.broadcast = () => {};
  try {
    await engine.openRoot();
  } catch (error) {
    await engine.close();
    throw error;
  }
  engine.stopWatcher();
  engine.stopWatchdog();
  engine.startWatcher = async () => {};
  engine.startWatchdog = () => {};
  engine.stopWatcher = () => {};
  engine.stopWatchdog = () => {};
  engine.scheduleReconcile = () => {};
  const harness = { engine, root, harnesses };
  liveHarnesses.add(harness);
  return harness;
}

async function detachLinks(root) {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const stat = await fsp.lstat(abs).catch(() => null);
      if (!stat) continue;
      if (stat.isSymbolicLink()) {
        await removeEntry(abs).catch(() => {});
      } else if (stat.isDirectory()) {
        stack.push(abs);
      }
    }
  }
}

async function closeHarness(harness) {
  if (!liveHarnesses.delete(harness)) return;
  try {
    await harness.engine.stopWebServer();
  } catch {
    /* already stopped */
  }
  await harness.engine.close();
  await ensureWritable(harness.root).catch(() => {});
  await detachLinks(harness.root).catch(() => {});
  if (KEEP) {
    console.log(`[keep] ${harness.root}`);
    return;
  }
  await fsp
    .rm(harness.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })
    .catch(() => {});
}

async function withHarness(label, customHarnessesOrFn, maybeFn, options = {}) {
  const fn = typeof customHarnessesOrFn === 'function' ? customHarnessesOrFn : maybeFn;
  const custom = typeof customHarnessesOrFn === 'function' ? null : customHarnessesOrFn;
  const harness = await createHarness(label, custom, options);
  try {
    return await fn(harness);
  } finally {
    await closeHarness(harness);
  }
}

async function treeManifest(root) {
  const entries = new Map();
  const walk = async (dir, rel) => {
    const listing = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of listing) {
      const abs = path.join(dir, entry.name);
      const key = rel ? `${rel}/${entry.name}` : entry.name;
      const stat = await fsp.lstat(abs);
      if (stat.isSymbolicLink()) {
        entries.set(key, { type: 'link', target: await fsp.readlink(abs) });
      } else if (stat.isDirectory()) {
        entries.set(key, { type: 'dir', mode: stat.mode & 0o777 });
        await walk(abs, key);
      } else if (stat.isFile()) {
        entries.set(key, {
          type: 'file',
          mode: stat.mode & 0o777,
          size: stat.size,
          sha: sha256(await fsp.readFile(abs)),
        });
      }
    }
  };
  await walk(root, '');
  return entries;
}

function manifestSnapshot(manifest) {
  return Object.fromEntries(
    [...manifest.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function fileHashes(manifest) {
  return Object.fromEntries(
    [...manifest.entries()]
      .filter(([, value]) => value.type === 'file')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([rel, value]) => [rel, value.sha]),
  );
}

function bindingFor(engine, slug, harnessId, scope = 'global', projectId = null) {
  const skill = engine.db.get('SELECT * FROM skills WHERE slug = ?', slug);
  assert.ok(skill, `缺少技能 ${slug}`);
  const row =
    scope === 'project'
      ? engine.db.get(
          'SELECT * FROM bindings WHERE skill_id = ? AND harness_id = ? AND scope = ? AND project_id = ?',
          skill.skill_id,
          harnessId,
          scope,
          projectId,
        )
      : engine.db.get(
          'SELECT * FROM bindings WHERE skill_id = ? AND harness_id = ? AND scope = ?',
          skill.skill_id,
          harnessId,
          scope,
        );
  assert.ok(row, `缺少绑定 ${slug}@${harnessId}/${scope}`);
  return row;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function canBind(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error) => resolve({ ok: false, code: error.code }));
    server.listen(port, host, () => server.close(() => resolve({ ok: true })));
  });
}

function listenServer(port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function insertProject(engine, projectPath, projectId = path.basename(projectPath)) {
  const now = Date.now();
  engine.db.run(
    'INSERT INTO projects (project_id, name, path, missing, manifest_exported, last_active, created_at) VALUES (?, ?, ?, 0, 0, ?, ?)',
    projectId,
    path.basename(projectPath),
    projectPath,
    now,
    now,
  );
  return engine.db.get('SELECT * FROM projects WHERE project_id = ?', projectId);
}

function harnessShape(harness) {
  return {
    id: harness.id,
    name: harness.name,
    shortName: harness.shortName ?? harness.short_name,
    command: harness.command ?? '',
    category: harness.category,
    candidates: harness.candidates.map((candidate) => ({
      id: candidate.id,
      path: candidate.path,
      scope: candidate.scope,
      role: candidate.role,
      discovery: candidate.discovery,
      priority: candidate.priority,
      label: candidate.label ?? '',
    })),
  };
}

async function request(url, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers['X-Quiver-Token'] = token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { status: response.status, json, text };
}

async function runCase(id, title, fn) {
  const startedAt = Date.now();
  try {
    const detail = (await fn()) ?? {};
    const entry = { id, title, status: 'PASS', ms: Date.now() - startedAt, detail };
    results.push(entry);
    console.log(`\nPASS ${id}. ${title}  (${entry.ms} ms)`);
    for (const line of detail.lines ?? []) console.log(`     - ${line}`);
  } catch (error) {
    const entry = { id, title, status: 'FAIL', ms: Date.now() - startedAt, error };
    results.push(entry);
    console.error(`\nFAIL ${id}. ${title}  (${entry.ms} ms)`);
    console.error(error?.stack ?? error);
  }
}

async function main() {
  console.log(`Quiver 引擎集成测试 · ${process.platform}/${process.arch} · Node ${process.version}`);
  console.log(`隔离目录：${TEMP_BASE}`);
  await fsp.mkdir(TEMP_BASE, { recursive: true });

  await runCase(1, '目录树哈希确定性与忽略规则', async () =>
    withHarness('case1-hash', async ({ engine, root }) => {
      const fixture = await createSkillDir(path.join(root, 'fixtures', 'hash-case'), {
        'assets/payload.bin': Buffer.from([0, 1, 2, 3, 254, 255]),
        'scripts/run.sh': '#!/bin/sh\necho quiver\n',
      });
      const first = await hashDirectory(fixture, engine.cache);
      await writeTree(fixture, {
        '.git/HEAD': 'ref: refs/heads/main\n',
        '.git/objects/ab/cdef': 'ignored git object\n',
        '.DS_Store': 'ignored\n',
        'Thumbs.db': 'ignored\n',
        'desktop.ini': 'ignored\n',
        'nested/.DS_Store': 'ignored\n',
      });
      const second = await hashDirectory(fixture, engine.cache);
      assert.equal(second.sha, first.sha, '忽略项不得改变目录树哈希');
      assert.equal(second.files.size, first.files.size);
      assert.ok(
        ![...second.files.keys()].some((rel) => IGNORED_TEST_PATTERN.test(rel)),
        '哈希文件集合不得包含忽略项',
      );

      await engine.importLocal(fixture);
      const skill = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'hash-case');
      assert.ok(skill);
      assert.equal(skill.active_sha, first.sha);

      const storeRoot = path.join(root, 'store', 'sha256', first.sha);
      const storeManifest = await treeManifest(storeRoot);
      assert.ok(storeManifest.size > 0);
      for (const rel of storeManifest.keys()) {
        assert.ok(!IGNORED_TEST_PATTERN.test(rel), `中央库不应包含忽略项：${rel}`);
      }
      const alias = path.join(root, 'available', `hash-case@${first.sha.slice(0, 7)}`);
      assert.equal(await fsp.realpath(alias), await fsp.realpath(storeRoot));

      return {
        lines: [
          `干净目录 sha = ${first.sha}`,
          `加入 .git/.DS_Store/Thumbs.db/desktop.ini 后 sha = ${second.sha}`,
          `参与哈希的文件 = ${first.files.size} 个`,
          `入库版本 = ${first.sha.slice(0, 12)}…，store 内无忽略项`,
        ],
      };
    }),
  );

  await runCase(2, '中央库只读锁（文件 0444 / 目录不可写）', async () =>
    withHarness('case2-readonly', async ({ engine, root }) => {
      const fixture = await createSkillDir(path.join(root, 'fixtures', 'readonly-skill'), {
        'assets/read-only.txt': 'immutable payload\n',
      });
      await engine.importLocal(fixture);
      const skill = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'readonly-skill');
      assert.ok(skill);
      const storeRoot = path.join(root, 'store', 'sha256', skill.active_sha);
      const rootStat = await fsp.stat(storeRoot);
      assert.equal(rootStat.mode & 0o200, 0, 'store 根目录不得可写');

      const manifest = await treeManifest(storeRoot);
      let fileCount = 0;
      let dirCount = 0;
      for (const [rel, entry] of manifest) {
        if (entry.type === 'file') {
          fileCount += 1;
          assert.equal(entry.mode & 0o200, 0, `文件应只读：${rel}`);
        } else if (entry.type === 'dir') {
          dirCount += 1;
          assert.equal(entry.mode & 0o200, 0, `目录应只读：${rel}`);
        }
      }
      assert.ok(fileCount > 0, 'store 中应存在文件');
      assert.ok(dirCount > 0, 'store 中应存在子目录');

      const before = manifestSnapshot(manifest);
      let writeDenied = 'skipped (root)';
      const elevatedRoot =
        process.platform !== 'win32' &&
        typeof process.getuid === 'function' &&
        process.getuid() === 0;
      if (!elevatedRoot) {
        await assert.rejects(
          fsp.writeFile(path.join(storeRoot, 'SKILL.md'), 'tampered'),
          (error) => ['EPERM', 'EACCES', 'EROFS'].includes(error.code),
          '只读文件写入必须被系统拒绝',
        );
        writeDenied = 'EPERM/EACCES';
      }
      const after = manifestSnapshot(await treeManifest(storeRoot));
      assert.deepEqual(after, before, '篡改尝试不得改变任何文件');

      return {
        lines: [
          `store 根目录 mode = 0${(rootStat.mode & 0o777).toString(8)}（无写位）`,
          `只读文件 = ${fileCount}，只读子目录 = ${dirCount}`,
          `直接覆盖 SKILL.md → ${writeDenied}`,
          `前后清单完全一致（${Object.keys(before).length} 项）`,
        ],
      };
    }),
  );

  await runCase(3, 'Windows Junction 挂载与防穿透安全卸载', async () =>
    withHarness('case3-junction', async ({ engine, root }) => {
      const fixture = await createSkillDir(path.join(root, 'fixtures', 'safe-unlink'), {
        'assets/large.bin': crypto.randomBytes(4096),
        'nested/deep/config.json': JSON.stringify({ enabled: true, tags: ['a', 'b'] }),
      });
      await engine.importLocal(fixture);
      const skill = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'safe-unlink');
      assert.ok(skill);
      const storeRoot = path.join(root, 'store', 'sha256', skill.active_sha);
      const alias = path.join(root, 'available', `safe-unlink@${skill.active_sha.slice(0, 7)}`);
      const storeBefore = manifestSnapshot(await treeManifest(storeRoot));
      const availableBefore = manifestSnapshot(await treeManifest(alias));
      const storeFileCount = Object.values(storeBefore).filter((item) => item.type === 'file')
        .length;
      assert.ok(storeFileCount > 0);

      await engine.enable({
        skillId: skill.skill_id,
        harnessIds: ['claude-code'],
        scope: 'global',
        syncMode: 'link',
      });
      const binding = bindingFor(engine, 'safe-unlink', 'claude-code');
      assert.equal(binding.sync_mode, 'link');
      const targetPath = binding.target_path;
      const targetStat = await fsp.lstat(targetPath);
      assert.ok(targetStat.isSymbolicLink(), '目标必须是 junction/symlink');
      assert.equal(await fsp.realpath(targetPath), await fsp.realpath(storeRoot));
      assert.ok((await fsp.readFile(path.join(targetPath, 'SKILL.md'), 'utf8')).includes('safe-unlink'));

      await engine.disable(binding.binding_id);
      await assert.rejects(fsp.lstat(targetPath), (error) => error.code === 'ENOENT');
      assert.equal(
        engine.db.get('SELECT * FROM bindings WHERE binding_id = ?', binding.binding_id),
        undefined,
      );

      const storeAfter = manifestSnapshot(await treeManifest(storeRoot));
      const availableAfter = manifestSnapshot(await treeManifest(alias));
      assert.deepEqual(storeAfter, storeBefore, '中央库源文件必须 100% 保持不变');
      assert.deepEqual(availableAfter, availableBefore, 'available 别名下的文件必须 100% 保持不变');
      assert.equal(
        Object.values(storeAfter).filter((item) => item.type === 'file').length,
        storeFileCount,
      );
      assert.equal(await fsp.realpath(alias), await fsp.realpath(storeRoot));

      const audit = engine.db.get(
        "SELECT * FROM audit_logs WHERE action = 'disable' ORDER BY id DESC LIMIT 1",
      );
      assert.ok(audit);
      assert.equal(audit.source, 'desktop');
      assert.equal(audit.binding_id, binding.binding_id);

      return {
        lines: [
          `junction 目标 realpath === store/sha256/${skill.active_sha.slice(0, 12)}…`,
          `禁用后入口已移除（ENOENT），绑定行已删除`,
          `store 清单 ${Object.keys(storeBefore).length} 项逐一相等（${storeFileCount} 个文件）`,
          `available 清单 ${Object.keys(availableBefore).length} 项逐一相等`,
          `审计 disable 来源 = desktop`,
        ],
      };
    }),
  );

  await runCase(4, '漂移检测与 Reset / Adopt / Ignore 三大裁决闭环', async () =>
    withHarness('case4-drift', async ({ engine, root }) => {
      const fixture = await createSkillDir(path.join(root, 'fixtures', 'drift-target'), {
        'docs/notes.md': 'anchor notes\n',
        'assets/logo.txt': 'anchor logo\n',
      });
      await engine.importLocal(fixture);
      const skill = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'drift-target');
      assert.ok(skill);
      const anchorSha = skill.active_sha;
      const storeAnchor = path.join(root, 'store', 'sha256', anchorSha);

      await engine.enable({
        skillId: skill.skill_id,
        harnessIds: ['codex'],
        scope: 'global',
        syncMode: 'copy',
      });
      let binding = bindingFor(engine, 'drift-target', 'codex');
      assert.equal(binding.sync_mode, 'copy');
      const target = binding.target_path;
      assert.deepEqual(
        fileHashes(await treeManifest(target)),
        fileHashes(await treeManifest(storeAnchor)),
        '副本初始内容必须与锚点版本一致',
      );

      await fsp.writeFile(path.join(target, 'SKILL.md'), '# drift-target\n\n本地修改 A\n');
      await fsp.writeFile(path.join(target, 'local-notes.md'), '本地新增文件\n');
      await fsp.rm(path.join(target, 'docs', 'notes.md'));

      const drifted = await engine.refresh();
      const driftBinding = drifted.snapshot.bindings.find((item) => item.id === binding.binding_id);
      assert.ok(driftBinding);
      assert.equal(driftBinding.state, 'drifted');
      const drift = driftBinding.driftFiles;
      assert.equal(drift.length, 3, '差异清单应准确列出 3 个文件');
      assert.deepEqual(
        Object.fromEntries(drift.map((item) => [item.path, item.status])),
        { 'SKILL.md': 'M', 'local-notes.md': 'A', 'docs/notes.md': 'D' },
      );
      const targetSha = (await hashDirectory(target, null)).sha;
      assert.equal(driftBinding.currentSha, targetSha);
      assert.notEqual(targetSha, anchorSha);
      const driftRow = engine.db.get(
        'SELECT * FROM bindings WHERE binding_id = ?',
        binding.binding_id,
      );
      assert.deepEqual(JSON.parse(driftRow.drift_files), drift);

      const adoptResult = await engine.adoptBinding(binding.binding_id);
      const adoptedSkill = engine.db.get(
        'SELECT * FROM skills WHERE skill_id = ?',
        skill.skill_id,
      );
      const adoptedSha = adoptedSkill.active_sha;
      assert.notEqual(adoptedSha, anchorSha, '收编后必须生成新版本');
      binding = engine.db.get('SELECT * FROM bindings WHERE binding_id = ?', binding.binding_id);
      assert.equal(binding.resolved_sha, adoptedSha);
      assert.equal(binding.state, 'enabled');
      assert.equal(binding.drift_files, null);
      assert.equal(binding.current_sha, null);
      const versions = engine.db.all(
        'SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY created_at ASC, version_sha ASC',
        skill.skill_id,
      );
      assert.equal(versions.length, 2);
      assert.ok(versions.some((version) => version.version_sha === anchorSha));
      assert.ok(versions.some((version) => version.version_sha === adoptedSha));
      const adoptedStore = path.join(root, 'store', 'sha256', adoptedSha);
      assert.equal(
        await fsp.readFile(path.join(adoptedStore, 'SKILL.md'), 'utf8'),
        '# drift-target\n\n本地修改 A\n',
      );
      assert.equal(
        await fsp.readFile(path.join(adoptedStore, 'local-notes.md'), 'utf8'),
        '本地新增文件\n',
      );
      assert.ok(!(await treeManifest(adoptedStore)).has('docs/notes.md'));
      const adoptedSnapshotBinding = adoptResult.snapshot.bindings.find(
        (item) => item.id === binding.binding_id,
      );
      assert.equal(adoptedSnapshotBinding.state, 'enabled');
      assert.equal(adoptedSnapshotBinding.resolvedSha, adoptedSha);
      const adoptAudit = engine.db.get(
        "SELECT * FROM audit_logs WHERE action = 'adopt' ORDER BY id DESC LIMIT 1",
      );
      assert.ok(adoptAudit);
      assert.equal(adoptAudit.detail, adoptedSha);

      await fsp.writeFile(path.join(target, 'SKILL.md'), '# drift-target\n\n第二次修改\n');
      await fsp.writeFile(path.join(target, 'extra.md'), '第二次新增\n');
      const driftedAgain = await engine.refresh();
      const again = driftedAgain.snapshot.bindings.find((item) => item.id === binding.binding_id);
      assert.equal(again.state, 'drifted');
      assert.deepEqual(
        Object.fromEntries(again.driftFiles.map((item) => [item.path, item.status])),
        { 'SKILL.md': 'M', 'extra.md': 'A' },
      );

      const resetResult = await engine.resetBinding(binding.binding_id);
      const resetRow = engine.db.get(
        'SELECT * FROM bindings WHERE binding_id = ?',
        binding.binding_id,
      );
      assert.equal(resetRow.state, 'enabled');
      assert.equal(resetRow.resolved_sha, adoptedSha);
      assert.equal(resetRow.current_sha, null);
      assert.equal(resetRow.drift_files, null);
      const resetSnapshotBinding = resetResult.snapshot.bindings.find(
        (item) => item.id === binding.binding_id,
      );
      assert.equal(resetSnapshotBinding.state, 'enabled');
      const targetHash = (await hashDirectory(target, null)).sha;
      assert.equal(targetHash, adoptedSha, '重置后目标目录必须回到锚点哈希');
      assert.deepEqual(
        fileHashes(await treeManifest(target)),
        fileHashes(await treeManifest(adoptedStore)),
      );
      await assert.rejects(
        fsp.readFile(path.join(target, 'extra.md')),
        (error) => error.code === 'ENOENT',
      );
      const resetAudit = engine.db.get(
        "SELECT * FROM audit_logs WHERE action = 'reset' ORDER BY id DESC LIMIT 1",
      );
      assert.ok(resetAudit);

      await fsp.writeFile(path.join(target, 'SKILL.md'), '# drift-target\n\n忽略但不回滚\n');
      const driftedForIgnore = await engine.refresh();
      const beforeIgnore = driftedForIgnore.snapshot.bindings.find(
        (item) => item.id === binding.binding_id,
      );
      assert.equal(beforeIgnore.state, 'drifted');
      assert.equal(Boolean(beforeIgnore.ignoredDrift), false);
      await engine.ignoreDrift(binding.binding_id);
      const ignoredRow = engine.db.get(
        'SELECT * FROM bindings WHERE binding_id = ?',
        binding.binding_id,
      );
      assert.equal(ignoredRow.ignored_drift, 1);
      assert.equal(ignoredRow.state, 'drifted', '忽略裁决不得清除漂移事实');
      const ignoredSnapshot = await engine.snapshot();
      const ignoredView = ignoredSnapshot.bindings.find(
        (item) => item.id === binding.binding_id,
      );
      assert.equal(ignoredView.state, 'drifted');
      assert.equal(ignoredView.ignoredDrift, true);
      assert.ok((ignoredView.driftFiles ?? []).length > 0);
      await engine.refresh();
      const ignoredAfterRefresh = engine.db.get(
        'SELECT * FROM bindings WHERE binding_id = ?',
        binding.binding_id,
      );
      assert.equal(ignoredAfterRefresh.ignored_drift, 1, '持续漂移时忽略标记必须保留');
      const ignoreAudit = engine.db.get(
        "SELECT * FROM audit_logs WHERE action = 'ignore_drift' ORDER BY id DESC LIMIT 1",
      );
      assert.ok(ignoreAudit);
      assert.equal(ignoreAudit.binding_id, binding.binding_id);

      return {
        lines: [
          `锚点 sha = ${anchorSha.slice(0, 12)}…`,
          `漂移清单 = D:docs/notes.md, A:local-notes.md, M:SKILL.md`,
          `收编新版本 = ${adoptedSha.slice(0, 12)}…（skill_versions 共 2 条）`,
          `再次漂移 → 重置后目标哈希 = ${targetHash.slice(0, 12)}…（等于锚点）`,
          `再次漂移 → 忽略后 state=drifted / ignoredDrift=true，刷新后标记保留`,
          `审计 adopt / reset / ignore_drift 均已写入`,
        ],
      };
    }),
  );

  await runCase(5, 'depends_on 依赖预检与孤儿项目自动复活', async () =>
    withHarness('case5-deps-revival', async ({ engine, root }) => {
      await engine.importLocal(await createSkillDir(path.join(root, 'fixtures', 'skill-a')));
      await engine.importLocal(await createSkillDir(path.join(root, 'fixtures', 'skill-b')));
      const skillA = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'skill-a');
      const skillB = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'skill-b');
      assert.ok(skillA && skillB);
      await engine.editSkill(skillB.skill_id, { dependsOn: ['skill-a'] });
      const skillBRow = engine.db.get('SELECT * FROM skills WHERE skill_id = ?', skillB.skill_id);
      assert.deepEqual(JSON.parse(skillBRow.depends_on), ['skill-a']);

      await engine.enable({
        skillId: skillA.skill_id,
        harnessIds: ['claude-code'],
        scope: 'global',
        syncMode: 'link',
      });
      await engine.enable({
        skillId: skillB.skill_id,
        harnessIds: ['claude-code'],
        scope: 'global',
        syncMode: 'link',
      });
      const bindingA = bindingFor(engine, 'skill-a', 'claude-code');
      const bindingB = bindingFor(engine, 'skill-b', 'claude-code');
      const impact = await engine.checkDisableImpact(bindingA.binding_id);
      assert.equal(impact.skill.slug, 'skill-a');
      assert.equal(impact.dependents.length, 1, '禁用预检必须准确返回 1 个依赖方');
      const dependent = impact.dependents[0];
      assert.equal(dependent.bindingId, bindingB.binding_id);
      assert.equal(dependent.skillSlug, 'skill-b');
      assert.equal(dependent.harnessId, 'claude-code');
      assert.equal(dependent.scope, 'global');
      assert.equal(dependent.scopeLabel, '全局');
      assert.equal(dependent.state, 'enabled');
      const noImpact = await engine.checkDisableImpact(bindingB.binding_id);
      assert.equal(noImpact.dependents.length, 0);

      const projectDir = path.join(root, 'projects', 'demo-project');
      await fsp.mkdir(projectDir, { recursive: true });
      await engine.addProject(projectDir);
      const project = engine.db.get('SELECT * FROM projects WHERE path = ?', projectDir);
      assert.ok(project);
      await engine.enable({
        skillId: skillA.skill_id,
        harnessIds: ['claude-code'],
        scope: 'project',
        projectId: project.project_id,
        syncMode: 'link',
      });
      const projectBinding = engine.db.get(
        "SELECT * FROM bindings WHERE project_id = ? AND scope = 'project'",
        project.project_id,
      );
      assert.ok(projectBinding);
      const projectTarget = projectBinding.target_path;
      const storeRootA = path.join(root, 'store', 'sha256', skillA.active_sha);
      assert.ok((await fsp.lstat(projectTarget)).isSymbolicLink());
      assert.equal(await fsp.realpath(projectTarget), await fsp.realpath(storeRootA));

      const movedDir = `${projectDir}-moved`;
      await fsp.rename(projectDir, movedDir);
      await engine.inspectProjects();
      let projectRow = engine.db.get(
        'SELECT * FROM projects WHERE project_id = ?',
        project.project_id,
      );
      assert.equal(projectRow.missing, 1);
      let projectBindingRow = engine.db.get(
        'SELECT * FROM bindings WHERE binding_id = ?',
        projectBinding.binding_id,
      );
      assert.equal(projectBindingRow.state, 'orphaned');

      await removeEntry(path.join(movedDir, '.claude', 'skills', 'skill-a'));
      await fsp.rename(movedDir, projectDir);
      await engine.inspectProjects();
      projectRow = engine.db.get('SELECT * FROM projects WHERE project_id = ?', project.project_id);
      assert.equal(projectRow.missing, 0, '项目路径恢复后必须脱离 missing');
      projectBindingRow = engine.db.get(
        'SELECT * FROM bindings WHERE binding_id = ?',
        projectBinding.binding_id,
      );
      assert.equal(projectBindingRow.state, 'enabled', '绑定必须自动恢复为 enabled');
      const restoredStat = await fsp.lstat(projectTarget);
      assert.ok(restoredStat.isSymbolicLink());
      assert.equal(await fsp.realpath(projectTarget), await fsp.realpath(storeRootA));

      const notice = engine.notices.find(
        (item) => item.kind === 'project_revive' && item.message.includes('demo-project'),
      );
      assert.ok(notice, '必须写入项目自动恢复提示');
      const reviveAudit = engine.db.get(
        "SELECT * FROM audit_logs WHERE action = 'revive_project' ORDER BY id DESC LIMIT 1",
      );
      assert.ok(reviveAudit);
      assert.equal(reviveAudit.source, 'desktop');
      assert.equal(reviveAudit.detail, projectDir);

      return {
        lines: [
          `禁用预检：skill-a → 依赖方 [skill-b@claude-code/global]`,
          `反向预检：skill-b → 0 个依赖方`,
          `移走项目 → missing=1，绑定 orphaned`,
          `移回 + 丢失入口 → 巡检后 missing=0，绑定 enabled，入口已重挂`,
          `恢复提示 + revive_project 审计已写入`,
        ],
      };
    }),
  );

  await runCase(6, '备份包导出 / 全新空库导入 / schema_version 校验', async () => {
    const source = await createHarness('case6-source');
    let target = null;
    try {
      target = await createHarness('case6-target');
      const engine = source.engine;

      await engine.importLocal(
        await createSkillDir(path.join(source.root, 'fixtures', 'backup-link')),
      );
      await engine.importLocal(
        await createSkillDir(path.join(source.root, 'fixtures', 'backup-copy'), {
          'docs/copy.md': 'copy payload\n',
        }),
      );
      await engine.importLocal(
        await createSkillDir(path.join(source.root, 'fixtures-v1', 'backup-versioned'), {
          'docs/history.md': 'v1\n',
        }),
      );
      await engine.importLocal(
        await createSkillDir(path.join(source.root, 'fixtures-v2', 'backup-versioned'), {
          'docs/history.md': 'v2\n',
          'docs/extra.md': 'extra\n',
        }),
      );

      const linkSkill = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'backup-link');
      const copySkill = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'backup-copy');
      const versionedSkill = engine.db.get(
        'SELECT * FROM skills WHERE slug = ?',
        'backup-versioned',
      );
      assert.ok(linkSkill && copySkill && versionedSkill);
      await engine.enable({
        skillId: linkSkill.skill_id,
        harnessIds: ['claude-code'],
        scope: 'global',
        syncMode: 'link',
      });
      await engine.enable({
        skillId: copySkill.skill_id,
        harnessIds: ['codex'],
        scope: 'global',
        syncMode: 'copy',
      });
      await engine.enable({
        skillId: versionedSkill.skill_id,
        harnessIds: ['codex'],
        scope: 'global',
        syncMode: 'link',
      });

      const backupFile = path.join(source.root, 'backups', 'full-backup.json');
      await engine.exportBackupTo(backupFile);
      const payload = JSON.parse(await fsp.readFile(backupFile, 'utf8'));
      assert.equal(payload.schema_version, 1);
      assert.equal(payload.skills.length, 3);
      assert.equal(payload.bindings.length, 3);
      assert.ok(payload.bindings.every((item) => item.scope === 'global'));
      const totalVersions = payload.skills.reduce(
        (sum, item) => sum + (item.versions?.length ?? 0),
        0,
      );
      assert.equal(totalVersions, 4);
      const versionedPayload = payload.skills.find((item) => item.slug === 'backup-versioned');
      assert.equal(versionedPayload.versions.length, 2);
      assert.equal(versionedPayload.active_sha, versionedSkill.active_sha);
      assert.ok(
        versionedPayload.versions.every(
          (version) => Array.isArray(version.files) && version.files.length > 0,
        ),
      );

      assert.equal(target.engine.db.all('SELECT * FROM skills').length, 0);
      const importResult = await target.engine.importBackupFile(backupFile);
      assert.equal(importResult.ok, true);

      const restoredSkills = target.engine.db.all('SELECT * FROM skills');
      assert.equal(restoredSkills.length, 3);
      for (const exported of payload.skills) {
        const row = target.engine.db.get(
          'SELECT * FROM skills WHERE slug = ?',
          exported.slug,
        );
        assert.ok(row, `恢复后缺少技能 ${exported.slug}`);
        assert.equal(row.active_sha, exported.active_sha);
        const versions = target.engine.db.all(
          'SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY created_at ASC, version_sha ASC',
          row.skill_id,
        );
        assert.deepEqual(
          versions.map((version) => version.version_sha).sort(),
          exported.versions.map((version) => version.sha).sort(),
        );
        for (const version of exported.versions) {
          const originManifest = await treeManifest(
            path.join(source.root, 'store', 'sha256', version.sha),
          );
          const restoredManifest = await treeManifest(
            path.join(target.root, 'store', 'sha256', version.sha),
          );
          assert.deepEqual(
            fileHashes(restoredManifest),
            fileHashes(originManifest),
            `版本 ${version.sha.slice(0, 12)}… 内容应完整恢复`,
          );
          assert.ok(Object.keys(fileHashes(restoredManifest)).length > 0);
        }
      }

      const restoredBindings = target.engine.db.all(
        "SELECT * FROM bindings WHERE scope = 'global'",
      );
      assert.equal(restoredBindings.length, 3);
      for (const exported of payload.bindings) {
        const skill = target.engine.db.get(
          'SELECT * FROM skills WHERE slug = ?',
          exported.slug,
        );
        const binding = target.engine.db.get(
          'SELECT * FROM bindings WHERE skill_id = ? AND harness_id = ? AND scope = ?',
          skill.skill_id,
          exported.harness_id,
          'global',
        );
        assert.ok(binding, `恢复后缺少绑定 ${exported.slug}@${exported.harness_id}`);
        assert.equal(binding.sync_mode, exported.sync_mode);
        assert.equal(binding.resolved_sha, exported.resolved_sha);
        assert.equal(binding.candidate_id, exported.candidate_id);
        assert.equal(binding.state, 'enabled');
        const stat = await fsp.lstat(binding.target_path);
        if (exported.sync_mode === 'link') {
          assert.ok(stat.isSymbolicLink());
          assert.equal(
            await fsp.realpath(binding.target_path),
            await fsp.realpath(
              path.join(target.root, 'store', 'sha256', exported.resolved_sha),
            ),
          );
        } else {
          assert.ok(!stat.isSymbolicLink());
          assert.equal(
            (await hashDirectory(binding.target_path, null)).sha,
            exported.resolved_sha,
          );
        }
      }
      const restoredSnapshot = await target.engine.snapshot();
      assert.ok(restoredSnapshot.bindings.every((item) => item.state === 'enabled'));

      const futureFile = path.join(target.root, 'backups', 'future-999.json');
      await writeTree(target.root, {
        'backups/future-999.json': JSON.stringify(
          { schema_version: 999, app: 'Quiver', skills: [] },
          null,
          2,
        ),
      });
      const skillsBefore = target.engine.db.all('SELECT * FROM skills').length;
      let rejected = null;
      try {
        await target.engine.importBackupFile(futureFile);
      } catch (error) {
        rejected = error;
      }
      assert.ok(rejected, 'schema_version = 999 必须被拒绝');
      assert.equal(rejected.code, 'BACKUP_SCHEMA_TOO_NEW');
      assert.match(rejected.message, /999/);
      assert.match(rejected.message, /升级 Quiver/);
      assert.equal(target.engine.db.all('SELECT * FROM skills').length, skillsBefore);
      assert.equal(target.engine.db.all('SELECT * FROM bindings').length, 3);

      const bindingLines = payload.bindings
        .map((item) => `${item.slug}@${item.harness_id}:${item.sync_mode}:${item.resolved_sha.slice(0, 8)}…`)
        .join(', ');
      return {
        lines: [
          `备份包 = ${payload.skills.length} 技能 / ${totalVersions} 版本 / ${payload.bindings.length} 全局绑定`,
          `全新空库导入 → ${restoredSkills.length} 技能 / ${restoredBindings.length} 绑定`,
          `绑定恢复 = ${bindingLines}`,
          `schema_version=999 → ${rejected.code}（含升级提示，未写入任何数据）`,
        ],
      };
    } finally {
      if (target) await closeHarness(target);
      await closeHarness(source);
    }
  });

  await runCase(7, '本地 Web 服务与 Token 鉴权', async () =>
    withHarness('case7-web', async ({ engine }) => {
      let port = null;
      let running = false;
      for (let attempt = 0; attempt < 3 && !running; attempt += 1) {
        port = await freePort();
        await engine.configureWeb({ enabled: true, port, lan: false });
        running = engine.webStatus().running;
      }
      assert.ok(running, '内嵌 Web 服务应成功启动');
      const token = engine.config.web_token;
      assert.ok(token && token.length > 0, 'Web 服务必须持有非空 Token');
      const base = `http://127.0.0.1:${port}`;

      const healthNoToken = await request(`${base}/api/health`);
      assert.equal(healthNoToken.status, 401);
      assert.equal(healthNoToken.json.code, 'UNAUTHORIZED');
      const healthBadToken = await request(`${base}/api/health`, {
        token: 'x'.repeat(token.length),
      });
      assert.equal(healthBadToken.status, 401);
      const healthOk = await request(`${base}/api/health`, { token });
      assert.equal(healthOk.status, 200);
      assert.equal(healthOk.json.ok, true);
      assert.equal(healthOk.json.app, 'Quiver');

      const rpcNoToken = await request(`${base}/api/rpc`, {
        method: 'POST',
        body: { action: 'snapshot' },
      });
      assert.equal(rpcNoToken.status, 401);
      const rpcSnapshot = await request(`${base}/api/rpc`, {
        method: 'POST',
        token,
        body: { action: 'snapshot' },
      });
      assert.equal(rpcSnapshot.status, 200);
      assert.equal(rpcSnapshot.json.ok, true);
      assert.equal(rpcSnapshot.json.snapshot.settings.web.token, '');
      assert.ok(!rpcSnapshot.text.includes(token), 'RPC 响应不得包含 Token');

      const rpcBlocked = await request(`${base}/api/rpc`, {
        method: 'POST',
        token,
        body: { action: 'configureWeb', payload: { enabled: false } },
      });
      assert.equal(rpcBlocked.status, 403);
      assert.equal(rpcBlocked.json.code, 'DESKTOP_ONLY');

      const scan = await request(`${base}/api/rpc`, {
        method: 'POST',
        token,
        body: { action: 'scanHarness', payload: 'claude-code' },
      });
      assert.equal(scan.status, 200);
      assert.equal(scan.json.ok, true);
      const audit = engine.db.get(
        "SELECT * FROM audit_logs WHERE action = 'scan_harness' ORDER BY id DESC LIMIT 1",
      );
      assert.ok(audit, 'Web 动作必须写入审计日志');
      assert.equal(audit.source, 'web');
      assert.equal(audit.detail, 'claude-code');
      const webCount = engine.db.get(
        "SELECT COUNT(*) AS count FROM audit_logs WHERE source = 'web'",
      ).count;
      assert.ok(webCount >= 1);

      return {
        lines: [
          `监听 127.0.0.1:${port}，Token 长度 ${token.length}`,
          `无 Token / 错误 Token → 401 UNAUTHORIZED`,
          `正确 Token → /api/health 200，/api/rpc snapshot 200 且 token 字段为空`,
          `configureWeb over RPC → 403 DESKTOP_ONLY`,
          `scanHarness → 200；audit_logs.source = web（共 ${webCount} 条 Web 审计）`,
        ],
      };
    }),
  );

  await runCase(8, '候选路径链 / 共享层遮蔽与拆分禁用 / 收藏', async () => {
    const caseRoot = path.join(TEMP_BASE, 'case8-candidates');
    const homeDir = (...parts) => path.join(caseRoot, 'home', ...parts);
    const sharedDir = homeDir('agents', 'skills');
    const claudeDir = homeDir('claude', 'skills');
    const claudeAltDir = homeDir('claude-alt', 'skills');
    const codexDir = homeDir('codex', 'skills');
    const candidate = (id, candidatePath, scope, role, discovery, priority) => ({
      id,
      path: candidatePath,
      scope,
      role,
      discovery,
      priority,
    });
    const harnesses = [
      {
        id: 'claude-code',
        name: 'Claude Code',
        short_name: 'Claude',
        command: 'claude',
        candidates: [
          candidate('g-primary', claudeDir, 'global', 'primary', 'exact', 0),
          candidate('g-shared', sharedDir, 'global', 'shared', 'exact', 1),
          candidate('g-alt', claudeAltDir, 'global', 'compat', 'exact', 2),
          candidate('p-primary', '.claude/skills', 'project', 'primary', 'parent-chain', 3),
        ],
      },
      {
        id: 'codex',
        name: 'OpenAI Codex',
        short_name: 'Codex',
        command: 'codex',
        candidates: [
          candidate('g-primary', codexDir, 'global', 'primary', 'exact', 0),
          candidate('g-shared', sharedDir, 'global', 'shared', 'exact', 2),
          candidate('p-primary', '.codex/skills', 'project', 'primary', 'nested-monorepo', 3),
        ],
      },
      {
        id: 'cursor',
        name: 'Cursor',
        short_name: 'Cursor',
        command: 'cursor',
        candidates: [
          candidate('p-primary', '.cursor/skills', 'project', 'primary', 'exact', 0),
          candidate('g-shared', sharedDir, 'global', 'shared', 'exact', 1),
        ],
      },
    ];

    return withHarness('case8-candidates', harnesses, async ({ engine }) => {
      await engine.importLocal(
        await createSkillDir(path.join(caseRoot, 'fixtures', 'shared-skill')),
      );
      const skill = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'shared-skill');
      assert.ok(skill);
      await engine.enable({
        skillId: skill.skill_id,
        targets: [{ harnessId: 'claude-code', candidateId: 'g-shared' }],
        scope: 'global',
        syncMode: 'link',
      });
      const binding = bindingFor(engine, 'shared-skill', 'claude-code');
      assert.equal(binding.candidate_id, 'g-shared');
      assert.equal(path.resolve(path.dirname(binding.target_path)), path.resolve(sharedDir));
      const sharedEntry = path.join(sharedDir, 'shared-skill');
      assert.ok((await fsp.lstat(sharedEntry)).isSymbolicLink());

      const impact = engine.checkDisableImpact(binding.binding_id);
      assert.equal(impact.shared.active, true);
      assert.deepEqual(
        impact.shared.readers.map((reader) => reader.harnessId).sort(),
        ['codex', 'cursor'],
      );
      await assert.rejects(
        engine.disable(binding.binding_id),
        (error) => error.code === 'SHARED_CONFIRM',
      );

      const splitResult = await engine.disable(binding.binding_id, 'split');
      const splitRow = bindingFor(engine, 'shared-skill', 'codex');
      assert.equal(splitRow.candidate_id, 'g-primary');
      assert.equal(path.resolve(path.dirname(splitRow.target_path)), path.resolve(codexDir));
      assert.match(splitResult.description, /没有共享目录之外的首选路径/);
      assert.equal(
        engine.db.get(
          "SELECT COUNT(*) AS count FROM bindings WHERE skill_id = ? AND harness_id = 'cursor'",
          skill.skill_id,
        ).count,
        0,
        '没有备选目录的共用工具不得在共享目录重建入口',
      );
      await assert.rejects(fsp.lstat(sharedEntry), (error) => error.code === 'ENOENT');
      const splitAudit = engine.db.get(
        "SELECT * FROM audit_logs WHERE action = 'disable_split' ORDER BY id DESC LIMIT 1",
      );
      assert.equal(splitAudit.detail, 'shared-skill · 智能拆分');

      await engine.importLocal(
        await createSkillDir(path.join(caseRoot, 'fixtures', 'all-skill')),
      );
      const allSkill = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'all-skill');
      assert.ok(allSkill);
      await engine.enable({
        skillId: allSkill.skill_id,
        targets: [{ harnessId: 'claude-code', candidateId: 'g-shared' }],
        scope: 'global',
        syncMode: 'link',
      });
      const allBinding = bindingFor(engine, 'all-skill', 'claude-code');
      await engine.disable(allBinding.binding_id, 'all');
      assert.equal(
        engine.db.get(
          'SELECT COUNT(*) AS count FROM bindings WHERE skill_id = ?',
          allSkill.skill_id,
        ).count,
        0,
        '彻底移除后所有共用工具都不再持有绑定',
      );
      await assert.rejects(fsp.lstat(path.join(sharedDir, 'all-skill')), (error) => error.code === 'ENOENT');

      assert.equal((await engine.toggleFavorite(skill.skill_id)).ok, true);
      let snapshot = await engine.snapshot();
      assert.equal(
        snapshot.skills.find((item) => item.id === skill.skill_id).isFavorite,
        true,
      );
      await engine.toggleFavorite(skill.skill_id);
      snapshot = await engine.snapshot();
      assert.equal(
        snapshot.skills.find((item) => item.id === skill.skill_id).isFavorite,
        false,
      );

      await writeTree(sharedDir, {
        'shadow-skill/SKILL.md': '# shadow-skill\n\nshared copy\n',
        'agents-only/SKILL.md': '# agents-only\n\nshared copy\n',
      });
      await writeTree(claudeDir, {
        'shadow-skill/SKILL.md': '# shadow-skill\n\nprimary copy\n',
      });
      const projectDir = path.join(caseRoot, 'projects', 'mono');
      await writeTree(projectDir, {
        '.claude/skills/parent-skill/SKILL.md': '# parent-skill\n',
        'packages/web/.codex/skills/nested-skill/SKILL.md': '# nested-skill\n',
      });
      await engine.addProject(projectDir);
      const project = engine.db.get('SELECT * FROM projects WHERE path = ?', projectDir);
      assert.ok(project);

      snapshot = await engine.snapshot();
      const localUnmanaged = snapshot.unmanaged.filter((item) =>
        path.resolve(item.fsPath).startsWith(path.resolve(caseRoot)),
      );
      const shadowedEntry = localUnmanaged.find(
        (item) =>
          item.name === 'shadow-skill' &&
          path.resolve(item.fsPath) === path.resolve(path.join(sharedDir, 'shadow-skill')),
      );
      assert.ok(shadowedEntry, '共享目录中的同名技能应出现在扫描结果');
      assert.equal(shadowedEntry.shared, true);
      for (const harnessId of ['claude-code', 'codex', 'cursor']) {
        assert.ok(
          (shadowedEntry.sharedHarnessIds ?? []).includes(harnessId),
          `共享提示应包含 ${harnessId}`,
        );
      }
      assert.ok(shadowedEntry.shadowedBy, '低优先级同名目录必须标记被覆盖');
      assert.equal(shadowedEntry.shadowedBy.priority, 0);
      assert.equal(shadowedEntry.priority, 1);
      const parentEntry = localUnmanaged.find((item) => item.name === 'parent-skill');
      assert.ok(parentEntry, '父级目录候选应扫描到同名技能');
      assert.equal(parentEntry.discoveryLabel, '父级目录 (↑)');
      assert.equal(parentEntry.projectId, project.project_id);
      const nestedEntry = localUnmanaged.find((item) => item.name === 'nested-skill');
      assert.ok(nestedEntry, '子包目录候选应扫描到同名技能');
      assert.equal(nestedEntry.discoveryLabel, '子包目录 (↓)');

      return {
        lines: [
          `共享层入口 = ${path.relative(caseRoot, sharedDir)}（claude-code · g-shared）`,
          `拆分禁用 → codex 重新部署到 g-primary，cursor 无备选目录已跳过`,
          `彻底移除 → 绑定 0 条，共享入口已删除`,
          `扫描：shadow-skill 被原生首选覆盖（优先级 #1），parent-skill / nested-skill 命中项目候选`,
          `收藏切换 → snapshot.isFavorite 同步`,
        ],
      };
    });
  });

  await runCase(9, 'SKILL.md Frontmatter / 首段简介解析与启动刷新', async () =>
    withHarness('case9-skill-md', async ({ engine, root }) => {
      assert.equal(
        parseSkillDescription(
          '---\nname: demo\ndescription: 单行 frontmatter 简介\n---\n# demo\n',
        ),
        '单行 frontmatter 简介',
      );
      assert.equal(
        parseSkillDescription('---\ndescription: >\n  折叠式 frontmatter\n  简介\n---\n'),
        '折叠式 frontmatter 简介',
      );
      assert.equal(
        parseSkillDescription('---\ndescription: |\n  保留\n  换行\n---\n'),
        '保留 换行',
      );
      assert.equal(
        parseSkillDescription('---\ndescription: "带引号的简介"\n---\n'),
        '带引号的简介',
      );
      assert.equal(
        parseSkillDescription('\uFEFF---\ndescription: BOM frontmatter\n---\n'),
        'BOM frontmatter',
      );
      assert.equal(
        parseSkillDescription(
          '\uFEFF# Title\n\n正文首段第一行\n正文首段第二行\n\n第二段不应采用\n',
        ),
        '正文首段第一行 正文首段第二行',
      );
      assert.equal(
        parseSkillDescription(
          '---\nname: x\n---\n\n正文 **加粗** 与 [链接](https://example.com)\n',
        ),
        '正文 加粗 与 链接',
      );
      assert.equal(parseSkillDescription('  \n\n'), null);

      await writeTree(root, {
        'fixtures/fm-skill/SKILL.md':
          '---\nname: fm-skill\ndescription: 来自 frontmatter 的简介\n---\n# fm-skill\n\n正文无关。\n',
        'fixtures/fm-skill/docs/notes.md': '# notes\n',
      });
      await engine.importLocal(path.join(root, 'fixtures', 'fm-skill'));
      const bodyDir = path.join(root, 'fixtures', 'body-skill');
      await createSkillDir(bodyDir, {
        'SKILL.md': '# body-skill\n\n首段第一行。\n首段第二行。\n\n第二段不应采用。\n',
      });
      await engine.importLocal(bodyDir);

      let fmSkill = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'fm-skill');
      let bodySkill = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'body-skill');
      assert.ok(fmSkill && bodySkill);
      assert.equal(fmSkill.comment, '来自 frontmatter 的简介');
      assert.equal(bodySkill.comment, '首段第一行。 首段第二行。');

      engine.db.run(
        'UPDATE skills SET comment = ? WHERE skill_id = ?',
        DEFAULT_ADOPT_COMMENT,
        bodySkill.skill_id,
      );
      engine.db.run(
        "UPDATE skills SET comment = '人工维护备注' WHERE skill_id = ?",
        fmSkill.skill_id,
      );
      await engine.openRoot();
      fmSkill = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'fm-skill');
      bodySkill = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'body-skill');
      assert.equal(bodySkill.comment, '首段第一行。 首段第二行。', '启动刷新必须替换默认占位简介');
      assert.equal(fmSkill.comment, '人工维护备注', '启动刷新不得覆盖人工维护的备注');

      const resync = await engine.resyncSkillComment(fmSkill.skill_id);
      assert.equal(resync.ok, true);
      fmSkill = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'fm-skill');
      assert.equal(fmSkill.comment, '来自 frontmatter 的简介');
      const audit = engine.db.get(
        "SELECT * FROM audit_logs WHERE action = 'resync_skill_comment' ORDER BY id DESC LIMIT 1",
      );
      assert.ok(audit);
      assert.equal(audit.skill_id, fmSkill.skill_id);

      return {
        lines: [
          'Frontmatter 单行 / 折叠 > / 字面 | / 引号 / BOM 均解析成功',
          '无 Frontmatter 时取正文首段，跳过标题、空行与代码围栏',
          `导入 fm-skill → comment = ${fmSkill.comment}`,
          `导入 body-skill → comment = ${bodySkill.comment}`,
          '启动刷新：默认占位被替换，人工备注保留；resync 可强制回写',
        ],
      };
    }),
  );

  await runCase(10, 'skillPreview 文件树与只读正文预览', async () =>
    withHarness('case10-preview', async ({ engine, root }) => {
      await writeTree(root, {
        'fixtures-v1/preview-skill/SKILL.md': '# preview-skill\n\nv1 正文\n',
        'fixtures-v1/preview-skill/docs/notes.md': '# notes v1\n',
        'fixtures-v1/preview-skill/assets/logo.txt': 'logo payload\n',
        'fixtures-v1/preview-skill/.git/HEAD': 'ref: refs/heads/main\n',
        'fixtures-v1/preview-skill/.DS_Store': 'ignored\n',
        'fixtures-v2/preview-skill/SKILL.md': '# preview-skill\n\nv2 正文\n',
        'fixtures-v2/preview-skill/docs/notes.md': '# notes v2\n',
        'fixtures-v2/preview-skill/assets/logo.txt': 'logo payload\n',
      });
      await engine.importLocal(path.join(root, 'fixtures-v1', 'preview-skill'));
      const skill = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'preview-skill');
      assert.ok(skill);
      const v1Sha = skill.active_sha;
      const v1Store = path.join(root, 'store', 'sha256', v1Sha);
      const storeBefore = manifestSnapshot(await treeManifest(v1Store));

      const preview1 = (await engine.skillPreview(skill.skill_id)).preview;
      const paths = preview1.files.map((file) => file.path);
      const expectedPaths = ['SKILL.md', 'assets/logo.txt', 'docs/notes.md'].sort((left, right) =>
        left.localeCompare(right),
      );
      assert.deepEqual(paths, expectedPaths);
      assert.ok(paths.every((item) => !path.isAbsolute(item)));
      assert.equal(preview1.sha, v1Sha);
      assert.equal(preview1.skillMarkdown, '# preview-skill\n\nv1 正文\n');
      assert.equal(preview1.truncated, false);
      assert.equal(preview1.overflow, false);
      assert.ok(!paths.some((item) => item.startsWith('.git/') || item === '.DS_Store'));

      await engine.importLocal(path.join(root, 'fixtures-v2', 'preview-skill'));
      const updated = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'preview-skill');
      const v2Sha = updated.active_sha;
      assert.notEqual(v2Sha, v1Sha);
      const previewActive = (await engine.skillPreview(updated.skill_id)).preview;
      assert.equal(previewActive.sha, v2Sha);
      assert.equal(previewActive.skillMarkdown, '# preview-skill\n\nv2 正文\n');
      const previewOld = (await engine.skillPreview(updated.skill_id, v1Sha)).preview;
      assert.equal(previewOld.sha, v1Sha);
      assert.equal(previewOld.skillMarkdown, '# preview-skill\n\nv1 正文\n');
      await assert.rejects(
        engine.skillPreview(updated.skill_id, '0'.repeat(64)),
        (error) => error.code === 'STORE_MISSING',
      );

      const storeAfter = manifestSnapshot(await treeManifest(v1Store));
      assert.deepEqual(storeAfter, storeBefore, '预览不得修改中央库任何文件');
      const storeFile = path.join(v1Store, 'SKILL.md');
      const mode = (await fsp.stat(storeFile)).mode & 0o777;
      assert.equal(mode & 0o200, 0, '预览正文来自只读文件');
      assert.ok((await fsp.stat(path.join(root, 'store', 'sha256', v2Sha))).isDirectory());

      return {
        lines: [
          `v1 sha = ${v1Sha.slice(0, 12)}…，文件树 ${paths.length} 项（已忽略 .git / .DS_Store）`,
          `预览正文 = ${JSON.stringify(preview1.skillMarkdown)}`,
          `导入 v2 后 active = ${v2Sha.slice(0, 12)}…，仍可按 v1 sha 预览旧版本`,
          `缺失版本 → STORE_MISSING`,
          `预览前后 store 清单完全一致（${Object.keys(storeBefore).length} 项）`,
        ],
      };
    }),
  );

  await runCase(11, '外部技能批量收编', async () => {
    const caseRoot = path.join(TEMP_BASE, 'case11-batch');
    const claudeDir = path.join(caseRoot, 'claude', 'skills');
    const codexDir = path.join(caseRoot, 'codex', 'skills');
    const harnesses = [
      {
        id: 'batch-claude',
        name: 'Batch Claude',
        short_name: 'BClaude',
        command: 'bclaude',
        candidates: [
          {
            id: 'g-primary',
            path: claudeDir,
            scope: 'global',
            role: 'primary',
            discovery: 'exact',
            priority: 0,
          },
        ],
      },
      {
        id: 'batch-codex',
        name: 'Batch Codex',
        short_name: 'BCodex',
        command: 'bcodex',
        candidates: [
          {
            id: 'g-primary',
            path: codexDir,
            scope: 'global',
            role: 'primary',
            discovery: 'exact',
            priority: 0,
          },
        ],
      },
    ];
    return withHarness('case11-batch', harnesses, async ({ engine, root }) => {
      await writeTree(claudeDir, {
        'ext-one/SKILL.md': '# ext-one\n\n第一批扩展\n',
        'ext-two/SKILL.md': '# ext-two\n\n第二批扩展\n',
      });
      await writeTree(codexDir, {
        'ext-register/SKILL.md': '# ext-register\n\n原地登记的扩展\n',
      });

      let snapshot = await engine.snapshot();
      const ext = (name) => {
        const found = snapshot.unmanaged.find((item) => item.name === name);
        assert.ok(found, `扫描结果缺少 ${name}`);
        return found;
      };
      const adoptIds = [ext('ext-one').id, ext('ext-two').id];
      const adoptResult = await engine.adoptUnmanagedBatch(adoptIds, 'adopt');
      assert.equal(adoptResult.ok, true);
      assert.equal(adoptResult.count, 2);
      assert.match(adoptResult.message, /批量收编 2 个/);

      for (const name of ['ext-one', 'ext-two']) {
        const skill = engine.db.get('SELECT * FROM skills WHERE slug = ?', name);
        assert.ok(skill, `批量收编后缺少 ${name}`);
        const storeRoot = path.join(root, 'store', 'sha256', skill.active_sha);
        const entry = path.join(claudeDir, name);
        assert.ok((await fsp.lstat(entry)).isSymbolicLink(), `${name} 原目录必须替换为链接`);
        assert.equal(await fsp.realpath(entry), await fsp.realpath(storeRoot));
        const binding = engine.db.get(
          "SELECT * FROM bindings WHERE skill_id = ? AND harness_id = 'batch-claude' AND scope = 'global'",
          skill.skill_id,
        );
        assert.ok(binding);
        assert.equal(binding.sync_mode, 'link');
        assert.equal(path.resolve(binding.target_path), path.resolve(entry));
        assert.equal(binding.resolved_sha, skill.active_sha);
      }

      snapshot = await engine.snapshot();
      assert.ok(!snapshot.unmanaged.some((item) => item.name === 'ext-one'));
      assert.ok(!snapshot.unmanaged.some((item) => item.name === 'ext-two'));
      const registerTarget = snapshot.unmanaged.find((item) => item.name === 'ext-register');
      assert.ok(registerTarget);
      const registerResult = await engine.adoptUnmanagedBatch([registerTarget.id], 'register');
      assert.equal(registerResult.ok, true);
      assert.equal(registerResult.count, 1);
      assert.match(registerResult.message, /批量登记 1 个/);

      const registerSkill = engine.db.get(
        'SELECT * FROM skills WHERE slug = ?',
        'ext-register',
      );
      assert.ok(registerSkill);
      const registerEntry = path.join(codexDir, 'ext-register');
      const registerStat = await fsp.lstat(registerEntry);
      assert.ok(registerStat.isDirectory() && !registerStat.isSymbolicLink());
      assert.equal(
        (await hashDirectory(registerEntry, null)).sha,
        registerSkill.active_sha,
        '原地登记不得改动外部目录内容',
      );
      const registerBinding = engine.db.get(
        "SELECT * FROM bindings WHERE skill_id = ? AND harness_id = 'batch-codex' AND scope = 'global'",
        registerSkill.skill_id,
      );
      assert.ok(registerBinding);
      assert.equal(registerBinding.sync_mode, 'copy');
      assert.equal(path.resolve(registerBinding.target_path), path.resolve(registerEntry));
      assert.equal(
        await fsp.readFile(
          path.join(root, 'store', 'sha256', registerSkill.active_sha, 'SKILL.md'),
          'utf8',
        ),
        '# ext-register\n\n原地登记的扩展\n',
      );
      snapshot = await engine.snapshot();
      assert.ok(!snapshot.unmanaged.some((item) => item.name === 'ext-register'));

      const audits = engine.db.all(
        "SELECT * FROM audit_logs WHERE action = 'adopt_unmanaged_batch' ORDER BY id ASC",
      );
      assert.equal(audits.length, 2);
      assert.equal(audits[0].detail, '收编 2/2');
      assert.equal(audits[1].detail, '登记 1/1');

      return {
        lines: [
          `adopt 批量 2 个：ext-one / ext-two → link，原目录已替换为 store 链接`,
          'register 批量 1 个：ext-register 保持真实目录，绑定模式 copy',
          '收编后全部从 unmanaged 列表消失',
          `审计 = ${audits.map((item) => item.detail).join(' / ')}`,
        ],
      };
    });
  });

  await runCase(12, 'Web 服务关闭释放端口与占用时自动分配', async () =>
    withHarness('case12-web-port', async ({ engine, root }) => {
      let port = null;
      let started = false;
      for (let attempt = 0; attempt < 3 && !started; attempt += 1) {
        port = await freePort();
        await engine.configureWeb({ enabled: true, port, lan: false });
        started = engine.webStatus().running;
      }
      assert.ok(started, '首次启动 Web 服务失败');
      const token = engine.config.web_token;
      let base = `http://127.0.0.1:${port}`;
      const firstHealth = await request(`${base}/api/health`, { token });
      assert.equal(firstHealth.status, 200);

      await engine.close();
      const released = await canBind(port);
      assert.equal(released.ok, true, `engine.close() 后端口 ${port} 必须释放（${released.code}）`);

      await engine.openRoot();
      assert.equal(engine.webStatus().running, true, '重新打开工作区后应按配置恢复监听');
      assert.equal(engine.config.web_port, port);

      const occupiedPort = await freePort();
      const blocker = await listenServer(occupiedPort);
      try {
        const blocked = await engine.configureWeb({
          enabled: true,
          port: occupiedPort,
          lan: false,
        });
        assert.equal(blocked.ok, true);
        assert.equal(blocked.warning, true);
        assert.equal(engine.webStatus().running, false);
        assert.match(String(engine.webStatus().error), /已被占用/);
        assert.equal(engine.config.web_port, occupiedPort);

        const allocated = await engine.autoAllocateWebPort();
        assert.equal(allocated.ok, true);
        const allocatedPort = engine.config.web_port;
        assert.equal(engine.webStatus().running, true);
        assert.notEqual(allocatedPort, occupiedPort);
        assert.equal(engine.webStatus().url, `http://127.0.0.1:${allocatedPort}`);
        base = `http://127.0.0.1:${allocatedPort}`;
        const health = await request(`${base}/api/health`, { token });
        assert.equal(health.status, 200);
        const saved = await loadConfig(path.join(root, 'config.toml'), 'real');
        assert.equal(Number(saved.web_port), allocatedPort);
        assert.equal(saved.web_enabled, true);

        await engine.close();
        const allocatedReleased = await canBind(allocatedPort);
        assert.equal(
          allocatedReleased.ok,
          true,
          `自动分配的端口 ${allocatedPort} 在 close 后必须释放`,
        );
      } finally {
        await closeServer(blocker);
      }

      return {
        lines: [
          `首轮监听 127.0.0.1:${port}，await engine.close() 后可重新绑定同端口`,
          `占用端口 ${occupiedPort} → configureWeb 保存配置但 running=false（error 含“已被占用”）`,
          `autoAllocateWebPort → ${base} 健康检查 200，config.toml 已回写`,
          '再次 close 后自动分配端口同样释放',
        ],
      };
    }),
  );

  await runCase(13, '25 项内置 Harness 多候选路径链解析', async () => {
    const builtins = builtinHarnesses();
    assert.equal(BUILTINS.length, 25, '内置 Harness 字典必须为 25 项');
    assert.equal(builtins.length, 25);
    assert.equal(new Set(builtins.map((item) => item.id)).size, 25, 'Harness id 必须唯一');
    for (const builtin of BUILTINS) {
      assert.ok(builtin.candidates.length >= 2, `${builtin.id} 至少需要全局 + 项目候选`);
      const priorities = builtin.candidates.map((candidate) => candidate.priority);
      assert.deepEqual(
        priorities,
        priorities.map((_, index) => index),
        `${builtin.id} 初始优先级必须连续`,
      );
    }
    const codexHarness = builtins.find((item) => item.id === 'codex');
    const envCandidate = codexHarness.candidates.find((item) => item.path === '$CODEX_HOME/skills');
    assert.ok(envCandidate, 'Codex 必须包含 $CODEX_HOME/skills 候选');
    assert.equal(envCandidate.priority, 0, '$CODEX_HOME 必须是 Codex 的首选候选');

    const fakeHome = process.platform === 'win32' ? 'C:\\Users\\QuiverTest' : '/home/quiver-test';
    const virtualCodex = path.join(TEMP_BASE, 'case13-virtual-codex');
    assert.equal(
      resolveGlobalBase(envCandidate, { homeDir: fakeHome, env: { CODEX_HOME: virtualCodex } }),
      path.resolve(virtualCodex, 'skills'),
    );
    assert.equal(resolveGlobalBase(envCandidate, { homeDir: fakeHome, env: {} }), null);

    return withHarness(
      'case13-builtins',
      builtins,
      async ({ engine, root }) => {
        const home = path.join(root, 'home');
        const sharedDir = path.join(home, '.agents', 'skills');
        const claudeNative = path.join(home, '.claude', 'skills');
        const cursorNative = path.join(home, '.cursor', 'skills');
        const codexHome = path.join(root, 'codex-home');
        const codexEnv = path.join(codexHome, 'skills');
        const codexFallback = path.join(home, '.codex', 'skills');
        const parentProject = path.join(root, 'projects', 'mono-parent', 'packages', 'app');
        const parentRoot = path.join(root, 'projects', 'mono-parent');
        const nestedProject = path.join(root, 'projects', 'mono-nested');
        const nestedBase = path.join(nestedProject, 'packages', 'group', 'app', '.cursor', 'skills');
        const tooDeep = path.join(
          nestedProject,
          'packages',
          'group',
          'app',
          'deeper',
          '.cursor',
          'skills',
        );

        await writeTree(sharedDir, {
          'shared-builtin/SKILL.md': '# shared-builtin\n\n共享层技能\n',
        });
        await writeTree(claudeNative, {
          'shadow-skill/SKILL.md': '# shadow-skill\n\n原生首选副本\n',
        });
        await writeTree(codexEnv, {
          'dual-skill/SKILL.md': '# dual-skill\n\nCODEX_HOME 副本\n',
        });
        await writeTree(codexFallback, {
          'dual-skill/SKILL.md': '# dual-skill\n\n~/.codex 副本\n',
        });
        await writeTree(parentRoot, {
          '.claude/skills/parent-skill/SKILL.md': '# parent-skill\n\n父级目录技能\n',
        });
        await writeTree(nestedBase, {
          'nested-skill/SKILL.md': '# nested-skill\n\n三级子包技能\n',
        });
        await writeTree(tooDeep, {
          'too-deep-skill/SKILL.md': '# too-deep-skill\n\n第四级不应命中\n',
        });
        await fsp.mkdir(parentProject, { recursive: true });
        await fsp.mkdir(nestedProject, { recursive: true });
        insertProject(engine, parentProject, 'parent-app');
        insertProject(engine, nestedProject, 'nested-mono');

        const parentCandidate = defaultHarness('claude-code').candidates.find(
          (item) => item.discovery === 'parent-chain',
        );
        const parentDirs = collectProjectCandidateDirs(parentCandidate, parentProject);
        assert.deepEqual(
          parentDirs.map((item) => path.resolve(item)),
          [path.resolve(parentRoot, '.claude', 'skills')],
        );
        const nestedCandidate = defaultHarness('cursor').candidates.find(
          (item) => item.discovery === 'nested-monorepo' && item.scope === 'project',
        );
        const nestedDirs = collectProjectCandidateDirs(nestedCandidate, nestedProject);
        assert.ok(
          nestedDirs.some((item) => path.resolve(item) === path.resolve(nestedBase)),
          'nested-monorepo 必须扫描到第 3 层子包',
        );
        assert.ok(
          !nestedDirs.some((item) =>
            path.resolve(item).startsWith(path.resolve(tooDeep)),
          ),
          'nested-monorepo 不得扫描第 4 层子包',
        );

        const previousCodexHome = process.env.CODEX_HOME;
        const hadCodexHome = Object.prototype.hasOwnProperty.call(process.env, 'CODEX_HOME');
        process.env.CODEX_HOME = codexHome;
        try {
          let snapshot = await engine.snapshot();
          assert.equal(snapshot.harnesses.length, 25);
          const codex = snapshot.harnesses.find((item) => item.id === 'codex');
          const codexCandidates = [...codex.candidates].sort(
            (left, right) => left.priority - right.priority,
          );
          assert.equal(codexCandidates[0].id, 'g-primary');
          assert.equal(codexCandidates[0].path, '$CODEX_HOME/skills');
          assert.equal(codexCandidates[0].exists, true);
          assert.equal(codexCandidates[1].id, 'g-primary-home');
          assert.equal(codexCandidates[1].exists, true);
          assert.equal(codex.physicalGlobalPath, codexEnv);
          assert.equal(codex.detected, true);

          delete process.env.CODEX_HOME;
          const withoutEnv = await engine.snapshot();
          const fallbackCodex = withoutEnv.harnesses.find((item) => item.id === 'codex');
          assert.equal(fallbackCodex.physicalGlobalPath, codexFallback);
          assert.equal(
            fallbackCodex.candidates.find((item) => item.id === 'g-primary').exists,
            false,
          );
          process.env.CODEX_HOME = codexHome;

          snapshot = await engine.snapshot();
          const qoder = snapshot.harnesses.find((item) => item.id === 'qoder');
          assert.equal(
            qoder.detected,
            false,
            '仅有共享层目录时不得把工具标记为本机活跃',
          );
          assert.equal(
            qoder.candidates.find((item) => item.path === '~/.agents/skills').exists,
            true,
          );

          const sharedEntry = snapshot.unmanaged.find(
            (item) =>
              item.name === 'shared-builtin' &&
              path.resolve(item.fsPath) === path.resolve(path.join(sharedDir, 'shared-builtin')),
          );
          assert.ok(sharedEntry);
          assert.equal(sharedEntry.shared, true);
          assert.ok(
            (sharedEntry.sharedHarnessIds ?? []).length >= 20,
            `共享层应映射到多个工具，实际 ${(sharedEntry.sharedHarnessIds ?? []).length}`,
          );
          for (const harnessId of ['agents-common', 'claude-code', 'codex', 'cursor', 'qoder']) {
            assert.ok(
              (sharedEntry.sharedHarnessIds ?? []).includes(harnessId),
              `共享层读者缺少 ${harnessId}`,
            );
          }

          const envDual = snapshot.unmanaged.find(
            (item) =>
              item.name === 'dual-skill' &&
              path.resolve(item.fsPath) === path.resolve(path.join(codexEnv, 'dual-skill')),
          );
          const homeDual = snapshot.unmanaged.find(
            (item) =>
              item.name === 'dual-skill' &&
              path.resolve(item.fsPath) === path.resolve(path.join(codexFallback, 'dual-skill')),
          );
          assert.ok(envDual && homeDual);
          assert.equal(envDual.priority, 0);
          assert.equal(envDual.shadowedBy, null);
          assert.equal(homeDual.priority, 1);
          assert.equal(homeDual.shadowedBy?.candidateId, 'g-primary');
          assert.equal(homeDual.shadowedBy?.priority, 0);

          const parentEntry = snapshot.unmanaged.find(
            (item) => item.name === 'parent-skill',
          );
          assert.ok(parentEntry, 'parent-chain 向上扫描未命中');
          assert.equal(parentEntry.projectId, 'parent-app');
          assert.equal(parentEntry.discoveryLabel, '父级目录 (↑)');
          const nestedEntry = snapshot.unmanaged.find(
            (item) => item.name === 'nested-skill',
          );
          assert.ok(nestedEntry, 'nested-monorepo 向下扫描未命中');
          assert.equal(nestedEntry.projectId, 'nested-mono');
          assert.equal(nestedEntry.discoveryLabel, '子包目录 (↓)');
          assert.ok(
            !snapshot.unmanaged.some((item) => item.name === 'too-deep-skill'),
            '第 4 层子包不得被扫描',
          );
          assert.ok(
            snapshot.unmanaged.some(
              (item) =>
                item.name === 'shadow-skill' &&
                path.resolve(item.fsPath) === path.resolve(path.join(claudeNative, 'shadow-skill')),
            ),
            '原生目录中的 shadow-skill 应可见',
          );

          const qoderNative = path.join(home, '.qoder', 'skills');
          await writeTree(qoderNative, {
            'native-qoder/SKILL.md': '# native-qoder\n\n原生目录技能\n',
          });
          engine.candidateStatsCache.clear();
          const withNative = await engine.snapshot();
          const activeQoder = withNative.harnesses.find((item) => item.id === 'qoder');
          assert.equal(activeQoder.detected, true, '非 shared 候选存在时必须判定为活跃');

          return {
            lines: [
              `内置字典 = ${BUILTINS.length} 项，全部包含有序候选链`,
              `Codex 首选 = $CODEX_HOME/skills → ${codexEnv}（未设置时回退 ${codexFallback}）`,
              `共享层 ~/.agents/skills 映射到 ${(sharedEntry.sharedHarnessIds ?? []).length} 个工具`,
              `parent-chain 命中 ${path.relative(root, parentDirs[0])}`,
              `nested-monorepo 命中第 3 层 ${path.relative(root, nestedBase)}，第 4 层被排除`,
              `同名遮蔽：~/.codex 副本 priority=1 被 CODEX_HOME priority=0 覆盖`,
              '共享层存在不影响 qoder.detected；原生目录出现后 detected=true',
            ],
          };
        } finally {
          if (hadCodexHome) process.env.CODEX_HOME = previousCodexHome;
          else delete process.env.CODEX_HOME;
        }
      },
      { mode: 'sandbox' },
    );
  });

  await runCase(14, '自定义 Harness 与候选路径配置持久化', async () =>
    withHarness(
      'case14-config',
      builtinHarnesses(),
      async ({ engine, root }) => {
        await engine.importLocal(
          await createSkillDir(path.join(root, 'fixtures', 'roundtrip-skill')),
        );
        const skill = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'roundtrip-skill');
        assert.ok(skill);
        await engine.enable({
          skillId: skill.skill_id,
          harnessIds: ['claude-code'],
          scope: 'global',
          syncMode: 'link',
        });
        let binding = bindingFor(engine, 'roundtrip-skill', 'claude-code');
        const originalTarget = binding.target_path;
        assert.ok((await fsp.lstat(originalTarget)).isSymbolicLink());

        const customGlobal = path.join(root, 'my-tool', 'skills');
        const customExtra = path.join(root, 'my-tool', 'extra');
        const payload = engine.config.harnesses.map((item) => engine.harnessPayload(item));
        payload.push({
          id: 'my-tool',
          name: 'My Tool',
          shortName: 'My',
          command: 'mytool',
          category: 'custom',
          candidates: [
            {
              id: 'g-primary',
              path: customGlobal,
              scope: 'global',
              role: 'primary',
              discovery: 'exact',
              priority: 0,
            },
            {
              id: 'g-extra',
              path: customExtra,
              scope: 'global',
              role: 'custom',
              discovery: 'exact',
              priority: 1,
              label: '自定义扫描',
            },
            {
              id: 'p-primary',
              path: '.mytool/skills',
              scope: 'project',
              role: 'primary',
              discovery: 'exact',
              priority: 2,
            },
          ],
        });
        const saveCustom = await engine.saveHarnessConfig({
          harnesses: payload,
          editorCommand: 'cursor .',
        });
        assert.equal(saveCustom.ok, true);
        const customHarness = engine.harness('my-tool');
        assert.ok(customHarness);
        assert.equal(customHarness.is_builtin, false);
        assert.equal(customHarness.category, 'custom');
        assert.equal(customHarness.global_path, customGlobal);
        assert.equal(customHarness.project_rel_path, '.mytool/skills');
        assert.equal(engine.config.harnesses.length, 26);

        const extraDir = path.join(root, 'home', '.claude', 'skills-extra');
        const addResult = await engine.addHarnessCandidate({
          harnessId: 'claude-code',
          path: extraDir,
          scope: 'global',
          role: 'custom',
          discovery: 'exact',
          label: '增量目录',
        });
        assert.equal(addResult.ok, true);
        let claudeHarness = engine.harness('claude-code');
        const addedCandidate = claudeHarness.candidates.find(
          (candidate) => candidate.path === extraDir,
        );
        assert.ok(addedCandidate);
        assert.equal(addedCandidate.role, 'custom');
        assert.equal(addedCandidate.priority, claudeHarness.candidates.length - 1);
        assert.equal(addedCandidate.label, '增量目录');
        let reloaded = await loadConfig(path.join(root, 'config.toml'), 'sandbox');
        assert.equal(reloaded.editor_command, 'cursor .');
        assert.deepEqual(
          harnessShape(reloaded.harnesses.find((item) => item.id === 'claude-code')),
          harnessShape(claudeHarness),
        );
        assert.deepEqual(
          harnessShape(reloaded.harnesses.find((item) => item.id === 'my-tool')),
          harnessShape(customHarness),
        );

        const reorderedCandidates = [
          { ...addedCandidate },
          ...claudeHarness.candidates.filter((candidate) => candidate.id !== addedCandidate.id),
        ];
        const reorderPayload = engine.config.harnesses.map((item) =>
          engine.harnessPayload(
            item.id === 'claude-code' ? { ...item, candidates: reorderedCandidates } : item,
          ),
        );
        await engine.saveHarnessConfig({ harnesses: reorderPayload });
        claudeHarness = engine.harness('claude-code');
        assert.deepEqual(
          claudeHarness.candidates.map((candidate) => candidate.id),
          reorderedCandidates.map((candidate) => candidate.id),
        );
        assert.deepEqual(
          claudeHarness.candidates.map((candidate) => candidate.priority),
          claudeHarness.candidates.map((_, index) => index),
        );
        reloaded = await loadConfig(path.join(root, 'config.toml'), 'sandbox');
        assert.deepEqual(
          reloaded.harnesses
            .find((item) => item.id === 'claude-code')
            .candidates.map((candidate) => [candidate.id, candidate.priority]),
          claudeHarness.candidates.map((candidate) => [candidate.id, candidate.priority]),
        );

        const nextPrimary = path.join(root, 'home', '.claude', 'skills-next');
        const movedPayload = engine.config.harnesses.map((item) =>
          engine.harnessPayload(
            item.id === 'claude-code'
              ? {
                  ...item,
                  candidates: item.candidates.map((candidate) =>
                    candidate.id === 'g-primary'
                      ? { ...candidate, path: nextPrimary }
                      : candidate,
                  ),
                }
              : item,
          ),
        );
        const movableBindings = engine.db.all(
          "SELECT * FROM bindings WHERE harness_id = 'claude-code' AND scope = 'global' AND state != 'orphaned'",
        );
        const movedResult = await engine.saveHarnessConfig({ harnesses: movedPayload });
        assert.equal(movedResult.ok, true);
        assert.match(
          movedResult.description,
          new RegExp(`重新部署 ${movableBindings.length} 个绑定`),
        );
        binding = engine.db.get('SELECT * FROM bindings WHERE binding_id = ?', binding.binding_id);
        const nextTarget = path.join(nextPrimary, 'roundtrip-skill');
        assert.equal(path.resolve(binding.target_path), path.resolve(nextTarget));
        assert.equal(binding.candidate_id, 'g-primary');
        await assert.rejects(fsp.lstat(originalTarget), (error) => error.code === 'ENOENT');
        assert.ok((await fsp.lstat(nextTarget)).isSymbolicLink());
        assert.equal(
          await fsp.realpath(nextTarget),
          await fsp.realpath(path.join(root, 'store', 'sha256', skill.active_sha)),
        );
        reloaded = await loadConfig(path.join(root, 'config.toml'), 'sandbox');
        assert.equal(
          reloaded.harnesses
            .find((item) => item.id === 'claude-code')
            .candidates.find((candidate) => candidate.id === 'g-primary').path,
          nextPrimary,
        );

        const resetResult = await engine.resetHarnessDefaults('claude-code');
        assert.equal(resetResult.ok, true);
        claudeHarness = engine.harness('claude-code');
        assert.deepEqual(harnessShape(claudeHarness), harnessShape(defaultHarness('claude-code')));
        assert.ok(!claudeHarness.candidates.some((candidate) => candidate.path === extraDir));
        binding = engine.db.get('SELECT * FROM bindings WHERE binding_id = ?', binding.binding_id);
        assert.equal(path.resolve(binding.target_path), path.resolve(originalTarget));
        assert.ok((await fsp.lstat(originalTarget)).isSymbolicLink());
        assert.ok(engine.harness('my-tool'), '恢复内置默认不得删除自定义 Harness');

        reloaded = await loadConfig(path.join(root, 'config.toml'), 'sandbox');
        assert.equal(reloaded.harnesses.length, 26);
        assert.deepEqual(reloaded.removed_harnesses, []);
        assert.equal(reloaded.editor_command, 'cursor .');
        for (const harness of engine.config.harnesses) {
          const restored = reloaded.harnesses.find((item) => item.id === harness.id);
          assert.ok(restored, `config.toml 缺少 ${harness.id}`);
          assert.deepEqual(harnessShape(restored), harnessShape(harness));
        }
        const configText = await fsp.readFile(path.join(root, 'config.toml'), 'utf8');
        assert.match(configText, /\[harnesses\.my-tool\]/);
        assert.match(configText, /editor_command = "cursor \."/);

        return {
          lines: [
            `自定义 Harness = my-tool（26 个工具），editor_command = "cursor ."`,
            `追加候选 = ${addedCandidate.id}（priority ${addedCandidate.priority}）`,
            `重排后顺序 = ${claudeHarness.candidates.map((candidate) => candidate.id).join(' → ')}（恢复默认后）`,
            `修改 primary → 绑定自动重挂到 ${nextTarget}`,
            `恢复默认 → 绑定回到 ${originalTarget}，自定义工具保留`,
            `config.toml 26 个工具的 id / 名称 / 候选链 / 优先级逐项回读一致`,
          ],
        };
      },
      { mode: 'sandbox' },
    ),
  );

  await runCase(15, '跨工具共享目录解绑裁决与物理文件准确性', async () => {
    const caseRoot = path.join(TEMP_BASE, 'case15-shared-unbind');
    const sharedDir = path.join(caseRoot, 'home', 'agents', 'skills');
    const claudeDir = path.join(caseRoot, 'home', 'claude', 'skills');
    const codexDir = path.join(caseRoot, 'home', 'codex', 'skills');
    const cursorDir = path.join(caseRoot, 'home', 'cursor', 'skills');
    const candidate = (id, candidatePath, scope, role, discovery, priority) => ({
      id,
      path: candidatePath,
      scope,
      role,
      discovery,
      priority,
    });
    const harnesses = [
      {
        id: 'claude-code',
        name: 'Claude Code',
        short_name: 'Claude',
        command: 'claude',
        candidates: [
          candidate('g-primary', claudeDir, 'global', 'primary', 'exact', 0),
          candidate('g-shared', sharedDir, 'global', 'shared', 'exact', 1),
        ],
      },
      {
        id: 'codex',
        name: 'OpenAI Codex',
        short_name: 'Codex',
        command: 'codex',
        candidates: [
          candidate('g-primary', codexDir, 'global', 'primary', 'exact', 0),
          candidate('g-shared', sharedDir, 'global', 'shared', 'exact', 1),
        ],
      },
      {
        id: 'cursor',
        name: 'Cursor',
        short_name: 'Cursor',
        command: 'cursor',
        candidates: [candidate('g-shared', sharedDir, 'global', 'shared', 'exact', 0)],
      },
    ];

    return withHarness('case15-shared-unbind', harnesses, async ({ engine, root }) => {
      await writeTree(sharedDir, {
        'bystander/SKILL.md': '# bystander\n\n共享目录中的其它技能\n',
      });
      const bystanderFile = path.join(sharedDir, 'bystander', 'SKILL.md');
      const bystanderBefore = await fsp.readFile(bystanderFile, 'utf8');

      await engine.importLocal(
        await createSkillDir(path.join(caseRoot, 'fixtures', 'split-skill')),
      );
      const splitSkill = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'split-skill');
      assert.ok(splitSkill);
      await engine.enable({
        skillId: splitSkill.skill_id,
        targets: [{ harnessId: 'claude-code', candidateId: 'g-shared' }],
        scope: 'global',
        syncMode: 'link',
      });
      const splitBinding = bindingFor(engine, 'split-skill', 'claude-code');
      const splitStore = path.join(root, 'store', 'sha256', splitSkill.active_sha);
      const splitStoreBefore = manifestSnapshot(await treeManifest(splitStore));
      const splitAlias = path.join(
        root,
        'available',
        `split-skill@${splitSkill.active_sha.slice(0, 7)}`,
      );
      const splitAliasBefore = manifestSnapshot(await treeManifest(splitAlias));
      const splitSharedEntry = path.join(sharedDir, 'split-skill');
      assert.ok((await fsp.lstat(splitSharedEntry)).isSymbolicLink());
      await assert.rejects(
        engine.disable(splitBinding.binding_id),
        (error) => error.code === 'SHARED_CONFIRM',
      );
      assert.ok((await fsp.lstat(splitSharedEntry)).isSymbolicLink(), '未裁决前不得删除共享入口');

      const splitResult = await engine.disable(splitBinding.binding_id, 'split');
      assert.match(splitResult.description, /没有共享目录之外的首选路径/);
      await assert.rejects(fsp.lstat(splitSharedEntry), (error) => error.code === 'ENOENT');
      const codexBinding = bindingFor(engine, 'split-skill', 'codex');
      const codexTarget = path.join(codexDir, 'split-skill');
      assert.equal(path.resolve(codexBinding.target_path), path.resolve(codexTarget));
      assert.ok((await fsp.lstat(codexTarget)).isSymbolicLink());
      assert.equal(await fsp.realpath(codexTarget), await fsp.realpath(splitStore));
      assert.ok((await fsp.readFile(path.join(codexTarget, 'SKILL.md'), 'utf8')).includes('split-skill'));
      await assert.rejects(
        fsp.lstat(path.join(cursorDir, 'split-skill')),
        (error) => error.code === 'ENOENT',
      );
      await assert.rejects(
        fsp.lstat(path.join(claudeDir, 'split-skill')),
        (error) => error.code === 'ENOENT',
      );
      assert.equal(await fsp.readFile(bystanderFile, 'utf8'), bystanderBefore);
      assert.deepEqual(
        manifestSnapshot(await treeManifest(splitStore)),
        splitStoreBefore,
        '拆分禁用不得修改 store 源文件',
      );
      assert.deepEqual(
        manifestSnapshot(await treeManifest(splitAlias)),
        splitAliasBefore,
        '拆分禁用不得修改 available 别名',
      );
      assert.deepEqual(await fsp.readdir(sharedDir), ['bystander']);

      await engine.importLocal(
        await createSkillDir(path.join(caseRoot, 'fixtures', 'all-skill')),
      );
      const allSkill = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'all-skill');
      assert.ok(allSkill);
      await engine.enable({
        skillId: allSkill.skill_id,
        targets: [{ harnessId: 'claude-code', candidateId: 'g-shared' }],
        scope: 'global',
        syncMode: 'link',
      });
      const allBinding = bindingFor(engine, 'all-skill', 'claude-code');
      const allStore = path.join(root, 'store', 'sha256', allSkill.active_sha);
      const allStoreBefore = manifestSnapshot(await treeManifest(allStore));
      const allResult = await engine.disable(allBinding.binding_id, 'all');
      assert.match(allResult.message, /彻底移除/);
      assert.equal(
        engine.db.get(
          'SELECT COUNT(*) AS count FROM bindings WHERE skill_id = ?',
          allSkill.skill_id,
        ).count,
        0,
      );
      await assert.rejects(
        fsp.lstat(path.join(sharedDir, 'all-skill')),
        (error) => error.code === 'ENOENT',
      );
      for (const dir of [claudeDir, codexDir, cursorDir]) {
        await assert.rejects(
          fsp.lstat(path.join(dir, 'all-skill')),
          (error) => error.code === 'ENOENT',
        );
      }
      assert.equal(await fsp.readFile(bystanderFile, 'utf8'), bystanderBefore);
      assert.deepEqual(
        manifestSnapshot(await treeManifest(allStore)),
        allStoreBefore,
        '彻底移除不得修改 store 源文件',
      );
      assert.deepEqual(await fsp.readdir(sharedDir), ['bystander']);

      return {
        lines: [
          '共用读者 = codex + cursor；默认 disable → SHARED_CONFIRM，物理入口保持不变',
          'smart split → 共享入口删除，codex 原生目录重建链接，cursor 无备选目录已跳过',
          `all → 共享入口删除、所有工具绑定 0 条，store / available 清单完全一致`,
          '共享目录仅剩旁观技能 bystander，内容未被改动',
        ],
      };
    });
  });

  await runCase(16, 'Windows ~ 缩写还原为真实反斜杠绝对路径', async () =>
    withHarness(
      'case16-winpath',
      [
        {
          id: 'win-path-test',
          name: 'Win Path',
          short_name: 'WinPath',
          command: 'wpt',
          candidates: [
            {
              id: 'g-primary',
              path: '~/.quiver-winpath/skills',
              scope: 'global',
              role: 'primary',
              discovery: 'exact',
              priority: 0,
            },
            {
              id: 'p-primary',
              path: '.quiver-winpath/skills',
              scope: 'project',
              role: 'primary',
              discovery: 'exact',
              priority: 1,
            },
          ],
        },
      ],
      async ({ engine }) => {
        const fakeHome = process.platform === 'win32' ? 'C:\\Users\\QuiverTest' : '/home/quiver-test';
        const resolved = resolveGlobalBase(
          { path: '~/.quiver-winpath/skills' },
          { homeDir: fakeHome, env: {} },
        );
        assert.ok(path.isAbsolute(resolved));
        if (process.platform === 'win32') {
          assert.match(resolved, /^[A-Za-z]:\\/);
          assert.equal(resolved.includes('/'), false, 'Windows 真实路径必须使用反斜杠');
          assert.equal(resolved, 'C:\\Users\\QuiverTest\\.quiver-winpath\\skills');
        }
        const expanded = expandPath('~/AppData/Roaming', { homeDir: fakeHome });
        assert.equal(
          expanded,
          path.join(fakeHome, 'AppData', 'Roaming'),
          '~ 缩写必须展开为绝对路径',
        );
        const envResolved = resolveGlobalBase(
          { path: '$CODEX_HOME/skills' },
          {
            homeDir: fakeHome,
            env: { CODEX_HOME: process.platform === 'win32' ? 'C:\\Quiver\\codex-home' : '/opt/quiver-codex' },
          },
        );
        assert.equal(
          envResolved,
          path.resolve(process.platform === 'win32' ? 'C:\\Quiver\\codex-home' : '/opt/quiver-codex', 'skills'),
        );
        assert.equal(
          path.isAbsolute(envResolved),
          true,
          '环境变量候选同样必须还原为绝对路径',
        );

        const harness = engine.harness('win-path-test');
        assert.ok(harness);
        const physical = engine.globalBase(harness.candidates[0]);
        assert.ok(path.isAbsolute(physical));
        if (process.platform === 'win32') {
          assert.equal(physical.includes('/'), false);
          assert.equal(physical, path.join(os.homedir(), '.quiver-winpath', 'skills'));
        }

        return {
          lines: [
            `平台 = ${process.platform}/${process.arch}`,
            `~/.quiver-winpath/skills → ${resolved}`,
            `$CODEX_HOME/skills → ${envResolved}`,
            `engine.globalBase → ${physical}（绝对路径）`,
          ],
        };
      },
    ),
  );

  await runCase(17, '收藏 is_favorite 平滑迁移、切换与置顶排序', async () =>
    withHarness('case17-favorites', async ({ engine, root }) => {
      await engine.importLocal(
        await createSkillDir(path.join(root, 'fixtures', 'legacy-skill')),
      );
      const legacy = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'legacy-skill');
      assert.ok(legacy);
      assert.equal(legacy.is_favorite, 0);

      await engine.close();
      const raw = new DatabaseSync(path.join(root, 'metadata.db'));
      const beforeMigration = raw
        .prepare('PRAGMA table_info(skills)')
        .all()
        .map((column) => column.name);
      assert.ok(beforeMigration.includes('is_favorite'));
      raw.exec('ALTER TABLE skills DROP COLUMN is_favorite');
      const legacyColumns = raw
        .prepare('PRAGMA table_info(skills)')
        .all()
        .map((column) => column.name);
      assert.ok(!legacyColumns.includes('is_favorite'), '旧库必须确实缺少该列');
      raw.close();

      await engine.openRoot();
      const columns = engine.db.all('PRAGMA table_info(skills)');
      const favoriteColumn = columns.find((column) => column.name === 'is_favorite');
      assert.ok(favoriteColumn, '启动时必须补齐 is_favorite 列');
      assert.equal(favoriteColumn.notnull, 1);
      assert.equal(String(favoriteColumn.dflt_value), '0');
      const migratedLegacy = engine.db.get(
        'SELECT * FROM skills WHERE slug = ?',
        'legacy-skill',
      );
      assert.equal(migratedLegacy.is_favorite, 0, '迁移后存量技能默认未收藏');

      await engine.importLocal(
        await createSkillDir(path.join(root, 'fixtures', 'later-skill')),
      );
      const later = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'later-skill');
      assert.ok(later);
      assert.equal((await engine.toggleFavorite(later.skill_id)).ok, true);
      let snapshot = await engine.snapshot();
      assert.equal(snapshot.skills.find((item) => item.id === later.skill_id).isFavorite, true);
      assert.equal(snapshot.skills.find((item) => item.id === legacy.skill_id).isFavorite, false);

      const { favoritesFirst } = await import(
        pathToFileURL(path.join(repoRoot, 'src/lib/favorites.ts')).href
      );
      const ordered = favoritesFirst(snapshot.skills);
      assert.equal(ordered[0].id, later.skill_id, '收藏技能必须置顶');
      const sample = [
        { id: 'beta', displayName: 'Beta', isFavorite: true },
        { id: 'alpha', displayName: 'Alpha', isFavorite: true },
        { id: 'gamma', displayName: 'Gamma', isFavorite: false },
      ];
      assert.deepEqual(
        favoritesFirst(sample, (left, right) => left.displayName.localeCompare(right.displayName)).map(
          (item) => item.id,
        ),
        ['alpha', 'beta', 'gamma'],
        '收藏内部按调用方提供的次要排序稳定排列',
      );
      assert.deepEqual(
        favoritesFirst(snapshot.skills.filter((item) => item.isFavorite)).map((item) => item.id),
        [later.skill_id],
      );

      await engine.toggleFavorite(later.skill_id);
      snapshot = await engine.snapshot();
      assert.equal(snapshot.skills.find((item) => item.id === later.skill_id).isFavorite, false);
      assert.equal(snapshot.skills.filter((item) => item.isFavorite).length, 0);
      await engine.toggleFavorite(legacy.skill_id);
      snapshot = await engine.snapshot();
      assert.equal(favoritesFirst(snapshot.skills)[0].id, legacy.skill_id);

      const audits = engine.db.all(
        "SELECT * FROM audit_logs WHERE action = 'toggle_favorite' ORDER BY id ASC",
      );
      assert.equal(audits.length, 3);
      assert.deepEqual(audits.map((item) => item.detail), ['已收藏', '已取消收藏', '已收藏']);

      return {
        lines: [
          '旧库（无 is_favorite）启动 → ALTER TABLE 补齐，notnull=1 / default=0',
          `存量技能 ${legacy.slug} 迁移后 isFavorite=false`,
          `切换 ${later.slug} → snapshot.isFavorite=true，favoritesFirst 置顶`,
          '收藏过滤器只返回已收藏技能；二次切换恢复 false',
          `toggle_favorite 审计 = ${audits.map((item) => item.detail).join(' → ')}`,
        ],
      };
    }),
  );

  await runCase(18, '转为本地副本的原子性与缺失目标恢复', async () =>
    withHarness('case18-copy-recovery', async ({ engine, root }) => {
      await engine.importLocal(
        await createSkillDir(path.join(root, 'fixtures', 'copy-recovery'), {
          'assets/payload.txt': 'payload-before\n',
        }),
      );
      const skill = engine.db.get('SELECT * FROM skills WHERE slug = ?', 'copy-recovery');
      assert.ok(skill);
      await engine.enable({
        skillId: skill.skill_id,
        harnessIds: ['claude-code'],
        scope: 'global',
        syncMode: 'link',
      });
      let binding = bindingFor(engine, 'copy-recovery', 'claude-code');
      const target = binding.target_path;
      assert.equal((await fsp.lstat(target)).isSymbolicLink(), true);

      const realCp = fsp.cp;
      fsp.cp = async () => {
        const error = new Error('simulated copy failure');
        error.code = 'EACCES';
        throw error;
      };
      let failed = null;
      try {
        await engine.convertToCopy(binding.binding_id);
      } catch (error) {
        failed = error;
      } finally {
        fsp.cp = realCp;
      }
      assert.ok(failed, '复制失败必须抛出错误');
      assert.equal(
        (await fsp.lstat(target)).isSymbolicLink(),
        true,
        '复制失败时原有链接必须保留，不能先删除入口',
      );
      assert.equal(
        await fsp.readFile(path.join(target, 'assets/payload.txt'), 'utf8'),
        'payload-before\n',
      );
      binding = engine.db.get('SELECT * FROM bindings WHERE binding_id = ?', binding.binding_id);
      assert.equal(binding.sync_mode, 'link');
      assert.equal(binding.state, 'enabled');

      const result = await engine.convertToCopy(binding.binding_id);
      assert.equal(result.ok, true);
      binding = engine.db.get('SELECT * FROM bindings WHERE binding_id = ?', binding.binding_id);
      assert.equal(binding.sync_mode, 'copy');
      assert.equal(binding.state, 'enabled');
      assert.equal((await fsp.lstat(target)).isSymbolicLink(), false);
      assert.equal(
        await fsp.readFile(path.join(target, 'assets/payload.txt'), 'utf8'),
        'payload-before\n',
      );

      const second = await engine.convertToCopy(binding.binding_id);
      assert.equal(second.ok, true);
      assert.match(second.message, /已经是本地副本/);

      await ensureWritable(target);
      await fsp.rm(target, { recursive: true, force: true });
      assert.equal(await fsp.lstat(target).catch(() => null), null);
      await engine.resetBinding(binding.binding_id);
      const restored = await fsp.lstat(target);
      assert.equal(restored.isDirectory(), true, '重新恢复必须重建真实目录而不是只改状态');
      assert.equal(
        await fsp.readFile(path.join(target, 'assets/payload.txt'), 'utf8'),
        'payload-before\n',
      );
      const after = engine.db.get('SELECT * FROM bindings WHERE binding_id = ?', binding.binding_id);
      assert.equal(after.state, 'enabled');

      const crossSource = path.join(root, 'cross-volume-source');
      const crossTarget = path.join(root, 'cross-volume-target');
      await writeTree(crossSource, { 'SKILL.md': '# cross volume\n' });
      const realRename = fsp.rename;
      let firstRename = true;
      fsp.rename = async (...args) => {
        if (firstRename) {
          firstRename = false;
          const error = new Error('cross-device link not permitted');
          error.code = 'EXDEV';
          throw error;
        }
        return realRename(...args);
      };
      try {
        await moveEntry(crossSource, crossTarget);
      } finally {
        fsp.rename = realRename;
      }
      assert.equal(
        await fsp.readFile(path.join(crossTarget, 'SKILL.md'), 'utf8'),
        '# cross volume\n',
        '跨卷 EXDEV 必须回落到复制移动',
      );
      assert.equal(await fsp.lstat(crossSource).catch(() => null), null);

      return {
        lines: [
          '模拟复制失败 → 原链接与内容保持不变，绑定仍为 link/enabled',
          '重新转换 → 真实目录 + copy/enabled，内容与中央库一致',
          '删除副本目录后 resetBinding → 重建真实目录并恢复内容',
          '模拟 EXDEV → moveEntry 自动回落复制，源目录清理完成',
        ],
      };
    }),
  );

  await runCase(19, '托盘驻留开关默认关闭与配置往返', async () =>
    withHarness('case19-tray', async ({ engine, root }) => {
      const initial = await engine.snapshot();
      assert.equal(initial.settings.trayOnClose, false, '默认必须关闭托盘驻留');

      const enabled = await engine.setTrayOnClose(true);
      assert.equal(enabled.ok, true);
      assert.equal(enabled.snapshot.settings.trayOnClose, true);
      const configFile = path.join(root, 'config.toml');
      const enabledText = await fsp.readFile(configFile, 'utf8');
      assert.match(enabledText, /tray_on_close = "true"/);
      assert.equal((await loadConfig(configFile, engine.mode)).tray_on_close, true);

      const saved = await engine.saveHarnessConfig({
        editorCommand: engine.config.editor_command,
      });
      assert.equal(saved.snapshot.settings.trayOnClose, true, '保存工具配置不得丢失托盘开关');
      assert.match(await fsp.readFile(configFile, 'utf8'), /tray_on_close = "true"/);

      const disabled = await engine.setTrayOnClose(false);
      assert.equal(disabled.snapshot.settings.trayOnClose, false);
      assert.match(await fsp.readFile(configFile, 'utf8'), /tray_on_close = "false"/);
      assert.equal((await loadConfig(configFile, engine.mode)).tray_on_close, false);

      return {
        lines: [
          '默认 false → 点击 × 直接退出，不创建托盘',
          '开启后写入 config.toml，并随快照返回 trayOnClose=true',
          'saveHarnessConfig 往返保留托盘设置',
          '关闭后恢复 false，重新加载配置一致',
        ],
      };
    }),
  );

  await runCase(20, '旧版配置迁移：Cline 名称、Goose 补齐与 CODEX_HOME 中文标签', async () => {
    const legacyToml = [
      '[harnesses.cline]',
      'name = "Cline / Roo Code"',
      'short_name = "Cline / Roo Code"',
      'command = "cline"',
      'category = "global"',
      'is_builtin = "true"',
      'global_path = "~/.cline/skills"',
      'project_rel_path = ".cline/skills"',
      'candidates = "[]"',
      '',
      '[harnesses.codex]',
      'name = "OpenAI Codex"',
      'short_name = "Codex"',
      'command = "codex"',
      'category = "global"',
      'is_builtin = "true"',
      'global_path = "~/.codex/skills"',
      'project_rel_path = ".codex/skills"',
      `candidates = "${JSON.stringify([
        {
          id: 'g-primary',
          path: '~/.codex/skills',
          scope: 'global',
          role: 'primary',
          discovery: 'exact',
          priority: 0,
          label: 'CODEX_HOME',
        },
      ]).replaceAll('"', '\\"')}"`,
      '',
    ].join('\n');
    const parsed = parseToml(legacyToml, 'sandbox');
    assert.equal(parsed.harnesses.length, BUILTINS.length, '旧配置必须补齐为 25 个内置工具');
    const ids = new Set(parsed.harnesses.map((harness) => harness.id));
    for (const builtin of BUILTINS) {
      assert.ok(ids.has(builtin.id), `旧配置缺少内置工具 ${builtin.id}`);
    }
    const cline = parsed.harnesses.find((harness) => harness.id === 'cline');
    assert.equal(cline.name, 'Cline', '旧版 Cline / Roo Code 必须迁移为 Cline');
    assert.equal(cline.short_name, 'Cline');
    const goose = parsed.harnesses.find((harness) => harness.id === 'goose');
    assert.ok(
      goose.candidates.some((candidate) => candidate.path === '~/.config/goose/skills'),
      'Goose 必须带全局 ~/.config/goose/skills 候选',
    );
    assert.ok(
      goose.candidates.some((candidate) => candidate.path === '.goose/skills'),
      'Goose 必须带项目 .goose/skills 候选',
    );
    const codex = parsed.harnesses.find((harness) => harness.id === 'codex');
    const migrated = codex.candidates.find((candidate) => candidate.path === '~/.codex/skills');
    assert.ok(migrated, 'Codex 旧候选路径必须保留');
    assert.equal(migrated.label, '原生主目录');
    assert.ok(
      codex.candidates.every((candidate) => candidate.label !== 'CODEX_HOME'),
      '不允许残留 CODEX_HOME 原始标签',
    );

    const previousCodexHome = process.env.CODEX_HOME;
    delete process.env.CODEX_HOME;
    assert.equal(
      roleLabel({ path: '$CODEX_HOME/skills', role: 'primary' }),
      '原生主目录',
    );
    process.env.CODEX_HOME = path.join(TEMP_BASE, 'codex-home-label');
    try {
      assert.equal(
        roleLabel({ path: '${CODEX_HOME}/skills', role: 'primary' }),
        '环境变量主目录',
      );
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }

    return {
      lines: [
        `旧配置 2 个工具 → 补齐 ${parsed.harnesses.length} 个内置工具（含 Goose）`,
        'Cline / Roo Code → Cline（名称与短名同步迁移）',
        'CODEX_HOME → 原生主目录；设置环境变量后显示环境变量主目录',
      ],
    };
  });

  for (const harness of [...liveHarnesses]) await closeHarness(harness);
  await ensureWritable(TEMP_BASE).catch(() => {});
  if (KEEP) {
    console.log(`\n保留隔离目录：${TEMP_BASE}`);
  } else {
    await fsp
      .rm(TEMP_BASE, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })
      .catch(() => {});
  }

  const passed = results.filter((result) => result.status === 'PASS').length;
  console.log('\n================ 结果汇总 ================');
  for (const result of results) {
    console.log(
      `${result.status.padEnd(4)}  ${result.id}. ${result.title}  ${result.ms} ms`,
    );
  }
  console.log(`${passed}/${results.length} 通过`);
  process.exit(passed === results.length ? 0 : 1);
}

await main();
