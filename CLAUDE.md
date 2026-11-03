# Quiver

本地优先的 AI Skill 管理器：中央库只读，技能通过链接或副本分发到 Harness 的扫描目录。内置 25 个工具字典（Claude Code、Codex、Cursor、Windsurf、Cline、Antigravity、Qoder、Trae、通义灵码等），也支持自定义工具；每个工具可配置多条有序候选路径，并通过 `~/.agents/skills` 跨工具共享层一次启用。

当前已完成 **Phase 1–4**。渲染层不再持有 Mock 数据：主进程内的 `electron/engine` 负责 SQLite 元数据、内容寻址 Store、挂载/解链、对账与文件监听；渲染层只通过 IPC 读取快照并触发显式动作。Phase 4 补齐了 Windows 桌面发布链路：应用图标、electron-builder（NSIS + Portable）、开源 README/LICENSE 与仓库清理。

在此之上完成了 **UI 可读性升级**：明暗双主题、100/110/120% 界面缩放、更大的字号层级，以及「操作日志」查看器（筛选、中文搜索、JSON/CSV 导出）。

Phase 3 收尾能力也已落地：内嵌本地 Web 服务（Loopback + Token + SSE）、`depends_on` 依赖与禁用前警告、孤儿项目 30s 巡检与自动复活、跨平台权限受阻引导，以及备份包在设置中的导入入口与完整往返。

Phase 3.5 补齐了 Web 端三档响应式（桌面三栏 / 平板 64px 图标栏 / 手机底部四 Tab + 全屏推入详情）与默认关闭的局域网访问开关（`web_lan`）；开启后 HTTP 监听 `0.0.0.0`，但所有请求仍强制 `X-Quiver-Token`。

最新一轮把 Harness 模型升级为**有序候选路径链**：内置 25 项工具字典、自定义工具与路径链编辑器、跨工具共享层（`~/.agents/skills`）、多目录遮蔽提示、共享层拆分 / 彻底移除裁决、Harness 分类筛选与未检出工具收缩；同时新增技能收藏、别名胶囊与备注摘要，并修复「已修改」黄点误报。桌面端补充**可选的系统托盘驻留**（`tray_on_close`，默认关闭），关闭窗口时可隐藏到托盘并保持 Web 服务在线。引擎测试扩展到 20 项，覆盖构建、候选链、自定义 Harness、共享解绑、Windows 路径、收藏迁移、简介解析、预览、批量收编、副本转换原子性、缺失目标恢复、托盘开关配置往返与旧版名称/标签迁移。

## 技术栈

- **Electron 41**（主进程 CommonJS）+ **Vite 8** + **React 19** + **TypeScript 7**
- **持久化**：`node:sqlite` 的 `DatabaseSync`（Electron 41 内置 Node 24 直接可用），**不引入需要 C++/Rust 本地编译的原生模块**
- **哈希**：`node:crypto` SHA-256（目录树哈希 + 文件哈希缓存）
- **文件监听**：`chokidar` v4，防抖 2200ms 后广播 `engine:changed`；另有 30s 项目巡检兜底
- **本地 Web 服务**：原生 `node:http`（默认 `127.0.0.1`，可显式开启局域网监听）+ `X-Quiver-Token` 鉴权 + SSE `/api/events`
- **Tailwind CSS v4**（CSS-first `@theme`，无 `tailwind.config`）
- **motion** 弹簧动效、`layoutId` 滑块；**cmdk** 命令面板；**sonner** toast；**lucide-react** 图标
- 字体：IBM Plex Sans Variable / JetBrains Mono Variable（Fontsource 自托管）
- **打包**：electron-builder 26（Windows NSIS 安装版 + Portable 便携版，x64），应用图标由 SVG 经 Electron 离屏渲染生成 PNG/ICO

## 常用命令

```bash
npm run dev        # Vite(127.0.0.1:5173) + Electron 窗口，一条命令直接预览
npm run dev:web    # 仅浏览器渲染层（无 window.quiver 桥接，桌面动作会提示需在 Electron 中使用）
npm run build      # tsc --noEmit + vite build
npm run typecheck  # 仅类型检查
npm run test:engine # 20 项引擎集成测试（Electron Node 24 + 临时隔离目录）
npm start          # 用已构建的 dist/ 启动 Electron
npm run icons      # 由 build/icon.svg 生成 build/icon.png 与多尺寸 build/icon.ico
npm run dist:win   # 构建 dist/ + Windows NSIS 安装版与 Portable 便携版到 release/
```

`npm run dev` 使用 `concurrently + wait-on`。Vite 显式绑定 `127.0.0.1`（`vite.config.ts`），因为 `wait-on tcp:127.0.0.1:5173` 需要 IPv4 监听。

### 环境注意

- 某些 IDE/Agent shell 会导出 `ELECTRON_RUN_AS_NODE=1`，导致 Electron 以纯 Node 运行、主进程 `app` 为 `undefined`。`scripts/start-electron.mjs` 会在启动子进程前移除该变量，**不要改回直接执行 `electron .`**。
- 本地 Node 若低于 22，`node:sqlite` 不可用；引擎脚本请通过 Electron 二进制以 Node 模式运行。
- 端口 5173 为 `strictPort`。若 dev 失败提示端口占用，先确认没有残留的 Vite/Electron 进程。

## 运行模式与工作目录

| 模式 | 工作目录 | 用途 |
| --- | --- | --- |
| 演示沙盒（需手动切换） | 开发：`<repo>/.quiver-demo/`；打包后：`<userData>/quiver-sandbox/` | 可随时删除重建，不触碰真实 Harness 目录 |
| 真实本地目录（默认） | `~/.quiver/` | 挂载写入各 Harness 的真实扫描目录 |

- 首次启动默认进入**真实本地目录** `~/.quiver/`；演示沙盒需在「设置与路径映射」中显式切换，切换前会二次确认；**已有绑定不会跨工作目录迁移**。模式指针写入 `<userData>/engine-mode.json`，缺失时回落 `real`。
- 两种模式结构一致：`metadata.db`、`config.toml`、`store/sha256/<version_sha>/`、`available/<slug>@<sha7>/`、`staging/`。
- 删除 `.quiver-demo` 前必须先退出应用（释放 SQLite 与 chokidar），否则可能残留句柄。

## 架构

