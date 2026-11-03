function createActionHandlers(getEngine) {
  const instance = () => {
    const engine = getEngine();
    if (!engine) throw new Error('引擎尚未初始化');
    return engine;
  };

  return {
    enable: (payload) => instance().enable(payload),
    disable: (payload) =>
      instance().disable(
        typeof payload === 'string' ? payload : payload?.bindingId,
        typeof payload === 'object' ? payload?.mode ?? 'single' : 'single',
      ),
    checkDisableImpact: (payload) =>
      instance().checkDisableImpact(payload?.bindingId ?? payload),
    convertToCopy: (payload) => instance().convertToCopy(payload),
    updateBinding: (payload) => instance().updateBinding(payload),
    resetBinding: (payload) => instance().resetBinding(payload),
    redeployBinding: (payload) => instance().redeployBinding(payload),
    adoptBinding: (payload) => instance().adoptBinding(payload),
    ignoreDrift: (payload) => instance().ignoreDrift(payload),
    switchVersion: (payload) => instance().switchVersion(payload?.skillId, payload?.sha),
    adoptUnmanaged: (payload) => instance().adoptUnmanaged(payload?.id, payload?.mode),
    adoptUnmanagedBatch: (payload) =>
      instance().adoptUnmanagedBatch(payload?.ids, payload?.mode),
    ignoreUnmanaged: (payload) => instance().ignoreUnmanaged(payload),
    resyncSkillComment: (payload) => instance().resyncSkillComment(payload?.skillId),
    skillPreview: (payload) =>
      instance().skillPreview(payload?.skillId, payload?.sha ?? null),
    scanHarness: (payload) => instance().scanHarness(payload),
    addProject: (payload) => instance().addProject(payload),
    relocateProject: (payload) => instance().relocateProject(payload?.projectId, payload?.path),
    cleanProject: (payload) => instance().cleanProject(payload),
    convertToProjectOnly: (payload) =>
      instance().convertToProjectOnly(payload?.skillId, payload?.projectId),
    editSkill: (payload) => instance().editSkill(payload?.skillId, payload?.patch),
    deleteSkill: (payload) => instance().deleteSkill(payload),
    importLocal: (payload) => instance().importLocal(payload),
    importGit: (payload) => instance().importGitRepo(payload),
    importBackup: (payload) => instance().importBackupFile(payload),
    exportBackup: (payload) => instance().exportBackupTo(payload),
    exportProject: (payload) => instance().exportProject(payload),
    restoreProject: (payload) => instance().restoreProject(payload),
    saveConfig: (payload) => instance().saveHarnessConfig(payload),
    addHarnessCandidate: (payload) => instance().addHarnessCandidate(payload),
    resetHarnessDefaults: (payload) =>
      instance().resetHarnessDefaults(payload?.harnessId ?? payload),
    createCandidateDir: (payload) => instance().createCandidateDir(payload),
    toggleFavorite: (payload) =>
      instance().toggleFavorite(payload?.skillId ?? payload),
    configureWeb: (payload) => instance().configureWeb(payload),
    autoAllocateWebPort: () => instance().autoAllocateWebPort(),
    setMode: (payload) => instance().setMode(payload),
    getWorkRoot: () => instance().getWorkRoot(),
    listAuditLogs: (payload) => instance().listAuditLogs(payload),
    exportAuditLogs: (payload) => instance().exportAuditLogs(payload),
  };
}

module.exports = { createActionHandlers };
