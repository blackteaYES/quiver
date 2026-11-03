# AGENTS.md

面向在本仓库工作的编码 Agent。先读 `CLAUDE.md` 了解完整架构；这里是必须遵守的操作约束。

## 启动与验证

- `npm run dev` 同时拉起 Vite（127.0.0.1:5173）与 Electron。必须用这个入口验证桌面效果。
- `npm run dev:web` 只跑浏览器渲染层，无 `window.quiver` 桥接；桌面动作会提示需通过 Electron 窗口使用。
- 提交前至少执行 `npm run typecheck`、`npm run build` 与 `npm run test:engine`。
- 引擎集成测试为 `tests/engine-full.test.mjs`（20 项隔离场景，临时目录，结束自动清理），由 `scripts/run-engine-tests.mjs` 用 Electron 的 Node 24 运行；覆盖哈希确定性、只读 Store、Junction 安全解链、漂移三裁决、依赖与孤儿复活、备份、Web Token 与端口、`SKILL.md` 简介与预览、批量收编、25 项候选路径链、自定义 Harness 持久化、共享层解绑、Windows 真实路径、收藏迁移、副本转换原子性与缺失目标恢复、托盘开关配置往返、旧版工具名与候选标签迁移。改动引擎、候选路径链、共享层、挂载、Store、备份、收藏、Web 鉴权或托盘设置后必须跑。
- 修改图标或打包配置后执行 `npm run icons` / `npm run dist:win`；验证打包产物时用临时 `--user-data-dir` 启动，禁止污染真实 `%APPDATA%` 与 `~/.quiver`。
- 托盘驻留验证：默认关闭时点击窗口 `×` 必须直接退出；开启「关闭主窗口时最小化到系统托盘」后关闭窗口，进程与 Web 端口应保持，单击托盘恢复窗口，右键「彻底退出 Quiver」后端口释放且无 electron 残留。
- 不要直接 `electron .`：环境中的 `ELECTRON_RUN_AS_NODE=1` 会让主进程失效。启动统一走 `scripts/start-electron.mjs`。
- 本地 Node 低于 22 时无法加载 `node:sqlite`；需要直接跑引擎脚本时使用 Electron 二进制 + `ELECTRON_RUN_AS_NODE=1`。

## 硬性约束

