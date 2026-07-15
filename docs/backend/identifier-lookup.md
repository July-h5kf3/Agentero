# 魔棒入库（Identifier Lookup）与 Translator 后端

> 状态：**设计稿（待实现）**  
> 目标：用户点击 **魔棒**，粘贴 **链接或编号** → 用 **Translator** 解析元数据 → **只写 catalog + 轻量 paper 文件夹**（远程 `pdf_url` / `html_url` **不下载**）→ 落到 `papers/` 或当前 Papers 子文件夹。

相关文档：

- Catalog 权威存储：[`catalog.md`](catalog.md)
- 入库命令与事件：[`api.md`](api.md) §3.5
- Vault 文件模型：[`data-model.md`](data-model.md)
- UI：[`../frontend/ui.md`](../frontend/ui.md)

---

## 1. 产品目标

### 1.1 主交互（必须先满足）

```text
用户点击魔棒
  → 输入框：粘贴链接或编号（DOI / arXiv URL / arXiv ID / ISBN / PMID …）
  → Translator 解析元数据
  → 展示标题/作者等简要结果（可极简：成功即入库，失败 toast）
  → 加入 Papers：
       ├─ 默认：papers/<id>/
       └─ 若当前上下文是 papers 下的组织子文件夹：papers/<子路径>/<id>/
  → catalog.sqlite 写入一行（含 pdf_url / html_url / source_url 等）
  → 不下载 PDF/HTML 文件到 source/（与现有「远程 URL 只读 catalog」一致）
```

#### 用户故事

1. 用户在工具栏点击 **魔棒**（或 `⇧⌘I`）。
2. 粘贴 **链接**（如 `https://arxiv.org/abs/1706.03762`、`https://doi.org/10.…`）或 **编号**（如 `1706.03762`、`10.1038/…`）。
3. Motif 用 **本机 Translator Runtime**（Search / 必要 Web）解析出书目元数据。
4. 将条目加入 **Papers**：
   - **默认目标**：Vault 的 `papers/` 根下，`papers/<id>/`。
   - **上下文目标**：若文件树当前选中（或等价「当前打开」）的是 `papers/` 下的**组织子文件夹**（非 paper 本体），则写入  
     `papers/<该子路径>/<id>/`。
5. **Catalog 写入** title / authors / year / doi / arxiv_id / **`pdf_url` / `html_url` / `source_url`** 等；中间栏 PDF/HTML 视图仍按 UI 约定 **只读远程 URL，不落盘下载**。
6. 本地只创建轻量 paper 壳：`NOTES.md`（占位或短摘要）、空 `highlights.md`；**不**强制 `source/` 下载、**不**因魔棒去抓 PDF/HTML 文件。

### 1.2 目标文件夹解析规则

| 当前上下文（前端算出后传给 Host） | 入库父目录 `parent_dir` | 最终 path 示例 |
|---|---|---|
| 未选中 / 选中不在 `papers/` 下 | `papers` | `papers/1706.03762` |
| 选中 `papers` 根目录 | `papers` | `papers/1706.03762` |
| 选中 `papers/nlp`（组织文件夹，非 paper） | `papers/nlp` | `papers/nlp/1706.03762` |
| 选中某个 paper 文件夹或其中的文件 | **该 paper 的父目录** | `papers/nlp/1706.03762`（与兄弟 paper 同级） |
| 选中 `notes/`、`plans/` 等 | 回退 `papers` | `papers/1706.03762` |

规则摘要（前端 `resolvePapersParentDir`）：

1. 取文件树 **当前选中路径**（与新建文件时类似；若打开的是 paper 内文件，先归到 paper 文件夹再取其父目录）。
2. 若路径落在某个 **paper 最小单元** 内 → 使用该 paper 的 **父目录** 作为 `parent_dir`。
3. 若路径是 `papers/` 下目录且 **不是** paper → 该目录即为 `parent_dir`。
4. 否则 `parent_dir = "papers"`。
5. Host **校验**：`parent_dir` 必须是 `papers` 或 `papers/` 下既有（或可创建的）相对路径；禁止写到 Vault 外。

