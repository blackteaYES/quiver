const { contextBridge, ipcRenderer, webFrame } = require('electron');

const action = (name, payload) => ipcRenderer.invoke('engine:action', { action: name, payload });

contextBridge.exposeInMainWorld('quiver', {
  isElectron: true,
  platform: process.platform,
  engine: {
    snapshot: () => ipcRenderer.invoke('engine:snapshot'),
    refresh: () => ipcRenderer.invoke('engine:refresh'),
    enable: (payload) => action('enable', payload),
    disable: (id, mode) => action('disable', { bindingId: id, mode }),
    checkDisableImpact: (id) => action('checkDisableImpact', { bindingId: id }),
    convertToCopy: (id) => action('convertToCopy', id),
    updateBinding: (id) => action('updateBinding', id),
    resetBinding: (id) => action('resetBinding', id),
    redeployBinding: (id) => action('redeployBinding', id),
    adoptBinding: (id) => action('adoptBinding', id),
    ignoreDrift: (id) => action('ignoreDrift', id),
    switchVersion: (payload) => action('switchVersion', payload),
    adoptUnmanaged: (payload) => action('adoptUnmanaged', payload),
    adoptUnmanagedBatch: (payload) => action('adoptUnmanagedBatch', payload),
    ignoreUnmanaged: (id) => action('ignoreUnmanaged', id),
    resyncSkillComment: (skillId) => action('resyncSkillComment', { skillId }),
    skillPreview: (payload) => action('skillPreview', payload),
    scanHarness: (id) => action('scanHarness', id),
    addProject: (path) => action('addProject', path),
    relocateProject: (payload) => action('relocateProject', payload),
    cleanProject: (id) => action('cleanProject', id),
    convertToProjectOnly: (payload) => action('convertToProjectOnly', payload),
    editSkill: (payload) => action('editSkill', payload),
    deleteSkill: (id) => action('deleteSkill', id),
    importLocal: (path) => action('importLocal', path),
    importGit: (url) => action('importGit', url),
    importBackup: (path) => action('importBackup', path),
    exportBackup: (path) => action('exportBackup', path),
    exportProject: (id) => action('exportProject', id),
    restoreProject: (id) => action('restoreProject', id),
    saveConfig: (payload) => action('saveConfig', payload),
    addHarnessCandidate: (payload) => action('addHarnessCandidate', payload),
    resetHarnessDefaults: (harnessId) => action('resetHarnessDefaults', { harnessId }),
    createCandidateDir: (payload) => action('createCandidateDir', payload),
    toggleFavorite: (skillId) => action('toggleFavorite', { skillId }),
    configureWeb: (payload) => action('configureWeb', payload),
    autoAllocateWebPort: () => action('autoAllocateWebPort'),
    setMode: (mode) => action('setMode', mode),
    getWorkRoot: () => action('getWorkRoot'),
    listAuditLogs: (payload) => action('listAuditLogs', payload),
    exportAuditLogs: (payload) => action('exportAuditLogs', payload),
    onChange: (callback) => {
      const listener = (_event, snapshot) => callback(snapshot);
      ipcRenderer.on('engine:changed', listener);
      return () => ipcRenderer.removeListener('engine:changed', listener);
    },
  },
  dialog: {
    pickFolder: (options) => ipcRenderer.invoke('dialog:folder', options),
    pickFile: (options) => ipcRenderer.invoke('dialog:file', options),
    saveFile: (options) => ipcRenderer.invoke('dialog:save', options),
  },
  shell: {
    reveal: (input) => ipcRenderer.invoke('shell:reveal', input),
    openEditor: (input) => ipcRenderer.invoke('shell:editor', input),
    openTerminal: (input) => ipcRenderer.invoke('shell:terminal', input),
    copyText: (text) => ipcRenderer.invoke('shell:clipboard', text),
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
    openWorkRoot: () => ipcRenderer.invoke('shell:open-work-root'),
    saveQr: (dataUrl, defaultName) =>
      ipcRenderer.invoke('shell:save-qr', { dataUrl, defaultName }),
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    setTrayOnClose: (enabled) =>
      ipcRenderer.invoke('window:set-tray-on-close', Boolean(enabled)),
    setZoomFactor: (scale) => webFrame.setZoomFactor(scale),
    onMaximized: (callback) => {
      const listener = (_event, maximized) => callback(Boolean(maximized));
      ipcRenderer.on('window:maximized', listener);
      return () => ipcRenderer.removeListener('window:maximized', listener);
    },
  },
});
