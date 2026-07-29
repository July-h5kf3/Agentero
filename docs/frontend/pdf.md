# PDF 阅读与划词

## 渲染 vs 解析

| 层 | 位置 | 职责 |
|---|---|---|
| **渲染** | 前端 EmbedPDF + PDFium | 展示页面、缩放、翻页、选区 |
| **解析** | Host liteparse 等 | 生成 `PAPER.md`、Agent 可读正文（与预览分离） |

任意 Vault 路径 `.pdf` 可 `blob:` 预览；论文单元：本地优先 → 自动下载 → 远程 `pdf_url` 回退。HTML 用远程 `html_url` iframe（不注入主 DOM）。

## 阅读能力

| 能力 | 说明 |
|---|---|
| 缩放 | +/-、适应宽/整页、⌘滚轮 0.5×–3×；真实 scale 重渲染 |
| 导航 | 页码 pill、PageUp/Down、Home/End |
| 大纲 | 左侧书签浮层 |
| 查找 | `⌘F` + 命中高亮 |
| 沉浸 | 全屏 + 限宽居中 |
| 位置 | 记忆阅读位置 |
| 文中链接 | Link annotation 覆盖层：citation / 图表 / 章节 GoTo 点击跳页，URI 开系统浏览器；hover citation 锚文本（`[12]` / 作者-年份）经 `citation-hover-store` 联动右侧 References 卡片高亮（`embed/citation-links.tsx`） |

## 划词菜单

选区后：高亮 / 批注 / 提问 / 加入对话 / 翻译。

| 动作 | 落盘 | UI |
|---|---|---|
| 高亮 | `marks/annotations.json` | 颜色 |
| 批注 | 高亮 + `comment` | 页边针 + 右侧批注面板 |
| 提问 | `marks/<id>.json`（kind ask） | 迷你问答；页边针 |
| 加入对话 | 不落盘 | 选区固定为 Agent composer 选区 chip，见 [agent.md](agent.md) |
| 翻译 | `marks/<id>.json`（kind translate） | [translate.md](translate.md) |

- 不改 PDF 二进制；不自动写入 `NOTES.md`。
- 提问 Agent 可与面板默认 Agent 分开配置。
- 坐标归一化；多段 rect 支持双栏。

## 代码

| 路径 | 职责 |
|---|---|
| `src/components/viewer/embed/pdf-viewer.tsx` | 阅读器 |
| `src/lib/pdf/highlight/` | 高亮 / 批注 |
| `src/lib/pdf/ask/` | 划词提问 |
| `src/lib/pdf/translate/` | 划词翻译 IO |
| `src/lib/pdf/annotations-store.ts` | 按 tab 状态 |
| `src/lib/pdf/selection/` | 选区与 marks IO |

Host 下载/解析：[../backend/paper-import.md](../backend/paper-import.md)。  
引用元数据解析与 References 侧栏：[../development/citation-parsing.md](../development/citation-parsing.md)；插图 sidecar（未实现）：[../development/pdf-analysis.md](../development/pdf-analysis.md)。
