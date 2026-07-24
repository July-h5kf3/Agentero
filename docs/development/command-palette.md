# 全局命令面板 / 快速打开（Command Palette · Quick Open）

> 状态：**Phase A 已落地**（⌘P/⌘K 快速打开 · ⇧⌘P 命令面板 · `>` 前缀；命令注册表 Phase B 仍待）  
> 目标：对齐 VS Code 的 **⌘P 快速打开** 与 **⇧⌘P 命令面板** 交互心智，在 Agentero 中落地「全局搜索框」能力，并给出实现边界与分期。  
> 相关：现有 `src/components/layout/command-palette.tsx`、`src/lib/vault-search.ts`、Host `vault_search`、[`../frontend/ui.md`](../frontend/ui.md) §3.0 弹层栈、[`../backend/api.md`](../backend/api.md)。

---

## 1. 背景与目标

用户希望有类似 VS Code 的全局浮层搜索：

| 快捷键 | VS Code 名称 | 典型用途 |
|---|---|---|
| **⌘P** | Quick Open / Go to File | 按文件名（或符号）跳转打开 |
| **⇧⌘P** | Command Palette | 执行任意命令（View / Git / 扩展…） |

二者共用 **同一套 Quick Input UI 壳**（居中浮层 + 输入框 + 可滚动列表 + 键盘导航），但 **数据源与语义不同**。

**产品目标（Agentero）**

1. **全局入口**：任意焦点（编辑器 / PDF / 文件树）均可唤起，模态遮罩；`Esc` / `⌘W` 经 `overlay-stack` 关闭；同键再按亦可关闭。
2. **双模式心智**：快速打开（资源）vs 执行命令（动作）。
3. **科研场景优先**：论文 / 笔记 / Library 路径优先于「任意工作区文件」。
4. **可扩展**：新功能以注册命令方式进入面板，而不是硬编码一长串菜单。

---

## 2. VS Code 如何实现（机制拆解）

### 2.1 用户层：一个壳，多种「提供者」

官方文档将快捷键分工写得很清楚：

- **⇧⌘P**：直接进入 **编辑器 / 工作台命令**（Command Palette）。
- **⌘P**：进入 **文件 / 符号等导航**（Quick Open）。
- 同一输入框内可用 **前缀** 切换语义（在输入框键入 `?` 可列出帮助）：

| 前缀 | 含义 |
|---|---|
| `>` | 命令模式（命令面板；⇧⌘P 等价于预填 `>`） |
| （无前缀） | 按文件名 Quick Open |
| `@` | 当前文件符号 |
| `#` | 工作区符号 |
| `:` | 跳转到行号 |
| `?` | 帮助：列出可用前缀 |

因此 VS Code 的交互不是两个完全独立的对话框，而是：

```text
Quick Input（UI 壳）
   │
   ├─ 默认 / ⌘P     → File / 最近文件 / 符号… 提供者
   ├─ ⇧⌘P 或 `>`   → Commands 提供者
   └─ 其它前缀      → Line / Symbol / Help …
```

### 2.2 扩展层：命令是一等公民

VS Code 的「命令」不是面板内部硬编码列表，而是 **全局命令系统**：

1. **注册 handler**  
   `vscode.commands.registerCommand('myExt.doThing', handler)`  
   只绑定 **command id → 函数**。

2. **声明 UI 元数据**（`package.json` → `contributes.commands`）  
   - `command`：稳定 id  
   - `title`：面板中显示的标题  
   - `category`（可选）：面板中分组前缀，如 `Git: Commit`  
   - `enablement`（可选）：when 表达式，控制是否可用  

3. **菜单可见性**（`contributes.menus.commandPalette`）  
   默认所有 contributed commands 进 Command Palette；可用 when 子句隐藏「仅编辑器内有意义」的命令。

4. **快捷键**  
   `keybindings` 绑定到同一 command id；**快捷键与面板是同一命令的两条入口**。

5. **执行**  
   用户选中一项 → `commands.executeCommand(id, ...args)`  
   扩展可在代码中同样调用，保证行为一致。

要点：**Command Palette 是命令注册表的发现 UI**，不是功能实现本身。

### 2.3 实现层（源码心智，简化）

VS Code 工作台内部（概念上）大致是：

| 概念 | 作用 |
|---|---|
| **QuickInput / QuickPick** | 通用浮层：输入、过滤、高亮、列表虚拟化、键盘（↑↓ Enter Esc） |
| **QuickAccess / Picker providers** | 按 prefix 注册不同数据源（files / commands / symbols） |
| **CommandService** | 命令注册表 + 执行 + telemetry |
| **KeybindingService** | 快捷键 → command id |
| **When clause** | 上下文（有没有 active editor、语言 id、配置项）过滤可见性 |

