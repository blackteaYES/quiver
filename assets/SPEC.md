# Quiver · Skill 本地管理器设计终稿 (SPEC.md)

> **定位**：以本地文件系统为部署真相、以链接/副本控制可见性、同时支持「技能 / Harness / 项目」三视角的本地 Skill 管理器。桌面端为主，Web 端为完整能力入口。简单优先，复杂性折叠进默认值。

---

## 一、产品定位与边界

**一句话**：Quiver（箭袋）只负责“把造好的 Skill（箭）放到 Harness 能看到的目录，或从那里移走”，绝不干涉 Harness 内部的启用逻辑。

**明确不做**：
- 不读、不写 Harness 自己的配置文件或内部开关。
- 不做自动双向同步，不做三方合并（Three-way Merge）。
- 不修改技能包内的 `SKILL.md` 来存储管理器元数据。
- 不做技能市场内容审核，只做来源追踪。
- 不为项目级配置做跨设备自动搬运。
- **不自动在项目里生成 `.quiver/manifest.json`**，它不是必需品，只在用户显式导出项目配置时才产生。

---

## 二、整体架构

```
┌────────────────────────────────────────────────────────┐
│ 视图层：技能库 (Skills) │ 工具 (Harnesses) │ 项目 (Projects) │
└───────────────────────────┬────────────────────────────┘
                            │ 只读查询 / 显式动作命令
┌───────────────────────────▼────────────────────────────┐
│ 领域层：Binding 模型 + 对账引擎 (Reconciler) + 事务替换器   │
└───────────────────────────┬────────────────────────────┘
                            │ 安全文件 I/O / 状态持久化
┌───────────────────────────▼────────────────────────────┐
│ 存储层：中央库(Store) │ Harness挂载目录 │ 状态与索引(SQLite) │
└────────────────────────────────────────────────────────┘
```

**核心原则**：
1. **中央库不可变**：入库版本按内容寻址且设为只读，保证源头纯净。
2. **文件层事实优先**：SQLite 负责持久化元数据与 Binding 关系，但 UI 展示永远以“对账引擎”扫描目标目录后的真实物理状态为准，不盲信数据库历史记录。
3. **修复动作显式化**：检测到文件漂移、缺失或外部技能时，只标记状态，由用户显式点击动作裁决。

---

## 三、目录与存储布局

```
~/.quiver/
├── store/sha256/<version_sha>/        # 中央库：按目录树哈希寻址，内部文件设为只读(Read-Only)
├── available/<slug>@<short_sha>/      # 可读别名软链接 -> 指向 store/sha256/<version_sha>
├── staging/<op_uuid>/                 # 事务暂存区：用于构建原子替换视图
├── metadata.db                        # SQLite：技能元数据、版本关系、Binding 状态、文件哈希缓存
└── config.toml                        # Harness 候选路径链字典、web_enabled / web_port / web_token

# 全局级挂载目标（直接写入各 Harness 原生全局目录）：
~/.claude/skills/<slug>                # link 模式指向 ~/.quiver/available/<slug>@<short_sha>
~/.codex/skills/<slug>                 # 或 copy 模式下的独立目录副本

# 项目级目录（默认对项目零侵入，不创建 .quiver 目录）：
<project_root>/
├── .claude/skills/<slug>              # 直接在项目对应 Harness 目录下创建链接或副本
└── .quiver/                           # 【仅在用户显式点击“导出项目配置”时才创建】
    └── manifest.json                  # 可选：项目技能需求声明（可提交进 Git）
```

**布局要点**：
- **最小挂载单元为「技能目录」**（包含 `SKILL.md` 及其附属脚本/资源的文件夹），不支持单文件裸挂载，以保证跨平台（特别是 Windows Junction）行为一致。
- `store/` 内容寻址且只读，天然去重、防误改、支持瞬间回滚。
- `available/` 用 `<slug>@<short_sha>`（取前 7 位哈希）命名，解决纯哈希目录不可读的问题，同时允许同一技能多版本并存。
- **去掉多余的 `.quiver/enabled/` 中转层**：启用即直接在目标 Harness 的真实扫描目录（全局或项目级）中建立指向 `available/` 的链接（或复制副本）；禁用即安全移除该链接/副本，源文件永不删除。

### 3.1 运行数据位置（开发 / 打包）

| 内容 | 开发模式 | 打包后 |
| :--- | :--- | :--- |
| 演示沙盒工作目录（需手动切换） | `<repo>/.quiver-demo/` | `<userData>/quiver-sandbox/`（Windows 为 `%APPDATA%\Quiver\quiver-sandbox`） |
| 真实本地工作目录（默认） | `~/.quiver/` | `~/.quiver/`（不变） |
| 渲染层静态资源 | `<repo>/dist/`（Vite / `dist/index.html`） | `resources/app.asar/dist/` |
| 窗口图标 | `build/icon.png` | `resources/icon.png`（`extraResources`） |
| 安装包输出 | — | `release/`（已加入 `.gitignore`） |
| 构建资源 | `build/icon.svg`、`build/icon.png`、`build/icon.ico` | 同左，随源码提交 |

沙盒落在 `userData` 而不是安装目录，因为安装目录（`Program Files`）通常不可写；安装器卸载时保留用户数据（`deleteAppDataOnUninstall: false`）。

---

## 四、数据模型

### 4.1 技能主表与多版本表（分离逻辑 ID 与物理哈希）

**1. `skills`（逻辑技能实体表 — 跨版本不变）**

| 字段           | 类型        | 说明                                                         |
| :------------- | :---------- | :----------------------------------------------------------- |
| `skill_id`     | TEXT (PK)   | 稳定逻辑标识（UUID 或 `规范化名称 + 来源标识` 的哈希），跨版本不变 |
| `slug`         | TEXT        | 目录挂载名（英文/数字/连字符，如 `pdf-parser`）              |
| `display_name` | TEXT        | 自定义显示名称                                               |
| `alias`        | TEXT        | 简短别名                                                     |
| `comment`      | TEXT        | 自由备注                                                     |
| `tags`         | TEXT (JSON) | 轻量分类标签数组                                             |
| `source_type`  | TEXT        | `git` / `local` / `archive`                                  |
| `source_uri`   | TEXT        | 来源地址（Git URL 或本地导入源路径）                         |
| `active_sha`   | TEXT        | 当前默认激活的 `version_sha`                                 |
| `depends_on`   | TEXT (JSON) | 可选依赖的 `slug` 列表（仅用于禁用前警告，不自动解析）       |
| `is_favorite`  | INTEGER     | 是否收藏（`0` / `1`，默认 `0`）；列表置顶与筛选依据          |

**2. `skill_versions`（物理版本表 — 对应 Store 目录）**

| 字段          | 类型      | 说明                                                         |
| :------------ | :-------- | :----------------------------------------------------------- |
| `version_sha` | TEXT (PK) | 目录树内容哈希（SHA-256），对应 `store/sha256/<version_sha>` |
| `skill_id`    | TEXT (FK) | 关联的逻辑技能 `skill_id`                                    |
| `parent_sha`  | TEXT      | 上一版本哈希（可为空，用于展示版本演进）                     |
| `created_at`  | INTEGER   | 入库时间戳                                                   |

### 4.2 核心实体：`bindings`（唯一部署关系表）

> **三视图（技能库 / Harness / 项目）是同一 `bindings` 集合的不同切片，不是三套数据。**
> 唯一约束：`UNIQUE(skill_id, harness_id, scope, project_path)`（当 `scope = 'global'` 时，`project_path` 固定为空字符串 `""`）。同一 Harness 在同一作用域 / 项目下只保留一条绑定，`candidate_id` 记录它落在哪条候选路径。