```
build/
  icon.svg            Quiver 图标矢量源文件（Q 环 + 箭头 + 跳线插头）
  icon.png            1024×1024，窗口图标 / extraResources
  icon.ico            16/24/32/48/64/128/256 多尺寸 Windows 图标
electron-builder.yml  Windows NSIS + Portable 打包配置（asar、文件规则、图标、输出 release/）
electron/
  main.cjs            窗口与托盘生命周期、关闭策略、IPC 白名单、外部程序/终端/编辑器、剪贴板、窗口图标
  preload.cjs         contextBridge 暴露 window.quiver（唯一桌面能力入口）
  engine/
    index.cjs         引擎入口：快照、动作、对账调度、审计、监听广播
    db.cjs            SQLite schema 与 DatabaseSync 封装（WAL）
    config.cjs        config.toml 读写、候选路径链与自定义工具迁移、Web / 托盘设置持久化
    harnesses.cjs     25 项内置工具字典、分类与默认候选路径
    store.cjs         内容寻址入库、只读固化、available 别名
    hash.cjs          目录树哈希（忽略 .git/.DS_Store/Thumbs.db/desktop.ini）与文件缓存
    mount.cjs         Junction/symlink 挂载、copy 降级、安全解链
    reconcile.cjs     状态机：已启用/已修改/未找到/路径失效/发现外部技能
    seed.cjs          演示沙盒种子数据
    server.cjs        本地 Web 服务：Token 鉴权、RPC、SSE、静态/Dev 转发
    util.cjs          原子替换、权限恢复、结构化权限错误、路径工具
scripts/
  start-electron.mjs  清理 ELECTRON_RUN_AS_NODE 后拉起 Electron
  run-engine-tests.mjs 用 Electron Node 运行引擎集成测试
  build-icons.mjs     清理环境变量后启动 Electron 图标渲染
  render-icons.cjs    离屏渲染 SVG，写出 icon.png 并封装多尺寸 ICO
tests/
  engine-full.test.mjs 20 项隔离集成测试（哈希/只读库/解链/漂移三裁决/依赖与复活/备份/Web Token 与端口/简介与预览/批量收编/25 项候选链/自定义 Harness/共享解绑/Windows 路径/收藏迁移/副本转换原子性/缺失目标恢复/托盘开关配置往返/旧版名称与标签迁移）
README.md              开源说明：定位、架构、三视图、安全机制、Web 多端、开发与打包
LICENSE                MIT
src/
  App.tsx             快照加载、IPC 动作分发、视图/快捷键/弹层装配、移动端下钻状态
  lib/types.ts        AppData / Skill / Binding / Project / Harness / Settings
  lib/desktop.ts      window.quiver 类型与渲染层封装
  lib/actions.ts      QuiverActions 契约
  lib/responsive.ts   三档断点（mobile / tablet / desktop），跟随界面缩放重新判定
  components/         技能库、Harness、项目、拓扑、对话框、设置、移动端 Tab/状态面板
  index.css           设计令牌、全局层、动画 keyframes、安全区与滚动条工具
```

### 单一事实来源

- 唯一数据源是 `engine.snapshot()`：`{ skills, bindings, projects, unmanaged, harnesses, settings, notices, permission }`（`settings.web.token` 恒为空）。
- 每个动作（启用、禁用、更新、重置、收编、忽略、切换版本、导入、导出、设置保存…）都返回 `{ ok, message, description, warning?, snapshot }`；`App` 的 `applyResult` 统一 toast 并替换快照。
- 订阅 `engine.onChange`：chokidar 防抖对账后主进程广播，渲染层重新取快照。
- 渲染层不要在组件里复制业务状态；派生列表用 selector（`useMemo`）计算。

### 进程与安全边界

- `contextIsolation: true`、`nodeIntegration: false`，渲染层只能通过 preload 的 `window.quiver` 访问桌面能力。
- 主进程维护动作白名单；新增 IPC 时必须同步 `electron/main.cjs`、`electron/preload.cjs`、`src/lib/desktop.ts` 三处。
- 引擎通过 `resolveRequestPath` 做路径白名单：工作目录、真实模式下的用户主目录、已登记项目路径；越界直接拒绝。
- **中央库只读**：入库先计算目录树哈希，复制到 `store/sha256/<sha>`，目录 `0555`、文件 `0444`；`available/<slug>@<sha7>` 提供可读别名。
- **安全解链铁律**：禁用前先 `lstat`；若目标是 symlink/junction，只 `unlink` 入口，**绝不递归删除 Store 源目录**。
- 导入本地目录 / Git（`git clone --depth 1`）/ 备份包时拒绝任何软链接或硬链接；备份 JSON 校验 `schema_version`。
- 不读取、不改写任何 Harness 内部配置；不做自动双向同步或三方合并；元数据不写入 `SKILL.md`；`.quiver/manifest.json` 仅在用户点击导出时创建。
- 破坏性操作（删除技能、清理失效项目、切换运行模式、重置漂移）必须在 UI 二次确认。

### 本地 Web 服务

- 主进程用原生 `node:http` 启动服务，**默认只绑定 `127.0.0.1`**，默认端口 `4310`（`config.toml` 的 `web_enabled` / `web_port` / `web_token`）。端口被占用时服务保持未运行、返回中文提示，桌面端不受影响；设置页提供「自动分配空闲端口并启动」，经 `autoAllocateWebPort` 探测可用端口、回写 `config.toml` 并立即重启服务。该动作与 `configureWeb` / `setMode` 一样仅限桌面端。
- 局域网访问默认关闭。设置中的「允许局域网设备访问（手机/平板真机）」显式开启后写入 `web_lan`，HTTP 监听改为 `0.0.0.0`，并在设置页列出当前网卡 IPv4 地址（物理网卡优先，VMware/WSL 等虚拟网卡排后）；每个地址都可生成二维码与免输直连链接。开关**即时生效**：切换时直接调用 `configureWeb`，成功后自动展开第一个地址的二维码并滚动到可见位置，无需关闭/重开设置，失败则回退开关；底部「保存设置」与 Web 区的「保存并应用」仍会提交完整 Web 草稿。二维码与直连链接把 Token 放在 URL fragment（`#token=…`）而不是查询参数；`consumeWebTokenFromUrl()` 兼容读取旧式 `?token=`，读取后立即 `history.replaceState` 清除查询与 fragment 中的 Token，再继续渲染与请求。二维码等同于凭据，必须在桌面端显式点击才显示。二维码面板提供「下载 PNG」（Canvas 生成，经 `shell:save-qr` 原生保存对话框落盘）与「放大预览」，方便分享或自行截图。
- Token 为 24 字节随机值的 hex（48 字符），启动时缺失则自动生成；设置中可显示、复制、重新生成。重新生成会让已解锁的浏览器会话立即失效。
- 所有 `/api/*` 请求必须携带 `X-Quiver-Token`，使用 `timingSafeEqual` 校验；不使用 Cookie；Host 与 CORS 白名单只放行 `127.0.0.1` / `localhost`，开启局域网后额外放行本机网卡 IPv4；请求体上限 2MB。
- `configureWeb` / `setMode` 不允许通过 Web RPC 执行（返回 `DESKTOP_ONLY`），Web 端设置页对这两块只读。
- 路由：`POST /api/rpc`（动作白名单，与 IPC 同一套 handler）、`GET /api/events`（SSE 推送快照）、`GET /api/health`、静态 `dist/` 或开发期转发 Vite。开发模式下仅回环 Host 转发 Vite；局域网 Host 改为直接托管最近一次 `npm run build` 的 `dist/`，否则真机会被重定向到自己的 `127.0.0.1:5173`。快照与 SSE 中 `settings.web.token` 一律置空，避免 Token 回传。
- 浏览器端：首次访问显示中文 Token 解锁层（`WebUnlock`），Token 只存 `sessionStorage`；带 `#token=` 的二维码地址会自动写入会话并解锁，随后清除 fragment。解锁后 `engine()` 走 `webEngine`（`fetch` + SSE），审计来源记为 `web`。桌面端走 IPC，来源记为 `desktop`（`AsyncLocalStorage` 标注）。
- Vite 开发代理的端口取 `QUIVER_WEB_PORT`（默认 4310），与引擎配置保持一致；生产由同一服务托管 `dist/`。