1. **单一事实来源。** 渲染层数据只来自 `engine.snapshot()` 与 `engine.onChange`；不要把 Mock 数据、局部副本或乐观状态当作业务事实。派生列表用 `useMemo` selector。
2. **不触碰 Harness 内部配置。** 只读写技能扫描目录（`<harness>/skills/<slug>`）；不读取、不改写任何 Harness 的配置文件。
3. **中央库只读。** Store 内容寻址且权限固化（目录 `0555` / 文件 `0444`）。任何 UI 文案与交互都不能让人以为本地修改会自动回写；漂移的三种裁决（重置 / 收编 / 忽略）必须显式点击。
4. **安全解链。** 禁用或重挂载前先 `lstat`；目标是 symlink/junction 时只删除入口，**绝不递归删除 Store 源目录**；副本模式只删目标副本。
5. **导入纯净。** 本地目录 / Git / 备份包导入时拒绝任何软链接与硬链接；路径必须规范化为工作目录内的相对路径，拒绝 `..` 越界。
6. **显式破坏性操作。** 删除技能、清理失效项目、切换运行模式、重置漂移、收编外部技能都必须二次确认；不做自动合并或双向同步。
7. **IPC 白名单。** 新动作需同时更新 `electron/main.cjs`、`electron/preload.cjs`、`src/lib/desktop.ts`；渲染层禁止直接触碰 `fs` / `child_process` / `node:sqlite`。
8. **无原生编译依赖。** 不引入需要 C++/Rust 本地编译的模块；持久化使用 `node:sqlite`，哈希使用 `node:crypto`，监听使用 `chokidar`。
9. **视觉规则。** 只用 `@theme` 令牌与既有组件，同时适配 `dark` 与 `light` 两套令牌；边框 `hairline`、状态色仅用于状态点/标签；图标用 `lucide-react`；哈希/路径/命令用等宽胶囊；不使用 Emoji，不引入大面积彩色背景。字号下限 12.5px，禁止 `text-[10px]` / `text-[11px]`；深色模式文字不得比 `fg-subtle`（`#94a3b8`）更暗。
10. **动效与缩放。** 弹簧统一 400/30；导航、作用域与拓扑/列表切换用 `layoutId`；列表与详情用 `AnimatePresence`；弹层 `Esc` 可关闭；尊重 `prefers-reduced-motion`。缩放只走 `webFrame.setZoomFactor`（100/110/120%），依赖容器宽度自动布局的组件必须监听 `uiScale` 变化重新测量，不要假设 `ResizeObserver` 会触发。
11. **文案。** 界面语言为中文（工具品牌名、路径、哈希、命令除外）；动作名在流程前后保持一致（如「启用到…」→“已启用”）；错误说明原因与修复方式，不道歉、不空泛。
12. **审计日志只读。** `audit_logs` 只在引擎写动作路径生成；渲染层只通过 `quiver.listAuditLogs` / `quiver.exportAuditLogs` 查询与导出，不写入、不合并进快照，不做乐观更新。
13. **Web 服务边界。** 默认只监听 `127.0.0.1`；仅当设置中显式开启「允许局域网设备访问」(`web_lan`) 时才绑定 `0.0.0.0`，且 Host / Origin 白名单只扩展为当前网卡 IPv4。`/api/*` 一律校验 `X-Quiver-Token`（`timingSafeEqual`），不使用 Cookie；CORS 仅放行本地来源；`configureWeb` / `setMode` / `autoAllocateWebPort` 不得通过 Web RPC 执行。Token 不得出现在快照、SSE、日志或错误消息中；重新生成后旧会话必须失效。局域网二维码与免输直连链接必须由 UI 生成为 `http://<lan-ip>:<port>/#token=<token>` fragment 形式，不得生成 `?token=` 查询参数；前端 `consumeWebTokenFromUrl()` 读取（含旧式 `?token=` 兼容输入）后必须立即 `history.replaceState` 清除地址栏中的 Token，再继续渲染与请求。配置端口被占用时服务保持未运行并中文提示，桌面端可调用 `autoAllocateWebPort` 探测空闲端口、回写 `config.toml` 并立即启动。
14. **巡检与监听解耦。** `startWatcher()` 可以被项目/配置变更反复调用，但**不得**停掉 30s 巡检；巡检定时器只在 `openRoot()` 与 `close()` 中显式停止。路径恢复的复活逻辑必须走 `handleProjectRevival`，避免 chokidar 先行把 `missing` 清零导致漏挂载。
15. **响应式与触控。** ≥1024px 默认展开三栏；768–1023px 默认 64px 图标栏；<768px 隐藏侧栏并用底部四 Tab + 全屏推入详情，详情必须提供「← 返回列表」。侧栏与技能列表支持拖动调宽、双击/箭头折叠，宽度写入 `localStorage`（`quiver.navWidth` / `quiver.listWidth`）并在恢复隐藏面板时回到上次宽度；手动调整只覆盖默认值，不改变上面的断点默认。触控目标 ≥40px，<1024px 路径快捷动作常显，<768px 拓扑改为纵向流。纯视觉变化用响应式类，只有改变导航 / 下钻状态的布局才走 `useBreakpoint(uiScale)`；缩放后必须重新测量。
16. **打包边界。** Windows 打包只走 `electron-builder.yml`（asar、NSIS + Portable、x64）。`node:sqlite` 由 Electron 内置，保持 `npmRebuild: false`；新增原生模块必须同步 `asarUnpack`。打包后沙盒必须落在 `<userData>/quiver-sandbox`（默认模式是真实目录 `~/.quiver`，沙盒需显式切换），静态页由 `app.asar/dist` 托管；窗口图标从 `resources/icon.png` 读取。`build/icon.svg/png/ico` 需提交，`dist/`、`release/`、`release-*/` 不入库。
17. **候选路径链。** Harness 的 `candidates[]` 是有序事实来源（`priority` 越小越优先），`global_path` / `project_rel_path` 只作向后兼容迁移；同一 slug 同作用域按候选优先级遮蔽。共享层 `~/.agents/skills` / `.agents/skills` 的存在**不能**算作任何工具的「已检出」；只有非 shared 候选存在或有生效绑定才算活跃。删除工具或候选路径前必须检查生效绑定并中文阻断；保存首选路径变更后由引擎重挂，渲染层不得自行改写绑定。25 项工具的完整候选矩阵、角色与发现方式以 `electron/engine/harnesses.cjs` 为唯一事实来源，文档镜像见 `CLAUDE.md` / `assets/SPEC.md` / `README.md`，不得只改文档不改字典。
18. **跨工具禁用裁决。** 目标是共享/兼容层且被多个工具读取时，禁用必须让用户显式选择「智能拆分（重挂到其他工具首选目录）」或「从共享目录彻底移除」；不得默认二选一，也不得静默删除其他工具仍在读取的入口。
19. **收藏与展示字段。** `is_favorite` 只经 `toggleFavorite` 写库并随快照返回；列表置顶、`★ 收藏` 筛选、启用对话框排序都从快照派生，不做本地副本。别名 / 备注展示只读 `skill.alias` / `skill.comment`；`已修改` 黄点只在真实 `driftedCount > 0` 时显示。
20. **自定义 Harness 与配置持久化。** 新增自定义工具、追加候选、调整顺序、设首选、恢复默认与删除统一走引擎动作（`saveHarnessConfig` / `addHarnessCandidate` / `resetHarnessDefaults`），渲染层只提交草稿，不直接读写 `config.toml`。保存时 `candidates[]` 顺序就是事实来源，引擎按数组下标重写 `priority`（0 起）；新增候选默认 `role: 'custom'` 并追加到末尾。首选路径变更或恢复默认后由引擎重挂受影响绑定并回报「重新部署 N 个绑定」，渲染层不得自行改写 `binding.target_path`。仍有生效绑定的工具或候选路径禁止删除并中文阻断；恢复内置默认只重置该工具的默认候选链，不得删除自定义工具。保存后 `config.toml` 的 id / 名称 / 命令 / 分类 / 候选路径 / role / discovery / label / priority / `removed_harnesses` / `editor_command` 必须完整往返。
21. **系统托盘与关闭策略。** `config.toml` 的 `tray_on_close` 是唯一事实来源，**默认必须为 `false`**：点击窗口 `×` 直接 `app.quit()`，不得驻留。仅在用户显式开启「关闭主窗口时最小化到系统托盘（保持 Web 服务在线）」后才允许 `close` 事件 `preventDefault()` 并隐藏窗口；主进程必须同步创建托盘图标（`显示主窗口` / `在浏览器打开 Web 端` / `彻底退出 Quiver`），单击托盘恢复窗口。`before-quit` 必须先置 `forceQuit = true` 再走引擎关闭，避免托盘逻辑拦截真正的退出；若托盘图标不可用则不得拦截关闭，应回退为正常退出并在设置中保持关闭。该设置只允许桌面端修改（专用 IPC `window:set-tray-on-close`，同步 `main.cjs` / `preload.cjs` / `desktop.ts`），不进入 Web RPC；切换运行模式或配置文件后必须重新同步托盘状态。