Quick Open（⌘P）走 **文件索引 / 最近打开 / Git 忽略规则**；  
Command Palette（⇧⌘P）走 **CommandService 中所有「面向用户」的命令**，按标题模糊匹配（通常含 category）。

### 2.4 UX 细节（对标时要保留的）

- 居中（或可拖）浮层，窄宽适中，列表可滚动。
- 输入即过滤；命令侧常按 **fuzzy match**（标题 / 类别）。
- **MRU（最近使用）**：空查询时展示最近命令 / 最近文件。
- 键盘优先：↑↓ 选择、Enter 执行、Esc 关闭；列表循环可选。
- 结果分组（文件 / 命令 / 内容命中）。
- 无结果时空态文案；无工作区时明确提示。

---

## 3. Agentero 现状

### 3.1 已落地

| 能力 | 位置 | 说明 |
|---|---|---|
| 全局浮层 UI | `src/components/layout/command-palette.tsx` | shadcn `CommandDialog` + `CommandInput` + `CommandList` |
| 快捷键 | `shortcuts.ts` → `commandPalette` | **⌘K** 与 **⌘P**（`App.tsx` 另绑 p）打开**同一面板** |
| 论文 quick-open | 前端内存 `libraryPapers` | 标题 / 作者 / id 即时过滤，无 RPC |
| 全文搜索 | Host `vault_search` | walk `*.md`，AND 分词，片段 + 行号 |
| 打开目标 | `onOpenPaper` / `onOpenVaultRel` | 命中 `papers/` 打开论文，否则打开笔记路径 |

**语义上：当前面板 ≈ VS Code 的 ⌘P（资源导航）+ 内容搜索**，**还不是** ⇧⌘P 的「执行任意命令」。

### 3.2 与 VS Code 的差距

| 维度 | VS Code | Agentero 现状 |
|---|---|---|
| 快捷键分工 | ⌘P 文件 / ⇧⌘P 命令 | ⌘K ≈ ⌘P，**无 ⇧⌘P** |
| 前缀模式 | `>` `@` `#` `:` `?` | 无 |
| 命令注册表 | 全局 CommandService + 扩展贡献 | 无统一命令模型；动作散落 App / 菜单 / 快捷键 |
| 执行命令 | 面板即执行器 | 面板只 **打开资源** |
| 最近项 | 最近文件 / 最近命令 | 空查询 ≈ 论文列表前 N 条（非真实 MRU） |
| 上下文 when | 丰富 | 仅「有无 Vault」空态 |
| 符号 / 行号 | 一等能力 | 无 |

### 3.3 现有可复用资产

- **UI 壳**：`CommandDialog`（cmdk）已够用，不必另起浮层框架。  
- **搜索后端**：`vault_search` 可继续服务「内容」分组。  
- **快捷键系统**：`shortcuts.ts` + `useAppShortcuts` 可扩展 `commandPalette` / 新 id。  
- **动作入口**：`App.tsx` 中大量 handler（开 Vault、Rescan、切换侧栏、禅模式…）可 **登记为命令** 后被面板调用。

---

## 4. Agentero 目标架构（建议）

### 4.1 产品语义（对齐 VS Code，贴合科研）

| 入口 | 快捷键（建议） | 默认行为 |
|---|---|---|
| **快速打开** | **⌘P**（保留 **⌘K** 为别名） | 论文 / 笔记路径 / 打开中的 tab；可带全文内容组 |
| **命令面板** | **⇧⌘P**（或 `>` 前缀） | 执行应用命令：设置、侧栏、Library Rescan、新建笔记… |
| **统一壳** | 同一 `CommandPalette` 组件 | 根据 **mode** 或 **query 前缀** 切换数据源 |

推荐默认策略（与 VS Code 一致）：

- 打开时若快捷键是 ⇧⌘P → 初始 query = `>` 或 `mode: "commands"`。  
- 打开时若 ⌘P / ⌘K → `mode: "go"`，无前缀。  
- 用户在 go 模式下键入 `>` → 切到命令模式（可选，Phase 2）。

### 4.2 逻辑分层