| 字段            | 类型      | 说明                                                         |
| :-------------- | :-------- | :----------------------------------------------------------- |
| `binding_id`    | TEXT (PK) | 绑定记录 UUID                                                |
| `skill_id`      | TEXT (FK) | 关联 `skills.skill_id`                                       |
| `harness_id`    | TEXT      | 目标 Harness 标识（如 `claude-code`, `cursor`, `windsurf`）  |
| `scope`         | TEXT      | `global` / `project`                                         |
| `project_path`  | TEXT      | `scope = 'project'` 时为规范化绝对路径；`global` 时为 `""`   |
| `target_path`   | TEXT      | 实际落盘的目标技能目录完整路径                               |
| `candidate_id`  | TEXT      | 绑定时选中的 Harness 候选 ID；为空时回落到当前首选候选       |
| `state`         | TEXT      | `enabled` / `disabled` / `drifted` / `missing` / `unmanaged` / `orphaned` |
| `sync_mode`     | TEXT      | `link`（默认） / `copy`                                      |
| `resolved_sha`  | TEXT      | 部署时的 `version_sha`（版本锚点）                           |
| `ignored_drift` | BOOLEAN   | 用户是否已点击“忽略”本地修改分叉                             |
| `deployed_at`   | INTEGER   | 部署时间戳                                                   |

---

## 五、三视图设计

### 视图一：技能库（Skill 为主体）
- 展示所有已入库技能，支持增删改查、备注、别名、标签过滤；星标收藏置顶，并可按 `全部 / ★ 收藏 / 已修改 / 未分发` 筛选。
- 列表第二行展示别名胶囊与单行备注摘要；「已修改」黄点只在 `driftedCount > 0` 时出现。
- 选中技能 → 展示其全部 Binding：在哪些 Harness、哪些项目中启用，以及各自对账状态。
- **启用动作**：选目标 Harness（多选）+ 作用域（全局 / 指定项目）+ 分发模式（默认 `link`，可选 `copy`）；共享层候选可一键启用，每个工具可显式选择候选路径。
- **导入方式**：Git 仓库（浅克隆 `--depth 1`）、本地文件夹、Quiver 备份包。
- **版本历史**：折叠展示该 `skill_id` 下的所有 `skill_versions`，支持一键切换激活版本（`link` 模式的绑定将同步更新指向新版本）。

### 视图二：Harness（工具为主体）
- 工具按「本机活跃（默认）/ 全部 / 国内主流 / 国际主力 / 自定义」筛选，未检出工具折叠；支持搜索与新增自定义工具。
- 每个工具可维护有序候选路径链；扫描结果显示共享层、兼容联动、云端同步、父级 / 子包发现徽章，同名 slug 按优先级标记「当前生效」与「被覆盖」。
- 共享层上的禁用提供「仅在当前工具停用（智能拆分）」与「从共享目录彻底移除」两种显式裁决。
- 默认展示全局 Binding：该 Harness 全局启用了哪些技能。
- 顶部 Scope 切换器：`全局` / `指定项目`。切换到项目时，以叠加态展示“全局已生效 + 当前项目已生效”的技能。
- 支持“扫描工具目录”，识别目标路径下非 Quiver 创建的外部技能（标记为 `unmanaged`）。

### 视图三：项目（项目为主体）
- 展示已纳管项目下的所有 Binding：哪些技能对哪些 Harness 生效。**数据来源是本地 SQLite `bindings` 表，不需要项目内存在 `manifest.json`。**
- **作用域优先级与物理规则**：
  - 同名技能（同 `slug`）在项目中启用时，项目级覆盖全局级认知。
  - **注意物理边界**：由于 Quiver 不修改 Harness 内部配置，若某技能已在全局启用（如 `~/.claude/skills/foo` 存在），仅在项目目录不创建链接无法阻止 Harness 读取全局目录。因此 UI 不提供虚假的“项目级屏蔽全局”开关，而是提供快捷动作**「转为仅指定项目启用」**（自动移除全局链接，改为在勾选的项目中创建项目级链接）。
- **可选协作能力（用户显式触发）**：
  - **「导出项目配置」** → 生成 `<project_root>/.quiver/manifest.json`，仅列出当前项目实际启用的技能声明（部分清单）。
  - **「按配置恢复项目」** → 读取项目内的 `manifest.json`，与本地中央库匹配并在对应 Harness 项目目录中重建链接；若本地库缺少某技能，提示根据 `source_uri` 拉取。

---

## 六、核心机制与工程规范（AI 编码必读）

### 6.1 启用 / 禁用与跨平台链接降级
- **启用 (`link` 模式)**：在目标 Harness 技能目录创建指向 `~/.quiver/available/<slug>@<short_sha>` 的链接。
  - **macOS / Linux**：使用标准目录符号链接（`symlink`）。
  - **Windows 降级链**：优先尝试 `symlink_dir`；若无管理员/开发者模式权限（捕获 `ERROR_PRIVILEGE_NOT_HELD`），自动无缝降级为 **Windows 目录联接点 (`Junction`)**；若跨卷或文件系统不支持，最终降级为 `copy` 模式并在 UI 提示。
- **安全禁用（防穿透铁律）**：
  - 移除 `link` 模式的技能时，**严禁调用递归删除目录内容的方法穿透进软链接/Junction**！必须先通过 `fs::symlink_metadata` 识别链接/重解析点（Reparse Point），仅移除链接入口本身，确保 `store/` 源文件绝对安全。
- **事务性替换**：批量应用新启用集时，先在 `~/.quiver/staging/<uuid>/` 构建，校验通过后再原子移动/替换到目标路径。

### 6.2 目录树哈希（Tree Hash）与只读保护
- **Store 只读锁**：技能入库写入 `~/.quiver/store/sha256/<version_sha>/` 后，递归将该目录下所有文件权限设为**只读（Read-Only）**，防止用户在 IDE 中通过软链接误改中央库。若用户需在项目内修改技能，需在 UI 点击「转为本地副本（Copy 模式）」解除链接并获取可写副本。
- **确定性目录树哈希算法**：
  1. 遍历技能目录，**强制忽略** `.git`、`.DS_Store`、`Thumbs.db`、`desktop.ini`。
  2. 对每个文件提取：`规范化相对路径 (UTF-8, '/' 分隔) + 文件类型标记 + SHA-256(文件内容)`。
  3. 按相对路径字典序升序排列所有条目，拼接后计算最终的顶层 `SHA-256`，作为 `version_sha`。
- **大文件性能优化（两级校验）**：
  - 在 SQLite 维护 `file_hash_cache (abs_path, size, mtime_ns, sha256)`。
  - 对账扫描时，若文件 `size` 与 `mtime_ns` 未变，直接复用缓存的 `sha256` 参与目录树哈希计算，避免重复读取大文件 I/O，同时保证 100% 内容哈希语义。

### 6.3 覆盖语义：三个显式裁决动作

当目标目录处于 `drifted`（已修改）状态时，用户可执行以下行级显式动作：

| 内部动作          | 用户 UI 文案       | 方向      | 执行逻辑                                                     |
| :---------------- | :----------------- | :-------- | :----------------------------------------------------------- |
| **Reset (重置)**  | 从技能库恢复       | 库 → 目标 | 丢弃目标目录的本地修改，重新按 `resolved_sha` 建立链接或覆盖副本 |
| **Adopt (收编)**  | 将更改保存回技能库 | 目标 → 库 | 计算目标目录新哈希 `new_sha`，写入 `store/sha256/<new_sha>`（设为只读），在 `skill_versions` 新增版本并更新 `active_sha` 及当前 Binding |
| **Ignore (忽略)** | 保留本地修改       | —         | 将 `ignored_drift` 设为 `true`，不再高亮报警，保留本地分叉状态 |