UI：弹层底部一行轻量文案，如「将加入 `papers/nlp/`」（i18n），避免大段说明。

### 1.3 远程预览 vs 本地下载（策略 + 设置）

catalog **始终**可写入 `pdf_url` / `html_url`（有则供在线预览）。本地下载规则如下。

#### 决策表

| 有 `pdf_url` 或 `html_url` | 设置 `downloadFulltextToLocal` | 行为 |
|---|---|---|
| **有** | **关（默认）** | 只写 catalog URL；**不**下载（用远程预览） |
| **有** | **开** | catalog 写 URL **且** 用该 URL 下载到 `source/` |
| **无** | **任意**（关/开相同） | **必须尝试下载**到 `source/`（否则没有可预览内容）；无可下载地址则仅 metadata |

要点：

- **无预览 URL → 始终尽量下载**（与设置无关）。
- **有预览 URL → 默认不下载**；仅设置打开时额外镜像到本地。

阅读：优先远程 URL；`source/` 有文件时可作离线回退（实现阶段再定优先级）。

#### Translator 请求地址（占位）

| 常量 / 参数 | 默认值 |
|---|---|
| `DEFAULT_TRANSLATOR_BASE_URL`（Host + 前端） | **`http://127.0.0.1:1969`** |

- Host：`lookup_import` 对 `{base}/search` 或 `{base}/web` 发 `POST`（`Content-Type: text/plain`）。
- 可经参数 `translatorBaseUrl` 覆盖；未起 translation-server 时，**仅 arXiv** 回退到 export.arxiv.org。
- 命令 `lookup_translator_config` 返回当前默认占位地址。

#### 设置项

| Key | 类型 | 默认 | UI |
|---|---|---|---|
| `downloadFulltextToLocal` | `boolean` | **`false`** | Settings → **General** |

含义是「**有预览链接时是否也下载到本地**」，不是「总开关」：

- **关（默认）**：有 URL 只远程预览；无 URL 仍会下载（若可能）。
- **开**：有 URL 时也写入 `source/`。

文案（i18n）：

- en：`Also download when a preview URL exists`
- zh：`有预览链接时也下载到本地`

实现：`AppSettings` + General Switch；`lookup:import` 传入该标志。

### 1.4 非目标（本阶段）

| 不做 | 说明 |
|---|---|
| 有远程预览时仍强制镜像下载 | 与「远程优先」冲突；不做 |
| 官方 Zotero 公网 Translation SaaS | 自托管 Runtime |
| AGPL 翻译器链进主二进制 | sidecar 旁路进程 |
| 复杂多步确认面板 | v1 可「解析成功即入库」；重复时提示 skip / 打开已有 |

### 1.5 统一数据流（arXiv 与 DOI 等合并）

**不要**再分「左边 arXiv API / 右边 Translator」两条线。魔棒只走一条管道：

```text
用户输入（链接或编号：arXiv / DOI / ISBN / PMID …）
        │
        ▼
  parse → 规范化标识符 / URL
        │
        ▼
  Translator Runtime
    ├─ 编号 → POST /search
    └─ 链接 → POST /web（必要时）
        │
        ▼
  Zotero API JSON Item
        │
        ▼
  map → PaperMetadata（字段直接写入，见 §5）
    + 补全：arxiv 时用 arxiv.ts 填 pdf_url/html_url/source_url（若 Translator 未给）
        │
        ▼
  parent_dir 解析 → path = {parent_dir}/{id}
        │
        ▼
  catalog.papers UPSERT（sqlite）
  + papers/.../NOTES.md、highlights.md
        │
        ▼
  下载判定（见 §1.3）：
    无 pdf_url 且无 html_url → 始终尝试下载到 source/
    有预览 URL 且 downloadFulltextToLocal → 用 URL 下载到 source/
    有预览 URL 且设置关 → 不下载
```

