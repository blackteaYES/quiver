const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const { builtinHarnesses, mergeHarnesses } = require('./harnesses.cjs');

const DEFAULT_WEB_PORT = 4310;
const DEFAULT_HARNESSES = builtinHarnesses();

function defaultConfig(mode = 'sandbox') {
  return normalizeWebSettings({
    mode,
    editor_command: 'code',
    harnesses: builtinHarnesses(),
    removed_harnesses: [],
    web_enabled: true,
    web_port: DEFAULT_WEB_PORT,
    web_lan: false,
    web_token: '',
    tray_on_close: false,
  });
}

function falsey(value) {
  return value === false || value === 'false' || value === '0';
}

function normalizeWebSettings(config) {
  config.web_enabled = !falsey(config.web_enabled);
  config.web_lan = !falsey(config.web_lan);
  config.tray_on_close = config.tray_on_close === true || config.tray_on_close === 'true' || config.tray_on_close === '1';
  const port = Number.parseInt(String(config.web_port ?? ''), 10);
  config.web_port =
    Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_WEB_PORT;
  config.web_token = typeof config.web_token === 'string' ? config.web_token.trim() : '';
  return config;
}

function generateWebToken() {
  return crypto.randomBytes(24).toString('hex');
}

function parseValue(raw) {
  const value = raw.trim();
  if (!(value.startsWith('"') && value.endsWith('"')) || value.length < 2) return value;
  const body = value.slice(1, -1);
  let result = '';
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char !== '\\' || index === body.length - 1) {
      result += char;
      continue;
    }
    const next = body[index + 1];
    if (next === 'n') result += '\n';
    else if (next === 'r') result += '\r';
    else if (next === 't') result += '\t';
    else if (next === '"') result += '"';
    else if (next === '\\') result += '\\';
    else result += next;
    index += 1;
  }
  return result;
}

function parseJson(value, fallback) {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseToml(text, mode) {
  const config = defaultConfig(mode);
  config.harnesses = [];
  let section = null;
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const sectionMatch = trimmed.match(/^\[harnesses\.([\w.-]+)\]$/);
    if (sectionMatch) {
      section = { id: sectionMatch[1] };
      config.harnesses.push(section);
      return;
    }
    const assignment = trimmed.match(/^([\w.-]+)\s*=\s*(.+)$/);
    if (!assignment) return;
    const key = assignment[1];
    const value = parseValue(assignment[2]);
    if (section) section[key] = value;
    else config[key] = value;
  });
  const removed = parseJson(config.removed_harnesses, []);
  config.removed_harnesses = Array.isArray(removed)
    ? removed.map((item) => String(item)).filter(Boolean)
    : [];
  config.harnesses = mergeHarnesses(
    config.harnesses.map((item) => ({
      ...item,
      candidates: parseJson(item.candidates, []),
    })),
    config.removed_harnesses,
  );
  config.editor_command = config.editor_command || 'code';
  return normalizeWebSettings(config);
}

function escapeValue(value) {
  return `"${String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')}"`;
}

function serializeToml(config) {
  const lines = [
    '# Quiver 本地技能管理器配置',
    `mode = ${escapeValue(config.mode)}`,
    `editor_command = ${escapeValue(config.editor_command)}`,
    `web_enabled = ${escapeValue(config.web_enabled === false ? 'false' : 'true')}`,
    `web_port = ${escapeValue(String(config.web_port ?? DEFAULT_WEB_PORT))}`,
    `web_lan = ${escapeValue(config.web_lan === false ? 'false' : 'true')}`,
    `web_token = ${escapeValue(config.web_token ?? '')}`,
    `tray_on_close = ${escapeValue(config.tray_on_close ? 'true' : 'false')}`,
    `removed_harnesses = ${escapeValue(JSON.stringify(config.removed_harnesses ?? []))}`,
    '',
  ];
  (config.harnesses ?? []).forEach((harness) => {
    lines.push(`[harnesses.${harness.id}]`);
    lines.push(`name = ${escapeValue(harness.name)}`);
    lines.push(`short_name = ${escapeValue(harness.short_name)}`);
    lines.push(`command = ${escapeValue(harness.command ?? '')}`);
    lines.push(`category = ${escapeValue(harness.category ?? 'custom')}`);
    lines.push(`is_builtin = ${escapeValue(harness.is_builtin ? 'true' : 'false')}`);
    lines.push(`global_path = ${escapeValue(harness.global_path)}`);
    lines.push(`project_rel_path = ${escapeValue(harness.project_rel_path)}`);
    lines.push(`candidates = ${escapeValue(JSON.stringify(harness.candidates ?? []))}`);
    lines.push('');
  });
  return lines.join('\n');
}

async function loadConfig(file, mode) {
  try {
    const text = await fsp.readFile(file, 'utf8');
    return parseToml(text, mode);
  } catch {
    return defaultConfig(mode);
  }
}

async function saveConfig(file, config) {
  await fsp.mkdir(require('node:path').dirname(file), { recursive: true });
  await fsp.writeFile(file, serializeToml(config), 'utf8');
}

module.exports = {
  DEFAULT_HARNESSES,
  DEFAULT_WEB_PORT,
  defaultConfig,
  generateWebToken,
  loadConfig,
  normalizeWebSettings,
  parseToml,
  saveConfig,
  serializeToml,
};