#### 转为本地副本与缺失目标恢复

- **转为本地副本 (`convertToCopy`)**：仅对 `link` 绑定开放。目标必须不存在或仍是链接；若已是真实目录，返回 `TARGET_EXISTS`，**绝不删除或覆盖**用户目录。转换先把 Store 中 `resolved_sha` 的内容复制到 `~/.quiver/staging/<uuid>/`，再原子移动到目标路径（跨卷 `EXDEV` 回退为复制，Windows 临时占用 `EPERM` / `EBUSY` 重试），随后把绑定改为 `sync_mode = 'copy'`、`state = 'enabled'` 并清空漂移字段。中央库源文件与 `available/` 别名不受影响，审计动作 `convert_copy`。
- **缺失目标恢复 (`resetBinding` / `redeployBinding`)**：对 `missing` 或手动「重新部署」的绑定，按 `resolved_sha`（缺失时回落 `active_sha`）重建入口；`link` 模式遇到真实目录拒绝覆盖并中文提示，`copy` 模式只删除目标副本后重建。恢复同样走 `assertAllowedTarget` 路径白名单，不会递归删除 Store。

### 6.4 对账引擎（Reconciler）状态机

触发时机：应用启动、切换视图、手动刷新、`chokidar` 监听到目录结构变化（2.2s 防抖），以及 30s 项目巡检兜底。

| 状态枚举    | 用户 UI 文案   | 判定条件                                                     | 自动处理动作                                                 |
| :---------- | :------------- | :----------------------------------------------------------- | :----------------------------------------------------------- |
| `enabled`   | 已启用         | 目标存在，且目录树哈希 == `resolved_sha`（若源库有更新版本，额外提示「可更新」） | 无动作                                                       |
| `drifted`   | 已修改         | 目标存在，但目录树哈希 != `resolved_sha`                     | 标记状态，等待用户执行重置/收编/忽略                         |
| `missing`   | 未找到         | 数据库记录为启用，但 `target_path` 物理目录不存在            | **不自动删库记录**，标记缺失，提供「重新部署」或「移除记录」 |
| `unmanaged` | 发现外部技能   | 目标 Harness 目录下存在含 `SKILL.md` 的文件夹，但不在 `bindings` 表中 | 只读识别展示；提供「原地登记」或「收编入库」                 |
| `orphaned`  | 未找到对应项目 | `scope = 'project'` 且 `project_path` 根目录不存在（如外接硬盘拔出或项目移走） | 折叠展示；路径恢复时由 `handleProjectRevival` 按 `resolved_sha` + `sync_mode` 自动重挂并提示 |

### 6.5 SKILL.md 简介、只读预览与外部技能收编

- **简介提取**：导入或刷新时优先读取 `SKILL.md` frontmatter 的 `description` / `comment`，支持单行、折叠 `>`、字面 `|`、引号与 BOM；缺失时取正文首段（跳过标题、空行与代码围栏并剥离 Markdown 标记）。收编外部技能在两者都缺失时才使用默认占位注释。
- **启动刷新**：`openRoot()` 调用 `refreshDefaultSkillComments`，只替换默认占位或空备注，保留用户手写备注；`resyncSkillComment` 是显式重新同步入口，并写入 `resync_skill_comment` 审计。
- **只读预览**：`skillPreview(skillId, sha?)` 从 Store 读取指定版本，返回相对文件树（忽略 `.git` / `.DS_Store` / `Thumbs.db` / `desktop.ini`）与 `SKILL.md` 正文；文件过多时返回截断标记（上限 5000），缺失版本返回 `STORE_MISSING`。预览不写入、不 chmod、不改变 `available` 别名；详情面板只读展示，不允许在预览中编辑。
- **外部技能批量收编**：Harness 视图可多选外部技能（`unmanaged`）后批量执行。`adopt` 写入中央库、把原目录替换为 Store 链接并建立 `link` 绑定；`register` 保留原目录为真实目录、建立 `copy` 绑定。两者都只处理所选条目，审计动作 `adopt_unmanaged_batch`，详情为 `adopt:N/M` 或 `register:N/M`；成功后条目从外部技能列表消失。

### 6.6 技能收藏、别名与备注展示

- `skills.is_favorite` 通过 `db.cjs` 迁移（`ALTER TABLE … DEFAULT 0`，重复执行容错）；唯一写入口是引擎动作 `toggleFavorite`，渲染层不做本地乐观写入。
- 收藏在技能列表与详情显示星标并置顶；`EnableDialog` 的目标技能列表同样收藏优先。筛选器为 `全部 | ★ 收藏 | 已修改 | 未分发`，全部从快照派生。
- 列表第二行展示别名胶囊与备注摘要；别名 `alias` 与备注 `comment` 只读展示，唯一修改入口是「编辑信息」动作。
- 列表/详情的「已修改」黄点只在 `driftedCount > 0` 时出现，不能用「曾漂移」「存在 ignoredDrift」等近似条件。

---

## 七、内置 Harness 候选路径链字典（`config.toml` 默认初始值）

内置 **25 项**工具、**126 条候选**，按 `category` 分为共享层 1、国内主流 11、国际主力 13 与自定义工具。下表为完整候选路径矩阵：`P` 为 `priority`（越小越优先），`role` 取 `primary / shared / compat / synced / custom`，表中「父级链」「子包」对应 `parent-chain` / `nested-monorepo`。数据与 `electron/engine/harnesses.cjs` 逐项一致；`global_path` / `project_rel_path` 仍写入 `config.toml`，仅作为首选候选的兼容投影。

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

### 7.1 候选路径链模型

```text
candidates[] = {
  id: string,                                  // 工具内唯一，如 g-primary / p-shared
  path: string,                                // 支持 ~ / 环境变量；项目候选为相对路径
  scope: 'global' | 'project',
  role: 'primary' | 'shared' | 'compat' | 'synced' | 'custom',
  discovery: 'exact' | 'parent-chain' | 'nested-monorepo',
  priority: number,                            // 由数组下标生成，0 起
  label?: string
}
```

- **角色**：`primary` 原生首选；`shared` 跨工具共享层；`compat` 兼容联动目录；`synced` 云端同步目录；`custom` 用户自定义扫描。
- **发现方式**：`exact` 精确目录；`parent-chain` 从项目目录向上查找，直到 git 根，最多 4 层；`nested-monorepo` 向下最多 3 层，跳过 `node_modules`、`.git`、`dist`、`build`、`target`、`.next`、`out`、`.quiver*` 与隐藏目录。
- **优先级**：`priority` 越小越优先。首选入口只按 priority 选择，不因目录是否存在而改变；保存配置后若首选变化，受影响绑定会重挂到新路径。
- **共享层**：`~/.agents/skills` 与项目 `.agents/skills` 是跨工具共享目录；一个技能写入后，多个读者工具同时可见。共享层存在本身不代表工具活跃，`detected` 只看非 shared 候选存在或存在绑定。
- **遮蔽**：同一 slug 出现在多条候选目录时，最高优先级标「当前生效」，其余标「被高优先级同名目录覆盖」；共享层条目展示可见读者数量。
- **禁用裁决**：共享 / 兼容 / 同步候选上的禁用必须二选一——`split` 仅当前工具停用（保留其他活跃读者）或 `all` 从共享目录彻底移除（所有共用工具同步停用）。
- **自定义工具**：自动生成英文连字符 ID，默认勾选自动共享；可编辑候选链、排序、设首选、恢复默认；有活跃绑定的内置工具或候选不允许删除。
- **迁移**：旧版只有 `global_path` / `project_rel_path` 的配置会在加载时自动转换为候选数组并回写，同时继续写出两个兼容投影字段。

### 7.2 自定义 Harness 与多候选路径配置指南

**新增自定义工具**

