const fsp = require('node:fs/promises');
const path = require('node:path');
const { importDirectory } = require('./store.cjs');
const { mount, resolveTarget } = require('./mount.cjs');
const { reconcile } = require('./reconcile.cjs');
const { removeEntry, uuid } = require('./util.cjs');

const DAY = 86_400_000;

const DEMO_SKILLS = [
  {
    slug: 'pdf-parser',
    displayName: 'PDF 深度解析器',
    alias: 'pdf',
    comment: '提取长文档的表格、公式与引用结构，输出可检索的 Markdown 与结构化数据表。',
    tags: ['文档', 'Python', '解析'],
    sourceType: 'git',
    sourceUri: 'https://github.com/anthropics/skills/tree/main/pdf',
    schema: true,
    script: 'scripts/extract.py',
    versions: [
      { note: '初始入库', daysAgo: 21 },
      { note: '重写表格抽取管线', daysAgo: 7 },
    ],
  },
  {
    slug: 'git-commit-pro',
    displayName: '规范化提交生成器',
    alias: 'gcp',
    comment: '读取暂存区差异，按 Conventional Commits 生成可直接提交的提交说明。',
    tags: ['Git', 'DX'],
    sourceType: 'git',
    sourceUri: 'https://github.com/quiver-labs/git-commit-pro',
    versions: [
      { note: '初版', daysAgo: 43 },
      { note: '支持 scope 自动推断', daysAgo: 9 },
    ],
  },
  {
    slug: 'ui-auditor',
    displayName: '前端走查助手',
    alias: 'audit',
    comment: '对页面做视觉与可访问性走查，给出带定位的选择器与可直接应用的修复片段。',
    tags: ['前端', '设计', '走查'],
    sourceType: 'local',
    sourceUri: 'E:\\skills\\ui-auditor',
    script: 'scripts/audit.ts',
    versions: [
      { note: '初始入库', daysAgo: 31 },
      { note: '增加键盘导航检查', daysAgo: 19 },
    ],
  },
  {
    slug: 'sql-optimizer',
    displayName: '慢查询优化分析',
    alias: 'sqlx',
    comment: '解析慢查询执行计划，标注热点扫描并生成索引与改写建议。',
    tags: ['数据库', 'SQL'],
    sourceType: 'git',
    sourceUri: 'https://github.com/quiver-labs/sql-optimizer',
    versions: [
      { note: '初始入库', daysAgo: 72 },
      { note: '支持 Postgres 执行计划', daysAgo: 47 },
    ],
  },
  {
    slug: 'threejs-voxel-architect',
    displayName: '体素古建生成规范',
    alias: 'voxel',
    comment: '以体素网格重建中式古建的斗拱、飞檐与屋脊比例，附可复用的 Three.js 结构。',
    tags: ['3D', 'WebGL'],
    sourceType: 'git',
    sourceUri: 'https://github.com/quiver-labs/voxel-architect',
    versions: [{ note: '初始入库', daysAgo: 35 }],
  },
  {
    slug: 'rust-tauri-expert',
    displayName: 'Tauri v2 桌面架构',
    alias: 'tauri',
    comment: 'Tauri v2 权限、IPC 与窗口能力边界的工程实践手册，含权限最小化清单。',
    tags: ['Rust', '桌面'],
    sourceType: 'git',
    sourceUri: 'https://github.com/quiver-labs/tauri-expert',
    dependsOn: ['ui-auditor'],
    versions: [
      { note: '初始入库', daysAgo: 60 },
      { note: '对齐 Tauri 2.1', daysAgo: 23 },
    ],
  },
  {
    slug: 'legacy-linter',
    displayName: '遗留代码检查',
    alias: 'linter',
    comment: '针对遗留 Node 代码库的兼容性规则集，覆盖 CJS、旧版 API 与不安全依赖。',
    tags: ['质量', 'Node'],
    sourceType: 'local',
    sourceUri: 'E:\\skills\\legacy-linter',
    versions: [{ note: '初始入库', daysAgo: 120 }],
  },
  {
    slug: 'release-notes-writer',
    displayName: '发版说明生成',
    alias: 'release',
    comment: '从提交区间提炼面向用户的发版说明，自动按影响面分组并降噪。',
    tags: ['文档', 'Release'],
    sourceType: 'git',
    sourceUri: 'https://github.com/quiver-labs/release-notes',
    dependsOn: ['git-commit-pro'],
    versions: [
      { note: '初始入库', daysAgo: 50 },
      { note: '支持自定义分组', daysAgo: 11 },
    ],
  },
  {
    slug: 'prompt-forge',
    displayName: '提示词工坊',
    alias: 'forge',
    comment: '把粗糙的需求打磨成带约束、正反例与验收标准的提示词。',
    tags: ['Prompt', '写作'],
    sourceType: 'local',
    sourceUri: 'E:\\skills\\prompt-forge',
    versions: [
      { note: '初始入库', daysAgo: 62 },
      { note: '新增评审 rubric', daysAgo: 26 },
    ],
  },
  {
    slug: 'api-contract-guard',
    displayName: 'API 契约守护',
    alias: 'contract',
    comment: '在 PR 阶段校验 API 契约变更，阻止破坏性字段删除与隐式类型收窄。',
    tags: ['后端', '测试'],
    sourceType: 'git',
    sourceUri: 'https://github.com/quiver-labs/api-contract-guard',
    versions: [{ note: '初始入库', daysAgo: 81 }],
  },
];