## Harness 候选路径矩阵（镜像）

`electron/engine/harnesses.cjs` 是唯一事实来源；下表必须与其逐项一致，共 25 个工具、126 条候选。`P` 为 `priority`（越小越优先），`role` 取 `primary / shared / compat / synced / custom`，表中「父级链」「子包」对应 `parent-chain` / `nested-monorepo`；其余为 `exact`。改动字典时必须同步 `AGENTS.md` / `CLAUDE.md` / `assets/SPEC.md` / `README.md` 四份文档。

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

## 结构速查

| 位置 | 职责 |
| --- | --- |
| `src/App.tsx` | 快照加载、动作分发、视图、快捷键、弹层装配 |
| `src/lib/types.ts` | 领域模型（AppData / Skill / Binding / Project / Harness / Settings） |
| `src/lib/actions.ts` | `QuiverActions` 动作契约与 `EnableIntent` |
| `src/lib/desktop.ts` | `window.quiver` 类型与渲染层封装 |
| `src/lib/responsive.ts` | 三档断点判定，跟随 `uiScale` 重新测量 |
| `src/components/MobileTabBar.tsx` | 手机底部四 Tab 导航 |
| `src/components/MobileStatusSheet.tsx` | 手机状态与设置入口底部面板 |
| `src/components/SkillDetail.tsx` | 技能详情、拓扑/列表切换、版本历史 |
| `src/components/TopologyMap.tsx` | SVG 跳线拓扑、行内动作、漂移提示 |
| `src/components/HarnessView.tsx` | 工具视角、分类筛选/智能收缩、候选路径条、作用域叠加、外部目录收编 |
| `src/components/ProjectsView.tsx` | 项目视角、manifest、继承全局绑定 |
| `src/components/SettingsDialog.tsx` | 运行模式、编辑器命令、25 项 Harness 字典与候选路径链编辑器、局域网开关、托盘驻留开关、备份 |
| `src/components/EnableDialog.tsx` | 启用到…：共享层快捷开关、逐工具候选路径选择、收藏优先排序 |
| `src/components/AuditLogDialog.tsx` | 操作日志查看器：来源筛选、搜索、JSON/CSV 导出 |
| `src/components/WebUnlock.tsx` | 浏览器模式 Token 解锁层（sessionStorage） |
| `src/components/PermissionDialog.tsx` | 权限受阻引导：被拒路径、系统设置深链、副本降级 |
| `src/components/BindingActions.tsx` | 绑定行内动作与禁用依赖确认 |
| `src/components/TitleBar.tsx` | 窗口标题栏、明暗主题切换、命令面板入口 |
| `src/components/Sidebar.tsx` | 主导航、界面缩放、对账状态、操作日志/设置入口 |
| `electron/main.cjs` | 窗口与托盘生命周期、关闭策略、IPC 白名单、外部程序/终端/编辑器、外链白名单 |
| `electron/engine/config.cjs` | `config.toml` 读写：候选路径链、`removed_harnesses`、Web 配置、`tray_on_close` |
| `electron/engine/index.cjs` | 引擎门面：快照、动作、候选路径/共享层、对账、监听、30s 巡检、Web 服务生命周期、审计 |
| `electron/engine/harnesses.cjs` | 25 项内置 Harness 字典、默认候选链生成与旧配置迁移 |
| `electron/engine/server.cjs` | 本地 HTTP：Token 鉴权、RPC、SSE、静态/Dev 转发 |
| `electron/engine/store.cjs` | 内容寻址入库、只读固化、available 别名 |
| `electron/engine/mount.cjs` | Junction/symlink 挂载、copy 降级、安全解链 |
| `electron/engine/reconcile.cjs` | 已启用/已修改/未找到/路径失效/外部技能状态机 |
| `build/icon.svg/png/ico` | 应用图标矢量源与打包资源（窗口、安装器、extraResources） |
| `electron-builder.yml` | Windows NSIS + Portable 打包配置（asar、文件白名单、图标、输出 `release/`） |
| `scripts/build-icons.mjs` / `render-icons.cjs` | 离屏渲染 SVG 并封装多尺寸 ICO |

