const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { EngineError, IGNORED_NAMES, toEngineError, toPosix } = require('./util.cjs');

async function hashFile(file) {
  try {
    const buffer = await fsp.readFile(file);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (error) {
    throw toEngineError(error, file);
  }
}

async function collectFiles(root, cache, { rejectLinks = false } = {}) {
  const files = new Map();
  const rejected = [];
  const stack = [{ abs: root, rel: '' }];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(current.abs, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') throw new EngineError(`目录不存在：${current.abs}`, 'ENOENT');
      throw toEngineError(error, current.abs);
    }
    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry.name)) continue;
      const abs = path.join(current.abs, entry.name);
      const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name;
      const stat = await fsp.lstat(abs).catch((error) => {
        throw toEngineError(error, abs);
      });
      if (stat.isSymbolicLink()) {
        if (rejectLinks) {
          rejected.push(rel);
          continue;
        }
        const real = await fsp.realpath(abs).catch(() => null);
        if (!real) {
          rejected.push(rel);
          continue;
        }
        const realStat = await fsp.stat(real).catch(() => null);
        if (!realStat) continue;
        if (realStat.isDirectory()) {
          stack.push({ abs: real, rel });
        } else {
          files.set(rel, await hashFile(real));
        }
        continue;
      }
      if (stat.isDirectory()) {
        stack.push({ abs, rel });
        continue;
      }
      if (!stat.isFile()) continue;
      if (rejectLinks && stat.nlink > 1) {
        rejected.push(rel);
        continue;
      }
      const cached = cache?.get(abs, stat.size, stat.mtimeMs);
      if (cached) {
        files.set(rel, cached);
        continue;
      }
      const digest = await hashFile(abs);
      cache?.set(abs, stat.size, stat.mtimeMs, digest);
      files.set(rel, digest);
    }
  }

  return { files, rejected };
}

function hashTree(files) {
  const lines = Array.from(files.entries())
    .map(([rel, sha]) => `${toPosix(rel)}\u0000F\u0000${sha}`)
    .sort()
    .join('\n');
  return crypto.createHash('sha256').update(lines).digest('hex');
}

async function hashDirectory(root, cache, options = {}) {
  const { files, rejected } = await collectFiles(root, cache, options);
  return { sha: hashTree(files), files, rejected };
}

async function assertImportable(root) {
  const { rejected } = await collectFiles(root, null, { rejectLinks: true });
  if (rejected.length > 0) {
    throw new EngineError(
      `技能包内存在软链接或硬链接，已拒绝入库：${rejected.slice(0, 3).join('、')}`,
      'LINKS_REJECTED',
    );
  }
  const skillFile = path.join(root, 'SKILL.md');
  try {
    await fsp.access(skillFile);
  } catch {
    throw new EngineError('所选目录缺少 SKILL.md，无法作为技能入库', 'NO_SKILL_MD');
  }
}

async function diffDirectories(targetRoot, sourceRoot, cache, limit = 60) {
  let target;
  let source;
  try {
    target = await collectFiles(targetRoot, cache);
  } catch {
    return [];
  }
  try {
    source = await collectFiles(sourceRoot, cache);
  } catch {
    return [];
  }
  const changes = [];
  target.files.forEach((sha, rel) => {
    if (!source.files.has(rel)) changes.push({ status: 'A', path: rel });
    else if (source.files.get(rel) !== sha) changes.push({ status: 'M', path: rel });
  });
  source.files.forEach((_sha, rel) => {
    if (!target.files.has(rel)) changes.push({ status: 'D', path: rel });
  });
  changes.sort((a, b) => a.path.localeCompare(b.path));
  return changes.slice(0, limit);
}

module.exports = {
  assertImportable,
  collectFiles,
  diffDirectories,
  hashDirectory,
  hashFile,
  hashTree,
};