### 系统托盘与关闭策略

- `config.toml` 的 `tray_on_close` 是唯一事实来源，**默认 `false`**：点击窗口 `×` 直接 `app.quit()`，不驻留。只有用户在设置页显式开启「关闭主窗口时最小化到系统托盘（保持 Web 服务在线）」后，主进程才在 `close` 事件里 `preventDefault()` 并 `hide()`，引擎、chokidar 与本地 Web 服务保持运行。
- 设置开关直接调用专用 IPC `window:set-tray-on-close` 并立即写盘，不等待「保存设置」；成功、失败都通过返回快照回填 `settings.trayOnClose`，失败时回退开关。该设置只允许桌面端修改，不进入 Web RPC。
- 托盘图标复用 `windowIcon()`（开发读 `build/icon.png`，打包读 `resources/icon.png`），Windows 缩放为 16px。单击恢复并聚焦主窗口；右键菜单为「显示主窗口」「在浏览器打开 Web 端」（仅在 Web 服务运行时可用）与「彻底退出 Quiver」。
- `before-quit` 必须先置 `forceQuit = true` 再走引擎关闭，避免托盘 `close` 拦截真正的退出。若托盘图标创建失败，`window:set-tray-on-close` 回滚为关闭并中文报错，绝不出现“窗口已隐藏但无法恢复”。
- `setMode` 切换工作目录会切换分模式配置，`engine:action` 处理后必须调用 `syncTrayFromConfig()`；启动时同样在 `engine.init()` 完成后同步一次。

### 依赖、权限与项目复活

- `skills.depends_on` 存 JSON slug 数组；导入时可从 `quiver.json` / `SKILL.md` frontmatter 读取，也可在「编辑信息」中选择或移除依赖。
- 禁用入口前先调用 `checkDisableImpact(bindingId)`：在同作用域（含项目继承全局）查找已启用/已修改的依赖方，命中时弹「仍要禁用」确认，只有确认后才执行 `disable()`；取消不改变任何绑定。
- 项目目录缺失会把项目标为 `missing`，其绑定显示为 `orphaned`。30s 巡检（`fs.existsSync`）与 chokidar 对账 **都会**调用 `handleProjectRevival`：路径恢复后按 `resolved_sha` + `sync_mode` 重挂缺失入口、把项目重新纳入监听、写入复活提示与审计。
- 权限错误在 `util.cjs` 中统一捕获 `EACCES` / `EPERM` / `EROFS`，转为 `{ code, path, syscall, platform, message, key }`；失败动作与快照 `permission` 都会驱动 `PermissionDialog`。macOS 提供「完全磁盘访问权限」引导与系统设置深链；链接挂载被拒时提供「一键降级为本地副本模式」。
- 备份包导出包含技能元数据、`depends_on`、全部只读版本与全局绑定；导入入口在「设置 → 数据与备份」，导入时校验 `schema_version`（高于当前版本时拒绝并提示升级 Quiver）、拒绝链接与越界路径，按 slug 合并版本、保留依赖声明，并按当前 Harness 路径重建全局 `link` / `copy` 绑定（目标已存在时跳过，不覆盖）。

### 数据与领域不变量

- 核心表：`skills`、`skill_versions`、`bindings`、`file_hash_cache`、`audit_logs`；另有 `projects`、`ignored_unmanaged`、`app_meta` 辅助表。
- 绑定状态：`enabled | drifted | missing | orphaned`；`unmanaged` 单独列出，不进入绑定集合。
- 作用域 `global | project`；同步方式 `link | copy`；`orphaned` 表示项目目录缺失，不参与统计与拓扑。
- `project.harnesses` 是「项目级绑定 ∪ 全局绑定」的工具并集，项目视图必须展示全部已绑定工具（例如仅有全局 Cursor 入口时也要出现 Cursor）。
- 漂移只做标记；重置（丢弃本地修改）、收编（写回只读库作为新版本）、忽略（`ignoredDrift`）三种裁决都由用户点击触发。
- `switchVersion` 只切换技能的激活版本；`updateBinding` 才把绑定推进到新版本。
- Windows 使用 `fs.symlink(target, path, 'junction')`；macOS/Linux 使用目录 symlink；失败时降级为 `fs.cp` 副本。

#### 转为本地副本与缺失目标恢复

- `convertToCopy(bindingId)` 只处理 `link` 绑定：目标不存在或是链接时才允许转换；若目标已被真实目录占用，直接返回 `TARGET_EXISTS` 中文错误，**绝不删除或覆盖**该目录。转换先从 Store 的 `resolved_sha` 复制到 `staging/<uuid>/`，再原子移动到目标路径（`moveEntry` 在跨卷 `EXDEV` 时回退为复制），随后把 `sync_mode` 改为 `copy`、状态置为 `enabled` 并清空漂移字段，审计 `convert_copy`。
- `resetBinding` / `redeployBinding` 负责「未找到」与手动重新部署：按 `resolved_sha`（缺失时回落 `active_sha`）重新挂载；`link` 模式遇到真实目录同样拒绝覆盖并提示先处理，`copy` 模式只删除目标副本后重建；中央库 `store/` 与 `available/` 永远不受影响。
- 转换与恢复都必须经过 `assertAllowedTarget` 路径白名单；跨卷或 Windows 暂时占用由 `moveEntry` 的 `EXDEV` 复制回退与 `EPERM` / `EBUSY` 重试兜底。

### Harness 候选路径链与跨工具共享层

