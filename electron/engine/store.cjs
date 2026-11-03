const { execFile } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { assertImportable, hashDirectory } = require('./hash.cjs');
const {
  EngineError,
  IGNORED_NAMES,
  isPermissionError,
  lstatOrNull,
  moveEntry,
  removeEntry,
  setReadOnly,
  shortSha,
  toEngineError,
  uuid,
  within,
} = require('./util.cjs');

const execFileAsync = promisify(execFile);

const DEFAULT_ADOPT_COMMENT = '从 Harness 目录收编的本地技能。';
const TEXT_READ_LIMIT = 512 * 1024;
const PREVIEW_FILE_LIMIT = 5000;

function collapseWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function stripInlineMarkdown(value) {
  return collapseWhitespace(
    String(value)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
      .replace(/[*_~`]+/g, ''),
  );
}

function stripBlockIndent(lines) {
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => (line.match(/^[ \t]*/) ?? [''])[0].length);
  const min = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(min));
}

function frontmatterDescription(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const field = lines[index].match(/^description\s*:\s*(.*)$/i);
    if (!field) continue;
    const continuation = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      if (!/^\s/.test(lines[next]) && lines[next].trim() !== '') break;
      continuation.push(lines[next]);
    }
    while (
      continuation.length > 0 &&
      continuation[continuation.length - 1].trim() === ''
    ) {
      continuation.pop();
    }
    let inline = field[1].trim();
    if (!inline && continuation.length > 0) {
      return stripInlineMarkdown(stripBlockIndent(continuation).join(' '));
    }
    if (/^[|>][+-]?$/.test(inline)) {
      const folded = inline.startsWith('>');
      const block = stripBlockIndent(continuation)
        .map((line) => (folded ? line.trim() : line))
        .filter((line, lineIndex, list) => line || list[lineIndex - 1]);
      return stripInlineMarkdown(block.join(folded ? ' ' : '\n'));
    }
    const quote = inline[0];
    if ((quote === '"' || quote === "'") && !inline.slice(1).includes(quote)) {
      inline = [inline, ...continuation.map((line) => line.trim())].join(' ');
    }
    if (!/^['"]/.test(inline)) {
      const comment = inline.search(/\s#/);
      if (comment >= 0) inline = inline.slice(0, comment);
    }
    let value = inline;
    if (quote === '"' && value.startsWith('"') && value.lastIndexOf('"') > 0) {
      const raw = value.slice(1, value.lastIndexOf('"'));
      try {
        value = JSON.parse(`"${raw.replaceAll('\n', '\\n')}"`);
      } catch {
        value = raw;
      }
    } else if (quote === "'" && value.startsWith("'") && value.lastIndexOf("'") > 0) {
      value = value.slice(1, value.lastIndexOf("'")).replaceAll("''", "'");
    }
    return stripInlineMarkdown(value);
  }
  return null;
}

function firstBodyParagraph(body) {
  const lines = String(body)
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/);
  const collected = [];
  let started = false;
  let inFence = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^```/.test(line)) {
      if (inFence) {
        inFence = false;
        continue;
      }
      if (started) break;
      inFence = true;
      continue;
    }
    if (inFence) continue;
    if (!started) {
      if (!line) continue;
      if (/^#{1,6}\s/.test(line)) continue;
      if (/^([-*_])\1{2,}$/.test(line)) continue;
      if (/^<[^>]+>$/.test(line)) continue;
      started = true;
    } else if (!line || /^#{1,6}\s/.test(line)) {
      break;
    }
    collected.push(
      line
        .replace(/^\s*(?:>\s*)+/, '')
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''),
    );
  }
  const text = stripInlineMarkdown(collected.join(' '));
  return text || null;
}

function parseSkillDescription(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  if (!source.trim()) return null;
  const match = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (match) {
    const description = frontmatterDescription(match[1].split(/\r?\n/));
    if (description) return description;
  }
  return firstBodyParagraph(match ? source.slice(match[0].length) : source);
}

async function readTextFileLimited(file, limit = TEXT_READ_LIMIT) {
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat?.isFile()) return null;
  if (stat.size <= limit) return fsp.readFile(file, 'utf8');
  const handle = await fsp.open(file, 'r');
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function readSkillDescriptionFromDir(sourceDir) {
  const file = path.join(sourceDir, 'SKILL.md');
  try {
    const text = await readTextFileLimited(file);
    return text === null ? null : parseSkillDescription(text);
  } catch (error) {
    if (isPermissionError(error)) throw toEngineError(error, file);
    return null;
  }
}

async function readStoredSkillDescription(engine, sha) {
  if (!sha) return null;
  return readSkillDescriptionFromDir(storeDir(engine, sha));
}

async function refreshDefaultSkillComments(engine) {
  const rows = engine.db.all(
    'SELECT skill_id, active_sha, comment FROM skills WHERE comment = ?',
    DEFAULT_ADOPT_COMMENT,
  );
  let refreshed = 0;
  for (const row of rows) {
    const description = await readStoredSkillDescription(engine, row.active_sha);
    if (!description) continue;
    engine.db.run(
      'UPDATE skills SET comment = ? WHERE skill_id = ?',
      description,
      row.skill_id,
    );
    refreshed += 1;
  }
  return refreshed;
}

async function readSkillPreview(engine, sha) {
  const root = storeDir(engine, String(sha ?? ''));
  if (!(await fsp.stat(root).catch(() => null))) {
    throw new EngineError('中央库缺少该版本内容，无法预览', 'STORE_MISSING');
  }
  const files = [];
  let skillFile = null;
  let overflow = false;
  const stack = [{ abs: root, rel: '' }];
  while (stack.length > 0 && !overflow) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = await fsp.readdir(current.abs, { withFileTypes: true });
    } catch (error) {
      if (isPermissionError(error)) throw toEngineError(error, current.abs);
      return null;
    }
    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry.name)) continue;
      const abs = path.join(current.abs, entry.name);
      const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name;
      const stat = await fsp.lstat(abs).catch(() => null);
      if (!stat || stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        stack.push({ abs, rel });
        continue;
      }
      if (!stat.isFile()) continue;
      if (files.length >= PREVIEW_FILE_LIMIT) {
        overflow = true;
        break;
      }
      files.push({ path: rel, size: stat.size });
      if (entry.name.toLowerCase() === 'skill.md') {
        if (!skillFile || rel.toLowerCase() === 'skill.md') {
          skillFile = { abs, size: stat.size };
        }
      }
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  let skillMarkdown = null;
  let truncated = false;
  if (skillFile) {
    const text = await readTextFileLimited(skillFile.abs)
      .then((value) => value ?? '')
      .catch((error) => {
        if (isPermissionError(error)) throw toEngineError(error, skillFile.abs);
        return '';
      });
    skillMarkdown = text;
    truncated = skillFile.size > TEXT_READ_LIMIT;
  }
  return {
    sha: String(sha),
    files,
    skillMarkdown,
    truncated,
    overflow,
  };
}