1. 在「设置 → Harness 字典」或 Harness 视图点击「新增自定义工具」，填写显示名称、启动命令与分类；未填写的分类归入 `custom`。
2. `id` 自动由名称转英文连字符（去重后追加序号），不允许与内置或既有工具冲突。
3. 至少保留一条全局候选；默认勾选「自动共享」时追加 `~/.agents/skills` 与 `.agents/skills` 两条 `shared` 候选，否则只保留用户输入的首选路径。
4. 保存后工具立即进入字典并参与 `detected` 判定：非 shared 候选目录存在或存在绑定即视为本机活跃。

**为现有工具追加扫描目录**

1. 在候选路径编辑器中点击「新增候选」，选择作用域（全局 / 项目）、角色（`primary / shared / compat / synced / custom`）、发现方式（`exact / parent-chain / nested-monorepo`）与可选标签。
2. 全局路径支持绝对路径、`~` 与环境变量（如 `$CODEX_HOME`）；项目路径必须是安全相对路径，拒绝 `..` 越界。
3. 新增候选默认 `role: 'custom'` 并追加到数组末尾，`priority` 由数组下标决定；可通过 ↑ / ↓ 调整顺序，或点击「设为首选路径」将其移到首位。

**调整优先级与重挂载**

- `priority` 越小越优先；`P0` 是新绑定与启用对话框的默认候选。已有绑定通过 `candidate_id` 锚定，单纯重排不会强制迁移。
- 修改某条候选的路径、设为首选或恢复默认后，引擎按新首选路径重挂受影响绑定，并回报「重新部署 N 个绑定」；渲染层不得自行改写 `binding.target_path`。
- 首选入口只按 priority 选择，不因目录是否存在而改变，避免绑定重挂载时静默漂移到另一条候选。

**恢复默认与删除保护**

- 内置工具可「恢复默认路径链」，仅重置该工具的候选数组并重挂受影响绑定，不影响自定义工具与其他工具配置。
- 仍有生效绑定的工具或候选路径禁止删除，会中文提示先停用；内置工具删除后写入 `removed_harnesses`，再次保存配置可恢复。
- 保存后 `config.toml` 的 `id / 名称 / 命令 / 分类 / 候选 / role / discovery / label / priority / removed_harnesses / editor_command` 必须完整往返。

### 7.3 多候选展示、同名遮蔽与跨工具共享解绑

- **多候选展示**：Harness 视图逐条显示候选的路径、作用域、角色、发现方式与存在状态；共享层条目标注「跨工具共享 · 共 N 个活跃工具可见」，兼容 / 同步候选分别标注联动与云端来源。
- **同名遮蔽**：同一 `slug` 在同一作用域出现在多条候选目录时，按 `priority` 决定生效入口（更小者优先），最高优先级标「当前生效」，其余标「被高优先级同名目录覆盖」。遮蔽只影响 UI 认知与默认启用位置，不自动删除任何目录。
- **共享层解绑裁决**：目标是共享 / 兼容 / 同步层且被多个工具读取时，禁用必须让用户显式二选一，不得默认执行其一：
  - **智能拆分（`split` / `disable_split`）**：删除共享目录入口，并按各活跃读者的首选非共享候选重挂；没有可用候选的工具跳过，保留其他读者的使用能力。
  - **彻底移除（`all` / `disable_shared`）**：删除共享目录入口，同时停用所有共用该目录的工具绑定；中央库 `store/` 与 `available/` 源内容不受影响，其他旁观技能不被改动。
- **硬约束**：`detected` 只看非 shared 候选存在或存在绑定；共享层 `~/.agents/skills` / `.agents/skills` 在装有 Quiver 的机器上几乎总是存在，不能据此把全部内置工具判为活跃。

---

## 八、技术选型

| 层级             | 技术选型                                              | 选型理由                                                                 |
| :--------------- | :---------------------------------------------------- | :----------------------------------------------------------------------- |
| **桌面端框架**   | Electron 41                                           | 主进程 Node.js 直接操作文件系统，渲染层通过 contextBridge 隔离；无需 Rust 工具链 |
| **进程架构**     | Main + Preload (`contextBridge`) + React Renderer      | 文件系统、SQLite、监听全部留在主进程；渲染层只能调用白名单 IPC            |
| **前端界面**     | React 19 + TypeScript 7 + Tailwind CSS v4 + Vite 8     | 组件生态成熟，`@theme` 令牌驱动暗色设计系统，HMR 开发体验好                |
| **持久化与索引** | `node:sqlite` 的 `DatabaseSync`（Node 22+ / Electron 41 内置 Node 24） | 零原生编译依赖（无 C++/Rust）；事务安全、单文件易备份。可选用 `better-sqlite3` 预编译包，但禁止引入需要本地编译的原生模块 |
| **哈希计算**     | `node:crypto` SHA-256                                 | 标准库内置；目录树哈希 + 文件哈希缓存（size + mtimeMs）                   |
| **文件监听**     | `chokidar` v4                                         | 跨平台监听 Harness 目录与 Store 变更，防抖后广播快照变更                   |
| **Web 服务**     | 原生 `node:http`（默认 `127.0.0.1`，可选局域网）+ SSE | 与 IPC 复用同一动作层；`X-Quiver-Token` 鉴权、无 Cookie；开发期代理 Vite，生产托管 `dist/`（含 asar 内） |
| **桌面打包**     | electron-builder 26                                   | Windows x64 NSIS 安装版 + Portable 便携版；asar 打包、`asarUnpack` 预留原生模块；图标随 `extraResources` 落盘 |
| **图标生成**     | SVG + Electron 离屏渲染 + 自研 ICO 封装               | `build/icon.svg` 为唯一矢量源，生成 1024 PNG 与 16–256 多尺寸 ICO，无需额外图像工具链 |

**工程约束**：整套依赖必须能在 Windows / macOS 上开箱安装，不引入需要本地 C++/Rust 编译的主进程模块（`node:sqlite` 由 Electron 内置 Node 24 提供，打包时 `npmRebuild: false`）；Electron 主进程使用 CommonJS，渲染层保持纯 Web 依赖。

---

## 九、安全与权限防线

### 9.1 Web 端安全（已实现）
- **默认仅绑定本地回环 `127.0.0.1`**；只有用户在设置中显式开启「允许局域网设备访问」（`web_lan = true`）时，才改为监听 `0.0.0.0`，用于手机/平板真机访问。默认端口 `4310`，可在设置中开关与修改（`web_enabled` / `web_port`）。端口占用时服务保持未运行并给出中文提示，桌面端继续可用；设置页提供「自动分配空闲端口并启动」，经 `autoAllocateWebPort` 探测可用端口、回写 `config.toml` 并立即重启服务。
- **高熵随机 Token**：缺失时自动生成 `crypto.randomBytes(24).toString('hex')`（48 字符）；所有 `/api/*` 请求必须通过自定义 Header `X-Quiver-Token` 携带，服务端用 `timingSafeEqual` 比较（不使用 Cookie，免疫 CSRF）。局域网模式下同样强制鉴权，不存在“内网免登录”。
- **Host / CORS 白名单**：回环模式仅允许 `127.0.0.1` / `localhost`；开启局域网后额外放行本机网卡 IPv4（物理网卡优先，VMware/WSL/Hyper-V 等虚拟网卡排后）。请求体上限 2MB；快照与 SSE 中 Token 恒为空。
- **局域网二维码与免输直连链接**：设置页列出当前网卡 IPv4，每个地址可生成二维码与直连链接；链接规范形式为 `http://<lan-ip>:<port>/#token=<token>`，Token 只放在 URL fragment 而非查询参数。前端 `consumeWebTokenFromUrl()` 读取（含旧式 `?token=` 兼容输入）后立即 `history.replaceState` 清除地址栏中的 Token，再继续渲染与请求，避免进入服务端日志、浏览历史与 Referer。二维码等同凭据，必须由桌面端显式点击才显示，可下载 PNG 或放大预览。
- **桌面专属动作**：`configureWeb` / `setMode` / `autoAllocateWebPort` 不得通过 Web RPC 执行，返回 `DESKTOP_ONLY`；Web 设置页对这些块只读。重新生成 Token 会让已解锁的浏览器会话立即失效。
- **路由**：`POST /api/rpc` 复用桌面端动作白名单；`GET /api/events` 通过 SSE 推送快照（浏览器用 `fetch` 流读取以携带 Header）；`GET /api/health` 用于解锁校验；生产托管 `dist/`（打包后为 `app.asar/dist`），开发期回环 Host 转发 Vite，局域网 Host 直接托管最近一次构建的 `dist/`。
- **双端来源**：桌面端走 IPC，审计来源 `desktop`；浏览器走 RPC/SSE，审计来源 `web`，由 `AsyncLocalStorage` 标注。
- **破坏性操作二次确认**：重置、收编、删除技能库源文件需二次弹窗确认。
- **审计日志 (`audit_logs` 表)**：记录所有写操作（时间戳、来源端 Desktop/Web、动作类型、目标 `binding_id`/`skill_id`）。桌面端可查看与导出 JSON/CSV；日志只读，不参与业务状态。