- `electron/engine/harnesses.cjs` 定义 25 项内置工具：共享层 1（`agents-common`）、国内主流 11（Qoder / Qoder CN / WorkBuddy / DeepSeek Harness / Trae / Trae CN / Comate / CodeGeeX / iFlyCode / JoyCoder / FittenCode）、国际主力 13（Antigravity / Claude Code / Codex / Cursor / OpenCode / Cline / Roo Code / Kilo Code / Gemini CLI / Windsurf / GitHub Copilot / Kiro / Goose）。
- 每个 Harness 用有序 `candidates[]` 描述扫描目录，兼容旧 `global_path` / `project_rel_path`；打开工作目录时自动迁移为候选数组并写回 `config.toml`（序列化为 JSON 字符串）。
- 候选字段：`{ id, path, scope: 'global'|'project', role: 'primary'|'shared'|'compat'|'synced'|'custom', discovery: 'exact'|'parent-chain'|'nested-monorepo', priority, label? }`。`priority` 由数组下标生成（0 起），↑/↓ 只调整顺序。
- 发现规则：`exact` 原样解析 `~` / 环境变量；`parent-chain` 从项目目录向上查找到 git 根（最多 4 层）；`nested-monorepo` 向下最多 3 层，跳过 `node_modules`、`.git`、`dist`、`build`、`target`、`.next`、`out`、`.quiver*`。
- 首选入口由 `preferredCandidateFor()` 只按 priority 决定，不再叠加「目录是否存在」偏好；保存配置后若首选候选变化，引擎会把受影响绑定重挂到新路径。
- `detected` 必须是非 shared 候选存在 ∪ 有绑定：共享层候选几乎总是存在，不能用来判定工具活跃，否则 25 个内置工具会全部显示为「本机活跃」。
- 同一 slug 在多条候选下重复出现时按候选 priority 遮蔽：最高者标「当前生效」，其余标「被高优先级同名目录覆盖」；共享层条目标「跨工具共享 · 共 N 个活跃工具可见」。
- 共享 / 兼容 / 同步候选上的禁用必须显式二选一：`mode = 'split'` 只在当前 Harness 停用（智能拆分，保留其他读者）或 `mode = 'all'` 从共享目录彻底移除（所有共用工具同步停用）。普通候选保持既有安全解链路径。
- 自定义工具：设置字典与 Harness 工具栏均可新增，ID 自动转英文连字符，默认勾选自动共享（`~/.agents/skills` + `.agents/skills`）；可编辑候选链、恢复默认路径链、删除工具。删除内置工具仅在无活跃绑定时允许；被引用中的候选删除会被拒绝并给出中文原因。

#### 完整候选路径矩阵

`P` 为 `priority`（越小越优先）；`role` 取 `primary / shared / compat / synced / custom`，`discovery` 为 `exact / parent-chain / nested-monorepo`（表中仅标注非 exact）。该矩阵与 `electron/engine/harnesses.cjs` 的 `BUILTINS` 逐项一致，共 25 个工具、126 条候选。

