const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createActionHandlers } = require('./actions.cjs');

const HOST = '127.0.0.1';
const LAN_HOST = '0.0.0.0';
const BODY_LIMIT = 2 * 1024 * 1024;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? '';
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

function isLoopbackHost(hostHeader) {
  if (!hostHeader) return false;
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(`http://${hostHeader}`).hostname);
  } catch {
    return false;
  }
}
const DIST_ROOT = path.join(__dirname, '..', '..', 'dist');
const WEB_BLOCKED_ACTIONS = new Set(['configureWeb', 'setMode', 'autoAllocateWebPort']);

const VIRTUAL_INTERFACE =
  /(vmware|virtualbox|vbox|vethernet|hyper-v|wsl|loopback|virtual|虚拟|tunnel|tap|tun|clash|mihomo|meta|docker|vpn|wireguard|tailscale|zerotier|radmin|hamachi|npcap|sing-?box|utun)/i;
const VIRTUAL_ADDRESS = /^(198\.(18|19)\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

function isVirtualAddress(name, address) {
  return VIRTUAL_INTERFACE.test(name) || VIRTUAL_ADDRESS.test(address);
}

function localIPv4Entries() {
  const rank = (entry) => {
    let score = entry.virtual ? 10 : 0;
    if (/^192\.168\./.test(entry.address)) score += 0;
    else if (/^10\./.test(entry.address)) score += 1;
    else if (/^172\.(1[6-9]|2\d|3[01])\./.test(entry.address)) score += 2;
    else score += 3;
    return score;
  };
  const seen = new Map();
  const interfaces = os.networkInterfaces();
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      if (entry.family !== 'IPv4' && entry.family !== 4) continue;
      if (entry.address.startsWith('169.254.')) continue;
      const item = {
        address: entry.address,
        name,
        virtual: isVirtualAddress(name, entry.address),
      };
      const previous = seen.get(entry.address);
      if (!previous || rank(item) < rank(previous)) seen.set(entry.address, item);
    }
  }
  return [...seen.values()].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.name.localeCompare(b.name) ||
      a.address.localeCompare(b.address),
  );
}

function localIPv4Addresses() {
  return localIPv4Entries().map((entry) => entry.address);
}

