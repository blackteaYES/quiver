const fsp = require('node:fs/promises');
const path = require('node:path');
const { diffDirectories, hashDirectory } = require('./hash.cjs');
const {
  collectProjectCandidateDirs,
  discoveryLabel,
  isAgentsSharedPath,
  roleLabel,
  sortCandidates,
} = require('./harnesses.cjs');
const { storeDir } = require('./store.cjs');
const {
  isPermissionError,
  permissionFromError,
  shortSha,
} = require('./util.cjs');

async function directoryExists(target) {
  try {
    const stat = await fsp.stat(target);
    return stat.isDirectory();
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

function unmanagedId(targetPath) {
  return `u-${require('node:crypto')
    .createHash('sha256')
    .update(path.resolve(targetPath))
    .digest('hex')
    .slice(0, 16)}`;
}

function roleRank(candidate) {
  if (candidate.role === 'primary') return 0;
  if (candidate.role === 'synced') return 1;
  if (candidate.role === 'compat') return 2;
  if (candidate.role === 'custom') return 3;
  return 4;
}

async function fileCount(root) {
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await fsp.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(path.join(current, entry.name));
      else if (entry.isFile()) count += 1;
    }
  }
  return count;
}

function noteScanError(engine, error, target) {
  if (error?.permission) engine.notePermission(error.permission);
  else if (isPermissionError(error)) {
    engine.notePermission(permissionFromError(error, target));
  }
}

async function readSkillDirs(engine, base) {
  let entries = [];
  try {
    entries = await fsp.readdir(base, { withFileTypes: true });
  } catch (error) {
    noteScanError(engine, error, base);
    return [];
  }
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const abs = path.join(base, entry.name);
    const stat = await fsp.lstat(abs).catch((error) => {
      noteScanError(engine, error, abs);
      return null;
    });
    if (!stat || stat.isSymbolicLink()) continue;
    const hasSkill = await fsp
      .access(path.join(abs, 'SKILL.md'))
      .then(() => true)
      .catch((error) => {
        noteScanError(engine, error, path.join(abs, 'SKILL.md'));
        return false;
      });
    if (!hasSkill) continue;
    dirs.push({ name: entry.name, abs });
  }
  return dirs;
}

function scopeProjects(engine) {
  return engine.db.all('SELECT * FROM projects').filter((project) => !project.missing);
}

async function candidateDirectories(engine, harness, candidate, project) {
  if (candidate.scope === 'project') {
    if (!project) return [];
    return collectProjectCandidateDirs(candidate, project.path);
  }
  const base = engine.candidateBase(harness, candidate);
  if (!base) return [];
  return (await directoryExists(base)) ? [base] : [];
}