| Harness ID | 显示名称 | 分类 | 全局候选（按优先级） | 项目候选（按优先级） |
| --- | --- | --- | --- | --- |
| `agents-common` | Agents 跨工具共享 | shared | P0 · primary · `~/.agents/skills` · 跨工具共享层 | P1 · primary · `.agents/skills` · 跨工具共享层 |
| `qoder` | Qoder | domestic | P0 · primary · `~/.qoder/skills`<br>P1 · primary · `~/.qoderwork/skills` · QoderWork 变体<br>P2 · shared · `~/.agents/skills` · 跨工具共享层 | P3 · primary · `.qoder/skills`<br>P4 · compat · `.qoderwork/skills`<br>P5 · shared · `.agents/skills` · 跨工具共享层 |
| `qoder-cn` | Qoder CN | domestic | P0 · primary · `~/.qoder-cn/skills`<br>P1 · primary · `~/.lingma/skills` · Lingma 变体<br>P2 · compat · `~/.tonyi/skills`<br>P3 · shared · `~/.agents/skills` · 跨工具共享层 | P4 · primary · `.qoder-cn/skills`<br>P5 · primary · `.lingma/skills` · Lingma 变体<br>P6 · shared · `.agents/skills` · 跨工具共享层 |
| `workbuddy` | WorkBuddy | domestic | P0 · primary · `~/.workbuddy/skills`<br>P1 · primary · `~/.workbuddy/connectors/skills` · Connectors 目录<br>P2 · compat · `~/.codebuddy/skills`<br>P3 · shared · `~/.agents/skills` · 跨工具共享层 | P4 · primary · `.codebuddy/skills`<br>P5 · compat · `.workbuddy/skills`<br>P6 · shared · `.agents/skills` · 跨工具共享层 |
| `deepseek-harness` | DeepSeek Harness | domestic | P0 · primary · `~/.dsh/skills`<br>P1 · compat · `~/.deepseek/skills`<br>P2 · shared · `~/.agents/skills` · 跨工具共享层 | P3 · primary · `.dsh/skills`<br>P4 · compat · `.deepseek/skills`<br>P5 · shared · `.agents/skills` · 跨工具共享层 |
| `trae` | Trae | domestic | P0 · primary · `~/.trae/skills`<br>P1 · shared · `~/.agents/skills` · 跨工具共享层 | P2 · primary · `.trae/skills`<br>P3 · shared · `.agents/skills` · 跨工具共享层 |
| `trae-cn` | Trae CN | domestic | P0 · primary · `~/.trae-cn/skills`<br>P1 · compat · `~/.trae/skills`<br>P2 · compat · `~/.mars/skills`<br>P3 · shared · `~/.agents/skills` · 跨工具共享层 | P4 · primary · `.trae-cn/skills`<br>P5 · compat · `.trae/skills`<br>P6 · shared · `.agents/skills` · 跨工具共享层 |
| `comate` | Comate | domestic | P0 · primary · `~/.comate/skills`<br>P1 · compat · `~/.zulu/skills`<br>P2 · shared · `~/.agents/skills` · 跨工具共享层 | P3 · primary · `.comate/skills`<br>P4 · compat · `.zulu/skills`<br>P5 · shared · `.agents/skills` · 跨工具共享层 |
| `codegeex` | CodeGeeX | domestic | P0 · primary · `~/.codegeex/skills`<br>P1 · shared · `~/.agents/skills` · 跨工具共享层 | P2 · primary · `.codegeex/skills`<br>P3 · shared · `.agents/skills` · 跨工具共享层 |
| `iflycode` | 讯飞星火 Code | domestic | P0 · primary · `~/.iflycode/skills`<br>P1 · shared · `~/.agents/skills` · 跨工具共享层 | P2 · primary · `.iflycode/skills`<br>P3 · shared · `.agents/skills` · 跨工具共享层 |
| `joycoder` | JoyCoder | domestic | P0 · primary · `~/.joycoder/skills`<br>P1 · shared · `~/.agents/skills` · 跨工具共享层 | P2 · primary · `.joycoder/skills`<br>P3 · shared · `.agents/skills` · 跨工具共享层 |
| `fittencode` | Fitten Code | domestic | P0 · primary · `~/.fittencode/skills`<br>P1 · shared · `~/.agents/skills` · 跨工具共享层 | P2 · primary · `.fittencode/skills`<br>P3 · shared · `.agents/skills` · 跨工具共享层 |
| `antigravity` | Antigravity IDE | global | P0 · primary · `~/.gemini/antigravity/skills`<br>P1 · compat · `~/.gemini/config/skills`<br>P2 · shared · `~/.agents/skills` · 跨工具共享层 | P3 · primary · `.agents/skills` · 跨工具共享层<br>P4 · compat · `.agent/skills` |
| `claude-code` | Claude Code | global | P0 · primary · `~/.claude/skills`<br>P1 · synced · `~/.claude/skills/synced` · 云端同步目录<br>P2 · shared · `~/.agents/skills` · 跨工具共享层 | P3 · primary · `.claude/skills` · 父级链<br>P4 · shared · `.agents/skills` · 跨工具共享层 |
| `codex` | OpenAI Codex | global | P0 · primary · `$CODEX_HOME/skills` · 原生主目录<br>P1 · primary · `~/.codex/skills`<br>P2 · shared · `~/.agents/skills` · 跨工具共享层 | P3 · primary · `.codex/skills` · 父级链<br>P4 · shared · `.agents/skills` · 跨工具共享层 |
| `cursor` | Cursor | global | P0 · primary · `~/.cursor/skills`<br>P1 · shared · `~/.agents/skills` · 跨工具共享层 | P2 · primary · `.cursor/skills` · 子包<br>P3 · shared · `.agents/skills` · 子包 · 跨工具共享层 |
| `opencode` | OpenCode | global | P0 · primary · `~/.config/opencode/skills`<br>P1 · compat · `~/.opencode/skills`<br>P2 · compat · `~/.claude/skills`<br>P3 · shared · `~/.agents/skills` · 跨工具共享层 | P4 · primary · `.opencode/skills`<br>P5 · compat · `.claude/skills`<br>P6 · shared · `.agents/skills` · 跨工具共享层 |
| `cline` | Cline | global | P0 · primary · `~/.cline/skills`<br>P1 · compat · `~/.cline/rules`<br>P2 · shared · `~/.agents/skills` · 跨工具共享层 | P3 · primary · `.clinerules/skills` · 子包<br>P4 · compat · `.cline/skills`<br>P5 · shared · `.agents/skills` · 跨工具共享层 |
| `roo-code` | Roo Code | global | P0 · primary · `~/.roo/skills`<br>P1 · shared · `~/.agents/skills` · 跨工具共享层 | P2 · primary · `.roo/skills` · 子包<br>P3 · shared · `.agents/skills` · 跨工具共享层 |
| `kilo-code` | Kilo Code | global | P0 · primary · `~/.kilo/skills`<br>P1 · compat · `~/.kilocode/skills`<br>P2 · compat · `~/.claude/skills`<br>P3 · shared · `~/.agents/skills` · 跨工具共享层 | P4 · primary · `.kilo/skills`<br>P5 · compat · `.kilocode/skills`<br>P6 · compat · `.claude/skills`<br>P7 · shared · `.agents/skills` · 跨工具共享层 |
| `gemini-cli` | Gemini CLI | global | P0 · primary · `~/.gemini/skills`<br>P1 · compat · `~/.gemini/config/skills`<br>P2 · shared · `~/.agents/skills` · 跨工具共享层 | P3 · primary · `.gemini/skills`<br>P4 · shared · `.agents/skills` · 跨工具共享层 |
| `windsurf` | Windsurf | global | P0 · primary · `~/.codeium/windsurf/skills`<br>P1 · shared · `~/.agents/skills` · 跨工具共享层 | P2 · primary · `.windsurf/skills`<br>P3 · shared · `.agents/skills` · 跨工具共享层 |
| `github-copilot` | GitHub Copilot | global | P0 · primary · `~/.copilot/skills`<br>P1 · shared · `~/.agents/skills` · 跨工具共享层 | P2 · primary · `.github/skills`<br>P3 · shared · `.agents/skills` · 跨工具共享层 |
| `kiro` | Kiro | global | P0 · primary · `~/.kiro/skills`<br>P1 · shared · `~/.agents/skills` · 跨工具共享层 | P2 · primary · `.kiro/skills`<br>P3 · shared · `.agents/skills` · 跨工具共享层 |
| `goose` | Goose | global | P0 · primary · `~/.config/goose/skills`<br>P1 · shared · `~/.agents/skills` · 跨工具共享层 | P2 · primary · `.goose/skills`<br>P3 · shared · `.agents/skills` · 跨工具共享层 |

#### 自定义 Harness 配置指南

1. **新增自定义工具**：设置 → Harness 字典 → 「新增自定义工具」，填写显示名称、命令与分类；`id` 自动转为英文连字符，`is_builtin = false`，至少保留一条全局候选。默认勾选自动共享时追加 `~/.agents/skills` 与 `.agents/skills` 两条候选。
2. **追加自定义扫描目录**：在工具详情中选择作用域（global / project）、角色（默认 `custom`）、发现方式（`exact` / `parent-chain` / `nested-monorepo`）与标签；全局路径必须是绝对路径、`~` 路径或 `$ENV` 路径，项目路径必须是安全工作区相对路径，拒绝 `..` 越界。新候选追加到数组末尾，`priority` 为最后一位。
3. **调整优先级与设首选**：编辑器中的 ↑ / ↓ 只改变数组顺序，保存时引擎按数组下标重写 `priority`（0 起）；`P0` 是新绑定与启用对话框的默认候选。已有绑定通过 `binding.candidate_id` 锚定到具体候选，单纯重排不会强制改写；修改该候选的路径或恢复默认会触发引擎重挂并回报「重新部署 N 个绑定」。
4. **恢复默认路径链**：仅对内置工具显示「恢复默认路径链」，只重置该工具的候选数组并重挂受影响绑定，不删除自定义工具、不改动其他工具的配置。
5. **删除保护**：工具仍有生效绑定时禁止删除；候选路径仍被生效绑定引用时同样拒绝，并给出中文修复提示。删除内置工具会写入 `removed_harnesses`，再次保存配置或恢复默认时可重新出现。
6. **持久化校验**：`saveHarnessConfig` 保存后，`config.toml` 必须完整回读 `id / name / short_name / command / category / candidates[role, discovery, label, priority] / removed_harnesses / editor_command`；旧 `global_path` / `project_rel_path` 只作为首选候选的兼容投影。

#### 多候选展示、同名遮蔽与共享解绑