function sanitizeDependencies(input) {
  const list = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[,，\s]+/)
      : [];
  return Array.from(
    new Set(
      list
        .map((item) => String(item).trim().replace(/^['"]|['"]$/g, ''))
        .filter((item) => item && /^[\p{L}\p{N}._-]+$/u.test(item)),
    ),
  ).slice(0, 40);
}

function frontmatterDependencies(text) {
  const match = String(text)
    .replace(/^\uFEFF/, '')
    .match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return [];
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const field = lines[index].match(
      /^(?:depends_on|depends-on|dependencies)\s*:\s*(.*)$/i,
    );
    if (!field) continue;
    const inline = field[1].trim();
    if (inline) {
      return sanitizeDependencies(inline.replace(/^\[/, '').replace(/\]$/, ''));
    }
    const items = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      const item = lines[next].match(/^\s*-\s*(.+)$/);
      if (!item) break;
      items.push(item[1].trim());
    }
    return sanitizeDependencies(items);
  }
  return [];
}

async function readDeclaredDependencies(sourceDir) {
  try {
    const raw = await fsp.readFile(path.join(sourceDir, 'quiver.json'), 'utf8');
    const manifest = JSON.parse(raw);
    const declared = manifest?.dependsOn ?? manifest?.depends_on;
    if (declared !== undefined) return sanitizeDependencies(declared);
  } catch {
    /* quiver.json is optional */
  }
  try {
    const text = await fsp.readFile(path.join(sourceDir, 'SKILL.md'), 'utf8');
    return frontmatterDependencies(text);
  } catch (error) {
    if (isPermissionError(error)) throw toEngineError(error, path.join(sourceDir, 'SKILL.md'));
    return [];
  }
}