### 9.2 文件系统防逃逸
- **路径遍历防护**：导入压缩包或 Git 仓库时，对每个成员路径执行规范化校验（`canonicalize`），确保最终落盘路径严格位于目标根目录之内，拒绝包含 `..` 的非法相对路径。
- **拒绝源技能包内的软/硬链接**：入库扫描时，若发现外部导入的技能目录内部包含任何 symlink 或硬链接，直接拒绝入库并报错，防止通过恶意链接读取宿主敏感文件。

### 9.3 跨平台权限引导（已实现）
- 引擎统一捕获 `EACCES` / `EPERM` / `EROFS`，输出结构化 `{ code, path, syscall, platform, message, key }`；失败动作与快照 `permission` 都会弹出「系统权限受阻」对话框，展示被拒路径与 `syscall`。
- **macOS**：提示在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」中勾选 Quiver（经终端启动时还需授权终端），并通过 `shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles')` 直达设置；按钮为「授权后重试」。
- **Windows**：链接创建被拒（`LINK_PERMISSION`，`suggestion = copy`）时提供「一键降级为本地副本模式」，以 `copy` 重新执行启用；其余写权限问题提示检查目录可写性与安全软件，可「重试」。
- 外部链接走主进程白名单：仅允许上述系统设置深链与 `127.0.0.1` / `localhost` 的 HTTP 地址。

### 9.4 系统托盘与关闭策略（可选，默认关闭）

- `config.toml` 的 `tray_on_close` 是唯一事实来源，默认 `false`：点击窗口 `×` 直接 `app.quit()`，不驻留，避免用户误以为无法关闭。
- 设置页「本地 Web 服务」区域提供「关闭主窗口时最小化到系统托盘（保持 Web 服务在线）」开关，切换即通过专用 IPC `window:set-tray-on-close` 写盘并同步主进程，不等待「保存设置」；该设置仅桌面端可改，不进入 Web RPC。
- 开启后，`mainWindow.on('close')` 才 `preventDefault()` 并隐藏窗口，引擎、chokidar 与 Web 服务保持运行；托盘单击恢复主窗口，右键菜单为「显示主窗口」「在浏览器打开 Web 端」（Web 服务未运行时禁用）与「彻底退出 Quiver」。
- `before-quit` 必须先置 `forceQuit = true`；若托盘图标创建失败，设置接口回滚为关闭并中文报错，不得出现“窗口已隐藏但无法恢复”。切换运行模式后重新同步托盘状态。

---

## 十、分阶段落地路线图（供 AI 分步实现）

### Phase 1: MVP（打通核心主链路，已完成）
- 完成 SQLite 表结构初始化（`skills`, `skill_versions`, `bindings`, `file_hash_cache`）与 `config.toml` 加载。
- 实现技能入库（本地目录导入 + Git 浅克隆）→ 计算目录树 SHA-256 → 存入 `store/`（设为只读）→ 创建 `available/` 别名链接。
- 实现单/多 Harness 全局作用域下的 `link` 启用与安全禁用。
- 完成「技能库视图」与启动时全量对账引擎。

### Phase 2: 项目视图与分叉裁决（已完成）
- 实现「Harness 视图」与「项目视图」（基于本地 `bindings` 表，支持添加本地项目路径、切换 `copy` 模式）。
- 实现 `drifted` 状态下的三个显式动作：**重置 (Reset)**、**收编 (Adopt)**、**忽略 (Ignore)**，以及「转为本地副本」动作。
- 实现可选的「导出项目配置 (`manifest.json`)」与「按配置恢复项目」。
- 实现带 `schema_version` 的备份包导出与导入。

### Phase 3: 自动化体验与 Web 端（已完成）
- 接入 `chokidar` 文件监听 + 2.2 秒防抖自动对账。
- 内嵌 Node 本地 HTTP 服务端（`127.0.0.1`）+ `X-Quiver-Token` 鉴权 + 操作审计日志；浏览器端 Token 解锁层、SSE 快照推送、桌面/Web 双来源审计。
- `depends_on` 依赖编辑与禁用前警告：同作用域（含项目继承全局）存在已启用依赖方时，先确认「仍要禁用」再执行。
- 孤儿项目 30s 巡检与自动复活：路径恢复后重挂缺失入口、恢复监听，并提示「检测到项目 … 路径已恢复」。
- 跨平台权限受阻引导：macOS 完全磁盘访问权限深链与重试；Windows 链接权限被拒时一键降级本地副本。
- 备份包在设置中提供导出/导入入口，依赖声明与全部只读版本完整往返。

### Phase 3.5: UI 可读性升级、审计入口与多端响应式（已完成）
- 明暗双主题（`data-theme="dark" | "light"`）与 100% / 110% / 120% 界面缩放（`webFrame.setZoomFactor`），主题与缩放均持久化。
- 语义令牌提亮与字号提升：深色主背景 `#16181D`、卡片 `#222630`、边框 `rgba(255,255,255,0.14)`；文字下限 12.5px，辅助文字不暗于 `#94A3B8`。
- 技能列表收敛为两行（名称 + 状态、单行简介），绑定卡片放大间距并弱化部署时间；窄容器自动切换列表视图。
- 桌面端「操作日志」查看器：来源筛选、中文搜索、JSON/CSV 导出。Web 服务接入后，来源字段区分「桌面端 / Web 端」。
- Web 端三档响应式：≥1024px 三栏；768–1023px 64px 图标栏；<768px 底部四 Tab + 全屏推入详情（技能库 / Harness / 项目 / 设置与状态），触控目标 ≥40px。
- 可选局域网访问（`web_lan`，默认关闭）：开启后监听 `0.0.0.0`，列出本机网卡 IPv4，支持带 Token 的二维码、PNG 下载与放大预览；所有局域网请求仍强制 `X-Quiver-Token` 与 Host/CORS 白名单。