const DEMO_PROJECTS = [
  { id: 'quiver-desktop', name: 'quiver-desktop', daysAgo: 0, minutesAgo: 2 },
  { id: 'paper-reader-agent', name: 'paper-reader-agent', daysAgo: 1 },
  { id: 'zk-wiki', name: 'zk-wiki', daysAgo: 3 },
  { id: 'old-drive-demo', name: 'old-agent-demo', daysAgo: 21, missing: true },
];

const DEMO_BINDINGS = [
  { slug: 'pdf-parser', harnessId: 'claude-code', scope: 'global', mode: 'link', resolved: 'current', daysAgo: 7 },
  { slug: 'pdf-parser', harnessId: 'antigravity', scope: 'global', mode: 'link', resolved: 'current', daysAgo: 7 },
  {
    slug: 'pdf-parser',
    harnessId: 'cursor',
    scope: 'project',
    projectId: 'paper-reader-agent',
    mode: 'copy',
    resolved: 'current',
    daysAgo: 6,
    drift: true,
  },
  { slug: 'git-commit-pro', harnessId: 'claude-code', scope: 'global', mode: 'copy', resolved: 'previous', daysAgo: 42 },
  { slug: 'git-commit-pro', harnessId: 'codex', scope: 'project', projectId: 'zk-wiki', mode: 'link', resolved: 'current', daysAgo: 9 },
  { slug: 'ui-auditor', harnessId: 'claude-code', scope: 'global', mode: 'link', resolved: 'current', daysAgo: 19 },
  {
    slug: 'ui-auditor',
    harnessId: 'cursor',
    scope: 'project',
    projectId: 'quiver-desktop',
    mode: 'copy',
    resolved: 'current',
    daysAgo: 18,
    drift: true,
  },
  { slug: 'rust-tauri-expert', harnessId: 'claude-code', scope: 'project', projectId: 'quiver-desktop', mode: 'link', resolved: 'current', daysAgo: 22 },
  { slug: 'rust-tauri-expert', harnessId: 'antigravity', scope: 'project', projectId: 'quiver-desktop', mode: 'link', resolved: 'current', daysAgo: 22 },
  { slug: 'legacy-linter', harnessId: 'claude-code', scope: 'global', mode: 'link', resolved: 'current', daysAgo: 120, missing: true },
  { slug: 'release-notes-writer', harnessId: 'codex', scope: 'global', mode: 'link', resolved: 'current', daysAgo: 10 },
  { slug: 'release-notes-writer', harnessId: 'windsurf', scope: 'project', projectId: 'zk-wiki', mode: 'copy', resolved: 'previous', daysAgo: 49 },
  { slug: 'prompt-forge', harnessId: 'antigravity', scope: 'global', mode: 'link', resolved: 'current', daysAgo: 25 },
  {
    slug: 'sql-optimizer',
    harnessId: 'claude-code',
    scope: 'project',
    projectId: 'old-drive-demo',
    mode: 'link',
    resolved: 'current',
    daysAgo: 46,
    orphaned: true,
  },
  {
    slug: 'api-contract-guard',
    harnessId: 'claude-code',
    scope: 'project',
    projectId: 'old-drive-demo',
    mode: 'link',
    resolved: 'current',
    daysAgo: 46,
    orphaned: true,
  },
];