function assertSafeBackupSlug(value) {
  const slug = String(value ?? '');
  if (
    !slug ||
    slug === '.' ||
    slug === '..' ||
    slug.includes('/') ||
    slug.includes('\\') ||
    !/^[\p{L}\p{N}._-]+$/u.test(slug)
  ) {
    throw new EngineError(`备份包含非法的技能标识：${slug || '(空)'}`, 'BAD_BACKUP_SLUG');
  }
  return slug;
}

function storeDir(engine, sha) {
  return path.join(engine.root, 'store', 'sha256', sha);
}

function availableDir(engine, slug, sha) {
  return path.join(engine.root, 'available', `${slug}@${shortSha(sha)}`);
}

async function ensureAvailableLink(engine, slug, sha) {
  const target = storeDir(engine, sha);
  if (!(await fsp.stat(target).catch(() => null))) {
    throw new EngineError(`中央库缺少版本 ${sha}`, 'STORE_MISSING');
  }
  const link = availableDir(engine, slug, sha);
  const existing = await fsp.lstat(link).catch(() => null);
  if (existing) {
    const real = await fsp.realpath(link).catch(() => null);
    const source = await fsp.realpath(target).catch(() => null);
    if (real && source && real === source) return link;
    await removeEntry(link);
  }
  await fsp.mkdir(path.dirname(link), { recursive: true });
  try {
    await fsp.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    const wrapped = toEngineError(error, link, 'AVAILABLE_LINK_FAILED');
    throw new EngineError(
      `无法创建可用版本别名：${error.message}`,
      'AVAILABLE_LINK_FAILED',
      { permission: wrapped.permission },
    );
  }
  return link;
}

