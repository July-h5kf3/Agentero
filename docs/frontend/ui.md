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

- 工作台默认 **三栏**：文件树 + 中间内容 + Preview/Notes。
- **⌘L** 显示 / 隐藏右侧栏；右侧栏入口为 **Agent** 与 **Backlinks**。
- Backlinks 入口内采用上下分区：上方反链列表，下方 Graph。Graph 不再是独立顶层 tab。
- 各栏 header 等高：统一 `h-10`（`PaneHeader` / `PANE_HEADER_CLASS`），水平对齐；错误提示等放在 header 下方，不撑高标题栏。
- 边距、分割线保持轻量；控件密度偏紧凑（icon-xs / icon-sm）。
- **面板分隔（sash）**：对齐 VS Code / Cursor——默认 **1px** 细线，hover / 拖拽时略提亮；可点区域略宽但视觉不占粗条。实现见 `src/components/layout/resizable.tsx`。
- **独立滚动**：侧边栏 / 中间 / Preview **各自**滚动，顶栏固定；禁止整页连带滚动。内容区使用 `.motif-scroll`（细滚动条、半透明、`overscroll-behavior: contain`）。
- **中间栏视图切换**（纯图标 + Tooltip）：Markdown · PDF · HTML（`ViewModeToggle`）。
  - Markdown：源码编辑
  - PDF / HTML：**只读 `metadata.json` 的远程 `pdf_url` / `html_url`**（**不下载、不读本地 pdf/html 文件**）
  - arXiv 推荐写入：
    - `pdf_url`: `https://arxiv.org/pdf/{id}`
    - `html_url`: `https://arxiv.org/html/{id}`
    - `source_url`: `https://arxiv.org/abs/{id}`
  - 若只有 `arxiv_id`，用 `src/lib/arxiv.ts` 推导远程 URL
  - PDF：PDF.js 按 URL 流式渲染；HTML：独立 iframe 打开远程页
  - **PDF/HTML 时右侧自动加载该篇 `NOTES.md`**
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
| `⌘3` | 聚焦预览 | |
| `⌘L` | 显示 / 隐藏右侧栏 | Agent / Backlinks（含 Graph） |

- 在编辑区聚焦时同样生效；涉及浏览器保留键时需 `preventDefault`。
- 快捷键清单以设置页 **Keyboard** 为准，实现见 `src/lib/shortcuts.ts`。

### 3.2 Agent 右侧栏（AI Elements）

| 要求 | 说明 |
|---|---|
| 入口 | `⌘L`、标题栏右侧 Agent 图标、菜单 **View → Toggle Chat** |
| 结构 | Header（标题 · **可点 Agent 名切换 ACP 后端** · 关闭）+ 消息列表 + PromptInput |
| 消息组件 | AI Elements `Message` + `MessageContent` + `MessageResponse`（`from="user" \| "assistant"`） |
| 列表滚动 | `Conversation` + `use-stick-to-bottom`（`ConversationScrollButton`） |
| 输入 | `ai-elements/prompt-input`（↵ 发送 / ⇧↵ 换行） |
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

**Agent 切换**：点击 header 中的 Agent 名称打开下拉，列表来自 catalog + 注册表；选择后设为默认并用于后续 `runOnce`。

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
| 文案 | 英文 UI（与当前应用一致），简短说明可作 footer |

**页面职责**

- **General**：恢复上次 Vault、退出确认等应用行为。
- **Appearance**：主题、编辑字号、行号。
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

实现：`src/components/settings-window.tsx`；持久化暂用 `localStorage`（`src/lib/settings.ts`）。

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