## 已知坑

- Vite 必须绑定 `127.0.0.1`，否则 `wait-on tcp:127.0.0.1:5173` 会一直等待，Electron 不启动。
- 删除 `.quiver-demo` 前先退出应用，释放 SQLite 与 chokidar 句柄；删除后下次启动会重新播种演示数据。
- Windows 上只读目录删除前需要 `chmod` 恢复写权限；引擎的 `ensureWritable` 已处理，不要绕过。
- `EnableDialog` 的初始化 effect 只依赖 `intent`；`activeProjects` 每次渲染都是新数组，把它放进依赖会重置用户选择。
- `TopologyMap` 容器使用 `overflow-visible`，否则版本/漂移悬浮卡会被裁掉。
- 项目视图的工具摘要取 `project.harnesses`（项目级 ∪ 全局绑定的并集）；不要退回只按项目级绑定统计，否则会漏掉仅有全局入口的工具（如 Cursor）。
- `webFrame.setZoomFactor` 改变 `innerWidth` / `getBoundingClientRect`，但**不会触发** `ResizeObserver`、`window.resize` 或 `visualViewport.resize`；缩放后布局在下一帧才稳定。`SkillDetail` 通过 `uiScale` 依赖 + 600ms 逐帧测量 + 350ms 兜底来切换拓扑/列表，改这里时别把 `uiScale` 去掉。
- 技能详情的拓扑/列表阈值是容器 560px：100% 时详情宽约 594px 保持拓扑，110%/120% 自动切列表；手动切换仍然允许，但缩放变化会按宽度重新裁决。
- Web 默认端口 4310，本机若被其他程序占用（例如 QQ）时服务不会启动；改 `config.toml` 的 `web_port` 后用同一端口启动 Vite（`QUIVER_WEB_PORT=xxxx`），否则开发代理会指向旧端口。
- 重新生成 Token 会立即让浏览器会话失效；桌面端不受影响。调试 Web RPC 时从 `config.toml` 读取当前 Token，不要复用旧值。
- 浏览器 SSE 必须用 `fetch` 流（`EventSource` 不能发送自定义 Header）；快照与 SSE 中的 `settings.web.token` 始终为空。
- 局域网调试结束后把 `config.toml` 的 `web_lan` 恢复为 `false`；Web RPC 会拒绝 `configureWeb` / `setMode`，不能在浏览器设置页里关闭监听。
- 开发模式下 `VITE_DEV_SERVER_URL` 只对回环 Host 生效；局域网 Host 的静态页回落到 `dist/`。因此 `npm run dev` 下真机测试前必须先 `npm run build`，否则手机拿到的是 `NO_DIST`。
- 带 Token 的局域网二维码使用 `#token=` fragment；`App` 启动时消费并 `history.replaceState` 清除。不要改成查询参数，否则 Token 会进入服务端日志与历史记录。
- `localIPv4Addresses()` 物理网卡优先、虚拟网卡（VMware/WSL/Hyper-V）排后；不要按固定网卡名过滤，否则会漏掉有效地址。
- `useBreakpoint(uiScale)` 依赖 `uiScale`：`webFrame.setZoomFactor` 不会触发 resize/ResizeObserver，去掉缩放参数会导致手机/平板布局在缩放后不更新。
- 手机端的 `VersionPill` 触控依赖 `onFocus` 仅在 `:focus-visible` 时打开、pointer 事件忽略非 mouse；改成普通 focus 会与点击叠加成“开了又关”。
- 绑定行（Harness / 项目 / 技能详情）不能只给操作区加 `max-sm:w-full`：父级若是 nowrap 的 `flex`，左侧技能名、路径会被挤成 0 宽，整页横向溢出。父级必须 `flex-col sm:flex-row`，操作按钮手机端用两列网格；日期加 `whitespace-nowrap`。
- 项目复活必须由 `handleProjectRevival` 统一处理：chokidar 的 reconcile 会先把 `projects.missing` 更新为 0，若巡检只在 `missing === 1` 时处理，就会漏掉重挂载和提示。
- 重启文件监听（`startWatcher`）不得停止 30s 巡检；此前把 `stopWatchdog()` 放在 `stopWatcher()` 内，导致添加项目后巡检永久停摆。
- 设置页「允许局域网设备访问」开关必须直接调用 `configureWeb` 即时生效并同步 `webLan`（失败回退）；只改本地草稿会让用户看到“已开启”，关闭重开后又变回未允许。成功后用返回快照的 `lanUrls[0]` 自动展开二维码，并滚动到面板可见位置。
- 托盘开关默认值必须是 `false`，且 `config.cjs` 解析旧配置时缺失键也回落 `false`；设置开关切换后立即写 `config.toml` 并同步主进程托盘，不要等「保存设置」。若启用时托盘图标创建失败，必须回滚为关闭并中文报错，否则窗口会被隐藏却无法恢复。
- 托盘开启时 `mainWindow.on('close')` 才能 `preventDefault()`；`before-quit` 必须先置 `forceQuit = true`。不要用「窗口是否可见」判断是否退出，否则系统关机或托盘「彻底退出」会被拦截。
- 托盘设置随 `config.toml` 分模式保存；`setMode` 切换工作目录后必须调用 `syncTrayFromConfig()`，否则真实模式与沙盒模式的托盘状态会与快照不一致。
- 「转为本地副本」必须先复制到 staging 并校验目录树哈希，再原子替换目标；失败时保留原链接与 `link/enabled`。`resetBinding` 对已删除的副本目录必须重建真实目录并写回 Store 内容，不能只把状态改回 `enabled`。
- `shell:save-qr` 属于 IPC 白名单：改动需同步 `electron/main.cjs`、`electron/preload.cjs`、`src/lib/desktop.ts`。主进程只接受 `data:image/png;base64,`，校验 PNG 签名、48 位下限与 8MB 上限，文件名必须剔除路径分隔符与控制字符。
- 打包时若 `release/win-unpacked` 的 `default_app.asar` 被宿主 IDE 搜索服务占用，会报 `EPERM` / `EBUSY`。不要终止宿主进程；可改用 `--config.electronDist=node_modules/electron/dist` 输出到其他目录，再从干净 stage 用 `--prepackaged` 打包。`release-*/` 已在 `.gitignore` 中。
- 修改 `build/icon.svg` 后必须执行 `npm run icons`，否则窗口与安装器仍使用旧 PNG/ICO；图标生成依赖 Electron 离屏渲染，Node 脚本不能直接替代。
- Harness「本机活跃」判定不能用任意候选目录存在：共享层候选（`~/.agents/skills`、`.agents/skills`）在装有 Quiver 的机器上几乎总是存在，会让 25 个内置工具全部显示为活跃。`detected` 必须是「非 shared 候选存在 ∪ 有绑定」。
- `preferredCandidateFor()` 只按 priority 选择首选候选，不得再叠加「目录是否存在」的偏好；否则绑定重挂载会静默漂移到另一条候选路径。
- `saveConfig` 回写候选数组时按数组下标生成 `priority`（0 起），编辑器的 ↑/↓ 只调整数组顺序；不要在渲染层单独维护 priority 字段。
- 共享层候选（role `shared`/`compat`/`synced`）的禁用必须显式二选一：「仅在当前工具停用（智能拆分）」或「从共享目录彻底移除（所有共用工具同步停用）」；引擎侧对应 `detachShared` 与 `disabled` 两条路径，不能只删其中一个入口就宣告完成。
- `Modal` 与 `EnableDialog` 的手机端触控下限用 `max-sm:` 任意变体统一兜底（`[&_button]` / `[&_input]` / `[&_select]` 至少 40px）；候选路径输入行必须 `flex-wrap` 且路径列 `max-sm:basis-full`，否则 390px 下路径框只剩约 140px。
- `toggleFavorite` 是收藏的唯一写入口，收藏列表从快照派生并在 `EnableDialog` 置顶；`is_favorite` 走迁移（`ALTER TABLE` 容错），别名与备注是只读展示，不要借收藏路径顺手写回技能元数据。列表「已修改」黄点只在 `driftedCount > 0` 时出现，不能用「存在漂移绑定」之外的近似条件。
- Harness 顶部筛选语义：`本机活跃` 只列活跃工具（未检出工具通过「展开其余 N 个」切到「全部」）；`全部` 与分类筛选必须返回完整匹配集合（25 / 11 / 13 / 0），不能回落到活跃集合。分类为 0（如「自定义」）或搜索无结果时必须显示空状态与「查看全部」，不能继续展示上一个工具的详情。
- Harness 标签条隐藏原生滚动条，必须保留左右箭头与滚轮横向滚动；滚轮在两端要放行页面滚动，选中靠右的标签后自动滚入视野。390px 下筛选按钮组用 `flex-wrap`，不要横向裁切「自定义」。
