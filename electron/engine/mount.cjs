const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  EngineError,
  ensureWritable,
  lstatOrNull,
  moveEntry,
  removeEntry,
  toEngineError,
  uuid,
} = require('./util.cjs');
const { availableDir, ensureAvailableLink, storeDir } = require('./store.cjs');

function globalDisplayPath(engine, harness, slug) {
  const candidate = engine.preferredCandidateFor(harness, 'global');
  const base = candidate ? engine.candidateBase(harness, candidate) : null;
  if (!base) throw new EngineError('没有可用的全局候选路径', 'NO_CANDIDATE');
  return `${engine.displayFor(base).replace(/\/$/, '')}/${slug}`;
}

function globalPhysicalPath(engine, harness, slug) {
  const candidate = engine.preferredCandidateFor(harness, 'global');
  const base = candidate ? engine.candidateBase(harness, candidate) : null;
  if (!base) throw new EngineError('没有可用的全局候选路径', 'NO_CANDIDATE');
  return path.join(base, slug);
}

function projectPhysicalPath(engine, project, harness, slug) {
  const candidate = engine.preferredCandidateFor(harness, 'project', project);
  const base = candidate ? engine.candidateBase(harness, candidate, project) : null;
  if (!base) throw new EngineError('没有可用的项目候选路径', 'NO_CANDIDATE');
  return path.join(base, slug);
}

function resolveTarget(engine, { harness, project, scope, slug, candidate = null }) {
  const chosen = candidate ?? engine.preferredCandidateFor(harness, scope, project);
  if (!chosen) throw new EngineError('该工具没有匹配作用域的候选路径', 'NO_CANDIDATE');
  if (chosen.scope !== scope) {
    throw new EngineError('候选路径的作用域与请求不一致', 'BAD_CANDIDATE_SCOPE');
  }
  const base = engine.candidateBase(harness, chosen, scope === 'project' ? project : null);
  if (!base) {
    throw new EngineError('候选路径包含未设置的环境变量，暂时无法使用', 'CANDIDATE_UNRESOLVED');
  }
  return {
    targetPath: path.join(base, slug),
    displayPath: `${engine.displayFor(base).replace(/\/$/, '')}/${slug}`,
    candidate: chosen,
  };
}

async function copyVersion(engine, sha, targetPath) {
  const source = storeDir(engine, sha);
  if (!(await fsp.stat(source).catch(() => null))) {
    throw new EngineError(`中央库缺少版本 ${sha}`, 'STORE_MISSING');
  }
  const staging = path.join(engine.root, 'staging', uuid());
  await fsp.mkdir(path.dirname(targetPath), { recursive: true }).catch((error) => {
    throw toEngineError(error, path.dirname(targetPath));
  });
  await fsp.mkdir(staging, { recursive: true }).catch((error) => {
    throw toEngineError(error, staging);
  });
  try {
    await fsp.cp(source, staging, { recursive: true, dereference: true }).catch((error) => {
      throw toEngineError(error, targetPath);
    });
    await ensureWritable(staging);
    const existing = await lstatOrNull(targetPath);
    if (existing) {
      if (existing.isSymbolicLink()) await removeEntry(targetPath);
      else throw new EngineError('目标目录已存在，已保留原内容未覆盖', 'TARGET_EXISTS');
    }
    await moveEntry(staging, targetPath);
  } finally {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

async function mount(engine, { slug, sha, syncMode = 'link', targetPath, allowCopyFallback = true }) {
  engine.assertAllowedTarget(targetPath);
  await fsp.mkdir(path.dirname(targetPath), { recursive: true }).catch((error) => {
    throw toEngineError(error, path.dirname(targetPath));
  });

  const existing = await lstatOrNull(targetPath);
  if (existing) {
    throw new EngineError('目标目录已存在，请先处理现有目录', 'TARGET_EXISTS');
  }

  if (syncMode === 'link') {
    const linkTarget = availableDir(engine, slug, sha);
    await ensureAvailableLink(engine, slug, sha);
    try {
      await fsp.symlink(
        linkTarget,
        targetPath,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      return { mode: 'link' };
    } catch (error) {
      const wrapped = toEngineError(error, targetPath, 'LINK_FAILED');
      if (!allowCopyFallback) {
        if (wrapped.code === 'PERMISSION_DENIED') {
          throw new EngineError(
            `无法在目标位置创建链接（${wrapped.permission?.code ?? error.code}）`,
            'LINK_PERMISSION',
            { permission: wrapped.permission, suggestion: 'copy' },
          );
        }
        throw new EngineError(`无法创建链接：${error.message}`, 'LINK_FAILED', {
          permission: wrapped.permission,
        });
      }
      await copyVersion(engine, sha, targetPath);
      return { mode: 'copy', fallbackReason: error.code ?? error.message };
    }
  }

  await copyVersion(engine, sha, targetPath);
  return { mode: 'copy' };
}

async function unmount(engine, targetPath, { allowRecursive = false } = {}) {
  engine.assertAllowedTarget(targetPath);
  const stat = await lstatOrNull(targetPath);
  if (!stat) return false;
  if (!stat.isSymbolicLink() && !allowRecursive) {
    throw new EngineError('目标不是链接，已拒绝递归删除', 'NOT_A_LINK');
  }
  return removeEntry(targetPath, { recursive: allowRecursive && !stat.isSymbolicLink() });
}

async function redeploy(engine, { slug, sha, syncMode, targetPath }) {
  const stat = await lstatOrNull(targetPath);
  if (stat) {
    await removeEntry(targetPath, {
      recursive: !stat.isSymbolicLink(),
    });
  }
  return mount(engine, { slug, sha, syncMode, targetPath });
}

module.exports = {
  copyVersion,
  globalDisplayPath,
  globalPhysicalPath,
  mount,
  projectPhysicalPath,
  redeploy,
  resolveTarget,
  unmount,
};