| 来源 | 在统一流中的位置 |
|---|---|
| arXiv 编号/abs URL | 同一 Translator（arXiv Search/Web）→ map 进 metadata |
| DOI / ISBN / PMID | 同一 Translator Search → map 进 metadata |
| 远程 PDF/HTML | **只**作为 `pdf_url` / `html_url` 字段进 metadata/catalog |
| 旧独立 `arxiv:import` 全量下载 | **不**混进魔棒；若保留则是另一命令，默认用户走魔棒 |

原则：

- **Translator 返回值 → 直接并入 `PaperMetadata`**，再落 catalog；不并行维护两套 arXiv 专用结构。
- **魔棒 = 轻量加入文库**（metadata + 远程 URL + 笔记壳）。

---

## 2. 架构总览

### 2.1 分层

```text
┌──────────────────────────────────────────────────────────┐
│ Frontend：魔棒输入 + parent_dir + 打开 paper              │
└───────────────────────────┬──────────────────────────────┘
                            │ lookup:add / lookup:search+import
┌───────────────────────────▼──────────────────────────────┐
│ Host：parse → Translator client → map→PaperMetadata      │
│       → catalog upsert + 最小文件落盘                      │
└───────────────────────────┬──────────────────────────────┘
                            │ POST /search | /web
┌───────────────────────────▼──────────────────────────────┐
│ Translator Runtime（本机 sidecar）                         │
│  Search/Web translators（含 arXiv、DOI、ISBN、PMID…）      │
└──────────────────────────────────────────────────────────┘
```

### 2.2 为何用旁路 Translator Runtime

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| A. 仅自写 Crossref/arXiv 客户端 | 无 AGPL、实现简单 | 覆盖面远小于 Zotero；ISBN/PMID/ADS 等要逐个做 | 可作为 **fallback** |
| B. Motif 进程内嵌 JS 翻译器引擎 | 零外部进程 | AGPL 传染风险、打包复杂 | **不做**（除非产品整体 AGPL） |
| C. **本机 sidecar：translation-server** | 复用全量 Search Translator；进程边界清晰；可热更新 translators | 需管理子进程生命周期 | **推荐主路径** |
| D. 用户自备 URL 指向外部 server | 灵活 | 隐私/ToS/可用性不可控 | 高级设置可选 |

**默认策略**：Motif 启动后按需拉起本地 Translator Runtime；不可用时降级到内置轻量客户端（DOI→doi.org/Crossref，arXiv→export API），并在 UI 标明「精简模式」。

### 2.3 与 Zotero 魔棒的对应关系

| Zotero | Motif |
|---|---|
| `lookup.js` UI | `MagicWand` 弹层 |
| `extractIdentifiers()` | `lookup:parse` / Host `parse.rs` |
| `Zotero.Translate.Search` | `POST /search` on translation-server |
| Search Translators 仓库 | sidecar 内置 / 可更新的 translators 目录 |
| 写入 Zotero SQLite | 写 Vault 文件 + **catalog.sqlite** |
| 可选附件 | 本阶段可选：有 `pdf_url`/`arxiv_id` 再走 source 抓取 |

参考实现（上游，不 fork 进 Motif 主仓逻辑）：