### Phase 4: Windows 打包与开源发布（已完成）
- 设计 Quiver 矢量图标（Q 环 + 箭头 + 跳线插头），由 SVG 生成 1024×1024 PNG 与 16–256 多尺寸 ICO，接入窗口图标、安装器图标与 `extraResources`。
- 配置 electron-builder：asar、文件白名单、`asarUnpack`、`npmRebuild: false`、Windows x64 NSIS 安装版与 Portable 便携版，输出 `release/`。
- 验证打包产物独立运行：内嵌 Web 服务可从 `app.asar/dist` 托管静态页面，Token 鉴权、快照脱敏与桌面专属动作限制与开发模式一致。
- 清理仓库并完善 `.gitignore`（依赖、构建产物、本地工作目录、数据库、日志、编辑器/OS 文件）；补齐 MIT `LICENSE` 与开源级中文 `README.md`；同步 `SPEC.md` / `CLAUDE.md`。
- 引擎集成测试（`tests/engine-full.test.mjs`）从 8 项扩展到 20 项，覆盖哈希确定性、只读库、Junction 安全解链、漂移裁决、依赖与项目复活、备份 `schema_version`、Web Token 鉴权与审计来源、端口占用与自动分配、简介解析与预览、批量收编、25 项候选链、自定义 Harness、共享解绑、Windows 真实路径、收藏迁移、副本转换原子性与缺失目标恢复、托盘开关配置往返、旧版名称与标签迁移。

### Phase 5: Harness 候选路径链与技能收藏（已完成）
- Harness 升级为有序候选路径链：内置 25 项工具字典（共享 1 + 国内 11 + 国际 13），兼容旧 `global_path` / `project_rel_path` 并自动迁移。
- 自定义工具与候选编辑器：英文 ID 自动生成、分类、自动共享、路径角色 / 发现方式 / 优先级编辑、设首选、恢复默认、删除保护。
- 多目录扫描与遮蔽提示：共享层徽章与读者数、同名 slug 优先级覆盖提示、启用对话框的共享层一键启用与候选下拉。
- 跨工具禁用裁决：仅在当前工具停用（智能拆分）或从共享目录彻底移除（所有共用工具同步停用）。
- Harness 视图分类筛选与智能收缩：本机活跃 / 全部 / 国内主流 / 国际主力 / 自定义，未检出工具折叠。
- 技能收藏（`is_favorite`）、别名胶囊与备注摘要、`全部 / ★ 收藏 / 已修改 / 未分发` 筛选；「已修改」黄点仅按 `driftedCount > 0` 显示。
- `SKILL.md` 简介提取与只读预览、默认备注刷新、外部技能批量收编（`adopt` 链接 / `register` 副本）。
- 本地 Web 服务端口占用保持未运行并提供「自动分配空闲端口并启动」，局域网免输直连链接使用 `#token=` fragment 并立即清除地址栏参数。

### Phase 6: 文档同步、系统托盘与 Windows 正式版打包（已完成）
- 四份文档（`AGENTS.md` / `assets/SPEC.md` / `CLAUDE.md` / `README.md`）同步完整 25 项候选路径矩阵、自定义 Harness 配置指南、多候选遮蔽与共享解绑裁决、简介/预览/批量收编、收藏与别名、转为本地副本与缺失目标恢复、左右面板拖拽收起、系统托盘开关、Web 自动端口与直连规则。
- 新增可选的系统托盘驻留（`tray_on_close`，默认关闭）：关闭窗口可隐藏到托盘并保持 Web 服务在线，托盘菜单支持恢复窗口、打开 Web 端与彻底退出；引擎测试扩展至 20 项并覆盖配置往返。
- 经 `npm run dist:win` 输出 Windows x64 NSIS 安装版与 Portable 便携版，产物位于 `release/`；用临时 `--user-data-dir` 验证窗口启动、asar 静态托管、Token 鉴权与托盘关闭策略。

## 十一、UI 界面效果图与视觉规范（供前端实现参考）

### 11.1 整体视觉风格与窗口栅格
- **设计语言**：现代极客桌面工具风格（参考 Linear / Raycast / Cursor 设置页），高信息密度、低视觉噪音、克制使用彩色（仅在状态圆点与主按钮使用强调色）。
- **窗口尺寸**：默认 `1160 × 760`，最小支持 `960 × 640`。
- **主题与缩放**：标题栏提供 `柔和暗色 / 清爽浅色` 切换；左侧栏底部提供 `100% / 110% / 120%` 界面缩放，二者均持久化。浅色主题背景 `#F8FAFC`、卡片 `#FFFFFF`、文字 `#0F172A`。
- **字号规范**：正文/按钮/导航 14px，列表与卡片标题 15–16px，详情标题 20–22px，等宽路径/哈希/状态 13px；下限 12.5px。深色模式辅助文字不暗于 `#94A3B8`。
- **顶层导航栏（左侧固定窄边栏 `200px`）**：
  - 顶部仅 **3 个主视图入口**：`技能库`、`Harness`、`项目`。
  - 严禁将“全局/项目作用域”、“回收站”、“市场”做成顶层导航项。
  - 底部固定区：`刷新状态` 按钮（显示上次检查时间）、`操作日志` 入口、`设置` 入口。

---

### 11.2 视图一：技能库（Master-Detail 左右分栏布局）

> **布局比例**：左侧导航 (`200px`) + 中间技能列表 (`320px`) + 右侧技能详情与生效分布 (`flex-1`)。左侧导航与技能列表的右边缘均可拖动调宽（分隔条 `role="separator"`，支持方向键 ±16px 与双击收起），宽度持久化在 `localStorage` 的 `quiver.navWidth` / `quiver.listWidth`；拖动到阈值以下视为收起，恢复时回到上次宽度而非默认值。移动端不启用拖拽。

```
+------------------+----------------------------------+------------------------------------------------------+
|  QUIVER     v0.1 | [🔍 搜索技能、别名或标签...    ] |  pdf-parser (PDF 深度解析器)         [启用到…] [···] |
|                  | [全部] [文档] [编码] [前端]  [+] |  别名: pdf  | 来源: [github.com/org/skills](https://github.com/org/skills)           |
|  ◈ 技能库    (12)|----------------------------------|  备注: 提取长文档表格与公式，适用于论文阅读         |
|  ❖ Harness   (6) | ● pdf-parser               v2 ★  |  [标签: #文档 #Python]              [编辑备注/标签] |
|  ▣ 项目      (4) |   PDF 深度解析器 · 3 处已启用    |------------------------------------------------------|
|                  |   #文档  #Python                 |  生效位置 (3)                                        |
|                  |----------------------------------|                                                      |
|                  |   git-commit-pro           v1    |  全局 (Global)                                       |
|                  |   规范化提交生成 · 1 处已启用    |  ┌────────────────────────────────────────────────┐  |
|                  |   #Git                           |  │ Claude Code   ● 已启用 (链接)           [禁用] │  |
|                  |----------------------------------|  │ ~/.claude/skills/pdf-parser                    │  |
|                  | ● ui-auditor        [发现修改!]  |  ├────────────────────────────────────────────────┤  |
|                  |   前端走查助手   · 2 处已启用    |  │ Antigravity   ● 已启用 (链接)           [禁用] │  |
|                  |   #前端                          |  │ ~/.gemini/antigravity/skills/pdf-parser        │  |
|                  |----------------------------------|  └────────────────────────────────────────────────┘  |
|                  |   sql-optimizer            v3    |  项目 (Projects)                                     |
|                  |   慢查询优化分析 · 未启用        |  ┌────────────────────────────────────────────────┐  |
|                  |   #数据库                        |  │ quiver-app / Cursor                            │  |
|                  |                                  |  │ ● 已修改 (本地副本)                            │  |
|                  |                                  |  │ [从技能库恢复] [将更改保存回技能库] [保留修改] │  |
|                  |                                  |  └────────────────────────────────────────────────┘  |
|------------------|                                  |------------------------------------------------------|
|  ↻ 刚刚检查      |                                  |  ▸ 历史版本 (共 2 个版本，当前激活 a1b2c3d)          |
|  ⚙ 设置          |  [+ 导入技能 (本地 / Git / 备份)]|    • a1b2c3d (当前激活) - 2026-10-24 导入            |
|                  |                                  |    • 9f8e7d6            - 2026-10-10 [设为当前版本]  |
+------------------+----------------------------------+------------------------------------------------------+
```