```text
┌─────────────────────────────────────────┐
│  UI: CommandPalette (CommandDialog)     │
│  - input / list / groups / empty        │
└──────────────────┬──────────────────────┘
                   │ query + mode
┌──────────────────▼──────────────────────┐
│  Providers（可插拔）                      │
│  - GoProvider: papers / notes / tabs    │
│  - ContentProvider: vault_search        │
│  - CommandsProvider: command registry   │
│  - (later) HelpProvider: `?`            │
└──────────────────┬──────────────────────┘
                   │ onSelect item
┌──────────────────▼──────────────────────┐
│  CommandRegistry / handlers             │
│  - openPaper / openPath / runAction     │
└─────────────────────────────────────────┘
```

### 4.3 命令注册表（核心，对应 VS Code CommandService）

新建轻量模块（建议 `src/lib/commands/`）：

```ts
type AppCommand = {
  id: string;                    // e.g. "app.openSettings"
  title: string;                 // i18n key or resolved string
  category?: string;             // e.g. "View" / "Vault" / "Paper"
  keywords?: string[];           // 额外模糊匹配
  /** 是否在命令面板显示 */
  when?: () => boolean;          // 有 Vault？桌面？…
  run: () => void | Promise<void>;
};
```

- 启动时（或 `App` mount）注册内置命令：  
  `settings.open`、`sidebar.toggle`、`chat.toggle`、`agent.zen`、`vault.rescan`、`library.focus`、`tab.close`…  
- **快捷键表** 与命令表对齐：理想态是 shortcut id → 同一 `AppCommand.id`，避免「菜单走一条路径、面板走另一条」。  
- 命令面板只负责：过滤 + 调用 `run()`。

一期不必做扩展贡献（package.json）；内置注册即可。预留 `registerCommand` API 给后续插件/CLI 桥。

### 4.4 结果项统一模型

```ts
type PaletteItem =
  | { kind: "paper"; paperPath: string; title: string; subtitle?: string }
  | { kind: "file"; path: string; title: string; snippet?: string; line?: number }
  | { kind: "command"; commandId: string; title: string; category?: string }
  | { kind: "tab"; tabId: string; title: string };
```

UI 按 `kind` 分组渲染（Papers / Files / Commands / Open tabs）。

### 4.5 过滤与排序

| 模式 | 过滤 | 排序建议 |
|---|---|---|
| Go · 论文 | 内存多词 AND（现状） | 标题前缀命中 > 作者 > id；空查询 = 最近打开 paper（tab / 访问 MRU） |
| Go · 内容 | `vault_search` 去抖 | 沿用 Host score |
| Commands | 客户端 fuzzy（title + category + keywords） | 最近执行命令优先，其次字母 |

### 4.6 无 Vault / 其它弹层打开时

- **无 Vault**：Go 模式可展示「打开 Vault / 创建 Vault」类命令；内容搜索禁用。  
- **其它弹层**（设置 / 快捷键清单等）：与 Dialog 共用 [`overlay-stack`](../frontend/ui.md)（§3.0）。`⌘P`/`⌘K`/`⇧⌘P` 自身可再按关闭；`Esc` / `⌘W` 关最顶层。有弹层时 `whenSettingsClosed` 门控挡住 Vault 树类快捷键，但开关类（设置 / 面板 / 清单）仍可匹配。

---

## 5. 分期实现（建议）

### Phase A — 快捷键与双模式壳（小改、高感知） — ✅ 已落地

1. 拆分快捷键：  
   - `quickOpen`：⌘P（+ 保留 ⌘K 别名）  
   - `commandPalette`：⇧⌘P  
2. `CommandPalette` 接收 `initialMode: "go" | "commands"`；`>` 前缀切命令模式。  
3. Commands 模式：App 注入 `AppCommand[]`，客户端 fuzzy，Enter 执行。  
4. Go 模式：论文 quick-open + `vault_search`。  
5. i18n / 快捷键速查表更新；弹层注册 `command-palette`。

**验收**：⇧⌘P 能执行「打开设置 / 切换侧栏」等命令；⌘P 行为与今日一致或更好。

### Phase B — 命令注册表与 MRU

1. `src/lib/commands/registry.ts` + 内置命令迁移（从 App 抽出绑定）。  
2. localStorage：`command-mru`、`paper-mru`。  
3. 空查询：最近论文 + 最近命令。  
4. 可选前缀：`>` 强制命令模式。

### Phase C — 资源面增强

1. 打开中的 **tabs** 分组。  
2. 文件树路径 quick-open（非仅 catalog paper）。  
3. 内容命中跳转到 **行号**（编辑器 `scrollToLine`，若已有）。  
4. FTS5 替换 walk（性能）。

### Phase D — 可选 VS Code 级前缀