- **展示**：Harness 视图按候选顺序展示扫描目录与物理路径；绑定行显示实际命中的 `candidate_id`、角色标签与共享标记，启用对话框允许逐工具选择候选，并提供「一键启用到跨工具共享层」。
- **同名遮蔽**：同一 `slug` 在同一作用域出现多次时，按候选 `priority` 决定生效入口（更小者优先），再按 `role` 与受管状态裁决；其余条目标注「被高优先级同名目录覆盖」。共享层条目标注「跨工具共享 · 共 N 个活跃工具可见」。
- **智能拆分（`disable_split`）**：只删除当前工具在共享/兼容层上的入口，并把技能按各其他活跃读者的首选候选重新部署；没有可用候选的工具会被跳过并在结果说明中列出。
- **彻底移除（`disable_shared`）**：删除共享目录入口，同时停用所有共用工具的绑定；中央库 `store/` 与 `available/` 源内容不受影响，其他旁观技能不被改动。
- **硬约束**：共享层禁用必须由用户在两个动作中显式选择，不得默认执行其一；`detected` 只看非 shared 候选存在或存在绑定，共享层存在本身不算工具活跃。

### SKILL.md 简介、只读预览与外部技能收编

- **简介提取**：导入或刷新时优先读取 `SKILL.md` frontmatter 的 `description` / `comment`，支持单行、折叠 `>`、字面 `|`、引号与 BOM；缺失时取正文首段（跳过标题、空行与代码围栏并剥离 Markdown 标记）。收编外部技能在两者都缺失时使用默认占位注释。
- **启动刷新**：`openRoot()` 调用 `refreshDefaultSkillComments`，只替换默认占位或空备注，保留用户手写备注；`resyncSkillComment` 是显式重新同步入口，并写入 `resync_skill_comment` 审计。
- **只读预览**：`skillPreview(skillId, sha?)` 从 Store 读取指定版本，返回相对文件树（忽略 `.git` / `.DS_Store` / `Thumbs.db` / `desktop.ini`）与 `SKILL.md` 正文；文件过多时返回截断标记（上限 5000），缺失版本返回 `STORE_MISSING`。预览不写入、不 chmod、不改变 `available` 别名；详情面板只读展示，不允许在预览中编辑。
- **批量收编**：Harness 视图可多选外部技能（`unmanaged`）后批量执行。`adopt` 写入中央库、把原目录替换为 Store 链接并建立 `link` 绑定；`register` 保留原目录为真实目录、建立 `copy` 绑定。两者都只处理所选条目，审计动作 `adopt_unmanaged_batch`，详情为 `adopt:N/M` 或 `register:N/M`；成功后条目从外部技能列表消失。

## 打包与发布

### Windows 构建

```bash
npm run icons     # 可选：源码改图标后重生成 build/icon.png 与 build/icon.ico
npm run dist:win  # npm run build + electron-builder --win
```

- 配置在 [`electron-builder.yml`](electron-builder.yml)：`appId: com.quiver.desktop`、`productName: Quiver`、`buildResources: build`、`output: release`、x64。
- 产物：`release/Quiver-0.1.0-setup.exe`（NSIS 安装版，非一键、可选目录、桌面/开始菜单快捷方式、安装后可选启动）、`release/Quiver-0.1.0-portable.exe`（免安装便携版）、`release/win-unpacked/`（免安装解包目录）。
- `files` 只收 `dist/**`、`electron/**`、`package.json`（排除 sourcemap）；electron-builder 会自动纳入生产 `node_modules`，devDependencies 不进入包内。
- `asar: true`。应用没有需要本地编译的原生模块：`node:sqlite` 由 Electron 41 内置 Node 24 提供，因此 `npmRebuild: false`；`asarUnpack` 预留了 `**/*.node` 与 `node_modules/**/prebuilds/**`，将来若引入原生模块无需改配置。
- `extraResources` 把 `build/icon.png` 复制到 `resources/icon.png`；`main.cjs` 的 `windowIcon()` 在打包后读 `process.resourcesPath/icon.png`，开发时读 `build/icon.png`。Windows 同时调用 `app.setAppUserModelId('com.quiver.desktop')`。
- 未配置代码签名证书，构建会跳过签名；首次运行会触发 Windows SmartScreen 提示。正式分发需提供证书（`CSC_LINK` / `CSC_KEY_PASSWORD`）或接入 Trusted Signing。

### 打包后的路径

| 内容 | 开发 | 打包后 |
| --- | --- | --- |
| 渲染层入口 | Vite dev server / `dist/index.html` | `resources/app.asar/dist/index.html`（`loadFile`） |
| Web 静态根 | `<repo>/dist` | `resources/app.asar/dist`（`server.cjs` 的 `DIST_ROOT = __dirname/../../dist`，asar 内 `fs` 读取由 Electron 透明支持） |
| 演示沙盒 | `<repo>/.quiver-demo/` | `<userData>/quiver-sandbox/`（如 `%APPDATA%/Quiver/quiver-sandbox`） |
| 真实模式 | `~/.quiver/` | `~/.quiver/`（不变） |

- 打包后 `app.getAppPath()` 指向 `app.asar`，因此沙盒必须落在 `userData`，不能写入安装目录（安装目录通常不可写）。
- 安装器 `deleteAppDataOnUninstall: false`，卸载保留 `%APPDATA%/Quiver` 与 `~/.quiver` 中的技能库数据。

### 图标流水线

- [`build/icon.svg`](build/icon.svg) 是唯一矢量源：暗色圆角底、白色 Q 环、琥珀箭头与跳线插头。
- `npm run icons` → [`scripts/build-icons.mjs`](scripts/build-icons.mjs) 清理 `ELECTRON_RUN_AS_NODE` 后启动 Electron，[`scripts/render-icons.cjs`](scripts/render-icons.cjs) 用透明离屏窗口渲染 SVG，`capturePage()` 写出 1024×1024 PNG，再由 PNG 封装 16/24/32/48/64/128/256 多尺寸 ICO。
- 图标只在源文件变化时重跑；`build/icon.png` / `build/icon.ico` 是构建资源，需提交到仓库。

### 验证打包产物

- 启动 `release/win-unpacked/Quiver.exe` 并附加 `--user-data-dir=<临时目录>`，避免污染真实 `%APPDATA%`；可在临时目录预先写入 `sandbox/config.toml` 固定 `web_port` / `web_token`，再用 HTTP 检查。
- 必查：窗口能打开；内嵌 Web 服务能从 asar 托管 `index.html` 与 JS/CSS；无 Token 401、正确 Token 200；快照能返回种子技能且 `settings.web.token` 为空；`configureWeb` 经 Web RPC 返回 `DESKTOP_ONLY`；渲染层 URL 指向 `app.asar/dist/index.html`。
- 托盘必查：默认关闭时关闭窗口进程退出；开启后关闭窗口进程仍在且 Web 端口可用，单击托盘恢复窗口，右键「彻底退出 Quiver」后端口释放、无 electron 残留。
- 便携版与安装版共用同一 `app.asar`；便携版每次运行解压到临时目录，用户数据仍写入 `userData`。