---

### 11.3 视图二：Harness 视图（工具视角 + 顶部作用域切换器）

> **交互重点**：顶部切换「全局」或「叠加指定项目」；当检测到该工具目录里有非 Quiver 创建的文件夹时，在顶部展示温和的提示条。

```
+------------------+-----------------------------------------------------------------------------------------+
|  QUIVER     v0.1 |  选择工具: [ Claude Code ▾ ]   [ Cursor ]   [ Antigravity ]   [ Codex ]   [ Windsurf ]  |
|                  |-----------------------------------------------------------------------------------------|
|  ◈ 技能库   (12) |  当前视角: (● 仅看全局 ~/.claude/skills )   (○ 叠加项目视角: [ 选择项目... ▾ ] )        |
|  ❖ Harness   (6) |-----------------------------------------------------------------------------------------|
|  ▣ 项目      (4) |  ℹ 在 ~/.claude/skills 中发现 1 个外部技能                           [扫描目录]        |
|                  |  ┌───────────────────────────────────────────────────────────────────────────────────┐  |
|                  |  │ ◈ my-custom-prompt                            ● 发现外部技能                      │  |
|                  |  │   ~/.claude/skills/my-custom-prompt           [原地登记]  [收编到技能库]  [忽略]  │  |
|                  |  └───────────────────────────────────────────────────────────────────────────────────┘  |
|                  |                                                                                         |
|                  |  已启用技能 (3)                                                       [+ 启用新技能…]   |
|                  |  ┌───────────────────────────────────────────────────────────────────────────────────┐  |
|                  |  │ pdf-parser (PDF 深度解析器)                   ● 已启用 · 链接 · a1b2c3d           │  |
|                  |  │ ~/.claude/skills/pdf-parser                   [转为本地副本]  [禁用]              │  |
|                  |  ├───────────────────────────────────────────────────────────────────────────────────┤  |
|                  |  │ git-commit-pro (规范化提交生成)               ● 已启用 · 副本 · 8c7d6e5  [↑可更新]│  |
|                  |  │ ~/.claude/skills/git-commit-pro               [更新到最新]    [禁用]              │  |
|                  |  ├───────────────────────────────────────────────────────────────────────────────────┤  |
|                  |  │ legacy-helper                                 ● 未找到 (目标目录已被外部删除)     │  |
|                  |  │ ~/.claude/skills/legacy-helper                [重新恢复]      [移除记录]          │  |
|                  |  └───────────────────────────────────────────────────────────────────────────────────┘  |
|------------------|                                                                                         |
|  ↻ 刚刚检查      |                                                                                         |
|  ⚙ 设置          |                                                                                         |
+------------------+-----------------------------------------------------------------------------------------+
```

---

### 11.4 视图三：项目视图（项目本地治理 + 可选导出配置）

> **交互重点**：不依赖 `manifest.json` 即可管理；右上角提供可选的「导出项目配置」；底部折叠展示路径已不存在的「未找到对应项目（孤儿）」。

```
+------------------+-----------------------------------------------------------------------------------------+
|  QUIVER     v0.1 |  当前项目: [ 📁 quiver-app (D:\Projects\quiver-app) ▾ ]  [+ 添加项目]                   |
|                  |  状态: 纯本地管理 (未生成配置文件)             [导出项目配置]  [按配置恢复项目]         |
|  ◈ 技能库   (12) |-----------------------------------------------------------------------------------------|
|  ❖ Harness   (6) |  本项目专享启用 (2)                                              [+ 为本项目启用技能…]  |
|  ▣ 项目      (4) |  ┌───────────────────────────────────────────────────────────────────────────────────┐  |
|                  |  │ rust-tauri-expert  →  Claude Code, Antigravity                                    │  |
|                  |  │ ● 已启用 (链接) · .claude/skills/rust-tauri-expert                         [禁用] │  |
|                  |  ├───────────────────────────────────────────────────────────────────────────────────┤  |
|                  |  │ ui-auditor         →  Cursor                                                      │  |
|                  |  │ ● 已修改 (本地副本) · .cursor/skills/ui-auditor                                   │  |
|                  |  │ ⚠ 检测到本地文件已被修改:                                                         │  |
|                  |  │   [从技能库恢复]   [将更改保存回技能库]   [保留本地修改]                          │  |
|                  |  └───────────────────────────────────────────────────────────────────────────────────┘  |
|                  |                                                                                         |
|                  |  继承自全局的技能 (2)  (提示: 全局启用的技能对所有项目可见)                             |
|                  |  ┌───────────────────────────────────────────────────────────────────────────────────┐  |
|                  |  │ pdf-parser         →  Claude Code (全局生效中)        [转为仅指定项目启用…]       │  |
|                  |  └───────────────────────────────────────────────────────────────────────────────────┘  |
|------------------|-----------------------------------------------------------------------------------------|
|  ↻ 刚刚检查      |  ▸ 未找到对应项目 (1) — D:\OldDrive\demo-api (路径当前不可访问，重连后自动恢复)         |
|  ⚙ 设置          |                                                                                         |
+------------------+-----------------------------------------------------------------------------------------+
```

---

### 11.5 状态徽章与行级操作按钮映射表（前端组件规范）

前端统一封装 `<StatusBadge />` 与 `<BindingActions />` 组件，严禁暴露内部枚举名：

| 内部状态           | UI 文案            | 视觉样式 (Tailwind 参考)                                     | 允许的行级操作按钮                                         |
| :----------------- | :----------------- | :----------------------------------------------------------- | :--------------------------------------------------------- |
| `enabled`          | `● 已启用`         | 翡翠绿 `bg-emerald-500/10 text-emerald-400 border-emerald-500/20` | `[转为本地副本]` (仅 link 时)、`[禁用]`                    |
| `enabled` + 有新版 | `↑ 可更新`         | 天空蓝 `bg-sky-500/10 text-sky-400 border-sky-500/20`        | `[更新到最新]`、`[禁用]`                                   |
| `drifted`          | `● 已修改`         | 琥珀黄 `bg-amber-500/10 text-amber-400 border-amber-500/20`  | `[从技能库恢复]`、`[将更改保存回技能库]`、`[保留本地修改]` |
| `missing`          | `● 未找到`         | 珊瑚红 `bg-rose-500/10 text-rose-400 border-rose-500/20`     | `[重新恢复]`、`[移除记录]`                                 |
| `unmanaged`        | `● 发现外部技能`   | 紫罗兰 `bg-purple-500/10 text-purple-400 border-purple-500/20` | `[原地登记]`、`[收编到技能库]`、`[忽略]`                   |
| `orphaned`         | `● 未找到对应项目` | 中性灰 `bg-slate-500/10 text-slate-400 border-slate-500/20`  | 默认折叠在底部，提供 `[重新定位路径…]`、`[清理记录]`       |
---

### 11.6 操作日志查看器（桌面端）

- **入口**：左侧栏底部「操作日志」，`Esc` 关闭。
- **列表**：时间（日期与时刻分行）、来源标签（`桌面端` / `Web 端`）、中文动作名、目标技能 / Harness / 路径；按时间倒序，默认展示最近 20 条。
- **筛选与搜索**：来源分段（`全部 / 桌面端 / Web 端`）；搜索框 220ms 防抖，可匹配中文动作名、来源、Harness 与路径。
- **导出**：`[导出 JSON]`、`[导出 CSV]`（UTF-8 BOM + CRLF，便于 Excel 打开）。
- **边界**：日志只读、不提供编辑或删除；导出通过主进程写入用户选择的位置，渲染层不直接触碰文件系统。