async function scanUnmanaged(engine) {
  const ignored = new Set(
    engine.db.all('SELECT path FROM ignored_unmanaged').map((item) => path.resolve(item.path)),
  );
  const bindings = engine.db.all('SELECT * FROM bindings');
  const projects = scopeProjects(engine);
  const projectMap = new Map(projects.map((project) => [project.project_id, project]));
  const harnessOrder = new Map(
    engine.config.harnesses.map((harness, index) => [harness.id, index]),
  );

  const managed = new Set(bindings.map((binding) => path.resolve(binding.target_path)));
  const occurrences = new Map();
  const occurrenceList = [];

  const addOccurrence = (occurrence) => {
    const key = `${occurrence.scope}|${occurrence.projectId ?? ''}|${occurrence.harnessId}|${occurrence.slug}`;
    const list = occurrences.get(key) ?? [];
    list.push(occurrence);
    occurrences.set(key, list);
    occurrenceList.push(occurrence);
  };

  for (const harness of engine.config.harnesses) {
    for (const candidate of sortCandidates(harness.candidates)) {
      if (candidate.scope === 'global') {
        const bases = await candidateDirectories(engine, harness, candidate, null);
        for (const base of bases) {
          for (const dir of await readSkillDirs(engine, base)) {
            addOccurrence({
              dir: dir.abs,
              slug: dir.name,
              harnessId: harness.id,
              harnessName: harness.name,
              candidate,
              scope: 'global',
              projectId: null,
              projectName: null,
            });
          }
        }
        continue;
      }
      for (const project of projects) {
        const bases = await candidateDirectories(engine, harness, candidate, project);
        for (const base of bases) {
          for (const dir of await readSkillDirs(engine, base)) {
            addOccurrence({
              dir: dir.abs,
              slug: dir.name,
              harnessId: harness.id,
              harnessName: harness.name,
              candidate,
              scope: 'project',
              projectId: project.project_id,
              projectName: project.name,
            });
          }
        }
      }
    }
  }

  for (const binding of bindings) {
    const harness = engine.harness(binding.harness_id);
    if (!harness) continue;
    const skill = engine.skillById(binding.skill_id);
    if (!skill) continue;
    const project = binding.project_id ? projectMap.get(binding.project_id) : null;
    if (binding.scope === 'project' && !project) continue;
    const candidate = engine.candidateForTarget(
      harness,
      binding.scope === 'project' ? project : null,
      binding.target_path,
    );
    if (!candidate) continue;
    addOccurrence({
      dir: binding.target_path,
      slug: skill.slug,
      harnessId: binding.harness_id,
      harnessName: harness.name,
      candidate,
      scope: binding.scope,
      projectId: binding.project_id ?? null,
      projectName: project?.name ?? null,
      managed: true,
      bindingId: binding.binding_id,
    });
  }

  const winnerFor = (list) =>
    [...list].sort((left, right) => {
      if (left.candidate.priority !== right.candidate.priority) {
        return left.candidate.priority - right.candidate.priority;
      }
      const rank = roleRank(left.candidate) - roleRank(right.candidate);
      if (rank !== 0) return rank;
      if (Boolean(left.managed) !== Boolean(right.managed)) return left.managed ? -1 : 1;
      return (harnessOrder.get(left.harnessId) ?? 99) - (harnessOrder.get(right.harnessId) ?? 99);
    })[0];

  const byDir = new Map();
  for (const occurrence of occurrenceList) {
    const existing = byDir.get(occurrence.dir);
    if (!existing) {
      byDir.set(occurrence.dir, []);
    }
    byDir.get(occurrence.dir).push(occurrence);
  }

  const result = [];
  for (const [dir, dirOccurrences] of byDir) {
    const resolved = path.resolve(dir);
    if (managed.has(resolved) || ignored.has(resolved)) continue;
    const owner = [...dirOccurrences].sort((left, right) => {
      const rank = roleRank(left.candidate) - roleRank(right.candidate);
      if (rank !== 0) return rank;
      if (left.candidate.priority !== right.candidate.priority) {
        return left.candidate.priority - right.candidate.priority;
      }
      return (harnessOrder.get(left.harnessId) ?? 99) - (harnessOrder.get(right.harnessId) ?? 99);
    })[0];
    const harnessIds = Array.from(new Set(dirOccurrences.map((item) => item.harnessId)));
    const shared = dirOccurrences.some(
      (item) => item.candidate.role === 'shared' || isAgentsSharedPath(item.candidate.path),
    );
    const key = `${owner.scope}|${owner.projectId ?? ''}|${owner.harnessId}|${owner.slug}`;
    const winner = winnerFor(
      occurrences.get(key) ?? dirOccurrences.filter((item) => item.harnessId === owner.harnessId),
    );
    const shadowed = winner && path.resolve(winner.dir) !== resolved ? winner : null;
    result.push({
      id: unmanagedId(dir),
      harnessId: owner.harnessId,
      harnessIds,
      name: owner.slug,
      fsPath: dir,
      displayPath: engine.displayFor(dir),
      localRel: engine.relFor(dir),
      fileCount: await fileCount(dir),
      scope: owner.scope,
      projectId: owner.projectId ?? undefined,
      projectName: owner.projectName ?? undefined,
      candidateId: owner.candidate.id,
      candidatePath: owner.candidate.path,
      candidateRole: owner.candidate.role,
      candidateLabel: roleLabel(owner.candidate),
      discoveryLabel: discoveryLabel(owner.candidate),
      priority: owner.candidate.priority,
      shared,
      sharedHarnessIds: shared ? harnessIds : undefined,
      shadowedBy: shadowed
        ? {
            candidateId: shadowed.candidate.id,
            candidatePath: shadowed.candidate.path,
            candidateLabel: roleLabel(shadowed.candidate),
            priority: shadowed.candidate.priority,
            managed: Boolean(shadowed.managed),
            bindingId: shadowed.bindingId ?? null,
          }
        : null,
    });
  }
  result.sort((left, right) => left.name.localeCompare(right.name) || left.displayPath.localeCompare(right.displayPath));
  return result;
}

