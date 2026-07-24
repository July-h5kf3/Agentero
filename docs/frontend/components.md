# AI Elements 组件目录

> Agentero 的 Chat / Agent / 文件树等 AI UI **统一使用 [AI Elements](https://elements.ai-sdk.dev/)**。  
> 本文档按 **[elements.ai-sdk.dev/components](https://elements.ai-sdk.dev/components)** 的组件目录整理，并标注 Agentero 安装与使用状态。

相关：`docs/frontend/ui.md` · `docs/development/technical-plan.md` · 官网 [Docs](https://elements.ai-sdk.dev/docs) · [Setup](https://elements.ai-sdk.dev/docs/setup)

---

## 1. 约定（Agentero）

| 项 | 说明 |
|---|---|
| 落盘 | `src/components/ai-elements/<name>.tsx` |
| 安装 | `pnpm dlx shadcn@latest add https://elements.ai-sdk.dev/api/registry/<name>.json -y -o` |
| 通用 UI | 继续 shadcn `src/components/ui/`（AI Elements 依赖其 peers） |
| 传输层 | Agentero **ACP Client**（`agent_run_once` + 事件流），**不是**默认 `useChat` |
| 业务壳 | `agent/agent-panel`（Chat；`sidebar`/`zen`：禅模式左侧历史 + 全宽 `Conversation`；无会话数字标签；`hideFromChatHistory` 过滤后台运行；**权限三档** + `agent:permission-request` 对话框；**空态 suggestion → workflow**；Composer **当前论文默认 context** + **`@`（最近路径 / 浅层树 / 下钻子目录；论文标签同 `paperTreeLabelMode`）/ 文件树拖入 → context chip**（展示 paper-name/标题；图标：`context-path-icon` — paper `ScrollText` / 文件夹 `Folder` / 文件按扩展名））、`dialogs/command-palette`（`⌘K`/`⌘P` 论文 quick-open + `vault_search`）、`sidebar/file-tree`（Vault 树 + Library + 魔棒 + paper **Download / Zap** + 多选拖拽 + 折叠快捷键 + 回收站入口；**外部 PDF 拖到 `papers/` 组织夹 → metadata 确认入库**）、`library/import-local-pdf-dialog`（本地 PDF 元数据确认）、`workspace/recycle-bin-view`（中间栏回收站）、`library/papers-library`（catalog 表 + **染色 tags** + **阅读热力 spine** + **Rescan** + 文件夹作用域）、`sidebar/paper-info-panel`（Tags 色盘）、`workspace/tab-workspace`、`wiki/backlinks-panel`、`wiki/graph-panel`、`shell/background-tasks-panel`；`viewer/pdf-viewer`（导航/大纲/查找/平滑划词；批注 **Enter 保存**；划词提问 `hideFromChatHistory`） |
| 全局通知 | shadcn `ui/sonner` + `src/lib/core/notify.ts`（`notifyError` / `notifyWarning`）；右上角操作失败 Toast（见 [`ui.md`](ui.md) §2.1.2） |
| 状态列 | ✅ 已装并接线 · 📦 已装未接线 · — 未安装 |

安装命令中的 `<name>` 与下表 **Registry 名**（URL 路径）一致。

```bash
# 示例：安装 Message
pnpm dlx shadcn@latest add https://elements.ai-sdk.dev/api/registry/message.json -y -o
```

---

## 2. 组件总表（按官网）

官网组件页：`https://elements.ai-sdk.dev/components/<name>`。  
下表按场景分组；**Registry 名** = 安装 URL 与文件名。

### 2.1 对话核心（Chat）

| 组件 | Registry | 说明 | Agentero |
|---|---|---|---|
| [Conversation](https://elements.ai-sdk.dev/components/conversation) | `conversation` | 消息列表容器；贴底滚动、空状态、滚动按钮；`scrollClassName` 接 `agentero-scroll`（禅模式全宽视口、滚动条贴右） | ✅ Chat 列表 |
| [Message](https://elements.ai-sdk.dev/components/message) | `message` | 单条消息：`from`、内容、`MessageResponse`（Streamdown）、操作/分支 | ✅ 用户/助手气泡 |
| [Prompt Input](https://elements.ai-sdk.dev/components/prompt-input) | `prompt-input` | Composer：输入、附件、提交状态、工具槽 | ✅ 底部输入 |
| [Sources](https://elements.ai-sdk.dev/components/sources) | `sources` | 折叠展示引用来源列表 | ✅ Vault 路径引用 |
| [Attachments](https://elements.ai-sdk.dev/components/attachments) | `attachments` | 附件网格/列表/预览 | 📦（Prompt 已支持，ACP 暂不传文件；Vault 路径上下文用 Composer context chip，见 ui.md） |
| [Suggestion](https://elements.ai-sdk.dev/components/suggestion) | `suggestion` | 快捷建议 chip | ✅ 空态：Summarize / Ask library / List claims / Draft Related Work → `summary`/`qa`/`related_work` |
| [Shimmer](https://elements.ai-sdk.dev/components/shimmer) | `shimmer` | 加载占位闪光文案 | ✅ 等待正文 |
| [Inline Citation](https://elements.ai-sdk.dev/components/inline-citation) | `inline-citation` | 正文内可悬停引用 | ✅ 回复末尾徽章 + Hover 轮播 |
| [Open in Chat](https://elements.ai-sdk.dev/components/open-in-chat) | `open-in-chat` | 「在 Chat 中打开」 | — 非 Chat 栏入口 |

### 2.2 Agent / 推理 / 工具

| 组件 | Registry | 说明 | Agentero |
|---|---|---|---|
| [Reasoning](https://elements.ai-sdk.dev/components/reasoning) | `reasoning` | 思考过程折叠展示 | ✅ ACP `thought` 流 |
| [Chain of Thought](https://elements.ai-sdk.dev/components/chain-of-thought) | `chain-of-thought` | 思维链步骤 | 📦（Reasoning + Tool 已覆盖） |
| [Tool](https://elements.ai-sdk.dev/components/tool) | `tool` | 工具调用：状态、输入、输出 | ✅ `agent:tool` |
| [Confirmation](https://elements.ai-sdk.dev/components/confirmation) | `confirmation` | 人在环确认 | 📦（Host 仍自动选第一项） |
| [Task](https://elements.ai-sdk.dev/components/task) | `task` | 任务列表 / 进度折叠 | ✅ 工具调用摘要 |
| [Plan](https://elements.ai-sdk.dev/components/plan) | `plan` | 计划步骤展示 | ✅ `agent:plan` |
| [Queue](https://elements.ai-sdk.dev/components/queue) | `queue` | 消息队列、待办 | 📦 |
| [Checkpoint](https://elements.ai-sdk.dev/components/checkpoint) | `checkpoint` | 检查点 / 里程碑 | ✅ 系统行 |
| [Agent](https://elements.ai-sdk.dev/components/agent) | `agent` | Agent 身份 UI | — |
| [Context](https://elements.ai-sdk.dev/components/context) | `context` | 上下文窗口/用量 | ✅ `agent:usage` |
| [Persona](https://elements.ai-sdk.dev/components/persona) | `persona` | Rive 角色动画 | 📦（依赖 WebGL/外链，未接） |
| [Model Selector](https://elements.ai-sdk.dev/components/model-selector) | `model-selector` | 模型选择 | ✅ 输入框旁；列表来自 ACP session config |

> Agentero BYOA：模型列表与能力由 **ACP Agent** 通过 session `config_options`（category: model）上报；Agentero 不托管 API Key。Header 切换的是 **ACP 后端**，输入框切换的是 **该 Agent 提供的 model**。

### 2.3 代码与工程

| 组件 | Registry | 说明 | Agentero |
|---|---|---|---|
| [Code Block](https://elements.ai-sdk.dev/components/code-block) | `code-block` | 代码块、复制、语言切换 | 📦（`MessageResponse` 内已有 streamdown 代码） |
| [File Tree](https://elements.ai-sdk.dev/components/file-tree) | `file-tree` | 可展开文件树 | ✅ 侧栏 Vault 树 |
| [Terminal](https://elements.ai-sdk.dev/components/terminal) | `terminal` | 终端输出样式 | — |
| [Stack Trace](https://elements.ai-sdk.dev/components/stack-trace) | `stack-trace` | 堆栈展示 | — |
| [Test Results](https://elements.ai-sdk.dev/components/test-results) | `test-results` | 测试结果 | — |
| [Snippet](https://elements.ai-sdk.dev/components/snippet) | `snippet` | 短代码片段 | — |
| [Commit](https://elements.ai-sdk.dev/components/commit) | `commit` | Commit 信息展示 | — |
| [Package Info](https://elements.ai-sdk.dev/components/package-info) | `package-info` | 包信息 | — |
| [Schema Display](https://elements.ai-sdk.dev/components/schema-display) | `schema-display` | Schema 结构展示 | — |
| [Environment Variables](https://elements.ai-sdk.dev/components/environment-variables) | `environment-variables` | 环境变量展示 | — |

### 2.4 预览 / Artifact / 沙箱

| 组件 | Registry | 说明 | Agentero |
|---|---|---|---|
| [Web Preview](https://elements.ai-sdk.dev/components/web-preview) | `web-preview` | URL / 网页预览框 | — |
| [Artifact](https://elements.ai-sdk.dev/components/artifact) | `artifact` | 生成物（文档/代码等）容器 | — |
| [Sandbox](https://elements.ai-sdk.dev/components/sandbox) | `sandbox` | 沙箱运行环境 UI | — |
| [JSX Preview](https://elements.ai-sdk.dev/components/jsx-preview) | `jsx-preview` | JSX 实时预览 | — |
| [Image](https://elements.ai-sdk.dev/components/image) | `image` | 图片展示 | — |

### 2.5 语音 / 音频

| 组件 | Registry | 说明 | Agentero |
|---|---|---|---|
| [Speech Input](https://elements.ai-sdk.dev/components/speech-input) | `speech-input` | 语音输入 | — |
| [Mic Selector](https://elements.ai-sdk.dev/components/mic-selector) | `mic-selector` | 麦克风设备选择 | — |
| [Voice Selector](https://elements.ai-sdk.dev/components/voice-selector) | `voice-selector` | 语音/音色选择 | — |
| [Audio Player](https://elements.ai-sdk.dev/components/audio-player) | `audio-player` | 音频播放 | — |
| [Transcription](https://elements.ai-sdk.dev/components/transcription) | `transcription` | 转写文本 | — |

### 2.6 图 / 工作流画布

| 组件 | Registry | 说明 | Agentero |
|---|---|---|---|
| [Canvas](https://elements.ai-sdk.dev/components/canvas) | `canvas` | 画布根容器 | — |
| [Node](https://elements.ai-sdk.dev/components/node) | `node` | 图节点 | — |
| [Edge](https://elements.ai-sdk.dev/components/edge) | `edge` | 边 | — |
| [Connection](https://elements.ai-sdk.dev/components/connection) | `connection` | 连接线/连线交互 | — |
| [Controls](https://elements.ai-sdk.dev/components/controls) | `controls` | 画布控件 | — |
| [Panel](https://elements.ai-sdk.dev/components/panel) | `panel` | 画布面板 | — |
| [Toolbar](https://elements.ai-sdk.dev/components/toolbar) | `toolbar` | 画布工具栏 | — |

---

## 3. Agentero 已安装明细

路径：`src/components/ai-elements/`

| 文件 | 主要导出 | 接线位置 |
|---|---|---|
| `conversation.tsx` | 列表 / 空态 / 贴底 | `agent/agent-panel` |
| `message.tsx` | Message + Actions / Response | `agent/agent-panel` |
| `prompt-input.tsx` | Composer；**IME 组字中 Enter 不提交**（见 [`../bug_fix/ime-composition-enter-submit.md`](../bug_fix/ime-composition-enter-submit.md)） | `agent/agent-panel` |
| `sources.tsx` | Vault 引用 | `agent/agent-panel` |
| `reasoning.tsx` | Thought 折叠 | `agent/agent-panel` |
| `tool.tsx` | ACP tool 调用 | `agent/agent-panel` |
| `plan.tsx` | ACP plan | `agent/agent-panel` |
| `task.tsx` | 工具摘要 | `agent/agent-panel` |
| `suggestion.tsx` / `shimmer.tsx` | 建议 chip / 加载 | `agent/agent-panel` |
| `checkpoint.tsx` | 系统切换行 | `agent/agent-panel` |
| `context.tsx` | Token 用量 | `agent/agent-panel` header |
| `file-tree.tsx` | Vault 树 | `sidebar/file-tree` |
| `inline-citation.tsx` | 正文旁引用徽章 | `agent/agent-panel` |
| 其它已装未接 | chain-of-thought, queue, confirmation, persona, attachments, code-block | 按需扩展 |

---

## 4. Agentero 集成要点

### 4.1 Chat 组合（已接线）

```text
Conversation
  ConversationContent
    Message from="user" | "assistant"
      MessageContent
        Reasoning → ReasoningTrigger + ReasoningContent   // ACP thought
        MessageResponse                                    // ACP message
    Sources（可选）
  ConversationScrollButton
PromptInput
  PromptInputBody → PromptInputTextarea
  PromptInputFooter → PromptInputTools + PromptInputSubmit
```

### 4.2 流式事件映射

| ACP 事件 | UI |
|---|---|
| 发送成功 | 追加 user 行 + streaming assistant 行 |
| `agent:stream` `kind=thought` | 追加到最后一条 agent 的 `reasoning`，`Reasoning isStreaming` |
| `agent:stream` `kind=message`（默认） | 追加到最后一条 agent 的正文 `MessageResponse` |
| `agent:completed` | 定稿正文 / reasoning + `sources` |
| `agent:failed` | 去掉未完成 streaming，追加 error |

监听需可取消，避免 Strict Mode 双挂载导致重复气泡。

### 4.3 传输边界

| 能力 | Agentero |
|---|---|
| AI Elements UI | ✅ |
| `useChat` / HTTP DefaultChatTransport | ❌ 默认不用 |
| ACP `runOnce` + events | ✅ |

### 4.4 推荐 import

```ts
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
} from "@/components/ai-elements/file-tree";
```

---

## 5. 扩展新组件

1. 在 [组件目录](https://elements.ai-sdk.dev/components) 确认名称与文档。  
2. `pnpm dlx shadcn@latest add https://elements.ai-sdk.dev/api/registry/<name>.json -y -o`  
3. 仅在业务域（`agent/`、`sidebar/`、`workspace/` 等）接线；不复制平行实现。  
4. 更新本文 **§2 状态列** 与 **§3**。  
5. 传输仍走 ACP，除非产品明确改为 HTTP Agent。

---

## 6. 仓库目录（非 AI Elements）

业务组件按**域**顶层分目录（勿再挂 `layout/` 大杂烩；`library` 顶层，不挂 `workspace`；双链用 `wiki/` 而非 `feature`）：

```text
src/components/
├── ui/                  # shadcn only
├── ai-elements/         # registry only
├── icons/               # 品牌图标（勿并 ui）
├── shell/               # 真壳 + 共享 chrome
│   ├── workspace-header.tsx
│   ├── layout-menu.tsx
│   ├── window-controls.tsx
│   ├── pane-header.tsx
│   ├── resizable.tsx
│   ├── vault-welcome.tsx
│   ├── background-tasks-panel.tsx
│   └── error-boundary.tsx
├── sidebar/             # 左栏导航
│   ├── file-tree.tsx
│   ├── paper-info-panel.tsx
│   └── vault-sidebar-header.tsx
├── wiki/                # 双链
│   ├── backlinks-panel.tsx
│   └── graph-panel.tsx
├── agent/               # Chat 业务壳（编排 + 子 UI + 运行时 hook）
│   ├── agent-panel.tsx          # 薄编排（sidebar / zen）
│   ├── use-agent-panel.ts       # 注册表 / 流式 / 历史 / send / 上下文
│   ├── chat-transcript.tsx      # Conversation + 消息行
│   ├── agent-composer.tsx       # PromptInput + @/$ + model/effort
│   ├── agent-history.tsx        # 侧栏历史 popover + 禅模式左轨
│   ├── agent-switcher.tsx
│   ├── agent-permission-dialog.tsx
│   ├── context-path-icon.tsx
│   └── types.ts
├── workspace/           # dockview 中间栏
│   ├── tab-workspace.tsx
│   ├── tab-center.tsx
│   └── recycle-bin-view.tsx
├── library/             # 论文域（顶层）
│   ├── papers-library.tsx
│   ├── paper-tag-chip.tsx
│   ├── reading-heatmap.tsx
│   ├── import-local-pdf-dialog.tsx
│   └── move-papers-dialog.tsx
├── editor/              # Plate Markdown 编辑器
├── viewer/              # PDF / HTML / 图片
├── settings/
│   ├── settings-window.tsx
│   └── settings-window-root.tsx
└── dialogs/             # 仅全局 / 跨域
    ├── command-palette.tsx
    ├── remote-vault-dialog.tsx
    └── zotero-migrate-dialog.tsx
```

- **Plate**（`editor/`）：笔记 WYSIWYG，不是 AI Elements。  
  - `markdown-editor.tsx`：防抖保存、`ImagePlugin.uploadImage` → `./assets/`、引用计数 GC。  
  - `image-node.tsx`：相对路径 `blob:` 预览；选中显示 `![alt](url)` 源码。  
  - `editor-toolbar.tsx`：格式按钮 +「插入图片」。  
  - `src/lib/markdown/image.ts`：路径 / 落盘 / GC 工具（单测 `test/markdown-image.test.ts`）。  
- **禁止**把 Chat 塞进 `ui/` 或与 shadcn Message/Bubble 混用。

---

## 7. 参考

- [AI Elements](https://elements.ai-sdk.dev/)  
- [Components](https://elements.ai-sdk.dev/components)  
- [Docs / Setup](https://elements.ai-sdk.dev/docs/setup)  
- [Conversation](https://elements.ai-sdk.dev/components/conversation) · [Message](https://elements.ai-sdk.dev/components/message) · [Prompt Input](https://elements.ai-sdk.dev/components/prompt-input) · [Sources](https://elements.ai-sdk.dev/components/sources) · [File Tree](https://elements.ai-sdk.dev/components/file-tree)  
- 业务：`src/components/agent/`（`agent-panel` + `use-agent-panel` 等）· `src/components/sidebar/file-tree.tsx`
