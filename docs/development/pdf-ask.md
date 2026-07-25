# PDF 划词（Selection：高亮 / 批注 / 提问 / 翻译）

> 状态：**MVP 已落地**（EmbedPDF / PDFium + Vault 文件 IO）。
>
> **引擎**：[@embedpdf](https://www.embedpdf.com)（PDFium / WASM）。组件：`src/components/viewer/embed/pdf-viewer.tsx`；共享引擎 `engine-provider.tsx`（`main.tsx` 挂载）。
> **高亮 / 批注** = EmbedPDF 注解，落盘 `papers/<id>/marks/annotations.json`（批注 = `contents` 非空）。旧 highlight json / 根目录 `annotations.json` 首次打开时一次性迁入。
> **提问 / 翻译** = 应用层浮层；成功翻译落盘 `marks/<id>.json`（`kind` ∈ `ask` | `translate`）。
> **查找 / 大纲**：`@embedpdf/plugin-search` / `plugin-bookmark`。
> 实现：`viewer/embed/*`、`viewer/pdf-ask/*`、`lib/pdf-selection`、`lib/pdf-ask|pdf-highlight|pdf-translate`、`annotations-panel.tsx`。
> 相关：[`technical-plan.md`](technical-plan.md)、[`translate.md`](translate.md)、[`../frontend/ui.md`](../frontend/ui.md)、[`../backend/data-model.md`](../backend/data-model.md)、[`../backend/api.md`](../backend/api.md)。

## 1. 产品目标

在 **中间栏 PDF 阅读** 场景下，对原文就地 **高亮 / 批注 / 提问 / 翻译**，结果全部落在论文目录的 `marks/` 下，可重开与回访。

| 交互 | 行为 |
|---|---|
| **划词** | 选中文本 → **操作菜单**（5 色高亮 / 复制 / 批注 / 提问 / 翻译）；平滑蓝色选区覆盖层 |
| **操作菜单** | 共用框架；落盘 **`marks/<id>.json`**（`kind` 区分）；滚动/缩放 **重定位** 卡片不关闭 |
| **双击 / 悬停** | 直接开提问卡（页码上下文；悬停有防误触阈值） |
| **提问** | `runOnce` + `hideFromChatHistory`；有用户消息后保留页边提问针 |
| **编辑 / 重发** | 会话空闲时 hover 用户气泡 **Edit**，或底部输入为空时按 **`↑`** → 编辑最后一条用户问题；重发丢弃该条及之后消息再发起新 turn。Agent 侧栏 Chat 的 **`↑`/`↓`** 则是把历史 prompt **回填到输入框**（不回滚气泡；见 `src/lib/ui/prompt-recall.ts`） |
| **回访** | `SelectionGutter`：提问 Hover 打开；批注/翻译点击打开；Hide 留针、Delete 删盘 |

参考形态：浮层卡片 + 底部输入（类似常见 AI 浮层；本应用内需对齐 shadcn / AI Elements，且不引入外部 Chat 产品壳）。

**非目标（首版不做）**：

- 完整 Zotero/Hypothesis 原位高亮同步（导入侧暂迁文本到 `NOTES.md`；阅读器自用 `marks/`）。
- 跨设备实时协作评论。
- 扫描件 OCR 实时划词（无文本层时降级为「仅坐标提问」，见 §7）。
- 在 PDF 二进制内写入注解（不改原始 PDF 文件）。

## 2. 与现有架构的关系

```text
中间栏 PdfViewer（EmbedPDF / PDFium + selection / annotation 插件）
        │
        ├─ 划词 → SelectionMenu
        ├─ activeCard: ask | annotate | translate
        │     ├─ AskPopover / AnnotationEditor / TranslateCard（SelectionCard）
        │     └─ 滚动/缩放 → placeActiveCard（不关卡）
        ├─ SelectionGutter → 页边针
        ├─ 高亮/批注 IO   → papers/<id>/marks/annotations.json
        ├─ 提问/翻译 IO    → papers/<id>/marks/<id>.json
        └─ 提问 / Agent 译 → agent_run_once + stream（hideFromChatHistory）
```

| 已有能力 | 本功能用法 |
|---|---|
| EmbedPDF selection / annotation | 选区几何、高亮与批注 |
| `viewer/embed/pdf-viewer` | 菜单 / activeCard / gutter / 落盘 |
| ACP `agent_run_once` | 提问与可选 Agent 翻译 |
| AI Elements | 提问卡 Conversation / PromptInput |
| Vault 文件 | `marks/annotations.json` + `marks/<id>.json` |

## 3. 技术栈分析

### 3.1 分层选型

| 层 | 选型 | 理由 | 是否新增依赖 |
|---|---|---|---|
| PDF 渲染 | **EmbedPDF** + PDFium（WASM） | 统一渲染 / 选区 / 注解 / 查找 / 大纲 | 已装 `@embedpdf/*` |
| 选区与几何 | selection 插件 + `selection-anchor` / geometry | 页内归一化坐标；滚动/缩放后重算 | 否 |
| 浮层定位 | **Floating UI**（`@floating-ui/react`）或 Radix **Popover** 定位 primitives | 处理碰撞、滚动、缩放后重算；与 shadcn 生态一致 | 建议新增 Floating UI（若未间接依赖） |
| 迷你对话 UI | **AI Elements** 精简组合 + shadcn Card/Button/Tooltip | 与 Agent 面板视觉一致；图标 + Tooltip，无常驻说明文案 | 否 |
| 状态 | React 局部 state + 可选轻量 store（若已有 Zustand 可复用） | 当前选区线程、打开中的 threadId、流式 buffer | 视实现而定 |
| 持久化 | **Vault 内 JSON 文件**（见 §5） | 用户明确要求 JSON；结构化线程/坐标天然适合 JSON；外部工具仍可读 | 否（`plugin-fs` / Host 读写） |
| 问答后端 | **BYOA ACP Client** | 与产品一致；上下文注入 quote + 页码 + 可选 `PAPER.md`/`NOTES.md` 摘要；**Agent/模型** 来自设置 → Agent → **PDF 划词提问**（`settings.pdfAsk`，独立于 Chat / 翻译） | 否 |
| ID | 既有 `nanoid` | thread / message id | 否 |
| i18n | `react-i18next` | 全部用户文案走 `t()`；en 源语言 | 否 |

### 3.2 为何不选的方案

| 方案 | 不采用原因 |
|---|---|
| 在 PDF 内嵌 XFDF/注解 | 污染用户原始 PDF；与 local-first「人可读旁路文件」冲突 |
| 仅存 `.agentero/catalog.sqlite` | 问答是人的阅读产物，应可被外部工具打开；JSON 文件更透明 |
| 全部写入 Markdown 文件 | 不便表达多轮消息与流式元数据；JSON `marks/` 更干净 |
| 浏览器扩展式划词 | 应用内 Webview 已有 PDF，无需跨页面扩展 |
| 自研 Canvas 文本命中 | TextLayer 已够用；仅在无文本层时再考虑坐标-only |

### 3.3 关键技术细节（PDF.js）

1. **TextLayer 已开启**（`renderTextLayer`），选区 API 可用。
2. **坐标系**：以「页内归一化坐标」或「PDF 用户空间点 + pageNumber」存盘，**禁止只存屏幕像素**（缩放/窗口变化会失效）。
3. **映射公式（建议）**：
   - 运行时：`DOMRect` → 相对当前 `Page` 容器的 `(x, y, w, h)` → 除以 `viewport.width/height` 得 `0–1` 归一化 rects。
   - 回放：页渲染完成 + `width` 变化时，用同一归一化 rects × 当前 viewport 重定位圆片与高亮。
4. **多矩形选区**：跨行选区可能多个 `ClientRect`；全部保存为 `rects[]`，圆片锚点取首段中线 y 或包围盒中心。
5. **PDF 源与 CORS**：预览 **本地优先**（fs `readFile` → `blob:` 读 `{paper}/*.pdf`；不用 `asset://`，PDF.js 对其 XHR 会 `Unexpected server response (0)`）；无本地时尝试下载，失败再回退远程 `pdf_url`。TextLayer 抽取依赖 PDF.js 能读文本。远程路径若 CORS/范围请求失败，可提示用户补下本地 PDF 后重开。

## 4. 交互状态机

```text
idle
  │ selectionchange（非空选区）
  │ dblclick
  │ pointerdown + stay ≥ T（可配置，默认 ~700ms）
  ▼
prompting  ── 显示 AskPopover（空会话或继续）
  │ 用户发送
  ▼
streaming  ── agent:stream 更新助手气泡
  │ agent:completed / failed
  ▼
active     ── 可继续多轮；用户点「结束 / 收起」
  │
  ▼
anchored   ── 写盘；页边圆片；popover 关闭
  │ hover 圆片 → 预览
  │ click 圆片 → 回到 active/prompting
  ▼
...
```

**互斥与边界**：

- 打开迷你卡时，不自动抢右侧 Agent 大面板焦点；可选「在 Agent 面板打开」升级路径（后续）。
- 滚动 / 缩放时：activeCard **跟随锚点重定位**（不关闭）；页边针按归一化坐标重算。
- 切换论文 / 关闭 Vault：flush 未保存消息后卸载层。
- 悬停触发需 **防误触**：移动超过阈值像素则取消计时；编辑 NOTES 时不触发。

## 5. 数据模型（JSON 落盘）

### 5.1 路径（唯一）

```text
papers/<id>/
  NOTES.md
  marks/
    <id>.json              # 必填 kind: ask | highlight | translate
  reading-meta.json        # 可选：PDF pageCount（热图）
  *.pdf
```

| 规则 | 说明 |
|------|------|
| 目录 | **仅** `marks/`；不使用 `asks/`、`highlights/`、`translates/` |
| 格式 | pretty JSON；便于 Git diff |
| 判别 | 每条 **`kind` 必填**；解析时 `kind` 不符则丢弃 |
| catalog | **不**把正文写入 SQLite |

### 5.2 Schema（逻辑）

```ts
/** papers/<id>/marks/<id>.json */

// kind: "ask"
interface PdfAskThread {
  version: 1;
  kind: "ask";
  id: string;
  paperPath: string;
  createdAt: string;
  updatedAt: string;
  status: "open" | "ended";
  anchor: {
    page: number;
    rects: { x: number; y: number; w: number; h: number }[]; // 0–1
    quote?: string;
    trigger: "selection" | "dblclick" | "dwell";
  };
  messages: {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    createdAt: string;
    agentSessionId?: string;
  }[];
}

// kind: "highlight"（comment 非空 = 批注）
interface PdfHighlight {
  version: 1;
  kind: "highlight";
  id: string;
  paperPath: string;
  createdAt: string;
  updatedAt: string;
  page: number;
  rects: { x: number; y: number; w: number; h: number }[];
  quote: string;
  color?: string;   // yellow|green|blue|pink|purple
  comment?: string;
}

// kind: "translate"
interface PdfTranslateRecord {
  version: 1;
  kind: "translate";
  id: string;
  paperPath: string;
  createdAt: string;
  updatedAt?: string;
  page: number;
  rects: { x: number; y: number; w: number; h: number }[];
  quote?: string;
  result?: string;
  error?: string;
}
```

实现：`src/lib/pdf/selection/marks-io.ts`（路径）+ 各 `parse*` / `list*` / `write*`。

### 5.3 存储边界

| | `marks/*.json` | `NOTES.md` |
|---|---|---|
| 目的 | 阅读器标注/问答/翻译（运行时事实来源） | 人写综合笔记 / 精读讲义 |
| 默认 | **读写均用 marks** | **不**因划词自动写入 |
| 导出 | 可选将来导出 quote+comment 为 Markdown | 独立 |

## 6. 前端模块

```text
src/components/viewer/
  pdf-viewer.tsx                 # SelectionMenu + activeCard + gutter + IO
  annotations-panel.tsx          # 右侧批注/提问总览
  pdf-ask/
    selection-menu.tsx
    selection-card.tsx           # 共用浮层（lockHeight 等）
    selection-gutter.tsx         # 共用页边针
    ask-popover.tsx | annotation-editor.tsx | translate-card.tsx
    highlight-layer.tsx | highlight-menu.tsx
src/lib/pdf/selection/           # marks-io + pin + ActiveSelectionCard
src/lib/pdf/ask|pdf-highlight|pdf-translate/
```

**UI**：i18n `viewer`；图标 + Tooltip；卡片 Esc/收起/删除；滚动重定位。

## 7. Agent / 翻译 API

落盘 **不**经 Host `pdf_ask_*` command（当前前端 `plugin-fs` + `marks-io`）。

**提问 / Agent 翻译**复用：

- `agent_run_once`（`hideFromChatHistory: true`）
- `agent:stream` / `agent:completed` / `agent:failed`
- 提问 prompt：`src/lib/pdf/ask/prompt.ts`；Agent/模型：`settings.pdfAsk`
- 翻译：应用级 `translate` 服务（免费 MT 或 BYOA Agent，见 [`translate.md`](translate.md)）

## 8. 页边圆片布局算法

1. 每页右侧预留 gutter（CSS：`page` 容器 `position: relative`，圆片 `absolute; right: -Npx` 或贴白边内侧）。
2. 圆片 `top` = 锚点 rects 的垂直中心映射到页容器像素。
3. **碰撞**：同页多线程 y 接近时，做简单纵向错开（stack），避免重叠不可点。
4. Hover：高亮对应 quote rects（半透明色带，语义色与选区区分，避免纯广告黄）。
5. 点击：打开 popover，anchor 仍绑该 thread。

视觉对标飞书：**正文锚点 + 边注指示器 + 点击回线程**，不实现完整右侧评论列表首版。

## 9. 实现分期

| 阶段 | 交付 | 验收 | 状态 |
|---|---|---|---|
| **M1 选区 + 弹层** | 划词 / 框选出现 popover | 选区稳定、滚动不崩 | ✅ |
| **M2 持久化** | JSON 读写；重开 PDF 锚点图标仍在 | 缩放后锚点仍对齐 quote | ✅ |
| **M3 ACP 接入** | 真流式回答；多轮；结束写盘 | 与 Agent 面板共用 provider 配置 | ✅ |
| **M4 双击 / 悬停** | 触发完善；阈值暂固定（约 700ms） | 防误触可接受 | ✅ |
| **M5 增强** | 导出 highlight；本地 PDF 文本层；无文本层降级 UI | 扫描件有明确空状态 | ⏳ |
| **M6 选区菜单** | 划词弹菜单：高亮 / 批注 / 提问 / 翻译 → 统一 `marks/*.json`；去掉默认琥珀高亮 | 四项可用；高亮重开对齐并可删除 | ✅ |
| **M7 批注（Zotero 式）** | 「批注」= 建高亮 + 内联编辑器写 `comment`；页边批注针；右侧「批注」面板（活动 PDF tab）列卡、跳转闪烁、编辑/删除；**不写 `NOTES.md`** | 新建/编辑/面板跳转/删除闭环；`comment` 落盘且 `version` 兼容 | ✅ |
| **M7b 批注 UX** | 内联编辑器 **`Enter` 保存 / `Shift+Enter` 换行**（IME 组字中 Enter 不保存，见 [`../bug_fix/ime-composition-enter-submit.md`](../bug_fix/ime-composition-enter-submit.md)）；批注卡与默认评论文案颜色减弱（`muted`，避免过深） | Enter 落盘；默认色对比度可接受 | ✅ |

## 10. 风险与降级

| 风险 | 缓解 |
|---|---|
| 远程 PDF 无 TextLayer / 乱码 | 检测 `textContent` 为空 → 仅允许坐标提问 + 提示「无文本层」 |
| 缩放后锚点漂移 | 归一化坐标 + 页渲染后重算；集成测试多 width |
| 流式中切换论文 | 取消/收尾当前 turn；禁止跨 paper 写盘 |
| JSON 与 Git 冲突 | 单线程单文件，降低合并难度；write 带 updatedAt |
| 与 NOTES 编辑抢焦点 | popover 焦点陷阱适度；Esc 关闭 |
| Token / 隐私 | 默认只发 quote + 问题；不默认整篇 PDF 上传；BYOA 由用户 Agent 出网 |

## 11. 测试要点

- 单元：归一化坐标往返、`schema` 校验（含可选 `comment`）、index 重建。
- 组件：selection → open popover；write → gutter 出现；click → 消息恢复。
- 批注：批注→内联编辑器写 `comment` 落盘并出现页边批注针；**`Enter` 保存 / `Shift+Enter` 换行**（输入法组字确认时不保存）；右侧「批注」面板列卡、点击跳转并闪烁、编辑 / 删除闭环；默认评论文案色为 muted。
- 集成：mock `agent:stream` 完成一轮后文件存在且可再读。
- 手工：长 PDF 滚动、窗口缩放、中英混排选区、双栏论文（rects 多段）。

## 12. 文档与代码入口

- [`../backend/data-model.md`](../backend/data-model.md)：`marks/` 约定  
- [`../frontend/ui.md`](../frontend/ui.md)：PDF 划词 UI  
- [`translate.md`](translate.md)：翻译服务  
- [`roadmap.md`](roadmap.md) / [`todo.md`](todo.md)

## 13. 决策摘要

1. **渲染**：EmbedPDF / PDFium。  
2. **交互**：划词菜单 + 统一 activeCard；页边针回访。  
3. **存储**：高亮/批注 → `marks/annotations.json`；提问/翻译 → `marks/<id>.json`；坐标归一化。  
4. **智能**：ACP BYOA；不在应用内嵌模型 Key。  
5. **UI**：SelectionCard / Gutter + AI Elements 提问卡。  
6. **标注层**：`marks/` 下 JSON（不写 NOTES / 不改 PDF 二进制）。