async function reconcile(engine) {
  engine.permissionIssue = null;
  const projects = engine.db.all('SELECT * FROM projects');
  const projectMap = new Map();
  for (const project of projects) {
    let exists;
    try {
      exists = await directoryExists(project.path);
    } catch (error) {
      engine.notePermission(permissionFromError(error, project.path));
      exists = project.missing !== 1;
    }
    if (project.missing === 1 && exists) {
      await engine.handleProjectRevival(project);
    } else if ((project.missing === 1) === exists) {
      engine.db.run(
        'UPDATE projects SET missing = ? WHERE project_id = ?',
        exists ? 0 : 1,
        project.project_id,
      );
    }
    projectMap.set(project.project_id, { ...project, missing: exists ? 0 : 1 });
  }

  const skills = new Map(
    engine.db.all('SELECT * FROM skills').map((skill) => [skill.skill_id, skill]),
  );
  const bindings = engine.db.all('SELECT * FROM bindings');

  for (const binding of bindings) {
    let state = 'enabled';
    let currentSha = null;
    let driftFiles = null;
    let updateAvailable = null;
    let permissionBlocked = false;

    const project = binding.project_id ? projectMap.get(binding.project_id) : null;
    if (binding.scope === 'project' && (!project || project.missing)) {
      state = 'orphaned';
    }

    if (state !== 'orphaned') {
      const stat = await fsp.lstat(binding.target_path).catch(() => null);
      if (!stat) {
        state = 'missing';
      } else {
        const expected = await fsp
          .realpath(storeDir(engine, binding.resolved_sha))
          .catch(() => null);
        const actual = await fsp.realpath(binding.target_path).catch(() => null);
        const linkedToStore = Boolean(expected && actual && expected === actual);

        if (linkedToStore) {
          state = 'enabled';
          if (binding.ignored_drift) {
            engine.db.run(
              'UPDATE bindings SET ignored_drift = 0 WHERE binding_id = ?',
              binding.binding_id,
            );
          }
        } else {
          let hash = null;
          try {
            hash = (await hashDirectory(binding.target_path, engine.cache)).sha;
          } catch (error) {
            if (error?.permission) {
              engine.notePermission(error.permission);
              permissionBlocked = true;
            } else if (isPermissionError(error)) {
              engine.notePermission(permissionFromError(error, binding.target_path));
              permissionBlocked = true;
            }
            hash = null;
          }
          if (hash && hash === binding.resolved_sha) {
            state = 'enabled';
            if (binding.ignored_drift) {
              engine.db.run(
                'UPDATE bindings SET ignored_drift = 0 WHERE binding_id = ?',
                binding.binding_id,
              );
            }
          } else if (hash) {
            state = 'drifted';
            currentSha = hash;
            driftFiles = await diffDirectories(
              binding.target_path,
              storeDir(engine, binding.resolved_sha),
              engine.cache,
              40,
            );
          } else {
            state = 'missing';
          }
        }

        if (state === 'enabled') {
          const skill = skills.get(binding.skill_id);
          if (skill?.active_sha && skill.active_sha !== binding.resolved_sha) {
            updateAvailable = skill.active_sha;
          }
        }
      }
    }

    if (permissionBlocked) continue;

    const nextDrift = driftFiles && driftFiles.length > 0 ? JSON.stringify(driftFiles) : null;
    if (
      binding.state !== state ||
      binding.current_sha !== currentSha ||
      binding.drift_files !== nextDrift ||
      (binding.update_available ?? null) !== updateAvailable
    ) {
      engine.db.run(
        `UPDATE bindings SET state = ?, current_sha = ?, drift_files = ?, update_available = ? WHERE binding_id = ?`,
        state,
        currentSha,
        nextDrift,
        updateAvailable,
        binding.binding_id,
      );
    }
  }

  engine.lastChecked = new Date();
  engine.db.run(
    "INSERT INTO app_meta (key, value) VALUES ('last_checked', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    String(engine.lastChecked.getTime()),
  );
  return engine.lastChecked;
}

module.exports = {
  reconcile,
  scanUnmanaged,
  shortSha,
  unmanagedId,
};
