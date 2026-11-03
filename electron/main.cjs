const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
} = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Engine } = require('./engine/index.cjs');
const { createActionHandlers } = require('./engine/actions.cjs');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

app.setName('Quiver');
if (isWindows) app.setAppUserModelId('com.quiver.desktop');

let mainWindow = null;
let engine = null;
let engineReady = null;
let engineFailure = null;
let tray = null;
let forceQuit = false;

function failure(error) {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    code: error?.code ?? 'ENGINE_ERROR',
    permission: error?.permission ?? null,
    suggestion: error?.suggestion ?? null,
  };
}

async function ready() {
  if (engineReady) await engineReady;
  if (engineFailure) throw engineFailure;
  if (!engine) throw new Error('引擎尚未初始化');
  return engine;
}

function splitCommandLine(input) {
  const parts = [];
  let current = '';
  let quote = null;
  let hasContent = false;
  for (const char of String(input ?? '')) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      hasContent = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (hasContent) {
        parts.push(current);
        current = '';
        hasContent = false;
      }
      continue;
    }
    current += char;
    hasContent = true;
  }
  if (hasContent) parts.push(current);
  return parts;
}

function commandExists(command) {
  if (!command) return false;
  if (path.isAbsolute(command)) {
    return spawnSync(command, ['--version'], { timeout: 4000, windowsHide: true }).status === 0;
  }
  const probe = isWindows ? 'where' : 'which';
  try {
    const result = spawnSync(probe, [command], {
      timeout: 4000,
      windowsHide: true,
      stdio: 'ignore',
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function launchDetached(command, args, { shellMode = false, ...options } = {}) {
  return new Promise((resolve, reject) => {
    const child = shellMode
      ? spawn(command, { shell: true, detached: true, stdio: 'ignore', windowsHide: true, ...options })
      : spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, ...options });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function quoteWindows(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function windowsEditorFallbacks() {
  const local = process.env.LOCALAPPDATA;
  return [
    local ? path.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe') : null,
    'C:\\Program Files\\Microsoft VS Code\\Code.exe',
  ].filter(Boolean);
}

function resolveWindowsEditor(command) {
  const candidates = [command];
  if (/^code(?:\.cmd)?$/i.test(command)) {
    candidates.push('code-insiders', ...windowsEditorFallbacks());
  }
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate)) {
      if (fs.existsSync(candidate)) return candidate;
    } else if (commandExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function openEditor(target) {
  const realPath = path.resolve(target);
  if (!fs.existsSync(realPath)) {
    throw new Error(`路径不存在或已被移动：${realPath}`);
  }
  const configured = engine?.config?.editor_command || 'code';
  const parts = splitCommandLine(configured);
  const command = parts.shift() ?? 'code';
  if (isWindows) {
    const resolved = resolveWindowsEditor(command);
    if (!resolved) {
      throw new Error(
        `未找到编辑器「${command}」，请安装 VS Code 或在设置中修改默认编辑器命令`,
      );
    }
    const line = [resolved, ...parts, realPath].map(quoteWindows).join(' ');
    await launchDetached('cmd.exe', ['/d', '/s', '/c', line]);
    return;
  }
  if (!commandExists(command)) {
    throw new Error(`未找到编辑器命令「${configured}」，请在设置中修改默认编辑器命令`);
  }
  if (isMac && /^code(?:-insiders)?$/i.test(command)) {
    await launchDetached('open', [
      '-a',
      command === 'code-insiders' ? 'Visual Studio Code - Insiders' : 'Visual Studio Code',
      realPath,
    ]);
    return;
  }
  await launchDetached(command, [...parts, realPath]);
}

async function openTerminal(target) {
  const realPath = path.resolve(target);
  if (!fs.existsSync(realPath)) {
    throw new Error(`目录不存在或已被移动：${realPath}`);
  }
  if (isWindows) {
    try {
      await launchDetached('wt.exe', ['-d', realPath]);
      return;
    } catch {
      await launchDetached('cmd.exe', ['/K'], { cwd: realPath });
      return;
    }
  }
  if (isMac) {
    await launchDetached('open', ['-a', 'Terminal', realPath]);
    return;
  }
  await launchDetached('x-terminal-emulator', ['--working-directory', realPath]);
}

async function resolveExisting(instance, input) {
  const target = instance.resolveRequestPath(input);
  const stat = await fsp.stat(target).catch(() => null);
  if (!stat) throw new Error('路径不存在或已被移动');
  return target;
}

const actions = createActionHandlers(() => engine);

function isAllowedExternal(url) {
  return (
    url ===
      'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles' ||
    /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(?:\/.*)?$/i.test(url)
  );
}

function registerIpc() {
  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on('window:toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle('window:set-tray-on-close', async (_event, enabled) => {
    try {
      const instance = await ready();
      const result = await instance.setTrayOnClose(Boolean(enabled));
      syncTrayFromConfig();
      if (instance.config.tray_on_close && !tray) {
        await instance.setTrayOnClose(false);
        return failure(new Error('系统托盘图标不可用，已保持关闭'));
      }
      return result;
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('engine:snapshot', async () => {
    try {
      const instance = await ready();
      return { ok: true, snapshot: await instance.snapshot() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('engine:refresh', async () => {
    try {
      return await (await ready()).refresh();
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('engine:action', async (_event, request) => {
    const name = request?.action;
    const handler = actions[name];
    if (!handler) return { ok: false, error: `未知的操作：${String(name)}` };
    try {
      const result = await handler(request?.payload);
      if (name === 'setMode') syncTrayFromConfig();
      return result;
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('dialog:folder', async (event, options = {}) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
      const result = await dialog.showOpenDialog(win, {
        title: options.title || '选择文件夹',
        defaultPath: options.defaultPath,
        properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
      });
      return { ok: true, path: result.canceled ? null : result.filePaths[0] ?? null };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('dialog:file', async (event, options = {}) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
      const result = await dialog.showOpenDialog(win, {
        title: options.title || '选择文件',
        filters: options.filters,
        properties: ['openFile', 'dontAddToRecent'],
      });
      return { ok: true, path: result.canceled ? null : result.filePaths[0] ?? null };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('dialog:save', async (event, options = {}) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
      const result = await dialog.showSaveDialog(win, {
        title: options.title || '保存文件',
        defaultPath: options.defaultPath,
        filters: options.filters,
      });
      return { ok: true, path: result.canceled ? null : result.filePath ?? null };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('shell:reveal', async (_event, input) => {
    try {
      const instance = await ready();
      const target = await resolveExisting(instance, input);
      shell.showItemInFolder(target);
      return { ok: true, path: target };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('shell:editor', async (_event, input) => {
    try {
      const instance = await ready();
      const target = await resolveExisting(instance, input);
      await openEditor(target);
      return { ok: true, path: target, command: instance.config.editor_command };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('shell:terminal', async (_event, input) => {
    try {
      const instance = await ready();
      const target = await resolveExisting(instance, input);
      await openTerminal(target);
      return { ok: true, path: target };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('shell:clipboard', async (_event, text) => {
    try {
      clipboard.writeText(String(text ?? ''));
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('shell:open-external', async (_event, input) => {
    try {
      const url = String(input ?? '');
      if (!isAllowedExternal(url)) {
        throw new Error('该链接不在本地白名单内，已拒绝打开');
      }
      await shell.openExternal(url);
      return { ok: true, path: url };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('shell:open-work-root', async () => {
    try {
      const instance = await ready();
      await fsp.mkdir(instance.root, { recursive: true });
      const error = await shell.openPath(instance.root);
      if (error) throw new Error(error);
      return { ok: true, path: instance.root };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('shell:save-qr', async (event, input = {}) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
      const dataUrl = typeof input?.dataUrl === 'string' ? input.dataUrl : '';
      const prefix = 'data:image/png;base64,';
      if (!dataUrl.startsWith(prefix) || dataUrl.length > 12 * 1024 * 1024) {
        throw new Error('二维码图片格式无效');
      }
      const buffer = Buffer.from(dataUrl.slice(prefix.length), 'base64');
      if (buffer.length < 64 || buffer.length > 8 * 1024 * 1024) {
        throw new Error('二维码图片大小异常');
      }
      const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      if (!pngSignature.every((byte, index) => buffer[index] === byte)) {
        throw new Error('二维码图片不是有效的 PNG');
      }
      const suggested = String(input?.defaultName ?? 'quiver-qr.png')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
        .replace(/^\.+/, '')
        .trim()
        .slice(0, 80);
      const fileName = /\.png$/i.test(suggested)
        ? suggested
        : `${suggested || 'quiver-qr'}.png`;
      const result = await dialog.showSaveDialog(win, {
        title: '保存二维码',
        defaultPath: fileName,
        filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      });
      if (result.canceled || !result.filePath) return { ok: true };
      await fsp.writeFile(result.filePath, buffer);
      return { ok: true, path: result.filePath };
    } catch (error) {
      return failure(error);
    }
  });
}

function windowIcon() {
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '..', 'build', 'icon.png');
  return fs.existsSync(candidate) ? candidate : undefined;
}

function trayImage() {
  const icon = windowIcon();
  if (!icon) return nativeImage.createEmpty();
  const image = nativeImage.createFromPath(icon);
  if (image.isEmpty()) return image;
  const size = isWindows ? 16 : 22;
  return image.resize({ width: size, height: size, quality: 'best' });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function openWebFromTray() {
  try {
    const instance = await ready();
    const status = instance.webStatus();
    if (!status.running) {
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        title: '本地 Web 服务未运行',
        message: '本地 Web 服务当前未运行',
        detail: '请先在设置中开启「本地 Web 服务」，再从托盘打开浏览器。',
        buttons: ['显示主窗口', '取消'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (response === 0) showMainWindow();
      return;
    }
    await shell.openExternal(status.url);
  } catch (error) {
    await dialog
      .showMessageBox({
        type: 'error',
        title: '无法打开 Web 端',
        message: '无法打开本地 Web 端',
        detail: error instanceof Error ? error.message : String(error),
        buttons: ['确定'],
        noLink: true,
      })
      .catch(() => {});
  }
}

function buildTrayMenu() {
  let webRunning = false;
  try {
    webRunning = Boolean(engine?.webStatus().running);
  } catch {
    webRunning = false;
  }
  return Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showMainWindow() },
    {
      label: '在浏览器打开 Web 端',
      enabled: webRunning,
      click: () => void openWebFromTray(),
    },
    { type: 'separator' },
    {
      label: '彻底退出 Quiver',
      click: () => {
        forceQuit = true;
        app.quit();
      },
    },
  ]);
}

function ensureTray() {
  if (tray) return;
  const image = trayImage();
  if (image.isEmpty()) return;
  tray = new Tray(image);
  tray.setToolTip('Quiver · 本地技能管理器');
  tray.on('click', () => showMainWindow());
  tray.on('right-click', () => tray?.popUpContextMenu(buildTrayMenu()));
}

function destroyTray() {
  if (!tray) return;
  const current = tray;
  tray = null;
  try {
    current.destroy();
  } catch (error) {
    console.error('[quiver] 托盘销毁失败:', error);
  }
}

function syncTrayFromConfig() {
  try {
    if (engine?.config?.tray_on_close) ensureTray();
    else destroyTray();
  } catch (error) {
    destroyTray();
    console.error('[quiver] 托盘初始化失败:', error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    icon: windowIcon(),
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 12 } }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.webContents.send('window:maximized', mainWindow.isMaximized());
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized', false);
  });
  mainWindow.on('close', (event) => {
    if (forceQuit || !engine?.config?.tray_on_close) return;
    syncTrayFromConfig();
    if (!tray) return;
    event.preventDefault();
    mainWindow?.hide();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL() ?? '';
    if (url !== current) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  if (isDev) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        mainWindow?.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  engine = new Engine(app);
  engineReady = engine
    .init()
    .then(() => syncTrayFromConfig())
    .catch((error) => {
      engineFailure = error;
      console.error('[quiver] 引擎初始化失败:', error);
    });

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

let shuttingDown = false;
let closeStarted = false;
app.on('before-quit', (event) => {
  forceQuit = true;
  if (shuttingDown || !engine) return;
  if (closeStarted) {
    shuttingDown = true;
    return;
  }
  closeStarted = true;
  event.preventDefault();
  engine
    .close()
    .catch((error) => console.error('[quiver] 引擎关闭失败:', error))
    .finally(() => {
      destroyTray();
      app.quit();
    });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
