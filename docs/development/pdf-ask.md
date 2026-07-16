# PDF 划词提问（Selection Ask）

> 状态：**MVP 已落地（前端 + 文件 IO）**  
> 范围：阅读 PDF 时选中/双击/悬停触发提问 → 小对话框问答 → JSON 落盘 → 页边圆片回访（飞书式边注）。  
> 实现入口：`src/components/viewer/pdf-viewer.tsx`、`src/lib/pdf-ask/`、`src/components/viewer/pdf-ask/`。  
> 相关：[`technical-plan.md`](technical-plan.md) §3.4 阅读器、[`../frontend/ui.md`](../frontend/ui.md)、[`../backend/data-model.md`](../backend/data-model.md)、[`../backend/api.md`](../backend/api.md) Agent 契约。

## 1. 产品目标

在 **中间栏 PDF 阅读** 场景下，用户对论文原文发起「就地提问」，而不是先跳到右侧 Agent 面板再手工粘贴上下文。

| 交互 | 行为 |
|---|---|
| **划词** | 选中 PDF 文本后，在选区旁弹出迷你问答卡 |
| **双击** | 双击打开对话框，输入框预填页码（不选词、不高亮整页） |
| **悬停停留** | 指针在某处静止超过阈值 \(T\)，弹出迷你问答卡 |
| **键入提问** | 卡内输入问题并发送；**仅发送过问题的线程**保留对话图标 |
| **对话图标** | 锚在选区附近；Hover 打开，离开约 1s 后隐藏 |
| **回访** | Hover 图标打开线程；隐藏 / 删除 |

参考形态：浮层卡片 + 底部输入（类似常见 AI 浮层；本应用内需对齐 shadcn / AI Elements，且不引入外部 Chat 产品壳）。

**非目标（首版不做）**：

- 完整 Zotero/Hypothesis 高亮批注系统（仍走后续 `highlights.md` 路线）。
- 跨设备实时协作评论。
- 扫描件 OCR 实时划词（无文本层时降级为「仅坐标提问」，见 §7）。
- 在 PDF 二进制内写入注解（不改原始 PDF 文件）。

## 2. 与现有架构的关系

```text
中间栏 PdfViewer（react-pdf + pdf.js TextLayer）
        │
        ├─ 选区 / 双击 / 悬停  →  AskTrigger
        ├─ 迷你问答卡          →  AskPopover（AI Elements 子集）
        ├─ 页边圆片层          →  AskGutter
        │
        ├─ 会话 IO             →  Host 读写 papers/<id>/asks/*.json
        └─ 模型回答            →  既有 ACP Client（agent_run_once + 流式事件）
```

| 已有能力 | 本功能用法 |
|---|---|
| `react-pdf` + `pdfjs-dist`（已开 `renderTextLayer`） | 选区与字符坐标来源 |
| `PdfViewer`（`src/components/viewer/pdf-viewer.tsx`） | 扩展为带交互层的阅读器，而非平行第二套渲染 |
| ACP / `agent_run_once` + `agent:stream` 等 | 问答传输；**不**新建模型 SDK、**不**在 Agentero 存 API Key |
| AI Elements（Conversation / Message / PromptInput） | 迷你卡内消息列表与输入；传输仍是 ACP，不是 Vercel `useChat` |
| Paper 文件夹 / Vault 文件 | 线程 JSON 落在 paper 目录，local-first |
| `highlights.md`（L2.5 标注） | **首版不混写**；可选后续把「值得保留的引文」导出为 highlight |

## 3. 技术栈分析

### 3.1 分层选型