function skillMarkdown(skill, versionIndex) {
  return `# ${skill.displayName}

${skill.comment}

## 使用步骤

1. 阅读输入材料，确认任务边界与验收标准。
2. 按技能内的检查清单执行，记录关键判断。
3. 输出结论、证据与可执行的下一步。

## 版本快照

- 技能标识：\`${skill.slug}\`
- 快照序号：${versionIndex + 1} / ${skill.versions.length}
- 说明：${skill.versions[versionIndex].note}
`;
}

async function writeSkillSource(root, skill, versionIndex) {
  const dir = path.join(root, `${skill.slug}-v${versionIndex + 1}`);
  await fsp.mkdir(path.join(dir, 'references'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'SKILL.md'), skillMarkdown(skill, versionIndex));
  await fsp.writeFile(
    path.join(dir, 'references', 'checklist.md'),
    `# 检查清单\n\n- 输入材料完整\n- 版本快照：${versionIndex + 1}\n- 规则集：${skill.tags.join(' / ')}\n`,
  );
  if (skill.schema) {
    await fsp.mkdir(path.join(dir, 'references'), { recursive: true });
    await fsp.writeFile(
      path.join(dir, 'references', 'schema.json'),
      `${JSON.stringify({ version: versionIndex + 1, fields: ['title', 'tables', 'citations'] }, null, 2)}\n`,
    );
  }
  if (skill.script) {
    await fsp.mkdir(path.join(dir, 'scripts'), { recursive: true });
    const isTs = skill.script.endsWith('.ts');
    await fsp.writeFile(
      path.join(dir, skill.script),
      isTs
        ? `// ${skill.displayName} · v${versionIndex + 1}\nexport function run(input: string) {\n  return input.trim();\n}\n`
        : `# ${skill.displayName} · v${versionIndex + 1}\n\ndef run(input_text: str) -> str:\n    return input_text.strip()\n`,
    );
  }
  return dir;
}

async function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(root, rel);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, content);
  }
}

