# PDF 引用与插图解析方案

> 状态：设计中，尚未实现。  
> 目标：为本地 PDF 阅读器提供可重建的文内引用与插图索引，并把结果展示到侧边栏。

## 1. 目标与边界

### 1.1 首个 MVP

- 只处理**本地 Vault 中 paper 单元的本地 PDF**。
- 解析结果写入 paper 的 `source/`，不写入用户笔记、不修改原始 PDF、不修改原始 TeX/Bib。
- 优先使用 TeX/Bib：
  - 有 `.tex`/`.ltx`：解析源码、引用命令、参考文献和 `figure`/`includegraphics` 声明。
  - 无 TeX：使用 `liteparse` 解析 PDF 文本、文字 bbox、图片对象和页截图。
- 即使有 TeX，仍需要从最终 PDF 提取最小文字 bbox，用于把 TeX 引用映射到 PDF 页面。
- `PAPER.md` 只作为正文读取和解析质量的回退，不作为引用/插图交互的事实来源。

### 1.2 明确不做

- 不覆盖用户已有的 `source/agentero-*` 文件以外的文件。
- 不替换 TeX 中引用的原始 PDF 图片；只在派生目录生成 PNG。
- 不承诺任意 TeX 宏包、任意 BibLaTeX 样式、扫描 PDF 都能 100% 识别。
- 不把库外引用自动导入 Vault；只展示未解析成功的原始 key/文本。
- 不把引用边写入双链 Graph；双链图和文献引用关系保持两个模型。
- 不在首版实现 Connected Papers、cited-by、外部引用 API 或全文 HTML 解析。

## 2. Vault 落盘契约

```text
{paper}/
└── source/
    ├── agentero-cite.json
    ├── agentero-figures.json
    └── agentero-figures/
        ├── fig-1.png
        └── fig-2.png
```

三个路径都是可重建 sidecar。删除后可通过再次运行分析恢复；不存在时不影响 PDF、TeX、Bib、`NOTES.md` 或 `PAPER.md`。

### 2.1 `agentero-cite.json`

```json
{
  "schemaVersion": 1,
  "source": {
    "pdf": "1706.03762.pdf",
    "pdfSha256": "…",
    "mode": "tex",
    "generatedAt": "2026-07-21T00:00:00Z"
  },
  "citations": [
    {
      "id": "cite-vaswani2017",
      "rawKey": "vaswani2017",
      "display": "[1]",
      "metadata": {
        "title": "Attention Is All You Need",
        "authors": ["Ashish Vaswani"],
        "year": 2017,
        "doi": "10.48550/arXiv.1706.03762",
        "arxivId": "1706.03762"
      },
      "localMatch": {
        "paperPath": "papers/1706.03762",
        "matchBy": "doi"
      },
      "anchors": [
        {
          "page": 2,
          "bbox": { "x": 80, "y": 420, "width": 22, "height": 10 },
          "text": "[1]"
        }
      ],
      "reference": {
        "page": 15,
        "bbox": { "x": 70, "y": 180, "width": 330, "height": 24 }
      },
      "status": "resolved",
      "confidence": 0.96
    }
  ],
  "messages": []
}
```

`anchors` 是文中出现位置；`reference` 是参考文献条目位置，可为空。`status` 为 `resolved`、`unresolved` 或 `ambiguous`。`confidence` 只表示解析定位置信度。

### 2.2 `agentero-figures.json`

```json
{
  "schemaVersion": 1,
  "source": {
    "pdf": "1706.03762.pdf",
    "pdfSha256": "…",
    "mode": "tex",
    "generatedAt": "2026-07-21T00:00:00Z"
  },
  "figures": [
    {
      "id": "fig-1",
      "label": "Figure 1",
      "caption": "The Transformer model architecture.",
      "page": 3,
      "bbox": { "x": 72, "y": 120, "width": 460, "height": 280 },
      "png": "source/agentero-figures/fig-1.png",
      "sourceKind": "tex-declaration",
      "sourcePath": "source/figures/model.pdf",
      "warnings": []
    }
  ],
  "messages": []
}
```

`png` 始终是派生 PNG；原始 `sourcePath` 保留但不替换。`sourceKind` 为 `tex-declaration`、`pdf-image` 或 `pdf-figure-region`。无法生成缩略图时保留条目并写入 `warnings`。

## 3. Host API

新增 Host command：`paper_analyze_pdf`。

```ts
type PaperAnalyzePdfArgs = {
  vaultPath: string;
  path: string;
  force?: boolean;
  taskId?: string;
};

type PaperAnalyzePdfResult = {
  mode: "tex" | "pdf";
  citePath: string;
  figuresPath: string;
  figuresDir: string;
  citationCount: number;
  figureCount: number;
  messages: string[];
};
```

行为：

1. 校验 Vault 和 paper 路径，拒绝 `..` 路径穿越。
2. 查找 paper 内本地 PDF；没有 PDF 时返回可读错误。
3. 计算 PDF fingerprint。无 `force` 且 fingerprint、解析器 schema 都未变化时跳过。
4. 有 TeX 时 `mode = "tex"`，否则 `mode = "pdf"`。
5. 以临时文件写 JSON，成功后原子替换 sidecar；图片写入临时目录后再替换派生目录。
6. 解析失败不删除上一版可用 sidecar；错误写入 `messages`。