| 层 | 选型 | 理由 | 是否新增依赖 |
|---|---|---|---|
| PDF 渲染 | **既有** `react-pdf` + `pdfjs-dist` | 已渲染 TextLayer / AnnotationLayer，适合划词 | 否 |
| 选区与几何 | **DOM Selection + TextLayer span 几何**；必要时读 `page.getTextContent()` | 浏览器原生选区成本低；bbox 用 `getClientRects()` 映射到页坐标 | 否 |
| 浮层定位 | **Floating UI**（`@floating-ui/react`）或 Radix **Popover** 定位 primitives | 处理碰撞、滚动、缩放后重算；与 shadcn 生态一致 | 建议新增 Floating UI（若未间接依赖） |
| 迷你对话 UI | **AI Elements** 精简组合 + shadcn Card/Button/Tooltip | 与 Agent 面板视觉一致；图标 + Tooltip，无常驻说明文案 | 否 |
| 状态 | React 局部 state + 可选轻量 store（若已有 Zustand 可复用） | 当前选区线程、打开中的 threadId、流式 buffer | 视实现而定 |
| 持久化 | **Vault 内 JSON 文件**（见 §5） | 用户明确要求 JSON；结构化线程/坐标天然适合 JSON；外部工具仍可读 | 否（`plugin-fs` / Host 读写） |
| 问答后端 | **BYOA ACP Client** | 与产品一致；上下文注入 quote + 页码 + 可选 `PAPER.md`/`NOTES.md` 摘要 | 否 |
| ID | 既有 `nanoid` | thread / message id | 否 |
| i18n | `react-i18next` | 全部用户文案走 `t()`；en 源语言 | 否 |

### 3.2 为何不选的方案

| 方案 | 不采用原因 |
|---|---|
| 在 PDF 内嵌 XFDF/注解 | 污染用户原始 PDF；与 local-first「人可读旁路文件」冲突 |
| 仅存 `.agentero/catalog.sqlite` | 问答是人的阅读产物，应可被外部工具打开；JSON 文件更透明 |
| 全部写入 `highlights.md` | Markdown 不便表达多轮消息与流式元数据；首版 JSON 更干净；可后续互导 |
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
- 滚动 / 缩放时：popover 跟随锚点或临时隐藏，圆片重算 y。
- 切换论文 / 关闭 Vault：flush 未保存消息后卸载层。
- 悬停触发需 **防误触**：移动超过阈值像素则取消计时；编辑 NOTES 时不触发。

## 5. 数据模型（JSON 落盘）

### 5.1 路径约定

建议（与 paper 绑定、可备份、不进 catalog 权威表）：

```text
papers/<id>/
  NOTES.md
  highlights.md
  asks/                    # 本功能
    index.json             # 可选：线程目录（id、page、updatedAt）
    <threadId>.json        # 单线程完整记录
  1706.03762.pdf
  ...
```

- **事实来源**：`asks/<threadId>.json`（人产生的问答）。
- **可选索引**：`asks/index.json` 加速页边渲染（仅 id/page/y/preview）；丢失时可扫目录重建。
- **不**把全文塞进 `.agentero/catalog.sqlite`；catalog 不承载对话正文。

### 5.2 线程 JSON Schema（逻辑）

```ts
/** papers/<id>/asks/<threadId>.json */
interface PdfAskThread {
  version: 1;
  id: string;                 // nanoid
  paperPath: string;          // vault 相对路径
  createdAt: string;          // ISO 8601
  updatedAt: string;
  status: "open" | "ended";

  /** 锚点：可重建 UI 位置 */
  anchor: {
    page: number;             // 1-based
    /** 0–1 归一化矩形，相对该页 viewport */
    rects: { x: number; y: number; w: number; h: number }[];
    /** 划词原文；双击/悬停可为空或短上下文 */
    quote?: string;
    /** 触发方式，便于分析与调试 */
    trigger: "selection" | "dblclick" | "dwell";
  };

  messages: PdfAskMessage[];
}

interface PdfAskMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  /** 可选：ACP session / message 关联，便于调试 */
  agentSessionId?: string;
  sources?: { title?: string; uri?: string }[];
}
```

### 5.3 与 `highlights.md` 的边界

| | `asks/*.json` | `highlights.md` |
|---|---|---|
| 目的 | 多轮就地问答 | 引文 + 想法证据层 |
| 形态 | JSON 线程 | Markdown 块引用 |
| 首版 | **本功能唯一落盘** | 不自动写入 |
| 后续 | 「保存为标注」可导出 quote+comment | Agent/笔记引用 `^id` |

## 6. 前端模块划分（建议）

