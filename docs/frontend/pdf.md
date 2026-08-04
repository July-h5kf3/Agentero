# PDF 阅读与划词

## 渲染 vs 解析

| 层 | 位置 | 职责 |
|---|---|---|
| **渲染** | 前端 EmbedPDF + PDFium | 展示页面、缩放、翻页、选区 |
| **解析** | Host liteparse 等 | 生成 `PAPER.md`、Agent 可读正文（与预览分离） |

任意 Vault 路径 `.pdf` 可 `blob:` 预览；论文单元：本地优先 → 自动下载 → 远程 `pdf_url` 回退。HTML 用远程 `html_url` iframe（不注入主 DOM）。普通网页条目打开 HTML 并创建 `NOTES.md` 分屏；旧条目缺少 `html_url` 时从 `source_url` 兜底。

PDFium engine 由窗口共享并在主线程运行。Engine 宿主位于 React StrictMode 外，异步初始化即使在完成前被卸载也会主动销毁结果，避免 dev reload 遗留孤儿 WASM engine。工作区只挂载当前可见与最近使用的至多两个 PDF viewer；恢复的隐藏 PDF 标签按需 hydrate，退出保留集合的本地 PDF 字节会释放并在再次激活时重新读取。

## 阅读能力

| 能力 | 说明 |
|---|---|
| 缩放 | 可输入 50%–300% 精确比例；支持 +/-、适应宽/整页、⌘滚轮；真实 scale 重渲染 |
| 导航 | 页码 pill、PageUp/Down、Home/End |
| 大纲 | 左侧书签浮层 |
| 查找 | `⌘F` + 命中高亮 |
| 暗色页 | 跟随应用主题（`dark` class）。EmbedPDF 尚无页面 color-scheme API，仅对 `RenderLayer` / `TilingLayer` 做柔和反相（`invert(0.88)` + `hue-rotate(180)` + 轻亮度/对比）；选区 / 搜索 / 批注覆盖层与 Agent 裁剪（`renderPageRect`）不受影响。扫描版/插图会被一并反相 |
| 沉浸 | 全屏 + 限宽居中 |
| 位置 | 记忆阅读位置 |
| 文中链接 | Link annotation 覆盖层：citation / 图表 / 章节 GoTo 点击跳页，URI 开系统浏览器；hover citation 锚文本（`[12]` / 作者-年份）显示元数据预览并联动右侧 References 卡片高亮。图表、章节、公式等内部链接只保留导航，不显示引用预览 |
| 视觉批注 | 工具栏或 **⌘.** 进入框选。**Enter** → composer 草稿；**⌘/Ctrl+Enter** → 浮层。浮层与右侧 Agent **共用** `agentSessionStore` 会话（同一 send 管线、同一 `lines`），不是两套记录。Host 按能力 `session/load`（Grok）或 `session/resume` 续聊。多轮会回写同一 `marks/<id>.json` 的 `messages[]` / `answerSnapshot`（草稿 id 用 nanoid，跨重启不覆盖）。活动 PDF 才轮询 marks；切换 Vault 清空 composer 视觉草稿。裁剪最长边 1600 px |

## 划词菜单

选区后：高亮 / 批注 / 提问 / 加入对话 / 翻译。

| 动作 | 落盘 | UI |
|---|---|---|
| 高亮 | `marks/annotations.json` | 颜色 |
| 批注 | 高亮 + `comment` | 页边针 + 右侧批注面板 |
| 提问 | `marks/<id>.json`（kind ask） | 迷你问答；页边针 |
| 加入对话 | 不落盘 | 选区固定为 Agent composer 文本 chip，见 [agent.md](agent.md) |
| 翻译 | `marks/<id>.json`（kind translate） | [translate.md](translate.md) |
| 视觉批注 | `marks/<id>.json`（kind `agent-trace`）保存会话与 `image.path`；裁剪图位于 `marks/assets/<id>.png`；`providerSessionId` 为源会话；`messages[]` 本地多轮 transcript（续聊也会落盘） | 框选 → **Enter** → composer；**⌘↵** → 浮层。多轮续聊走 ACP 同一 session（load/resume），同时 `beginTraceContinue` + complete 更新 mark。打开 Agent 与 pin 共享 `providerSessionId` / `visualTraceId` |

- 不改 PDF 二进制；不自动写入 `NOTES.md`。
- 提问 Agent 可与面板默认 Agent 分开配置。
- 坐标归一化；多段 rect 支持双栏。
- 旧版 visual Ask（`kind: ask` + `visualKind`）仍可读、可打开。
- 一次提交可包含多条视觉批注：prompt 按 `## Annotation N` 分点，图片顺序与 annotation 对齐。
- 视觉裁剪不以 base64 写入 mark JSON；活动 PDF 的 marks 轮询只读取 metadata，悬浮卡片、打开 Agent 与 Wiki 嵌入按需读取图片。图片缺失时仍保留位置、批注和多轮 transcript。
- **写进笔记**：批注面板复制 / `[[@id]]` / `![[…@id]]`，见 [wiki.md](wiki.md) 编辑器 `@` 说明。

## 代码

| 路径 | 职责 |
|---|---|
| `src/components/viewer/embed/pdf-viewer.tsx` | 阅读器 |
| `src/components/viewer/embed/pdf-region-select-layer.tsx` | 图片区域框选覆盖层 |
| `src/components/viewer/embed/pdf-region-crop.ts` | PDF 区域裁剪与 Agent 图片编码 |
| `src/components/viewer/pdf-ask/visual-annotation-editor.tsx` | 框选后批注编辑器 |
| `src/components/viewer/pdf-citation-preview.tsx` | 文中引用悬浮预览 |
| `src/lib/agent/visual-context-store.ts` | Agent composer 视觉批注草稿 |
| `src/lib/pdf/agent-trace/` | agent-trace 契约 / mark 资产 IO / prompt / Open-in-Agent 重建 / 会话回跳 pending |
| `src/lib/pdf/highlight/` | 高亮 / 批注 |
| `src/lib/pdf/ask/` | 划词提问 |
| `src/lib/pdf/region.ts` | 区域坐标归一化与 PDF rect 转换 |
| `src/lib/pdf/translate/` | 划词翻译 IO |
| `src/lib/pdf/zoom.ts` | 精确缩放比例解析与范围限制 |
| `src/lib/pdf/annotations-store.ts` | 按 tab 状态 |
| `src/lib/pdf/selection/` | 选区与 marks IO |

Host 下载/解析：[../backend/paper-import.md](../backend/paper-import.md)。

引用元数据解析与 References 侧栏：[../backend/citation-parsing.md](../backend/citation-parsing.md)；插图 sidecar 与自动视觉区域检测尚未实现。
