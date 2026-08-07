# PDF 版面分析（Figures / Tables / Algorithms / Formulas）

实验能力：浏览器内 ONNX（PP-DocLayoutV3）检测 PDF 版面 → 应用层 **文字角色 + 联图聚合 + 公式按编号聚合 + 置信度去重** → 右栏 **Figures**。

| | |
|---|---|
| 上游 | [EmbedPDF Layout Analysis](https://www.embedpdf.com/docs/react/headless/plugins/plugin-layout-analysis) |
| 代码 | `src/lib/pdf/layout/`、`figures-panel.tsx`（header 按钮）、`pdf-viewer.tsx` |
| 持久化 | Paper PDF 写入 `{paper}/source/layout.json`（raw text-enriched regions）；`layoutAnalysisStore` 仍是运行时 UI store |

---

## 流水线（一图）

```text
右栏 Figures header：分析 (Boxes) / 叠加层 (Eye)
        │  handle.analyzeLayout() · store.overlayVisible 同步插件
        ▼
PP-DocLayoutV3  每页: render → detect → map to PDF points
        │  LayoutBlock[]（插件全量标签；页上 LayoutAnalysisLayer 仍画原始框）
        ▼
① 抽 caption / formula_number 文字（PDF text runs）
        │  captionRole: figure_main | table_main | algorithm_main | subpanel | other
        │  formula 右侧条带也可恢复 "(n)" 编号
        │  写入 {paper}/source/layout.json；再次分析优先读缓存
        ▼
①b source/layout.json 缓存命中
        │  跳过 PP-DocLayoutV3，只从 raw regions 重新归并
        ▼
② mergeCaptionsIntoHosts（联图 / 表题 / 算法题 / 公式按编号）
        │  输出 PdfLayoutRegion[]（图必有完整 title；公式仅保留有编号）
        ▼
③ 侧栏展示: isSidebarLayoutKind + dedupeLayoutRegions(minScore 默认 0.3)
        │  分区顺序：插图 → 表 → 算法 → **公式（最底）**
        ▼
右栏 Figures + 聚焦高亮（store.focused）+ 可选 PDF bbox 叠加层
        │
④ PDF 页 hover dwell（默认 600ms）→ 视觉批注卡
        │  hit 层用 **post-merge** 区域（与侧栏同源，非插件 raw 框）
        │  插图 / 表 / 算法 / 有编号公式；打开 VisualAnnotationEditor（不自动发送）
        │  移开源区 / 草稿卡后 hide（默认 1000ms，`LAYOUT_HOVER_HIDE_MS`）
        │  实现：`hit-test.ts` + `pdf-viewer` layout hit + `LAYOUT_HOVER_DWELL_MS` / `LAYOUT_HOVER_HIDE_MS`
```

注册（`pdf-viewer.tsx`）：

```ts
LayoutAnalysisPluginPackage: {
  layoutThreshold: 0.3,  // 与侧栏默认置信度一致
  tableStructure: false,
  autoAnalyze: false,
  renderScale: 2,
}
```

### 模型落盘（Host / XDG）

| 项 | 值 |
|---|---|
| 路径 | `$XDG_CACHE_HOME/agentero/models/pp-doclayoutv3.onnx`（Unix 默认 `~/.cache/agentero/models/`） |
| 启动 | Host `spawn_background_download`（task id 固定 `layout-model`；已有文件则跳过） |
| 面板 | App `useLayoutModelPrefetch` 监听 `layout-model:task` / 进度，写入左下角后台任务（可取消） |
| 代理 | 设置里的 `networkProxyEnabled` / `networkProxyUrl`（`network::client_builder`） |
| 源顺序 | **ModelScope 优先** → HuggingFace 回退 |
| ModelScope | `greatv/oar-ocr` → `pp-doclayoutv3.onnx` |
| HuggingFace | EmbedPDF `PP-DocLayoutV3-ONNX/model_fp16.onnx` |
| 来源标记 | 同目录 `pp-doclayoutv3.onnx.source` |
| 前端 | `agentero-model://…/pp-doclayoutv3.onnx`（Windows：`https://agentero-model.localhost/…`） |
| Commands | `layout_model_status` / `layout_model_ensure({ progressTaskId? })` |

实现：`src-tauri/src/features/layout_model/`、`src/lib/pdf/layout/model.ts`、`ai-runtime.ts`。

### Layout sidecar

`{paper}/source/layout.json` 保存 **初步解析结果**：模型标签映射后的 `PdfLayoutRegion[]`，并已尽力补充 caption / formula number 文本与 `captionRole`。它不保存侧栏最终卡片列表，也不保存缩略图；后续 `mergeCaptionsIntoHosts`、去重和置信度筛选都从该 raw sidecar 重新计算。因此修改联图、公式合并或筛选规则后，不需要重新运行 PP-DocLayoutV3。

```ts
type LayoutSidecar = {
  schemaVersion: 1;
  source: { mode: "embedpdf-layout"; generatedAt: string };
  regions: PdfLayoutRegion[]; // raw, pre-merge
};
```

缓存只在已知 paper folder 时启用；散落 PDF 没有 `{paper}` 路径，仍使用当前内存流程。点击重新分析时默认先读 `source/layout.json`；需要强制刷新模型输出时走 `force` 路径。

---

## 规则清单（现行，共 **17** 条核心规则）

按阶段编号。实现常量见 `merge-captions.ts` → `LAYOUT_MERGE`。

### A. 标签与侧栏（3）

| # | 规则 | 说明 |
|---|---|---|
| **A1** | 模型 label → kind | 映射：`image` `chart` `table` `algorithm` `formula` `formula_number` `figure_title` `header` `text`/`aside_text`→`text`；其余丢弃 |
| **A2** | 侧栏种类 | 展示 **image / chart / table / algorithm / formula（有编号）**；**不展示** 无编号 formula / 裸 `formula_number` / caption |
| **A3** | image+chart 同区 | 侧栏「插图」分区；NMS 时同属 `figure` 组；**公式分区固定在列表最下方** |

### B. 文字角色（3）

| # | 规则 | 说明 |
|---|---|---|
| **B1** | 文本角色优先 | `Figure N`→`figure_main`；`Table N`→`table_main`；`Algorithm N`→`algorithm_main`；`(a)`→`subpanel`（即使模型标成 figure_title） |
| **B2** | 无文本时几何兜底 | 宽≥0.45 且矮 → 可能主图题；窄短 → 子图题 |
| **B3** | 角色驱动绑定 | `table_main` 只绑 table；`figure_main` 只绑图；`subpanel` 不当整图锚点 |

### C. 类型分家与贴题方向（2）

| # | 规则 | 说明 |
|---|---|---|
| **C1** | 宿主族隔离 | figure / table / algorithm 不交叉绑主标题 |
| **C2** | 贴题方向 | **图：标题在下**；**表 / 算法：标题在上**（学术惯例） |

### D. 联图与 figure_title（4）

| # | 规则 | 说明 |
|---|---|---|
| **D1** | 主图题锚点 | 仅 `figure_main`（或宽 figure_title）可启动联图 |
| **D2** | 竖向带 | panel 须在「上一主图题底边 → 本图题顶边」内（防 Fig6/7/8 竖向串台） |
| **D3** | 全宽 vs 半宽 | 图题宽 ≥ **0.55**：band 内全部 image/chart 一次收齐（**不**再砍 `maxHeightAbove`，底行允许轻微压进 title）；半宽：标题水平栏 + panel 邻接连通 + 高度软上限 0.55 |
| **D4** | 标题完整包含 | 最终 figure `bbox` **必须完全包含** `titleBbox`；图无 title → **丢弃**（视为未分对） |

### E. 清理与展示（2）

| # | 规则 | 说明 |
|---|---|---|
| **E1** | 孤儿 panel | 落在更大联图内（覆盖≥0.55）的无主标题 panel 丢弃 |
| **E2** | 侧栏 NMS | 默认 `minScore=0.3`、`minArea=0.002`、同组 IoU≥0.45 抑低分、小框被盖≥0.85 丢小 |

### F. 公式编号聚合（3）

| # | 规则 | 说明 |
|---|---|---|
| **F1** | 必须有 formula_number | **仅**模型 `formula_number`（formulatitle）可启动合并；无编号框、仅文本恢复的 `(n)` **不**进侧栏 |
| **F2** | 不与 text 重叠 | `formula` / `formula_number` / 合并后 host 若被 `text`/`aside_text` 覆盖 ≥ **0.28** 面积 → **丢弃**（行内公式 / 误检） |
| **F3** | 侧栏位置 | 合并后的 display formula 放在 **插图 / 表 / 算法之后（列表最底）**；标题用 `(1)` 等；`text` 永不进侧栏 |

编号文本解析：`(1)` `(12a)` `(A.1)` `[3]` `Eq. (2)` 等（`extractFormulaNumberLabel`）；拒绝子图 `(a)`。多行仅在编号竖带内、邻接且 gap 无大块 text 时扩展。

半宽并排（Fig7\|Fig8）仅在双方都是半宽时做**软**水平分开，并**再并回完整 title**；全宽联图不做 mid-split。

---

## 已收敛 / 视为多余（勿再加分支）

| 项 | 状态 |
|---|---|
| 多套「全宽」阈值 0.55 / 0.62 | **已统一**为 `LAYOUT_MERGE.fullWidthTitle = 0.55` |
| 硬中线切全宽图导致细条框 | **已废止**（仅半宽软切 + 标题回并） |
| `clipFigureBboxToTitleColumn` 裁掉标题一半 | **已改为** `buildFigureBboxWithFullTitle`（标题必整框） |
| 无 title 仍保留 chart 进侧栏 | **已废止**（`requireFigureTitles`） |
| 侧栏默认 50% 置信度 | **已改为固定 30%**（无 UI 滑条） |
| 文档写死 0.5 / 无 merge 流水线 | **以本文为准** |
| `looksLikeFigureCaption` | 兼容别名，等价 `captionRoleFromText` 主类判断，勿再扩展 |

---

## 阈值速查

| 符号 / 位置 | 值 | 用途 |
|---|---|---|
| `layoutThreshold` | 0.3 | 插件层检测 |
| 侧栏 `minScore` | 0.3（固定，无滑条） | 展示过滤 |
| `LAYOUT_MERGE.fullWidthTitle` | 0.55 | 全宽联图 |
| `LAYOUT_MERGE.maxHeightAboveTitle` | 0.55 | **仅半宽**图题无 ceiling 时的竖向软上限 |
| `LAYOUT_MERGE.panelBottomSlack` | 0.04 | 半宽：panel 底可越过 title 顶的量 |
| `LAYOUT_MERGE.fullWidthPanelBottomSlack` | 0.14 | 全宽：底行 chart 允许压进 caption |
| `LAYOUT_MERGE.panelNeighborGap` | 0.08 | 子图邻接 |
| `LAYOUT_MERGE.orphanContainment` | 0.55 | 吞并孤儿 panel |
| `LAYOUT_MERGE.formulaNumberMaxGap` | 0.28 | 公式体与编号水平间距 |
| `LAYOUT_MERGE.formulaNumberBandPad` | 0.05 | 编号竖带 |
| `LAYOUT_MERGE.formulaNeighborGap` | 0.06 | 多行公式竖向扩展 |
| `LAYOUT_MERGE.formulaTextOverlap` | 0.28 | formula 被 text 覆盖比 → 不合并 |
| NMS `iouThreshold` | 0.45 | 去重 |
| NMS `containmentThreshold` | 0.85 | 去重 |

---

## 返回类型（应用层）

```ts
type PdfLayoutRegion = {
  id: string;
  pageIndex: number;           // 0-based
  kind: "image" | "chart" | "table" | "algorithm" | "formula" | "formula_number" | …;
  label: string;
  score: number;               // 0–1 → UI %
  readingOrder: number;
  rect: { x, y, w, h };        // PDF points
  bbox: { x, y, w, h };        // 0–1 页相对
  title?: string;              // 图/表题文字，或公式编号 "(1)"
  titleBbox?: { x, y, w, h };  // 完整标题/编号框（须 ⊆ bbox）
  captionRole?: CaptionRole;
};
```

页上 `LayoutAnalysisLayer` 仍显示**模型原始**多框；侧栏 / 跳转 / 聚焦用 **合并后** `PdfLayoutRegion`。

---

## 代码地图

| 路径 | 职责 |
|---|---|
| `run-analysis.ts` | 分析 → 文字 → merge → store |
| `io.ts` | `{paper}/source/layout.json` raw sidecar 读写与 schema 校验 |
| `title-text.ts` | 抽字、captionRole、公式编号解析 |
| `merge-captions.ts` | 联图 / 表 / 算法 / **公式按编号**、标题完整包含 |
| `normalize.ts` | DocumentLayout → regions（sync 无文字） |
| `dedupe.ts` | 侧栏 NMS |
| `labels.ts` / `colors.ts` / `store.ts` / `types.ts` | 映射、色、状态、类型 |
| `test/pdf-layout-*.test.ts` | 归一化 / 去重 / 角色 / 合并 / 公式 |

---

## 限制与后续

- 实验路径；大模型推理可能卡顿。
- 不改 PDF 二进制；只写可重建的 `{paper}/source/layout.json`。
- `layout.json` 只缓存 raw layout，不等同于未来 `agentero-figures.json` / 缩略图资产 sidecar。
- 后续：最终 figure sidecar、自动分析、一键视觉批注。