function hostnameOf(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end > 0 ? raw.slice(1, end) : raw;
  }
  return raw.replace(/:\d+$/, '');
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function tokenMatches(expected, provided) {
  if (!expected || typeof provided !== 'string' || provided.length === 0) return false;
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(provided, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function stripToken(snapshot) {
  if (!snapshot?.settings?.web) return snapshot;
  return {
    ...snapshot,
    settings: {
      ...snapshot.settings,
      web: { ...snapshot.settings.web, token: '' },
    },
  };
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (!payload.snapshot) return payload;
  return { ...payload, snapshot: stripToken(payload.snapshot) };
}

function failure(error) {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    code: error?.code ?? 'ENGINE_ERROR',
    permission: error?.permission ?? null,
    suggestion: error?.suggestion ?? null,
  };
}

function applyCommonHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(Object.assign(new Error('请求体超过 2 MB 限制'), { code: 'BODY_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

class WebServer {
  constructor(engine, { port = 4310, lan = false } = {}) {
    this.engine = engine;
    this.port = port;
    this.lan = lan;
    this.server = null;
    this.clients = new Set();
    this.heartbeat = null;
    this.status = {
      running: false,
      port,
      lan,
      host: this.bindHost(),
      url: `http://${HOST}:${port}`,
      lanUrls: this.getLanUrls(),
      lanAddresses: this.getLanAddresses(),
      error: null,
      disabled: true,
    };
    this.handlers = createActionHandlers(() => this.engine);
  }

  bindHost() {
    return this.lan ? LAN_HOST : HOST;
  }

  getLanAddresses() {
    if (!this.lan) return [];
    return localIPv4Entries().map((entry) => ({
      ...entry,
      url: `http://${entry.address}:${this.port}`,
    }));
  }

  getLanUrls() {
    return this.getLanAddresses().map((entry) => entry.url);
  }

  hostAllowed(host) {
    const hostname = hostnameOf(host);
    if (!hostname) return false;
    if (hostname === '127.0.0.1' || hostname === 'localhost') return true;
    return this.lan && localIPv4Addresses().includes(hostname);
  }

  originAllowed(origin) {
    const match = /^http:\/\/([^/:]+)(?::\d+)?$/i.exec(String(origin ?? ''));
    if (!match) return false;
    const hostname = match[1].toLowerCase();
    if (hostname === '127.0.0.1' || hostname === 'localhost') return true;
    return this.lan && localIPv4Addresses().includes(hostname);
  }

  applyCors(req, res) {
    const origin = req.headers.origin;
    if (origin) {
      if (!this.originAllowed(origin)) return false;
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Quiver-Token');
    res.setHeader('Access-Control-Max-Age', '600');
    return true;
  }

  async start(port = this.port, lan = this.lan) {
    await this.stop();
    this.port = port;
    this.lan = lan;
    this.status = {
      running: false,
      port,
      lan,
      host: this.bindHost(),
      url: `http://${HOST}:${port}`,
      lanUrls: this.getLanUrls(),
      lanAddresses: this.getLanAddresses(),
      error: null,
      disabled: false,
    };
    const server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
    this.server = server;
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        // Loopback by default; LAN binding is an explicit opt-in and still token-gated.
        server.listen(port, this.bindHost());
      });
      this.status.running = true;
      server.on('error', (error) => {
        this.status.error = error?.message ?? String(error);
      });
      this.heartbeat = setInterval(() => this.ping(), 20_000);
      this.heartbeat.unref?.();
    } catch (error) {
      this.server = null;
      try {
        server.close();
      } catch {
        /* server never started */
      }
      this.status.error =
        error?.code === 'EADDRINUSE'
          ? `端口 ${port} 已被占用，请更换端口后重试`
          : `本地服务启动失败：${error?.message ?? error}`;
    }
    return this.status;
  }

  async stop() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    this.clients.forEach((client) => {
      try {
        client.end();
      } catch {
        /* already closed */
      }
    });
    this.clients.clear();
    const server = this.server;
    this.server = null;
    if (!server) {
      this.status.running = false;
      return;
    }
    await new Promise((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
    });
    this.status.running = false;
  }

  disable() {
    void this.stop();
    this.status = {
      running: false,
      port: this.port,
      lan: this.lan,
      host: this.bindHost(),
      url: `http://${HOST}:${this.port}`,
      lanUrls: this.getLanUrls(),
      lanAddresses: this.getLanAddresses(),
      error: null,
      disabled: true,
    };
  }

  ping() {
    this.clients.forEach((client) => {
      try {
        client.write(': ping\n\n');
      } catch {
        this.clients.delete(client);
      }
    });
  }

  broadcast(snapshot) {
    if (this.clients.size === 0 || !snapshot) return;
    const frame = `data: ${JSON.stringify({
      type: 'snapshot',
      snapshot: stripToken(snapshot),
    })}\n\n`;
    this.clients.forEach((client) => {
      try {
        client.write(frame);
      } catch {
        this.clients.delete(client);
      }
    });
  }

  authorized(req) {
    const expected = this.engine?.config?.web_token ?? '';
    return tokenMatches(expected, req.headers['x-quiver-token']);
  }

  async handle(req, res) {
    applyCommonHeaders(res);
    const host = String(req.headers.host ?? '');
    if (!this.hostAllowed(host)) {
      sendJson(res, 403, {
        ok: false,
        error: this.lan
          ? '仅允许通过本机回环或本机局域网地址访问'
          : '仅允许通过 127.0.0.1 或 localhost 访问',
        code: 'BAD_HOST',
      });
      return;
    }
    if (!this.applyCors(req, res)) {
      sendJson(res, 403, { ok: false, error: '来源不在本地白名单内', code: 'BAD_ORIGIN' });
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${HOST}:${this.port}`);
    if (url.pathname.startsWith('/api/')) {
      await this.handleApi(req, res, url);
      return;
    }
    await this.handleStatic(req, res, url);
  }

  async handleApi(req, res, url) {
    if (!this.authorized(req)) {
      sendJson(res, 401, {
        ok: false,
        error: '需要访问 Token：请在桌面端「设置 → 本地 Web 服务」中查看，然后重新解锁',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      await this.handleEvents(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        app: 'Quiver',
        version: this.engine?.app?.getVersion?.() ?? '0.1.0',
        running: this.status.running,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/rpc') {
      let request;
      try {
        const raw = await readBody(req);
        request = JSON.parse(raw || '{}');
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          error: error?.code === 'BODY_TOO_LARGE' ? error.message : '请求体不是合法的 JSON',
          code: 'BAD_REQUEST',
        });
        return;
      }
      const action = String(request?.action ?? '');
      if (action === 'snapshot') {
        try {
          sendJson(res, 200, { ok: true, snapshot: stripToken(await this.engine.snapshot()) });
        } catch (error) {
          sendJson(res, 500, failure(error));
        }
        return;
      }
      if (action === 'refresh') {
        try {
          const result = await this.engine.runWithSource('web', () => this.engine.refresh());
          sendJson(res, 200, sanitizePayload(result));
        } catch (error) {
          sendJson(res, 500, failure(error));
        }
        return;
      }
      if (WEB_BLOCKED_ACTIONS.has(action)) {
        sendJson(res, 403, {
          ok: false,
          error: '该操作只能在桌面端执行',
          code: 'DESKTOP_ONLY',
        });
        return;
      }
      const handler = this.handlers[action];
      if (!handler) {
        sendJson(res, 404, { ok: false, error: `未知的操作：${action}`, code: 'NO_ACTION' });
        return;
      }
      try {
        const result = await this.engine.runWithSource('web', () => handler(request?.payload));
        sendJson(res, 200, sanitizePayload(result));
      } catch (error) {
        sendJson(res, 500, failure(error));
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: '未知的 API 路径', code: 'NOT_FOUND' });
  }

  async handleEvents(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    this.clients.add(res);
    req.on('close', () => {
      this.clients.delete(res);
    });
    try {
      const snapshot = await this.engine.snapshot();
      res.write(
        `data: ${JSON.stringify({ type: 'snapshot', snapshot: stripToken(snapshot) })}\n\n`,
      );
    } catch {
      /* the client will retry */
    }
  }

  async handleStatic(req, res, url) {
    // 开发模式下本地浏览器继续用 Vite；局域网设备改回构建产物，避免跳到设备自己的 127.0.0.1
    if (DEV_SERVER_URL && isLoopbackHost(req.headers.host)) {
      const target = `${DEV_SERVER_URL.replace(/\/$/, '')}${url.pathname}${url.search}`;
      res.writeHead(302, { Location: target, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    const distRoot = path.resolve(DIST_ROOT);
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      sendJson(res, 400, { ok: false, error: '非法路径', code: 'BAD_PATH' });
      return;
    }
    let target = path.resolve(distRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (target !== distRoot && !target.startsWith(distRoot + path.sep)) {
      sendJson(res, 403, { ok: false, error: '路径越界', code: 'PATH_ESCAPE' });
      return;
    }
    let body = await fsp.readFile(target).catch(() => null);
    if (!body) {
      if (path.extname(pathname)) {
        sendJson(res, 404, { ok: false, error: '文件不存在', code: 'NOT_FOUND' });
        return;
      }
      target = path.join(distRoot, 'index.html');
      body = await fsp.readFile(target).catch(() => null);
    }
    if (!body) {
      sendJson(res, 404, {
        ok: false,
        error: '尚未找到前端构建产物，请先执行 npm run build，或通过桌面端使用',
        code: 'NO_DIST',
      });
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': path.extname(target) === '.html' ? 'no-store' : 'public, max-age=3600',
      'Content-Length': body.length,
    });
    res.end(body);
  }
}

module.exports = {
  HOST,
  LAN_HOST,
  WebServer,
  localIPv4Addresses,
  localIPv4Entries,
  sanitizePayload,
  stripToken,
};
