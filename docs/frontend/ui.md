# Motif UI 规范

## 1. 主题与设计系统

- **基础组件**：以 [shadcn/ui](https://ui.shadcn.com/) 为规范（`components.json` → `style: radix-nova`，`baseColor: neutral`，CSS variables）。
- **主题**：tweakcn **modern-minimal**（覆盖 token，不另起皮肤）：
  ```bash
  pnpm dlx shadcn@latest add https://tweakcn.com/r/themes/modern-minimal.json
  ```
- **Chat / Agent / 文件树 AI UI**：以 [**AI Elements**](https://elements.ai-sdk.dev/) 为规范（完整约定见 **`docs/frontend/components.md`**）：
  - 落盘：`src/components/ai-elements/`（`conversation`、`message`、`prompt-input`、`sources`、`file-tree` 等）
  - 安装：`pnpm dlx shadcn@latest add https://elements.ai-sdk.dev/api/registry/<name>.json -y -o`
  - 主题 **不单独配置**：继续读 shadcn CSS token，随 System / Light / Dark。
  - 传输层是 Motif **ACP Client**（`agent_run_once` + 事件流），**不是** Vercel AI SDK `useChat`。
  - **禁止**用自研 `src/components/ai/*` 或官方 `ui/message`+`bubble` 搭新 Chat。
- 视觉原则：**尽量简约，减少不必要的元素**。
- 外观跟随 **System / Light / Dark**（`next-themes`，设置 → Appearance）。

## 2. 文案 vs 图标

| 场景 | 规则 |
|---|---|
| 工具栏、侧边栏操作、可识别的动作 | **优先用图标**，不要用长按钮文案 |
| 图标含义 | 必须配 `aria-label`；悬停用 **Tooltip** 显示短标签 |
| 页面主标题、空状态、错误、表单字段 | 可用文字；错误仅在发生时出现 |
| 解释性说明文案 | 默认不展示；避免常驻帮助段落挤占空间 |

### 2.1 侧边栏文件树

- 树 UI：**AI Elements** `FileTree`（业务包装：`src/components/layout/file-tree.tsx`；约定见 `docs/frontend/components.md`）。
- 顶栏单行：左侧 Vault 名称（可截断）+ 右侧 **纯图标操作**。
- 动作映射（Lucide）：
  - 打开 Vault → `FolderSearch`（⌘O）
  - 刷新树 → `RefreshCw`（⌘R）
  - 切回 Demo → `Sparkles`（仅非 demo）
- **设置入口不在侧边栏**：使用 macOS 顶部菜单 **motif → Settings…**（`⌘,`），不放齿轮图标。
- **不要**使用「Open vault… / Refresh」等文字按钮。

## 3. 布局

- 工作台默认 **三栏**：文件树 + 中间内容（WYSIWYG Markdown 编辑器）+ 右侧栏（Agent / Backlinks）。查看论文 PDF/HTML 时，右侧显示可编辑的 **Notes**（该篇 `NOTES.md`）。
- **⌘L** 显示 / 隐藏右侧栏；右侧栏入口为 **Agent** 与 **Backlinks**。
- Backlinks 入口内采用上下分区：上方反链列表，下方 Graph。Graph 不再是独立顶层 tab。
- 各栏 header 等高：统一 `h-10`（`PaneHeader` / `PANE_HEADER_CLASS`），水平对齐；错误提示等放在 header 下方，不撑高标题栏。
- 边距、分割线保持轻量；控件密度偏紧凑（icon-xs / icon-sm）。
- **面板分隔（sash）**：对齐 VS Code / Cursor——默认 **1px** 细线，hover / 拖拽时略提亮；可点区域略宽但视觉不占粗条。实现见 `src/components/layout/resizable.tsx`。
- **独立滚动**：侧边栏 / 中间编辑器 / 右侧 Notes **各自**滚动，顶栏固定；禁止整页连带滚动。内容区使用 `.motif-scroll`（细滚动条、半透明、`overscroll-behavior: contain`）。
- **中间栏视图切换**（纯图标 + Tooltip）：Markdown · PDF · HTML（`ViewModeToggle`）。
  - Markdown：**所见即所得富文本编辑**（Plate）。直接输入 Markdown 语法即时渲染（标题、列表、任务列表、代码块、表格、公式、`[[wikilink]]` 等）；无独立「预览」栏。
  - **保存**：编辑防抖后 **自动写回** 磁盘 `.md`，`⌘S` 立即保存；有未保存更改时 pane header 显示小圆点。未发生真实编辑不会写盘（打开文件不触发保存）。
  - **双链**：`[[目标#标题|别名]]` 与 `![[嵌入]]` 由 `@flowershow/remark-wiki-link` 解析并 **无损回写**；渲染仍复用既有 exists/missing 样式与点击导航。
  - **YAML frontmatter** 按字节原样保留（不经 Plate 往返）；注意 Plate 会归一化部分 Markdown 风格（列表 `-`→`*`、斜体 `*`→`_`），内容语义不变。
  - PDF / HTML：**只读 `metadata.json` 的远程 `pdf_url` / `html_url`**（**不下载、不读本地 pdf/html 文件**）
  - arXiv 推荐写入：
    - `pdf_url`: `https://arxiv.org/pdf/{id}`
    - `html_url`: `https://arxiv.org/html/{id}`
    - `source_url`: `https://arxiv.org/abs/{id}`
  - 若只有 `arxiv_id`，用 `src/lib/arxiv.ts` 推导远程 URL
  - PDF：PDF.js 按 URL 流式渲染；HTML：独立 iframe 打开远程页
  - **PDF/HTML 时右侧自动加载该篇 `NOTES.md`**（可编辑，自动保存 / `⌘S`）
  - **HTML 沙盒**：独立 `<iframe>`；arXiv 允许 scripts（对方 origin）；布局铺满中间栏
- 无障碍：图标按钮必须有可访问名称；焦点环使用主题 `ring`。

### 3.1 快捷键（对齐 macOS / Apple HIG 习惯）

显示使用 Apple 符号：`⌘ ⌥ ⇧ ⌃`。Windows / Linux 上将 `⌘` 映射为 `Ctrl`。

| 快捷键 | 作用 | 说明 |
|---|---|---|
| `⌘,` | 打开 / 关闭 Settings | 系统级 Preferences 约定 |
| `Esc` | 关闭 Settings | 关闭 sheet / 对话框 |
| `⌘O` | Open vault… | 打开文档/文件夹 |
| `⌘R` | 刷新文件树 | 刷新当前视图 |
| `⌥⌘S` | 显示 / 隐藏侧边栏 | 对齐 Mail / Preview 等侧边栏约定 |
| `⌘B` | 显示 / 隐藏侧边栏（别名） | 兼容常见生产力应用 |
| `⌘1` | 聚焦侧边栏 | 分区焦点（Mail 等） |
| `⌘2` | 聚焦编辑器 | |
| `⌘3` | 聚焦 Notes（论文 PDF/HTML 视图时） | |
| `⌘L` | 显示 / 隐藏右侧栏 | Agent / Backlinks（含 Graph） |

- 在编辑区聚焦时同样生效；涉及浏览器保留键时需 `preventDefault`。
- 快捷键清单以设置页 **Keyboard** 为准，实现见 `src/lib/shortcuts.ts`。

### 3.2 Agent 右侧栏（AI Elements）

| 要求 | 说明 |
|---|---|
| 入口 | `⌘L`、标题栏右侧 Agent 图标、菜单 **View → Toggle Chat** |
| 结构 | 会话标签 · Agent 选择 / 新建 / 历史操作 + 消息列表 + Composer |
| 消息组件 | AI Elements `Message` + `MessageContent` + `MessageResponse`（`from="user" \| "assistant"`） |
| 列表滚动 | `Conversation` + `use-stick-to-bottom`（`ConversationScrollButton`） |
| 输入 | 单层 Composer：当前文件、`@` 文件提及和 `$` 本机技能显示为可移除 context chip；候选列表支持 `↑` / `↓`、`Enter`；Agent 输出期间仍可编辑下一条输入，`Esc` 取消当前 ACP 运行；`/` 文本原样透传给 ACP Agent；YOLO 默认关闭；`↵` 发送 / `⇧↵` 换行 |
| 业务壳 | `src/components/layout/agent-panel.tsx`：注册表、流式事件、默认 Agent |
| Sources | `ai-elements/sources`：Vault 相对路径列表 |
| 不内置 | 模型 Key、Agent 二进制（BYOA） |
| 规范文档 | **`docs/frontend/components.md`** |

**消息树（AI Elements；不带头像）**

```text
Conversation
  └── ConversationContent
        ├── Message from="user" → MessageContent → MessageResponse
        └── Message from="assistant" → MessageContent
              ├── Reasoning（ACP thought，可选）
              ├── MessageResponse
              └── Sources（可选）
PromptInput → Body / Footer / Submit
```

**Agent 切换**：点击 Composer 上方的 Agent 图标打开下拉，列表来自 catalog + 注册表；选择后设为默认并用于后续 `runOnce`。

**会话标签**：运行中的 Agent session 不会锁定标签栏。用户可随时切换并查看其它已打开的会话，也可在新会话中发起独立运行；同一 session 在运行期间保持只读，避免重入。流式消息、工具调用和最终状态仍只写回它们所属的 session。

**上下文提及**：Composer 默认附带当前打开的 Vault 文件；输入 `@` 可按 Vault 内 Markdown 路径筛选并加入 context chip。发送时 Motif 将这些 Vault 相对路径追加到 prompt，并将第一个路径传为 `target`，Agent 仍按自身权限读取文件。

**本机技能**：输入 `$` 可筛选 `~/.agents/skills`、`${CODEX_HOME:-~/.codex}/skills` 和当前 Vault `.agents/skills` 中的 `SKILL.md`。选中后显示为 context chip；发送时 Host 重新解析技能 id、校验文件大小并将内容注入当前 provider 的 prompt。Codex 也会使用这条受限的本机技能注入路径。

**斜杠命令**：Motif 不实现自己的 `/` 命令菜单，输入内容原样传递给当前 provider。Codex 使用 App Server 的 native thread，保持 Codex 自己的命令语义。

**YOLO**：Composer 底栏的 YOLO 开关只作用于下一次运行。默认关闭时，Motif 取消 ACP 的权限请求；开启后自动选择 Agent 给出的第一个权限选项。逐项权限确认需要由保持 ACP 会话的后续实现提供。

**Codex 控件**：只有选中 `codex-acp` 时，底栏才显示 App Server `model/list` 提供的模型与 reasoning effort，以及仅在闪电图标内填充黄色的 Fast toggle。选择在下一次 native turn 中传给 App Server；其他 Agent 不显示也不接收这些偏好。YOLO 按 provider 注册项保存在本机浏览器偏好中。

**Codex 历史**：Motif 会将它创建或继续运行的 native thread id 记录在 Vault 的 `.motif/agent-sessions/codex.json`。历史列表默认只显示这份索引中的会话，避免混入同一 Vault 工作目录下由 Codex CLI、编辑器或其它应用创建的 thread。历史面板的“External”开关仅对 Codex 生效；开启后显示 App Server 返回的全部 Vault-scoped thread。开关偏好按 Codex provider 注册项保存在本机浏览器中。

### 3.3 Backlinks + Graph 右侧栏

| 区域 | 说明 |
|---|---|
| 入口 | 标题栏右侧 Backlinks 图标；若右侧栏关闭，点击后打开并切到 Backlinks |
| 上方 | `BacklinksPanel`：当前文件的反链来源与上下文摘录 |
| 下方 | `GraphPanel`：当前邻域 / 全图切换，节点点击打开对应文件或 paper |
| 布局 | 同一右侧栏内垂直堆叠，Backlinks 约占上方区域，Graph 填充剩余高度 |
| 非目标 | 不再提供独立顶层 Graph tab；避免右侧栏入口过多 |

## 4. 设置窗口（Settings）

参考 **macOS System Settings / 传统 Preferences** 形态，而非多标签网页：

| 要求 | 说明 |
|---|---|
| 入口 | 顶部菜单栏 **motif → Settings…**，或 `⌘,`（不在侧边栏放设置图标） |
| 结构 | 左侧分类导航 + 右侧内容；居中浮层 dialog |
| 分类 | General · Appearance · Agent · Keyboard · Privacy · About |
| 行样式 | 分组卡片（rounded + border）；左标签、右控件；行间细分隔 |
| 控件 | Switch / Select / Input；避免花哨装饰 |
| 关闭 | 右上角 `X`、点遮罩、`Esc`、再次 `⌘,` |
| 文案 | 支持国际化（i18n）：English 与简体中文可切换，English 为源语言与兜底；简短说明可作 footer |

**页面职责**

- **General**：恢复上次 Vault、退出确认等应用行为。
- **Appearance**：主题、**语言（跟随系统 / English / 简体中文）**、编辑字号、行号。
- **Agent**（BYOA，非模型 BYOK 表单）：
  - 总开关。
  - **Common agents** 目录表：名称 + 状态徽章（installed / ACP ready / missing 等）；打开页自动 Probe。
  - 仅保留 **Probe** 文字按钮（无 icon）；无逐行 Probe、无 command/路径/Handshake 详情文案。
  - **Use default** 纯文字（无 icon）。
  - Custom 区：添加任意 ACP command/args。
  - 页脚说明：模型与 API Key 由各 Agent CLI 自行管理，不在 Motif 内填写。
- **Keyboard**：只读快捷键表（按 App / Vault / Navigation 分组）。
- **Privacy**：分析与崩溃上报（默认关，本地优先）。
- **About**：版本与一句话定位。

实现：`src/components/settings-window.tsx`；持久化暂用 `localStorage`（`src/lib/settings.ts`，含 `locale` 偏好）。

## 4.1 国际化（i18n）

- 技术选型：[`react-i18next`](https://react.i18next.com/) + `i18next`，运行时切换，无需重启。
- 语言：English（`en`，源语言与兜底）、简体中文（`zh-CN`）；`locale` 偏好为 `system | en | zh-CN`，`system` 依据 `navigator.language` 解析。
- 词条目录：`src/i18n/locales/<locale>/<namespace>.json`，按功能划分命名空间（`common` `app` `settings` `agent` `sidebar` `viewer` `editor` `shortcuts` `aiElements`）。
- 类型安全：`src/i18n/i18next.d.ts` 依据英文词条推导 `t()` 的 key 类型；新增文案须先在 `en` 词条登记，并同步 `zh-CN`。
- 组件内用 `useTranslation("<ns>")`；跨命名空间用 `t("ns:key")` 前缀，并在 `useTranslation([...])` 中声明相关命名空间。React 之外的模块（如 `lib/`、`error-boundary`）用全局实例 `i18n.t(...)`。
- 数字/货币/日期用活动 locale 格式化（`Intl.*` 传入 `i18n.language`）。
- 原生 macOS 菜单同样本地化：渲染层通过 `set_locale` command 通知 Host 重建菜单（见 `docs/backend/api.md`）。
- 语言切换的联动集中在 `src/App.tsx`：`i18n.changeLanguage`、`document.documentElement.lang`、以及 `set_locale`。

## 5. 组件基线

目录分层（详情 **`docs/frontend/components.md` §0**）：

| 位置 | 职责 |
|---|---|
| `ui/` | shadcn 通用原语 |
| `ai-elements/` | AI Elements |
| `layout/` | 分栏、顶栏、文件树、Chat 面板 |
| `editor/` | Plate 编辑器 + 插件 |
| `viewer/` | PDF / HTML |
| `settings-window.tsx` | 设置窗 |

- 图标：**Lucide React**。
- 优先复用 `Button`（`variant="ghost"` + `size="icon-xs"`）、`Tooltip`、`Switch`、`Select`、`Input`、`DropdownMenu`。
- 参考：[shadcn/ui](https://ui.shadcn.com/) · [AI Elements](https://elements.ai-sdk.dev/) · `docs/frontend/components.md`