1. `?` 帮助。  
2. `:` 当前文档跳行（PDF 页码 / Markdown 行）。  
3. 符号（依赖大纲 / wiki 标题索引，非必须）。

---

## 6. UI / 交互规格（Agentero）

| 项 | 规格 |
|---|---|
| 形态 | 居中 `CommandDialog`，`max-w-xl` 左右 |
| 输入 | 单行；placeholder 随 mode 变化 |
| 列表 | 分组标题；图标 + 主标题 + 次要信息 |
| 键盘 | ↑↓ Enter Esc；cmdk `loop` |
| 点击遮罩 | 关闭 |
| 无障碍 | Dialog title/description；选项可聚焦 |
| i18n | 全部 `t()`；en 源语言 |
| 视觉 | 简约；无常驻说明文案；失败 Toast |

**Commands 列表示例（第一批）**

- Settings: Open / Close  
- View: Toggle Sidebar / Toggle Chat / Agent Zen  
- Vault: Open… / Create… / Reveal in Finder / Open in Terminal  
- Library: Focus full library / Rescan  
- Tab: Close / Next / Previous  
- Paper: Magic wand  

（标题走 i18n；`category` 用于显示 `Vault: Rescan` 式前缀。）

---

## 7. 数据与性能

| 数据 | 策略 |
|---|---|
| 论文 | 已有内存 `libraryPapers`，O(n) 可接受至数千篇 |
| Markdown 正文 | 现状 walk；大库卡顿时上 FTS5 或增量索引（roadmap 已记） |
| 命令 | 数十～百条，纯前端过滤 |
| 打开频率 | 面板 mount 常驻或随 open 挂载均可；注意勿在每次 keystroke 重建大列表 |

隐私：搜索 query 仅本地；不写遥测。

---

## 8. 风险与决策

| 风险 | 对策 |
|---|---|
| ⌘P 与浏览器/系统冲突 | 桌面 Tauri 捕获；文档标明 Windows 为 Ctrl |
| 与现有 ⌘K 习惯冲突 | 保留 ⌘K = Quick Open 别名；⇧⌘P 专用于命令 |
| App 过大、handler 难抽 | Phase A 用「面板 props 注入 commands 数组」；Phase B 再抽 registry |
| 命令与菜单不同步 | 命令 `run` 必须调用与菜单相同的 App handler |
| 过度对标 VS Code 符号体系 | 科研场景优先 paper/命令；符号/行号放 Phase D |

**明确不做（首版）**

- 扩展贡献点 / 第三方插件注册。  
- 完整 when 语言（用简单 predicate 即可）。  
- 工作区符号索引、语言服务器。  
- 面板内嵌预览第二栏。

---

## 9. 建议的文件布局

```text
src/lib/commands/
  types.ts          # AppCommand, PaletteItem
  registry.ts       # register / list / execute
  builtins.ts       # 内置命令 id 与工厂（注入 deps）
src/components/layout/
  command-palette.tsx   # UI；按 mode 组合 providers
  # 可选拆分：
  # command-palette-go.tsx / command-palette-commands.tsx
docs/development/command-palette.md  # 本文
```

Host：**命令面板本身无需新 RPC**；内容搜索继续 `vault_search`。若未来「命令」触发 Host-only 动作，仍走既有 Tauri commands。

---

## 10. 验收清单（设计级）

- [ ] 用户能说明 ⌘P 与 ⇧⌘P 的差异，并在 Agentero 中得到对应体验。  
- [ ] 无 Vault 时面板不崩溃，并给出可操作入口。  
- [ ] 至少 8 条命令可通过 ⇧⌘P 执行，且与菜单/快捷键结果一致。  
- [ ] Go 模式论文 quick-open + 内容搜索行为不回退。  
- [ ] 全部文案 i18n；快捷键进 Keyboard 速查。  
- [ ] 文档与 `roadmap` / `todo` 勾选同步。

---

## 11. 结论

1. **VS Code**：同一 Quick Input 壳 + 多 Provider；**命令**经全局注册表暴露给 ⇧⌘P；**文件**经 Quick Open 给 ⌘P；前缀切换语义。  
2. **Agentero**：已有 **Go 向** 命令面板（⌘K/⌘P）与 `vault_search`；缺的是 **命令注册表 + ⇧⌘P 模式**。  
3. **落地路径**：先双模式壳与内置命令列表（Phase A），再 registry/MRU（B），再资源与前缀增强（C/D）。  

下一实现任务建议从 **Phase A** 开工：扩展 `CommandPalette` + `shortcuts` + 注入首批 `AppCommand`。