---

## 十二、多端 Web 与响应式架构（已实现）

### 12.1 三档布局

| 断点 | 导航 | 内容 |
| :--- | :--- | :--- |
| `≥1024px` | 200px 左侧栏（技能库 / Harness / 项目 + 底部状态、日志、设置） | 技能库为列表 + 详情两栏，Harness / 项目为完整视图 |
| `768–1023px` | 收为 64px 图标栏 | 保持列表 + 详情，路径快捷动作常显（不依赖悬浮） |
| `<768px` | 隐藏侧栏，底部四 Tab（技能库 / Harness / 项目 / 设置与状态） | 技能与项目为全屏列表，点击推入全屏详情并提供「← 返回列表」 |

- 断点判定走 `useBreakpoint(uiScale)`，**必须传入界面缩放并在缩放后重新测量**；纯视觉变化用 Tailwind 响应式类，只有会改变导航 / 下钻状态的布局才走 JS 断点。
- 手机端下钻状态提升到 `App`（`mobileSkillOpen` / `mobileProjectOpen` / `mobileStatusOpen`），切换视图时重置；根容器 `100dvh`，底部 Tab 使用 `env(safe-area-inset-bottom)`。
- `<768px` 技能详情的拓扑改为纵向流（源版本在上，目标向下堆叠），默认列表视图；路径/哈希单行省略并可点击展开。
- 触控目标 ≥40px；`<640px` 绑定行改为纵向堆叠（操作区在内容下方、两列网格），Harness 标签换行；漂移裁决按钮纵向堆叠。
- 外部浏览器隐藏窗口控制按钮；手机端标题栏只保留主题与搜索图标。

### 12.2 Web 渲染层与桌面端共用动作契约

- 桌面端 `window.quiver` 走 IPC；浏览器端 `webEngine` 走 `fetch('/api/rpc')` + SSE `/api/events`，两端的动作白名单与返回结构一致（`{ ok, message, description, snapshot }`）。
- Token 只存 `sessionStorage`；首次访问显示中文解锁层（`WebUnlock`）。带 `#token=` 的二维码地址会自动解锁并清除 fragment。
- 审计来源由主进程 `AsyncLocalStorage` 标注：桌面端 `desktop`，浏览器 `web`。
- Vite 开发代理端口取 `QUIVER_WEB_PORT`（默认 4310）；开发模式仅回环 Host 转发 Vite，局域网 Host 直接托管 `dist/`，因此真机测试前需先执行一次 `npm run build`。

---

## 十三、构建、测试与 Windows 打包（Phase 4）

### 13.1 命令

```bash
npm run dev         # Vite(127.0.0.1:5173) + Electron
npm run dev:web     # 仅浏览器渲染层（无桌面桥接）
npm run typecheck   # tsc --noEmit
npm run build       # tsc --noEmit + vite build
npm run test:engine # 20 项引擎集成测试（Electron Node 24 + 临时隔离目录）
npm run icons       # 重新生成 build/icon.png 与 build/icon.ico
npm run dist:win    # npm run build + electron-builder --win（NSIS + Portable）
```

### 13.2 electron-builder 配置要点

- 配置文件 `electron-builder.yml`；`appId: com.quiver.desktop`、`productName: Quiver`、`buildResources: build`、`output: release`。
- `files` 仅包含 `dist/**`、`electron/**`、`package.json`，排除 sourcemap；electron-builder 自动纳入生产 `node_modules`。
- `asar: true`；`asarUnpack` 预留 `**/*.node` 与 `node_modules/**/prebuilds/**`。当前没有原生模块：`node:sqlite` 由 Electron 41 内置 Node 24 提供，故 `npmRebuild: false`。
- `extraResources` 将 `build/icon.png` 复制为 `resources/icon.png`；主进程打包后从 `process.resourcesPath/icon.png` 读取窗口图标，开发时读取 `build/icon.png`。Windows 额外设置 `app.setAppUserModelId('com.quiver.desktop')`。
- Windows 目标：`nsis`（`oneClick: false`、可选安装目录、可提升权限、桌面/开始菜单快捷方式、`deleteAppDataOnUninstall: false`）与 `portable`（`requestExecutionLevel: user`），均为 x64。当前仅配置 Windows x64，不产出 macOS / Linux 包。
- 产物：`release/Quiver-<version>-win-x64-setup.exe`、`release/Quiver-<version>-win-x64-portable.exe`、`release/win-unpacked/`。未配置证书时跳过签名，首次运行会有 SmartScreen 提示；GitHub Release 附带 `SHA256SUMS.txt`，放行方式与智能应用控制的限制见 README「未签名构建的使用方式」。

### 13.3 打包后的运行路径

- 渲染层：`BrowserWindow.loadFile(resources/app.asar/dist/index.html)`。
- Web 静态托管：`server.cjs` 的 `DIST_ROOT = path.join(__dirname, '..', '..', 'dist')` 在 asar 内解析为 `app.asar/dist`；Electron 为 `fs` 提供 asar 读取支持，`index.html`、JS/CSS 与字体均可正常返回。
- 演示沙盒：`app.isPackaged` 为真时使用 `<userData>/quiver-sandbox/`，避免写入不可写的安装目录；默认模式为真实目录 `~/.quiver/`，模式指针存于 `<userData>/engine-mode.json`（缺失时回落 `real`）。
- 安装器卸载保留 `%APPDATA%/Quiver` 与 `~/.quiver` 数据。

### 13.4 图标流水线

- `build/icon.svg` 是唯一矢量源：暗色圆角底、白色 Q 环、琥珀箭头与跳线插头（Q 的尾巴即插头线缆）。
- `scripts/build-icons.mjs` 清理 `ELECTRON_RUN_AS_NODE` 后启动 Electron；`scripts/render-icons.cjs` 在透明离屏窗口渲染 SVG，`capturePage()` 输出 1024×1024 `build/icon.png`，再封装 16/24/32/48/64/128/256 多尺寸 `build/icon.ico`。
- `build/icon.png` 与 `build/icon.ico` 作为构建资源提交；修改图标后需重跑 `npm run icons` 与 `npm run dist:win`。

### 13.5 打包产物验收

- 用 `--user-data-dir=<临时目录>` 启动 `release/win-unpacked/Quiver.exe`，并预写临时沙盒 `config.toml` 固定 `web_port` / `web_token`。
- 必查项：窗口与图标正常；`/` 返回 `index.html` 且静态资源可加载；无 Token 401、正确 Token 200；快照包含种子技能且 `settings.web.token` 为空；`configureWeb` 返回 `DESKTOP_ONLY`；渲染层 URL 位于 `app.asar/dist/index.html`。
- 托盘必查：默认关闭时关闭窗口进程退出；开启后关闭窗口进程与 Web 端口保持，单击托盘恢复窗口，右键「彻底退出 Quiver」后端口释放、无 electron 残留。
- 便携版与安装版共用同一 `app.asar`；便携版运行时解压到临时目录，用户数据仍写入 `userData`。

### 13.6 本机环境注意

- 宿主 IDE 的搜索服务可能长期占用 `release/win-unpacked/resources/default_app.asar`，导致 electron-builder 原子重命名报 `EPERM` / `EBUSY`。这不是配置缺陷：可改用自定义 `electronDist`（`node_modules/electron/dist`）输出到其他目录，或从干净 stage 用 `--prepackaged` + `--config.directories.output=release-build` 打包。
- 本地 Node 低于 22.12 时 electron-builder 会提示无法加载 `@electron/rebuild`；因 `npmRebuild: false`，打包本身不受影响。
- 引擎测试与打包验证均应使用临时目录，避免触碰真实 `~/.quiver` 与正在运行的演示沙盒。