async function copyIntoStore(engine, sourceDir, sha) {
  const destination = storeDir(engine, sha);
  const existing = await fsp.stat(destination).catch(() => null);
  if (existing) return destination;

  const staging = path.join(engine.root, 'staging', uuid());
  await fsp.mkdir(staging, { recursive: true });
  try {
    await fsp.cp(sourceDir, staging, {
      recursive: true,
      dereference: true,
      filter: (source) => !IGNORED_NAMES.has(path.basename(source)),
    }).catch((error) => {
      throw toEngineError(error, staging);
    });
    await setReadOnly(staging);
    await fsp.mkdir(path.dirname(destination), { recursive: true }).catch((error) => {
      throw toEngineError(error, path.dirname(destination));
    });
    await moveEntry(staging, destination);
  } finally {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
  return destination;
}

function findSkillBySlug(engine, slug) {
  return engine.db.get('SELECT * FROM skills WHERE slug = ?', slug);
}

function recordVersion(engine, skillId, sha, note, createdAt = Date.now()) {
  const existing = engine.db.get(
    'SELECT version_sha FROM skill_versions WHERE version_sha = ?',
    sha,
  );
  if (existing) {
    engine.db.run('UPDATE skills SET active_sha = ? WHERE skill_id = ?', sha, skillId);
    return;
  }
  const skill = engine.db.get('SELECT active_sha FROM skills WHERE skill_id = ?', skillId);
  engine.db.run(
    'INSERT INTO skill_versions (version_sha, skill_id, parent_sha, created_at, note) VALUES (?, ?, ?, ?, ?)',
    sha,
    skillId,
    skill?.active_sha ?? null,
    createdAt,
    note ?? null,
  );
  engine.db.run('UPDATE skills SET active_sha = ? WHERE skill_id = ?', sha, skillId);
}

async function importDirectory(engine, sourceDir, meta) {
  const source = path.resolve(sourceDir);
  if (!(await fsp.stat(source).catch(() => null))) {
    throw new EngineError('来源目录不存在', 'SOURCE_MISSING');
  }
  await assertImportable(source);

  const { sha } = await hashDirectory(source, engine.cache, { rejectLinks: true });
  await copyIntoStore(engine, source, sha);

  const displayName = String(meta.displayName ?? path.basename(source)).trim();
  const slug = String(meta.slug ?? path.basename(source)).trim();
  if (!slug) throw new EngineError('技能目录名不能为空', 'BAD_SLUG');
  const declared = Array.isArray(meta.dependsOn)
    ? sanitizeDependencies(meta.dependsOn)
    : await readDeclaredDependencies(source);
  const declaredDependencies = declared.filter((item) => item !== slug);

  const derivedComment = await readSkillDescriptionFromDir(source);
  const tags = JSON.stringify(meta.tags ?? []);
  const skill = findSkillBySlug(engine, slug);
  let skillId;
  engine.db.transaction(() => {
    if (skill) {
      skillId = skill.skill_id;
      const dependencies =
        Array.isArray(meta.dependsOn) || declaredDependencies.length > 0
          ? declaredDependencies
          : sanitizeDependencies(safeParseJson(skill.depends_on));
      const existingComment = String(skill.comment ?? '').trim();
      const preservedComment =
        existingComment && existingComment !== DEFAULT_ADOPT_COMMENT
          ? existingComment
          : null;
      engine.db.run(
        `UPDATE skills SET display_name = ?, alias = ?, comment = ?, tags = ?, depends_on = ?, source_type = ?, source_uri = ? WHERE skill_id = ?`,
        meta.displayName ? displayName : skill.display_name,
        meta.alias ?? skill.alias,
        meta.comment ?? preservedComment ?? derivedComment ?? skill.comment,
        meta.tags ? tags : skill.tags,
        JSON.stringify(dependencies),
        meta.sourceType ?? skill.source_type,
        meta.sourceUri ?? skill.source_uri,
        skillId,
      );
      recordVersion(engine, skillId, sha, meta.note ?? '导入新版本');
    } else {
      skillId = uuid();
      engine.db.run(
        `INSERT INTO skills (skill_id, slug, display_name, alias, comment, tags, source_type, source_uri, active_sha, depends_on, imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        skillId,
        slug,
        meta.displayName ?? displayName,
        meta.alias ?? null,
        meta.comment ?? derivedComment ?? meta.fallbackComment ?? null,
        tags,
        meta.sourceType ?? 'local',
        meta.sourceUri ?? source,
        null,
        JSON.stringify(declaredDependencies),
        Date.now(),
      );
      engine.db.run(
        'INSERT INTO skill_versions (version_sha, skill_id, parent_sha, created_at, note) VALUES (?, ?, ?, ?, ?)',
        sha,
        skillId,
        null,
        Date.now(),
        meta.note ?? '初始入库',
      );
      engine.db.run('UPDATE skills SET active_sha = ? WHERE skill_id = ?', sha, skillId);
    }
  });

  await ensureAvailableLink(engine, slug, sha);
  engine.audit('import_skill', null, skillId, `${slug}@${shortSha(sha)}`);
  return { skillId, slug, versionSha: sha };
}

async function importGit(engine, url, meta = {}) {
  const trimmed = String(url ?? '').trim();
  if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(trimmed)) {
    throw new EngineError('请输入有效的 Git 仓库地址', 'BAD_GIT_URL');
  }
  const staging = path.join(engine.root, 'staging', `git-${uuid()}`);
  await fsp.mkdir(path.dirname(staging), { recursive: true });
  try {
    await execFileAsync('git', ['clone', '--depth', '1', trimmed, staging], {
      timeout: 120_000,
      windowsHide: true,
    });
    const fallback = path
      .basename(trimmed)
      .replace(/\.git$/i, '')
      .replace(/[^\p{L}\p{N}._-]+/gu, '-');
    return await importDirectory(engine, staging, {
      slug: meta.slug ?? fallback,
      displayName: meta.displayName ?? fallback,
      alias: meta.alias,
      comment: meta.comment,
      tags: meta.tags ?? ['Git'],
      sourceType: 'git',
      sourceUri: trimmed,
      note: 'Git 浅克隆入库',
    });
  } catch (error) {
    if (error instanceof EngineError) throw error;
    throw new EngineError(`Git 克隆失败：${error.message}`, 'GIT_CLONE_FAILED');
  } finally {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

async function readStoreFiles(engine, sha) {
  const root = storeDir(engine, sha);
  if (!(await fsp.stat(root).catch(() => null))) return null;
  const files = [];
  const stack = [{ abs: root, rel: '' }];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = await fsp.readdir(current.abs, { withFileTypes: true });
    } catch (error) {
      if (isPermissionError(error)) throw toEngineError(error, current.abs);
      return null;
    }
    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry.name)) continue;
      const abs = path.join(current.abs, entry.name);
      const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name;
      const stat = await fsp.lstat(abs).catch(() => null);
      if (!stat) continue;
      if (stat.isDirectory()) {
        stack.push({ abs, rel });
        continue;
      }
      if (!stat.isFile()) continue;
      const data = await fsp.readFile(abs).catch((error) => {
        if (isPermissionError(error)) throw toEngineError(error, abs);
        return null;
      });
      if (!data) continue;
      files.push({ path: rel, encoding: 'base64', data: data.toString('base64') });
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

async function exportBackup(engine, destination) {
  const skills = engine.db.all('SELECT * FROM skills ORDER BY imported_at ASC');
  const payload = {
    schema_version: 1,
    app: 'Quiver',
    exported_at: new Date().toISOString(),
    skills: [],
    bindings: [],
  };
  for (const skill of skills) {
    const versionRows = engine.db.all(
      'SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY created_at ASC, version_sha ASC',
      skill.skill_id,
    );
    const versions = [];
    for (const version of versionRows) {
      const files = await readStoreFiles(engine, version.version_sha);
      if (!files || files.length === 0) continue;
      versions.push({
        sha: version.version_sha,
        created_at: version.created_at,
        note: version.note,
        files,
      });
    }
    if (versions.length === 0) continue;
    const active =
      versions.find((version) => version.sha === skill.active_sha) ??
      versions[versions.length - 1];
    payload.skills.push({
      slug: skill.slug,
      display_name: skill.display_name,
      alias: skill.alias,
      comment: skill.comment,
      tags: safeParseJson(skill.tags),
      depends_on: sanitizeDependencies(safeParseJson(skill.depends_on)),
      source_type: skill.source_type,
      source_uri: skill.source_uri,
      active_sha: active.sha,
      version: {
        sha: active.sha,
        created_at: active.created_at,
        note: active.note,
      },
      files: active.files,
      versions,
    });
  }
  const bindings = engine.db.all(
    "SELECT * FROM bindings WHERE scope = 'global' ORDER BY deployed_at ASC, rowid ASC",
  );
  for (const binding of bindings) {
    const skill = engine.db.get(
      'SELECT slug FROM skills WHERE skill_id = ?',
      binding.skill_id,
    );
    if (!skill || !engine.harness(binding.harness_id)) continue;
    payload.bindings.push({
      slug: skill.slug,
      harness_id: binding.harness_id,
      scope: 'global',
      candidate_id: binding.candidate_id,
      sync_mode: binding.sync_mode,
      resolved_sha: binding.resolved_sha,
    });
  }
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.writeFile(destination, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  engine.audit('export_backup', null, null, destination);
  return { path: destination, skills: payload.skills.length, bindings: payload.bindings.length };
}

async function writeVersionFiles(stagingDir, files) {
  for (const file of files) {
    const rel = String(file?.path ?? '');
    const normalized = path.normalize(rel);
    if (
      !rel ||
      path.isAbsolute(rel) ||
      normalized.split(/[\\/]/).includes('..') ||
      !within(stagingDir, path.join(stagingDir, normalized))
    ) {
      throw new EngineError(`备份包含非法路径：${rel}`, 'BAD_BACKUP_PATH');
    }
    const destination = path.join(stagingDir, normalized);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.writeFile(destination, Buffer.from(String(file.data ?? ''), 'base64'));
  }
}

function backupVersions(skill) {
  if (Array.isArray(skill?.versions) && skill.versions.length > 0) {
    return skill.versions
      .filter(
        (version) => version && Array.isArray(version.files) && version.files.length > 0,
      )
      .map((version) => ({
        sha: typeof version.sha === 'string' ? version.sha : '',
        note: version.note,
        files: version.files,
      }));
  }
  if (Array.isArray(skill?.files) && skill.files.length > 0) {
    return [
      {
        sha: typeof skill.active_sha === 'string' ? skill.active_sha : '',
        note: skill.version?.note,
        files: skill.files,
      },
    ];
  }
  return [];
}

async function isManagedLink(engine, targetPath) {
  const real = await fsp.realpath(targetPath).catch(() => null);
  if (!real) return false;
  return (
    within(path.join(engine.root, 'store'), real) ||
    within(path.join(engine.root, 'available'), real)
  );
}

async function restoreBackupBindings(engine, items) {
  // Lazy require: mount.cjs depends on this module, a top-level cycle would
  // hand it an empty export map.
  const { mount, resolveTarget } = require('./mount.cjs');
  const restored = [];
  const skipped = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue;
    if (item.scope !== undefined && item.scope !== 'global') continue;
    const harness = item.harness_id ? engine.harness(String(item.harness_id)) : null;
    if (!harness) {
      skipped.push(`${item.harness_id ?? '未知工具'}：Harness 未配置`);
      continue;
    }
    let slug;
    try {
      slug = assertSafeBackupSlug(item.slug);
    } catch (error) {
      skipped.push(error.message);
      continue;
    }
    const skill = engine.db.get('SELECT * FROM skills WHERE slug = ?', slug);
    if (!skill) {
      skipped.push(`${slug}：技能缺失`);
      continue;
    }
    const duplicate = engine.db.get(
      'SELECT 1 FROM bindings WHERE skill_id = ? AND harness_id = ? AND scope = ? AND project_path = ?',
      skill.skill_id,
      harness.id,
      'global',
      '',
    );
    if (duplicate) continue;
    const wanted = String(item.resolved_sha ?? '');
    const version = wanted
      ? engine.db.get(
          'SELECT 1 FROM skill_versions WHERE version_sha = ? AND skill_id = ?',
          wanted,
          skill.skill_id,
        )
      : null;
    const sha = version ? wanted : skill.active_sha;
    if (!sha) {
      skipped.push(`${slug}：没有可用版本`);
      continue;
    }
    const syncMode = item.sync_mode === 'copy' ? 'copy' : 'link';
    const exportedCandidate = item.candidate_id
      ? harness.candidates.find((candidate) => candidate.id === String(item.candidate_id))
      : null;
    const candidate =
      exportedCandidate && exportedCandidate.scope === 'global'
        ? exportedCandidate
        : engine.preferredCandidateFor(harness, 'global');
    let targetPath;
    try {
      ({ targetPath } = resolveTarget(engine, {
        harness,
        project: null,
        scope: 'global',
        slug: skill.slug,
        candidate,
      }));
    } catch (error) {
      skipped.push(`${slug}@${harness.id}：${error.message}`);
      continue;
    }
    const existing = await lstatOrNull(targetPath);
    if (existing) {
      if (!existing.isSymbolicLink() || !(await isManagedLink(engine, targetPath))) {
        skipped.push(`${slug}@${harness.id}：目标已存在`);
        continue;
      }
      await removeEntry(targetPath);
    }
    try {
      const mounted = await mount(engine, {
        slug: skill.slug,
        sha,
        syncMode,
        targetPath,
      });
      engine.db.run(
        `INSERT INTO bindings (binding_id, skill_id, harness_id, scope, project_path, project_id, target_path, candidate_id, state, sync_mode, resolved_sha, current_sha, drift_files, ignored_drift, update_available, deployed_at)
         VALUES (?, ?, ?, 'global', '', NULL, ?, ?, 'enabled', ?, ?, NULL, NULL, 0, NULL, ?)`,
        uuid(),
        skill.skill_id,
        harness.id,
        targetPath,
        candidate?.id ?? null,
        mounted.mode,
        sha,
        Date.now(),
      );
      restored.push({ slug: skill.slug, harnessId: harness.id, syncMode: mounted.mode, sha });
    } catch (error) {
      skipped.push(`${slug}@${harness.id}：${error.message}`);
    }
  }
  return { restored, skipped };
}

async function importBackup(engine, file) {
  let payload;
  try {
    payload = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (error) {
    throw new EngineError(`无法读取备份包：${error.message}`, 'BAD_BACKUP');
  }
  const schemaVersion = Number(payload?.schema_version);
  if (Number.isInteger(schemaVersion) && schemaVersion > 1) {
    throw new EngineError(
      `备份包的 schema_version = ${schemaVersion} 高于当前 Quiver 支持的版本 1，请升级 Quiver 后再导入。`,
      'BACKUP_SCHEMA_TOO_NEW',
    );
  }
  if (payload?.schema_version !== 1 || !Array.isArray(payload.skills)) {
    throw new EngineError('备份包格式不受支持（需要 schema_version = 1）', 'BAD_BACKUP');
  }
  const stagingRoot = path.join(engine.root, 'staging', `backup-${uuid()}`);
  const importedSkills = new Set();
  const skipped = [];
  let importedVersions = 0;
  try {
    for (const skill of payload.skills) {
      if (!skill?.slug) continue;
      const slug = assertSafeBackupSlug(skill.slug);
      const versions = backupVersions(skill);
      if (versions.length === 0) {
        skipped.push(`${slug}：备份中没有可恢复的文件`);
        continue;
      }
      let skillId = null;
      const importedShas = [];
      for (let index = 0; index < versions.length; index += 1) {
        const version = versions[index];
        const skillDir = path.join(
          stagingRoot,
          slug,
          `${index}-${shortSha(version.sha) || 'version'}`,
        );
        await writeVersionFiles(skillDir, version.files);
        const result = await importDirectory(engine, skillDir, {
          slug,
          displayName: skill.display_name,
          alias: skill.alias,
          comment: skill.comment,
          tags: skill.tags,
          dependsOn: Array.isArray(skill.depends_on)
            ? sanitizeDependencies(skill.depends_on)
            : undefined,
          sourceType: skill.source_type,
          sourceUri: skill.source_uri,
          note: version.note ?? '从备份包恢复',
        });
        skillId = result.skillId;
        importedShas.push(result.versionSha);
        importedVersions += 1;
      }
      if (skillId) {
        importedSkills.add(skillId);
        const desired = String(skill.active_sha ?? '');
        if (importedShas.includes(desired)) {
          engine.db.run(
            'UPDATE skills SET active_sha = ? WHERE skill_id = ?',
            desired,
            skillId,
          );
        }
      }
    }
  } finally {
    await fsp.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
  }
  const bindings = await restoreBackupBindings(engine, payload.bindings);
  const summary = `${importedSkills.size} 个技能 · ${importedVersions} 个版本 · ${bindings.restored.length} 个全局绑定${
    bindings.skipped.length > 0 ? ` · ${bindings.skipped.length} 个绑定跳过` : ''
  }`;
  engine.audit('import_backup', null, null, summary);
  return {
    skills: importedSkills.size,
    versions: importedVersions,
    bindings: bindings.restored.length,
    skipped: [...skipped, ...bindings.skipped],
  };
}

function safeParseJson(value) {
  try {
    return JSON.parse(value ?? '[]');
  } catch {
    return [];
  }
}

module.exports = {
  DEFAULT_ADOPT_COMMENT,
  availableDir,
  copyIntoStore,
  ensureAvailableLink,
  exportBackup,
  importBackup,
  importDirectory,
  importGit,
  parseSkillDescription,
  readSkillDescriptionFromDir,
  readSkillPreview,
  readStoredSkillDescription,
  refreshDefaultSkillComments,
  storeDir,
};