### 环境注意（仅限本机）

- Qoder 的搜索服务进程可能长期占用 `release/win-unpacked/resources/default_app.asar`，使 electron-builder 的原子重命名失败（`EPERM` / `EBUSY`）。这不是配置问题。可先用自定义 `electronDist`（如 `--config.electronDist=node_modules/electron/dist`）生成到别的输出目录，或从干净 stage 用 `--prepackaged` + `--config.directories.output=release-build` 打包；不要为此终止宿主 IDE 进程。
- 本地 Node 版本低于 22.12 时 electron-builder 会提示无法加载 `@electron/rebuild`；由于 `npmRebuild: false`，打包本身不受影响。

## UI 系统

设计令牌集中在 `src/index.css` 的 `@theme`：

- 背景层级 `void #16181d` → `sunken #121419` → `panel #1c1f26` → `raised #222630`，悬浮 `hover #292e3a`；浅色主题为 `void #f8fafc`、`panel/raised #ffffff`。
- 边框统一 `hairline rgba(255,255,255,0.14)`（悬浮 `0.25`），卡片配 `shadow-inset-top` 顶部内高光。
- 文字：标题 `fg #f8fafc`，正文/按钮 `fg-muted #cbd5e1`，辅助信息 `fg-subtle #94a3b8`；**深色模式下不得出现比 `#94a3b8` 更暗的文字色**（`fg-faint` 同样指向 `#94a3b8`）。浅色模式 `fg #0f172a`、`fg-muted #334155`、`fg-subtle #475569`。
- 强调色只用于状态：`jade`（启用）、`amber`（漂移/提醒）、`rose`（缺失/危险）、`sky`（可更新）、`violet`（外部目录）；不使用大面积彩色背景。
- 哈希、路径、命令一律等宽字体 + 半透明胶囊（`.mono-pill`、`PathPill`、`VersionPill`）。
- 图标只用 `lucide-react`，禁止 Emoji。
- 动效统一弹簧 `{ type: 'spring', stiffness: 400, damping: 30 }`；导航、作用域、拓扑/列表切换用 `layoutId` 滑动胶囊；列表/详情用 `AnimatePresence`；`prefers-reduced-motion` 已在全局降级。
- 快捷键：`Ctrl/Cmd+K` 命令面板，`Ctrl/Cmd+R` 刷新对账，`Esc` 关闭浮层。
- 目录路径四个快捷动作：在文件夹中显示、使用编辑器打开（默认 `code`，可在设置中改）、在终端中打开、复制路径。

### 主题与界面缩放

- 主题由 `document.documentElement.dataset.theme`（`dark` / `light`）驱动，浅色令牌在 `:root[data-theme="light"]` 覆盖；选择持久化在 `localStorage` 的 `quiver.theme`。
- 界面缩放为 100% / 110% / 120%，通过 `webFrame.setZoomFactor` 应用，持久化在 `quiver.scale`；标题栏切换主题，左侧栏底部切换缩放。
- **Electron 缩放不会触发 `ResizeObserver`、`window.resize` 或 `visualViewport.resize`**。依赖容器宽度自动布局的组件（如 `SkillDetail` 的拓扑/列表切换）必须接收 `uiScale` 并在值变化后重新测量；当前实现为 600ms 逐帧测量 + 350ms 兜底 + 观察器，避免读到缩放前的旧宽度。
- 字号下限 12.5px，禁止 `text-[10px]` / `text-[11px]`；正文与按钮 14px，列表/卡片标题 15–16px，详情标题 20–22px，等宽路径/哈希 13px。
- 技能列表固定两行（名称 + 状态、单行中文简介）；绑定卡片 `p-4`，部署时间默认弱化，行悬浮时恢复。

### 左右面板拖拽与收起

- 左侧主导航与技能列表均支持拖动边缘调宽：侧栏拖拽柄在右边缘，列表拖拽柄在列表与详情之间；两者都有 `role="separator"`、方向键 ±16px 与双击收起。
- 宽度持久化在 `localStorage` 的 `quiver.navWidth` / `quiver.listWidth`；拖动中实时更新，结束后写入。拖到阈值以下视为收起（列表 `<32px` 记为 `0`，`<160px` 吸附最小宽度），恢复时回到上次宽度而不是默认值。手动宽度只覆盖断点默认值，不改变三档布局判定。
- 列表收起后详情占满剩余宽度，可通过列表头部按钮或双击分隔条恢复；移动端不启用拖拽。

### 响应式布局与触控

- 三档布局：`lg`（≥1024px）保持左栏 + 列表 + 详情三栏；`md`（768–1023px）左栏收为 64px 图标栏；`<768px` 隐藏左栏，使用底部四大 Tab（技能库 / Harness / 项目 / 设置/状态），技能与项目为全屏列表，点击后推入全屏详情并提供「← 返回列表」。
- 断点由 `useBreakpoint(uiScale)` 判定，必须传入界面缩放并在缩放后重新测量；纯视觉变化用 Tailwind 响应式类，只有会改变导航 / 下钻状态的布局才走 JS 断点。
- 手机端详情状态提升到 `App`（`mobileSkillOpen` / `mobileProjectOpen` / `mobileStatusOpen`），切换视图时重置；桌面三栏布局不受影响。
- `<768px` 时技能详情的拓扑改为纵向流（源版本在上，目标向下堆叠），默认展示列表视图；路径/哈希单行省略，点击 `PathPill` 展开，`VersionPill` 支持点击切换变更文件卡。
- 触控目标不小于 40px；`<1024px` 路径快捷动作常显（不依赖 `group-hover`）；漂移裁决按钮在窄屏纵向堆叠。`<640px` 绑定行改为纵向堆叠（操作区在内容下方，两列网格），Harness 标签改为换行展示，不再横向裁切。底部 Tab 使用 `env(safe-area-inset-bottom)`，根容器高度为 `100dvh`。
- 外部浏览器隐藏窗口控制按钮；手机端标题栏只保留主题与搜索图标（不显示 `Ctrl K`）。
- 对话框触控：`Modal` 在 `<640px` 用任意变体统一兜底（`[&_button]` / `[&_input]` / `[&_select]` 至少 40px），`EnableDialog` 自身也改成单列网格 + 堆叠页脚 + 全宽 40px 按钮；候选路径行必须 `flex-wrap` 且路径输入 `max-sm:basis-full`，否则 390px 下路径框只剩约 140px。

### 技能收藏与元信息

