const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 1024;
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const buildDir = path.join(__dirname, '..', 'build');

function icoFromPngs(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(image.width >= 256 ? 0 : image.width, 0);
    entry.writeUInt8(image.height >= 256 ? 0 : image.height, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += image.png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(buildDir, 'icon.svg'), 'utf8');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
    svg { display: block; width: ${SIZE}px; height: ${SIZE}px; }
  </style></head><body>${svg}</body></html>`;

  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
    },
  });

  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const image = await win.webContents.capturePage();
    if (image.isEmpty()) throw new Error('图标渲染结果为空');

    fs.writeFileSync(path.join(buildDir, 'icon.png'), image.toPNG());

    const entries = [];
    for (const size of ICO_SIZES) {
      const resized = size === SIZE ? image : image.resize({ width: size, height: size, quality: 'best' });
      entries.push({ width: size, height: size, png: resized.toPNG() });
    }
    const ico = icoFromPngs(entries);
    fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);
    console.log(
      `[icons] icon.png ${image.getSize().width}x${image.getSize().height}, ` +
        `icon.ico ${ICO_SIZES.join('/')} (${ico.length} bytes)`,
    );
  } finally {
    win.destroy();
    app.quit();
  }
}).catch((error) => {
  console.error('[icons] 生成失败:', error);
  app.exit(1);
});