- UI：[`zotero/zotero` `lookup.js`](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/lookup.js)
- 解析：[`zotero/utilities` `extractIdentifiers`](https://github.com/zotero/utilities)
- 引擎：[`zotero/translate` `Translate.Search`](https://github.com/zotero/translate)
- HTTP 服务：[`zotero/translation-server`](https://github.com/zotero/translation-server)
- 翻译器：[`zotero/translators`](https://github.com/zotero/translators)（如 `DOI Content Negotiation.js`、`Library of Congress ISBN.js`、`PubMed.js`、`arXiv.org.js`）

---

## 3. 标识符与解析规则

### 3.1 支持的类型（v1）

| 类型 | 示例 | Translator 侧典型来源 |
|---|---|---|
| **DOI** | `10.1038/nature12373`、`https://doi.org/10.…` | DOI Content Negotiation → Crossref / DataCite / CSL |
| **ISBN** | `978-0-262-03384-8`、`0838985890` | LoC / WorldCat 等 ISBN Search Translator |
| **PMID** | `24297125`、`PMID:24297125` | NCBI E-utilities via PubMed Translator |
| **arXiv** | `1706.03762`、`arXiv:1706.03762v1`、abs URL | arXiv Search Translator 或 Motif arXiv API |
| **ADS Bibcode** | `2015ApJ...810...89S` | ADS 相关 Search Translator |

批量：空格、逗号、换行分隔；PMID 可在 Runtime 侧按批合并（Zotero 习惯每批 ≤200）。

### 3.2 解析优先级（对齐 Zotero `extractIdentifiers`）

对同一段输入文本，**按序**尝试（命中一类后，Zotero 原逻辑会停止后续类型；Motif 建议：

- **单条粘贴框**：采用 Zotero 同序，降低数字误识别为 PMID。
- **显式多行「每行一个」模式**：逐行独立解析，允许一行 DOI、一行 arXiv 混合。

顺序：

1. DOI（含 URL 解码与 `cleanDOI`）
2. ISBN（校验位；ISBN-10/13）
3. arXiv（去掉 version 后缀用于查库）
4. ADS Bibcode
5. PMID（1–9 位数字，最后匹配）

解析失败：返回 `lookup.failure_to_id`，不调用网络。

### 3.3 输出：`ParsedIdentifier`

```ts
type IdentifierKind = 'doi' | 'isbn' | 'pmid' | 'arxiv' | 'ads_bibcode';

interface ParsedIdentifier {
  kind: IdentifierKind;
  /** 规范化后的原始值（无 version 的 arXiv、clean DOI 等） */
  value: string;
  /** 用户输入中的原始片段（用于 UI 高亮） */
  raw: string;
}
```

---

## 4. Translator Runtime 契约

### 4.1 部署形态

| 模式 | 说明 | 默认 |
|---|---|---|
| `bundled` | Motif 附带/下载 sidecar 二进制或 Docker 镜像说明；Host 管理端口与生命周期 | 是（桌面） |
| `external` | 用户在设置中填 `http://127.0.0.1:1969` | 可选 |
| `off` | 仅用内置 fallback 客户端 | 降级 |

设置项（应用配置 / Tauri Store，**非** Vault）：

```ts
interface TranslatorRuntimeConfig {
  mode: 'bundled' | 'external' | 'off';
  base_url?: string;           // external 时必填，如 http://127.0.0.1:1969
  auto_start?: boolean;        // bundled 时默认 true
  user_agent_suffix?: string;  // 追加到请求 UA，便于站点联系
  timeout_ms?: number;         // 默认 30000
}
```

**User-Agent**：对外请求应带可识别后缀，例如  
`motif-translation/0.1 (+https://github.com/poco-ai/motif; contact@…)`，避免伪装成无标识爬虫（与 translation-server README 建议一致）。

### 4.2 HTTP API（与官方 translation-server 对齐）

#### `POST /search` — 标识符查元数据（魔棒主路径）

- **Request**：`Content-Type: text/plain`  
  Body：单个标识符字符串，或实现约定的多 ID 文本。
- **Response**：`200` + Zotero API JSON 数组（items）。

```bash
curl -d '10.2307/4486062' \
  -H 'Content-Type: text/plain' \
  http://127.0.0.1:1969/search
```

#### `POST /web` — 网页 URL（v2 可选）

用于后续「粘贴论文页 URL」；本阶段可不接 UI。

#### `POST /import` — BibTeX/RIS 等（与迁移工具共享，非魔棒主路径）

### 4.3 健康检查与懒启动

```text
lookup:search 被调用
  → client.ensure_ready()
       ├─ mode=off → 走 fallback
       ├─ external → GET/探测 base_url，失败则错误「无法连接 Translator」
       └─ bundled → 若进程未起：spawn sidecar，轮询 ready（≤ N 秒）
  → POST /search
```

事件（可选）：`translator:status` → `{ state: 'stopped'|'starting'|'ready'|'error', detail? }`。

### 4.4 失败与降级

| 情况 | 行为 |
|---|---|
| Runtime 未启动且 auto_start 失败 | 错误 + 引导打开设置；可选「用精简模式重试」 |
| `/search` 超时 | `lookup.timeout`；该 ID 标记 failed，其它 ID 继续 |
| 无匹配书目 | `lookup.not_found` |
| Runtime 返回部分成功 | 返回成功草稿 + 失败列表（对齐 Zotero「部分失败仍继续」） |
| fallback 成功 | `source: 'fallback'`，libraryCatalog 填 `Motif (Crossref)` 等 |

---

## 5. 数据映射：Translator Item → `PaperMetadata`（直接并入）

Translator 输出的 **Zotero API JSON Item** 经 `map` **直接写入** `PaperMetadata` / catalog 列，**不再**先落到另一套 arXiv 专用结构。  
catalog **schema v2** 起补齐期刊/卷期页等字段（见 [`catalog.md`](catalog.md) §4.2）。

### 5.1 字段对照（Item → metadata）

| `PaperMetadata` / catalog | Translator Item 来源 | 说明 |
|---|---|---|
| `title` | `title` | 必填；缺失则失败 |
| `authors` | `creators[]` → 展示串 | `firstName`+`lastName` 或 `name`；优先 `creatorType=author` |
| `creators_json` | `creators` 原数组 | 保留角色（author/editor…），JSON 文本 |
| `year` | 自 `date` 解析四位年 | |
| `date` | `date` | 原始日期串（如 `2017-06-12`） |
| `abstract` | `abstractNote` | |
| `summary` | 截断 `abstractNote` 或 Translator 短摘要 | 可选 |
| `doi` | `DOI` | |
| `isbn` | `ISBN` | 图书 |
| `issn` | `ISSN` | |
| `pmid` | `extra` 中 `PMID:` 或字段 | |
| `arxiv_id` | `archiveID` / `extra` 的 `arXiv:` / 用户输入 | 去 version |
| `publication` | `publicationTitle` \| `proceedingsTitle` \| `bookTitle` | 期刊/会议/书名 |
| `volume` | `volume` | |
| `issue` | `issue` | |
| `pages` | `pages` | |
| `publisher` | `publisher` | |
| `place` | `place` | 出版地 |
| `series` | `series` | |
| `language` | `language` | |
| `source_url` | `url` | 条目页；缺省时按类型推导 |
| `pdf_url` | attachments 中 pdf 的 `url`（若有） | **只存 URL**；arXiv 可再推导 |
| `html_url` | — | arXiv 可推导 `…/html/{id}` |
| `tags` | `tags[].tag` | |
| `zotero_item_type` | `itemType` | 如 `journalArticle`、`preprint`、`book` |
| `meta_source` | `libraryCatalog` | 如 `DOI.org (Crossref)`、`arXiv.org` |
| `extra` | `extra` | 未结构化残余 |
| `type` | 由 `zotero_item_type` + 标识符推断 | 有 `arxiv_id`→`arxiv`；有 `doi`→`doi`；book→`other` 等 |
| `id` | arXiv ID 或 citekey | |
| `bibtex_key` | 生成或沿用 | 作者+年+题词 |
| `path` | Host 用 `parent_dir`+`id` 写入 | 入库时填 |
| `status` | Host | 入库完成 → `completed` |
| `added_at` / `updated_at` | Host | ISO 8601 |
| `body_source` / `body_quality` | 魔棒通常不填 | 无本地正文解析 |
| `citation_count` | 一般无 | 可空 |

### 5.2 URL 补全（仍不下载）

在 map 之后、写库之前：

1. 若有 `arxiv_id` 且缺 URL → `arxiv.ts`：`pdf_url` / `html_url` / `source_url`。
2. 若有 `doi` 且缺 `source_url` → `https://doi.org/{doi}`。
3. 若有 `pmid` 且缺 `source_url` → PubMed 条目 URL。
4. **禁止**因补全 URL 而发起 PDF 文件下载。

### 5.3 中间结果

入库前 Host 手中只有 **`PaperMetadata`（已 map）**；不必单独长期持有 Zotero Item。调试可选暂存 `raw` 日志，不进 catalog。

```ts
// 概念：一次魔棒调用
const item = await translator.searchOrWeb(input); // Zotero Item
const metadata = mapZoteroItemToPaperMetadata(item); // → PaperMetadata
enrichRemoteUrls(metadata); // arxiv/doi 推导
await catalog.upsert({ ...metadata, path });
```

---

## 6. Tauri 命令与事件（契约）

命令名采用 `lookup:*`，与 `arxiv:*` / `pdf:*` 并列。完整登记见 [`api.md`](api.md)（实现时同步）。

### 6.1 `lookup:parse`

从文本提取标识符，**不访问网络**。

```ts
// 参数
{ text: string; mode?: 'zotero' | 'line_by_line' }

// 返回
{
  ok: true;
  data: { identifiers: ParsedIdentifier[] }
}
```

### 6.2 `lookup:search`

解析 + 调用 Translator Runtime（或 fallback），返回草稿列表。

```ts
// 参数
{
  text: string;
  mode?: 'zotero' | 'line_by_line';
  /** 强制只用 fallback，用于调试 */
  force_fallback?: boolean;
}

// 返回
{
  ok: true;
  data: {
    drafts: LookupDraft[];
    failures: { raw: string; code: string; message: string }[];
    runtime: { mode: string; used: 'translator' | 'fallback' };
  }
}
```

### 6.3 `lookup:import`

将解析结果写入目标 Papers 文件夹 + catalog；下载策略见 §1.3。

```ts
// 参数
{
  /** Vault 相对父目录：`papers` 或 `papers/nlp` 等（见 §1.2） */
  parent_dir: string;
  items: {
    draft_id?: string;
    metadata: PaperMetadata; // 可含 pdf_url / html_url / source_url
    on_duplicate?: 'skip' | 'open_existing';
  }[];
  options?: {
    /**
     * 来自设置 `downloadFulltextToLocal`（默认 false）。
     * true：有 pdf_url/html_url 时也下载到 source/。
     * false：有预览 URL 时不下载。
     * 注意：无 pdf_url 且无 html_url 时，无论本标志，都尝试下载。
     */
    download_fulltext_to_local?: boolean;
    /** Agent 生成 NOTES；默认 false 写占位模板 */
    generate_notes?: boolean;
  };
}

// 返回
{ ok: true; data: { job_id: string } }
// 或同步：{ ok: true; data: { paths: string[] } }
```

**Host 行为**：

1. 规范化 `parent_dir`（必须位于 `papers` 下）。
2. `path = {parent_dir}/{id}`。
3. 创建目录 + 占位 `NOTES.md` + 空 `highlights.md`。
4. **事务 upsert catalog**（远程 URL 只存字符串）。
5. **下载判定**（伪代码）：
   ```text
   has_preview = nonEmpty(pdf_url) || nonEmpty(html_url)
   if has_preview and not options.download_fulltext_to_local:
     skip download                    # 远程预览即可
   else:
     url = pdf_url or html_url or resolve_downloadable_url(metadata)
     if url:
       try download(url) → source/    # 无预览 URL 时必走此支；有 URL 且设置开也走
     else:
       skip download                  # 真的无法下载
   ```
6. 返回 `path`；前端刷新并打开 paper。

### 6.4 事件

| 事件 | 载荷 |
|---|---|
| `lookup:progress` | `{ job_id, done, total, current_id?, phase }` |
| `lookup:item_completed` | `{ job_id, path, id }` |
| `lookup:item_failed` | `{ job_id, draft_id, code, message }` |
| `lookup:completed` | `{ job_id, paths: string[] }` |
| `lookup:failed` | `{ job_id, message }` |
| `translator:status` | Runtime 状态（可选） |

### 6.5 `translator:status` / `translator:restart`（设置页）

供设置页显示 Runtime 是否就绪、手动重启 sidecar。

---

## 7. 许可、隐私与合规

### 7.1 许可

| 组件 | 许可（典型） | Motif 用法 |
|---|---|---|
| `zotero/translators` | 多为 AGPL-3.0 | **仅在 sidecar 进程内**使用与分发 |
| `zotero/translate` / translation-server | AGPL-3.0 | 旁路进程；源码按 AGPL 提供或指向上游 |
| Motif 主应用 | 以仓库 LICENSE 为准 | 通过 **HTTP localhost** 调用 sidecar，不把 translators 链进主二进制 |

产品文案建议：

- 设置页注明：「书目解析可选用 Zotero Translator 引擎（开源，AGPL），运行在本机独立进程。」
- 不声称「Official Zotero」；不使用 Zotero 商标做应用名。

### 7.2 隐私与网络

- 标识符与查询会发往 **第三方书目服务**（Crossref、PubMed、出版社 DOI 解析等），由各 Translator 决定，**不经 Zotero 公司服务器**（自托管 Runtime 时）。
- Motif 默认 **不**把 Vault 路径或笔记内容发给 Translator Runtime（Search 路径只传 ID）。
- 遵守目标站 ToS；控制并发与超时；批量入库限流。

### 7.3 local-first

- 元数据确认后写入 **用户 Vault** + **catalog**；离开应用后仍是普通文件 + sqlite。
- 不引入「仅云端可解析」为默认；Runtime 可离线则仅失败，不锁死 Vault。

---

## 8. 前端 UI（概要）

详细视觉以 [`ui.md`](../frontend/ui.md) 为准；本处只定行为。

### 8.1 入口

- 工具栏 **魔棒图标**（`WandSparkles` 等），Tooltip + `aria-label` → i18n `lookup.magicWand`。
- 快捷键：`⇧⌘I`（写入 `shortcuts.ts` + 设置 Keyboard）。
- 无 Vault 时 disabled。

### 8.2 主交互流（v1）

```text
点击魔棒
  → 弹出输入框（单行或小多行）：placeholder 如 “arXiv URL / ID, DOI, …”
  → 展示目标路径提示：将加入「papers/」或「papers/nlp/」（来自 §1.2）
  → 用户 Enter 或点「添加」
  → lookup:search（Translator）→ 可选极简预览
  → lookup:import({ parent_dir, items, download_fulltext_to_local: settings… })
  → 成功：刷新文件树；打开该 paper（PDF 视图读 catalog.pdf_url）
  → 失败：toast / 行内错误，不写半截 catalog
```

**默认体验偏好**：少步骤——解析成功即可入库；仅在 **重复** 或 **解析到多结果** 时打断确认。

文案：English 源语言 `en`，同步 `zh-CN`。无常驻说明段落。

### 8.3 目标文件夹展示

- 弹层内一行：`t('lookup.addTo', { path: parentDirDisplay })`。
- 用户切换文件树选中项后再次打开魔棒，目标随之更新（打开弹层时快照一次即可）。

---

## 9. Host 模块布局（规划）

```text
src-tauri/src/
  commands/
    lookup.rs
    translator.rs          # status / restart
  services/
    lookup/
      mod.rs
      parse.rs             # extractIdentifiers 规则
      client.rs            # Runtime HTTP
      map.rs               # Zotero JSON → PaperMetadata
      dedupe.rs
      fallback/
        mod.rs
        crossref.rs
        arxiv.rs
    importer/
      mod.rs               # 统一落盘
      from_metadata.rs     # 魔棒确认后的 metadata-only / optional source
    translator_runtime/
      mod.rs               # spawn / health / shutdown
```

前端：

```text
src/
  components/lookup/
    MagicWandButton.tsx
    LookupPopover.tsx
    LookupDraftList.tsx
  lib/lookup.ts            # invoke 封装
  i18n/locales/{en,zh-CN}/lookup.json
```

---

## 10. 入库落盘契约（魔棒）

```text
papers/
└── [optional-subfolders/]
    └── <id>/
        ├── NOTES.md
        ├── highlights.md
        └── source/            # 无预览 URL 时尽量有；有 URL 且设置开时也有
            └── …pdf / …
# catalog.papers：path, title, pdf_url, html_url, …
```

1. `path = {parent_dir}/{id}`（§1.2 + §6.3）。
2. 写 `NOTES.md` + `highlights.md`。
3. **catalog 事务**：有则写入 `pdf_url` / `html_url`。
4. 下载按 §1.3：**无预览 URL 必下**；有 URL 仅设置开时下。
5. **不**写默认 `PAPERS.md` / `library.bib` / `metadata.json`。
6. 重复：`on_duplicate: skip | open_existing`，**不**覆盖用户 `NOTES.md`。

arXiv 远程 URL 推导（无下载）：

- `pdf_url`: `https://arxiv.org/pdf/{id}`
- `html_url`: `https://arxiv.org/html/{id}`
- `source_url`: `https://arxiv.org/abs/{id}`

`type`：`arxiv` | `doi` | `other`（按标识符）。

---

## 11. 实现分期

### Phase A — 交互闭环（可先 fallback）

- [x] 文档：交互、目标文件夹、不下载约定
- [ ] 魔棒 Popover + `parent_dir` 解析 + i18n
- [ ] `lookup:parse` + arXiv/DOI fallback 客户端
- [ ] `lookup:import`：catalog + NOTES 壳，**无下载**

### Phase B — Translator Runtime

- [ ] sidecar + `lookup:search` → `POST /search`（及链接时 `/web`）
- [ ] map / dedupe / 设置页状态

### Phase C — 体验打磨

- [ ] 重复提示、批量、打开 paper 联调
- [ ] 与文件树选中态同步目标路径

### Phase D — 可选

- [x] 设置：`downloadFulltextToLocal`（有预览 URL 时是否也下载；无 URL 始终下载）— UI 已加
- [ ] PDF prepare 复用同一 Lookup

---

## 12. 测试要点

| 层级 | 内容 |
|---|---|
| 单测 `parse` | arXiv URL/ID、DOI、version 剥离 |
| 单测 `parent_dir` | 根 / 子文件夹 / paper 内文件 → 父目录 |
| 单测 import | catalog 有 `pdf_url`；`source/` 不出现 pdf |
| UI | 目标路径文案；无 Vault；重复 skip |

---

## 13. 验收标准

1. 点击魔棒，粘贴链接或编号，成功后 paper 壳 + **catalog 有行**。  
2. **无** `pdf_url`/`html_url`：无论设置，尽量下载到 `source/`。  
3. **有** 预览 URL + 设置关：不下载，远程预览。  
4. **有** 预览 URL + 设置开：catalog 保留 URL 且下载到 `source/`。  
5. 文件树选中 `papers/nlp` 时路径为 `papers/nlp/<id>/`。  
6. 重复不覆盖 `NOTES.md`；文案 i18n。

---

## 14. 开放问题

1. **sidecar 分发**方式（捆绑 / Docker / 首次下载）。  
2. v1 是否「解析成功即入库」还是始终二次确认。  
3. `generate_notes` 默认是否调 Agent（建议默认占位模板）。  

---

## 15. 修订记录

| 日期 | 说明 |
|---|---|
| 2026-07-15 | 初稿：Translator sidecar、命令契约 |
| 2026-07-15 | 交互收敛：链接/编号 → Translator → 加入 papers/ 或当前子文件夹；远程 URL 只写 catalog、不下载 |
| 2026-07-15 | 数据流合并：arXiv/DOI 等统一 Translator → 直接 map 进 PaperMetadata；catalog schema v2 补字段 |
| 2026-07-15 | 下载策略：无预览 URL 始终尝试下载；有 URL 时仅 `downloadFulltextToLocal` 开才额外本地下载 |
