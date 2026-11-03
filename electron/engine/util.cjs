const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const IGNORED_NAMES = new Set(['.git', '.DS_Store', 'Thumbs.db', 'desktop.ini']);
const PERMISSION_CODES = new Set(['EACCES', 'EPERM', 'EROFS']);

class EngineError extends Error {
  constructor(message, code = 'ENGINE_ERROR', details = {}) {
    super(message);
    this.code = code;
    this.permission = details.permission ?? null;
    this.suggestion = details.suggestion ?? null;
  }
}

function isPermissionError(error) {
  return PERMISSION_CODES.has(error?.code);
}

function permissionFromError(error, target) {
  return {
    code: error?.code ?? 'EACCES',
    path: target ?? error?.path ?? error?.dest ?? error?.filename ?? '',
    syscall: error?.syscall ?? '',
    platform: process.platform,
    message: error instanceof Error ? error.message : String(error),
    key: `${error?.code ?? 'EACCES'}:${target ?? error?.path ?? ''}`,
  };
}

function toEngineError(error, target, fallbackCode = 'PERMISSION_DENIED') {
  if (error instanceof EngineError) return error;
  if (isPermissionError(error)) {
    const permission = permissionFromError(error, target);
    const where = permission.path ? `：${permission.path}` : '';
    return new EngineError(
      `系统拒绝了 Quiver 的${permission.syscall ? ` ${permission.syscall} ` : '文件'}访问${where}（${permission.code}）`,
      fallbackCode,
      { permission },
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function shortSha(sha) {
  return String(sha ?? '').slice(0, 7);
}

function expandHome(input) {
  if (typeof input !== 'string') return input;
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function expandPath(input, { homeDir = os.homedir(), env = process.env } = {}) {
  if (typeof input !== 'string') return input;
  let value = input.trim();
  if (!value) return value;
  let unresolved = false;
  value = value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_match, braced, plain) => {
      const key = braced || plain;
      const found = env[key];
      if (found === undefined || found === '') {
        unresolved = true;
        return '';
      }
      return found;
    },
  );
  if (unresolved) return null;
  if (value === '~') return path.normalize(homeDir);
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    value = path.join(homeDir, value.slice(2));
  }
  return path.normalize(value);
}

function stripHome(input) {
  return String(input).replace(/^~[\\/]/, '');
}

function toPosix(input) {
  return String(input).replaceAll('\\', '/');
}

function fromPosix(input) {
  return path.sep === '\\' ? input.replaceAll('/', '\\') : input;
}

function within(parent, child) {
  const base = path.resolve(parent);
  const target = path.resolve(child);
  if (target === base) return true;
  return target.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
}

function formatStamp(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function relativeLabel(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - Number(timestamp);
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatStamp(timestamp).slice(0, 10);
}

function sanitizeSlug(input) {
  const slug = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'skill';
}

async function pathExists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(target) {
  try {
    const stat = await fsp.stat(target);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function lstatOrNull(target) {
  try {
    return await fsp.lstat(target);
  } catch (error) {
    if (isPermissionError(error)) throw toEngineError(error, target);
    return null;
  }
}

async function removeEntry(target, { recursive = false } = {}) {
  const stat = await lstatOrNull(target);
  if (!stat) return false;
  try {
    // Iron rule: never recurse through a link/junction into the store source.
    if (stat.isSymbolicLink()) {
      try {
        await fsp.unlink(target);
      } catch {
        await fsp.rmdir(target);
      }
      return true;
    }
    if (!stat.isDirectory()) {
      await fsp.unlink(target);
      return true;
    }
    if (!recursive) {
      throw new EngineError('目标目录已存在且不是链接，已拒绝覆盖');
    }
    await fsp.rm(target, { recursive: true, force: true });
    return true;
  } catch (error) {
    throw toEngineError(error, target);
  }
}

async function moveEntry(source, destination) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fsp.rename(source, destination);
      return true;
    } catch (error) {
      lastError = error;
      if (error.code === 'EXDEV') break;
      // Windows can hold transient handles on freshly written trees (indexers,
      // antivirus). Retry before falling back to a copy-based move.
      if (!['EPERM', 'EBUSY', 'EACCES', 'EEXIST', 'ENOTEMPTY'].includes(error.code)) {
        throw error;
      }
      if (await pathExists(destination)) {
        await fsp.rm(source, { recursive: true, force: true }).catch(() => {});
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 90 * (attempt + 1)));
    }
  }
  await fsp.cp(source, destination, {
    recursive: true,
    dereference: true,
    force: true,
    errorOnExist: false,
  }).catch(async (error) => {
    await fsp.rm(destination, { recursive: true, force: true }).catch(() => {});
    throw toEngineError(error, destination);
  });
  await fsp.rm(source, { recursive: true, force: true }).catch(() => {});
  if (!(await pathExists(destination))) throw lastError ?? new EngineError('移动目录失败', 'MOVE_FAILED');
  return true;
}

async function ensureWritable(root) {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const stat = await lstatOrNull(current);
    if (!stat || stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      await fsp.chmod(current, 0o755).catch(() => {});
      const entries = await fsp.readdir(current).catch(() => []);
      for (const entry of entries) stack.push(path.join(current, entry));
    } else {
      await fsp.chmod(current, 0o644).catch(() => {});
    }
  }
}

async function setReadOnly(root) {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const stat = await lstatOrNull(current);
    if (!stat || stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      const entries = await fsp.readdir(current).catch(() => []);
      for (const entry of entries) stack.push(path.join(current, entry));
      await fsp.chmod(current, 0o555).catch(() => {});
    } else {
      await fsp.chmod(current, 0o444).catch(() => {});
    }
  }
}

function uuid() {
  return crypto.randomUUID();
}

function countFiles(root) {
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry.name)) continue;
      if (entry.isDirectory()) stack.push(path.join(current, entry.name));
      else if (entry.isFile()) count += 1;
    }
  }
  return count;
}

module.exports = {
  EngineError,
  IGNORED_NAMES,
  PERMISSION_CODES,
  countFiles,
  ensureWritable,
  expandHome,
  expandPath,
  formatStamp,
  fromPosix,
  isDirectory,
  isPermissionError,
  lstatOrNull,
  moveEntry,
  pathExists,
  permissionFromError,
  relativeLabel,
  removeEntry,
  sanitizeSlug,
  setReadOnly,
  sha256,
  shortSha,
  stripHome,
  toEngineError,
  toPosix,
  uuid,
  within,
};