```text
src/components/viewer/
  pdf-viewer.tsx              # 现有；挂载交互层与 gutter
  pdf-ask/
    ask-layer.tsx             # 捕获 selection / dblclick / dwell
    ask-popover.tsx           # 迷你对话框（消息 + 输入）
    ask-gutter.tsx            # 右侧圆片列表
    ask-highlight.tsx         # 选区/已锚定高亮 overlay（可选）
    use-pdf-geometry.ts       # DOMRect ↔ 归一化坐标
    use-pdf-ask-store.ts      # 当前 paper 的 threads 加载/保存
src/lib/pdf-ask/
  types.ts
  schema.ts                   # 校验 version / 字段
  prompt.ts                   # 组装发给 Agent 的 prompt（含 quote/page）
```

**UI 约定**（对齐 [`../frontend/ui.md`](../frontend/ui.md)）：

- 圆片：小尺寸、低对比；Hover Tooltip 显示 quote 截断 + 首问摘要。
- 提问框：圆角矩形，只保留模型选择和发送按钮，上方是对话框
- 迷你卡：限制最大高度，内部滚动；底部输入；结束/关闭为图标按钮 + `aria-label`。
- 文案全部 i18n（建议 namespace `viewer` 或新建 `pdfAsk`）。

## 7. Host / API 契约（规划）

首版可两路径之一（实现时二选一，推荐 A 以统一权限与路径校验）：

### A. Host commands（推荐）

| Command | 作用 |
|---|---|
| `pdf_ask_list` | `{ paperPath }` → 线程摘要列表（供 gutter） |
| `pdf_ask_read` | `{ paperPath, threadId }` → 完整线程 |
| `pdf_ask_write` | `{ paperPath, thread }` → 原子写 `asks/<id>.json` + 更新 index |
| `pdf_ask_delete` | `{ paperPath, threadId }` | 

写盘规则：仅 Vault 内路径；不覆盖用户其他文件；JSON pretty-print 便于 Git diff。

### B. 前端 `plugin-fs` 直写

- 实现快，但路径校验与原子写分散；多窗口并发时更易冲突。  
- 若采用，仍须集中在 `src/lib/pdf-ask/io.ts`，后续可无痛迁 Host。

**问答**复用既有：

- `agent_run_once`：`prompt` 由 `prompt.ts` 注入 quote / page / 用户问题。
- 事件：`agent:stream` / `agent:completed` / `agent:failed`（窗口定向不变）。

**Prompt 骨架（示意）**：

```text
你在帮助用户阅读论文 PDF。
页码: {page}
对应的原文路径在{这里写tex路径或PAPER.md路径}
引用原文:
> {quote}

用户问题:
{question}

请基于引用作答；不确定时明确说明。回答简洁，必要时分点。
```

可选增强：附加 `NOTES.md` 摘要或 `PAPER.md` 邻近段落（需 Host 读文件，注意 token 预算）。

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

- 单元：归一化坐标往返、`schema` 校验、index 重建。
- 组件：selection → open popover；write → gutter 出现；click → 消息恢复。
- 集成：mock `agent:stream` 完成一轮后文件存在且可再读。
- 手工：长 PDF 滚动、窗口缩放、中英混排选区、双栏论文（rects 多段）。

## 12. 文档与代码入口（落地时同步）

实现时需同步：

- [`../backend/data-model.md`](../backend/data-model.md)：增加 `asks/` 文件约定与类型。
- [`../backend/api.md`](../backend/api.md)：`pdf_ask_*` 与 Agent prompt 约定。
- [`../frontend/ui.md`](../frontend/ui.md)：PDF 中间栏交互与圆片规则。
- [`roadmap.md`](roadmap.md) / [`todo.md`](todo.md)：勾选进度。

## 13. 决策摘要

1. **渲染**：继续 `react-pdf` TextLayer，不引入第二套 PDF 引擎。  
2. **交互**：选区 / 双击 / 悬停三触发 → 迷你问答卡 → 结束变页边圆片。  
3. **存储**：`papers/<id>/asks/<threadId>.json`（用户要求的 JSON）；坐标归一化可重建。  
4. **智能**：复用 ACP BYOA，不在 Agentero 内嵌模型 Key。  
5. **UI**：AI Elements + shadcn；飞书式边注心智，不做完整批注产品首版。  
6. **与 highlights**：分离；后续可选导出。