async function seedDemo(engine) {
  const root = engine.root;
  const staging = path.join(root, 'staging', `seed-${uuid()}`);
  await fsp.mkdir(staging, { recursive: true });
  const shas = new Map();

  try {
    for (const skill of DEMO_SKILLS) {
      const versions = skill.versions;
      for (let index = 0; index < versions.length; index += 1) {
        const source = await writeSkillSource(staging, skill, index);
        const result = await importDirectory(engine, source, {
          slug: skill.slug,
          displayName: skill.displayName,
          alias: skill.alias,
          comment: skill.comment,
          tags: skill.tags,
          dependsOn: skill.dependsOn,
          sourceType: skill.sourceType,
          sourceUri: skill.sourceUri,
          note: versions[index].note,
        });
        if (!shas.has(skill.slug)) shas.set(skill.slug, []);
        shas.get(skill.slug).push({ sha: result.versionSha, daysAgo: versions[index].daysAgo });
      }
    }
  } finally {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
  }

  const now = Date.now();
  for (const skill of engine.db.all('SELECT * FROM skills')) {
    const list = shas.get(skill.slug) ?? [];
    for (const version of list) {
      engine.db.run(
        'UPDATE skill_versions SET created_at = ? WHERE version_sha = ?',
        now - version.daysAgo * DAY,
        version.sha,
      );
    }
    if (list.length > 0) {
      engine.db.run(
        'UPDATE skills SET imported_at = ? WHERE skill_id = ?',
        now - list[0].daysAgo * DAY,
        skill.skill_id,
      );
    }
  }

  const projectMap = new Map();
  for (const project of DEMO_PROJECTS) {
    const projectPath = path.join(root, 'projects', project.id);
    if (!project.missing) await fsp.mkdir(projectPath, { recursive: true });
    engine.db.run(
      'INSERT INTO projects (project_id, name, path, missing, manifest_exported, last_active, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
      project.id,
      project.name,
      projectPath,
      project.missing ? 1 : 0,
      now - project.daysAgo * DAY - (project.minutesAgo ?? 0) * 60_000,
      now - project.daysAgo * DAY,
    );
    projectMap.set(project.id, { ...project, path: projectPath });
  }

  for (const binding of DEMO_BINDINGS) {
    const skillRow = engine.db.get('SELECT * FROM skills WHERE slug = ?', binding.slug);
    const harness = engine.config.harnesses.find((item) => item.id === binding.harnessId);
    if (!skillRow || !harness) continue;
    const project = binding.projectId ? projectMap.get(binding.projectId) : undefined;
    const versions = shas.get(binding.slug) ?? [];
    const chosen =
      binding.resolved === 'previous'
        ? versions[versions.length - 2] ?? versions[0]
        : versions[versions.length - 1];
    if (!chosen) continue;
    const { targetPath } = resolveTarget(engine, {
      harness,
      project,
      scope: binding.scope,
      slug: binding.slug,
    });
    let mode = binding.mode;
    if (!binding.missing && !binding.orphaned) {
      const stat = await fsp.lstat(targetPath).catch(() => null);
      if (stat) {
        await removeEntry(targetPath, { recursive: !stat.isSymbolicLink() }).catch(() => {});
      }
      const mounted = await mount(engine, {
        slug: binding.slug,
        sha: chosen.sha,
        syncMode: binding.mode,
        targetPath,
      });
      mode = mounted.mode;
      if (binding.drift) {
        const driftFile = path.join(targetPath, 'SKILL.md');
        const current = await fsp.readFile(driftFile, 'utf8').catch(() => '');
        await fsp.writeFile(
          driftFile,
          `${current}\n本地补充：项目内追加了评审规则与自定义字段。\n`,
        );
        await writeFiles(targetPath, {
          'scripts/helper.py': '# 本地新增的辅助脚本\ndef helper():\n    return "local"\n',
        });
      }
    }
    engine.db.run(
      `INSERT INTO bindings (binding_id, skill_id, harness_id, scope, project_path, project_id, target_path, state, sync_mode, resolved_sha, current_sha, drift_files, ignored_drift, update_available, deployed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'enabled', ?, ?, NULL, NULL, 0, NULL, ?)`,
      uuid(),
      skillRow.skill_id,
      binding.harnessId,
      binding.scope,
      project?.path ?? '',
      binding.projectId ?? null,
      targetPath,
      mode,
      chosen.sha,
      now - binding.daysAgo * DAY,
    );
  }

  const claude = engine.config.harnesses.find((item) => item.id === 'claude-code');
  const cursor = engine.config.harnesses.find((item) => item.id === 'cursor');
  if (claude) {
    await writeFiles(path.join(engine.globalRoot(claude), 'my-custom-prompt'), {
      'SKILL.md': '# my-custom-prompt\n\n外部维护的提示词技能，未经过 Quiver 管理。\n',
      'README.md': '# 使用说明\n\n手动放置于全局目录。\n',
      'examples/prompt.md': '把这段内容整理成三条要点。\n',
      'scripts/run.sh': '#!/bin/sh\necho custom-prompt\n',
    });
  }
  if (cursor) {
    await writeFiles(path.join(engine.globalRoot(cursor), 'design-tokens-kit'), {
      'SKILL.md': '# design-tokens-kit\n\n外部设计令牌技能，未经过 Quiver 管理。\n',
      'README.md': '# design tokens\n',
      'tokens/colors.json': '{"bg":"#09090b","fg":"#f4f4f5"}\n',
      'tokens/spacing.json': '{"xs":4,"sm":8,"md":12}\n',
      'tokens/radius.json': '{"sm":4,"md":8}\n',
      'examples/theme.md': '# 示例主题\n',
      'scripts/build.mjs': 'console.log("build tokens")\n',
    });
  }

  await reconcile(engine);
  engine.audit('seed_demo', null, null, `${DEMO_SKILLS.length} 个演示技能`);
}

async function ensureSeeded(engine) {
  if (engine.mode !== 'sandbox') return false;
  const row = engine.db.get('SELECT COUNT(*) AS count FROM skills');
  if ((row?.count ?? 0) > 0) return false;
  await seedDemo(engine);
  return true;
}

module.exports = { DEMO_SKILLS, ensureSeeded, seedDemo };