首版远程 Vault 返回“不支持远程 PDF 分析”，不复用远程 SFTP 临时缓存。

## 4. 解析策略

### 4.1 TeX 模式

从主文件递归处理 `\input{}`、`\include{}`，解析：

- `\cite{}`、`\citep{}`、`\citet{}`、`\parencite{}`、`\textcite{}` 等常用命令；
- `\bibliography{}`、`\addbibresource{}` 和 `.bib`；
- `figure` 环境、`\caption{}`、`\label{}`、`\includegraphics[options]{}`；
- `includegraphics[page=N]{figure.pdf}` 的页号信息。

Bib 解析只做 brace-aware 字段读取，不引入完整 TeX 编译器。元数据匹配优先级为 DOI、arXiv、`title + author + year`、原始 cite key。

TeX 不提供最终 PDF 坐标，因此仍对 PDF 做一次关闭 OCR 的 liteparse text/bbox 提取，把数字引用、author-year 文本和参考文献条目匹配到 PDF。匹配不到时保留 citation，但 `anchors=[]` 并标记 `unresolved`。

PNG/JPG 等图片可复制到派生目录。PDF/EPS/SVG 等资源使用页面渲染或后续图像转换生成 PNG，原始图片不改写。

### 4.2 PDF 模式

配置 liteparse：

- `emit_word_boxes = true`；
- `ImageMode::Embed`；
- OCR 开启但 best-effort，OCR 失败不阻止文字层结果。

引用识别顺序为 DOI/arXiv 链接、数字引用 `[1]`/`[1, 2]`/`[3–5]`、author-year、参考文献区域弱匹配。插图优先使用 `ExtractedImage`；没有独立 bytes 时渲染并裁剪 figure region；只有 caption 时保留条目并写 warning。

### 4.3 元数据匹配

首版只查询本地 catalog：

- DOI 精确匹配；
- arXiv ID 精确匹配；
- cite key 与 catalog id 精确匹配；
- title/author/year 保守模糊匹配，多候选标记 `ambiguous`。

Translator、Semantic Scholar、OpenAlex 等网络补全延后到引用关系版本，并且必须由用户显式操作触发。

## 5. 前端交互

### 5.1 Paper Content 侧栏

右侧新增 `Paper Content` tab，仅在当前 tab 是 paper PDF 且 sidecar 可用时显示：

- `Citations`：display、title/author/year、库内状态、解析状态；
- `Figures`：PNG 缩略图、caption、页码和 warning；
- 空态显示 `Analyze PDF`，不显示常驻错误条。

### 5.2 PDF 内交互

- citation hover：高亮当前 anchor，并显示轻量 metadata preview；不自动跳页。
- citation click：跳到 References 条目并短暂高亮；无 reference 时保留当前 anchor。
- 侧栏 citation：跳转到第一个 anchor；无 anchor 不跳转。
- figure card：跳至 figure 页并高亮 bbox。
- overlay 使用 sidecar bbox 与现有 PDF 页坐标转换，不复制 PDF 文本层。

### 5.3 Agent Composer

当前 PDF 有分析结果时，`@` 菜单增加 Citations/Figures 分组。citation 使用结构化 ref，figure 同时注入 sidecar JSON 路径和 PNG 路径。侧栏卡片支持拖入 Composer，继续使用 context chip，不使用 AI Elements Attachments。

## 6. 分阶段交付与难度

| 阶段 | 内容 | 估算 |
|---|---|---:|
| P0 | schema、fingerprint、Host command 契约、fixture 设计 | 1–2 天 |
| P1 | TeX/Bib/figure parser + PDF text bbox locator | 4–6 天 |
| P2 | liteparse 引用/图片/截图提取、PNG 派生 | 3–5 天 |
| P3 | PDF overlay、跳转、Paper Content 侧栏 | 3–4 天 |
| P4 | Composer `@`/drag structured refs、i18n、错误与后台任务 | 2–3 天 |
| P5 | 测试、文档、真实 arXiv/扫描 PDF 回归 | 2–4 天 |

单人约 **3–4 周**。主要不确定性是非标准 TeX 宏、BibLaTeX 样式、多栏 PDF 的 bbox 匹配、vector figure 裁剪和 OCR 坐标一致性。首版允许“有条目但定位失败”降级，避免极端 PDF 阻塞主流程。

## 7. 验收标准

- 有 TeX 和无 TeX 的 paper 都能生成两个 JSON sidecar；重复运行不修改原始资产。
- TeX 引用 PDF 图片时，`source/agentero-figures/` 生成 PNG，原 PDF 仍存在。
- citation hover 高亮 anchor；点击或侧栏点击可跳转 reference。
- figure card 可预览缩略图并跳到 PDF figure。
- Composer 可通过 `@` 和拖拽引用 citation/figure，prompt 含 Vault-relative 路径。
- 删除 sidecar 后再次运行可以重建；已有 `NOTES.md`、`PAPER.md`、TeX/Bib 不被覆盖。