- `skills.is_favorite` 通过 `db.cjs` 迁移（`ALTER TABLE … DEFAULT 0`，重复执行容错）；唯一写入口是引擎动作 `toggleFavorite`，渲染层不做本地乐观写入。
- 收藏在技能列表与详情显示星标，并置顶；`EnableDialog` 的目标技能列表同样收藏优先。筛选器为 `全部 | ★ 收藏 | 已修改 | 未分发`，全部从快照派生。
- 列表第二行展示别名胶囊与备注摘要；别名与备注只读展示，保持既有「编辑信息」动作作为唯一修改入口，不要借收藏路径写回元数据。
- 列表/详情的「已修改」黄点只在 `driftedCount > 0` 时出现，不能用「曾漂移」「存在 ignoredDrift」等近似条件。

### 操作日志

- 写入只发生在引擎动作路径（`audit_logs` 表），记录来源（桌面端/Web 端）、动作、`binding_id` / `skill_id` 与中文详情。
- 渲染层通过 `quiver.listAuditLogs()` / `quiver.exportAuditLogs()` 只读查询；日志不是快照的一部分，不要合并进业务状态。
- 查看器：左侧栏底部「操作日志」入口，支持来源筛选、220ms 防抖搜索（可按中文动作名、来源、Harness、路径匹配）、JSON/CSV 导出（UTF-8 BOM + CRLF）；`Esc` 关闭。

## 交付前检查

```bash
npm run typecheck
npm run build
npm run test:engine
```

`test:engine` 在 Electron 的 Node 24 下运行（本地 Node 20 缺少 `node:sqlite`），全程使用临时目录，结束后清理。随后在 Electron 窗口中实际确认：

1. 导入本地目录 / Git / 备份包，源文件冻结为只读版本并生成 `available` 别名。
2. 启用 `link` 与 `copy` 两种模式；禁用链接后 Store 源文件仍在。
3. 修改目标文件触发「已修改」，三种裁决都能生效；删除目标触发「未找到」，可重新恢复。
4. 项目目录失效时出现「路径失效」与孤儿绑定，可重新定位或清理。
5. manifest 导出/恢复、备份导出/导入（含设置中的导入入口与依赖声明往返）、设置中的 Harness 路径与编辑器命令保存。
6. 沙盒/真实模式切换的二次确认与提示；路径四个快捷动作。
7. 明暗双主题下文字与边框对比正常；100/110/120% 缩放下技能详情在窄容器自动切到列表视图（可手动切回拓扑），项目统计条与绑定卡片不溢出、不折行。
8. 「操作日志」可打开、按来源筛选、按中文动作/路径搜索、导出 JSON 与 CSV，`Esc` 关闭。
9. 设置中开启本地 Web 服务：无 Token 返回 401、正确 Token 可解锁、SSE 能收到快照、审计来源为「Web 端」；重新生成 Token 后旧会话失效。
10. 依赖警告：禁用被依赖技能时出现中文确认，取消不改状态，确认后才禁用。
11. 项目目录临时移走后显示「路径失效」，恢复后自动重挂并出现「检测到项目 … 路径已恢复」提示。
12. 权限受阻时弹窗展示被拒路径与修复方式；链接被拒可一键降级副本后重试成功。
13. 390px / 360px 宽度下无横向滚动：左栏隐藏、底部 Tab 常驻、列表 → 详情 → 返回完整可用；900px 宽度显示 64px 图标栏。触控目标 ≥40px，路径快捷动作无需悬浮即可见。
14. 设置中开启局域网后监听 `0.0.0.0` 并列出网卡 IPv4；开关切换即时生效，列表与第一个地址的二维码无需关闭设置即可出现；无 Token 的局域网请求 401，错误 Host / Origin 403；关闭后仅 `127.0.0.1` 可访问。Web 端不能修改 Web 配置与运行模式。展开任一地址的二维码后扫码可自动解锁，地址栏 fragment 随即被清除；重新生成 Token 后旧二维码失效。二维码可下载为 PNG（与内联 SVG 编码一致）并在放大预览中查看，`Esc` 只关闭预览层。
15. 控制台无运行时错误。
16. `npm run dist:win` 生成 `Quiver-0.1.0-setup.exe` 与 `Quiver-0.1.0-portable.exe`；安装版可自选目录、生成快捷方式、卸载保留用户数据；便携版可直接运行。
17. 打包产物用临时 `--user-data-dir` 启动：窗口显示图标与页面，内嵌 Web 服务可从 `app.asar/dist` 托管 HTML/JS/CSS，Token 鉴权、快照脱敏与 `DESKTOP_ONLY` 行为与开发模式一致。
18. Harness 候选路径链：25 项内置字典可按「本机活跃 / 全部 / 国内主流 / 国际主力 / 自定义」筛选，计数分别为 8 / 25 / 11 / 13 / 0；「本机活跃」只列活跃工具，未检出工具通过「展开其余 N 个」切到「全部」；分类为 0 或搜索无结果时显示空状态与「查看全部」；标签条左右箭头与滚轮可横向滚动，选中靠右标签自动滚入视野；`~/.agents/skills` 共享层不把全部工具误判为活跃；同一 slug 多目录时高优先级生效、低优先级标记被覆盖。
19. 自定义工具：新增后自动生成英文 ID 与共享候选，可编辑路径链、调整优先级、设为首选、恢复默认与删除；有活跃绑定或候选被引用时删除会被拒绝并说明原因；修改首选路径后绑定重挂到新路径。
20. 共享层禁用：从共享候选启用技能后，禁用时出现「仅在当前工具停用（智能拆分）」与「从共享目录彻底移除」两个选项，分别验证其他读者保留 / 全部停用。
21. 技能收藏：星标在列表与详情同步、收藏置顶并出现在 `EnableDialog` 前列；筛选「★ 收藏 / 已修改 / 未分发」结果正确；「已修改」黄点仅在存在漂移绑定时出现。
22. 手机端（390px / 360px）设置字典、候选路径编辑器、新增工具表单与启用对话框无横向滚动，按钮 / 输入 / 下拉触控目标 ≥40px，候选路径输入行自动换行。
23. 系统托盘：默认关闭时点击 `×` 直接退出；开启后窗口隐藏、进程与 Web 端口保持，单击托盘恢复，右键菜单三项可用，「彻底退出 Quiver」后端口释放。
24. 转为本地副本与恢复：`link` 绑定可转为可写副本，Store 源文件不变；目标缺失后「重新部署」能实际重建入口，真实目录占用时拒绝覆盖并给出中文提示。
25. 左右面板：拖动侧栏与列表分隔条可调宽，双击收起并恢复到上次宽度；重启后 `quiver.navWidth` / `quiver.listWidth` 仍生效，移动端不出现拖拽柄。
