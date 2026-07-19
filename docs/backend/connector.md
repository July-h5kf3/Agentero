# Zotero Connector 兼容服务（方案一）

> 状态：**MVP 已落地**（元数据保存 + 文件夹选择 + 超时规避 + **附件二进制上传 `saveAttachment`** + **远程 Vault（SSH）**；**快照 / cookies 仍待**）  
> 范围：Agentero Host 在本机 **模拟 Zotero 桌面端 Connector HTTP Server**，使官方 [Zotero Connector](https://www.zotero.org/download/connectors) 浏览器扩展把「保存」请求打到 Agentero，条目落入当前 Vault 的 catalog + paper 文件夹。  
> 实现入口：`src-tauri/src/services/connector/`、`commands/connector.rs`、`src/lib/connector.ts`、设置 → 通用、`App.tsx` 监听 `connector:*`。  
> **HTTP 覆盖总表**：见本文 [§4.5](#45-上游-api-覆盖总表实现-vs-缺口)。  
> 相关：[`identifier-lookup.md`](identifier-lookup.md)（魔棒入库与 `map_zotero_item`）、[`paper-import-pipeline.md`](paper-import-pipeline.md)（与其它入库入口的统一 `paper_commit` 方案）、[`catalog.md`](catalog.md)、[`api.md`](api.md)、[`data-model.md`](data-model.md)、[`../frontend/ui.md`](../frontend/ui.md)、[`../development/roadmap.md`](../development/roadmap.md)、[`../development/todo.md`](../development/todo.md)。

---

## 1. 产品目标

### 1.1 要解决的问题

用户已习惯在浏览器里点 **Zotero Connector** 一键保存论文/网页。Agentero 已有：

- **魔棒**（粘贴 ID/URL → Translator → 入库）
- **从 Zotero 数据目录迁移**（存量 `zotero.sqlite`）

仍缺：**浏览网页时与官方插件同一入口的增量捕获**。

方案一：**不改官方插件**，在 Agentero 内实现与 Zotero 桌面端兼容的本地 HTTP API，**占用（或兼容）`127.0.0.1:23119`**，让 Connector 以为本机 Zotero 在线。

### 1.2 用户故事

1. 用户打开 Agentero，打开某个 Vault（**本地路径**或 **Open Remote Vault**）。
2. 在 **设置** 中开启「兼容 Zotero Connector」（**默认关**）。
3. Host 在 `127.0.0.1:23119` 启动 Connector 兼容服务；若端口被 Zotero 占用则明确失败提示。
4. 用户在浏览器使用 **官方 Zotero Connector** 点保存（arXiv、DOI 页、期刊站等）。
5. Connector 将 translator 产出的 items JSON POST 到本机；Agentero 写入 `papers/…` + catalog，并按现有策略尽量下载 PDF。**远程 Vault** 时先 stage 再 SFTP 上传，catalog 经 work mirror PUT。
6. Agentero 刷新文件树 / Library；**`openPaper` 打开（或聚焦）该论文标签页**（与魔棒入库一致；附件 `saveAttachment` / 会话移动再次发出事件时亦会聚焦）；可选 toast 成功摘要。
7. 用户关闭开关或退出应用时释放端口。

**Vault 绑定**：`connector_set_vault` 接受本地绝对路径或 `remote:<sessionId>`。`remote_connect` 成功时 Host **立即**绑定 Connector；前端在 `vaultPath` 变化与 Connector 开启时再次同步。设置状态应显示 Listening 且带 vault（远程为 `remote:…`）；若提示 *No vault open*，请确认已打开知识库并已开启 Connector，远程场景请重新连接一次远程库。

### 1.3 与其它入库路径的边界

| 路径 | 入口 | 元数据来源 | 与本方案关系 |
|---|---|---|---|
| 魔棒 `lookup_import` | 侧栏 ⇧⌘I | Host 调 Translator Runtime | **并存**；落盘应对齐同一 paper 单元语义（统一方案见 [`paper-import-pipeline.md`](paper-import-pipeline.md)） |
| 本地 PDF 导入 | 魔棒弹层多选 | 文件名 + liteparse | 并存；目标共用 `paper_commit` |
| Zotero 迁移 | 欢迎页 / 侧栏 | `zotero.sqlite` + storage | **存量**；本方案是 **增量** |
| Connector 兼容（本方案） | 官方浏览器插件 | 插件侧 Translator → HTTP | 本文件 |
| 自研浏览器扩展 | 未来 | 任意 | 不阻塞；可共用入库核心，不必抢 23119 |

### 1.4 非目标（首版不做）

| 不做 | 说明 |
|---|---|
| 与 **同时运行的 Zotero 桌面端** 共用 23119 | 端口互斥；不做流量分流/透明代理 |
| 完整复刻 Google Docs / Word 引用集成（`/connector/document/*`） | 引用插入协议另案 |
| 在 Agentero 内实现 Translator 全量库 | 页面识别仍由 **官方 Connector** 完成 |
| 在线 zotero.org 回退路径 | 插件在「无桌面」时会走 zotero.org；我们只做本机 server |
| 修改或再分发官方 Connector 扩展 | 协议兼容即可 |
| 复制 AGPL 源码进产品 | 按 HTTP 契约 **重写**（Rust）；不 fork 大段 JS |
| 跨机器 / 非 loopback 暴露 | **禁止** `0.0.0.0` 默认监听 |
| CLI 独立 connector server | 首版仅桌面 Host；CLI 可后续只读文档对齐 |

---

## 2. 上游协议摘要

### 2.1 开源位置

| 角色 | 仓库 | 关键路径 |
|---|---|---|
| 浏览器插件（客户端） | [zotero/zotero-connectors](https://github.com/zotero/zotero-connectors) | `src/common/connector.js`（`callMethod`）、`src/common/zotero.js`（`connector.url` 默认 `http://127.0.0.1:23119/`） |
| 桌面 HTTP 框架 | [zotero/zotero](https://github.com/zotero/zotero) | `chrome/content/zotero/xpcom/server.js` |
| Connector endpoints | 同上 | `chrome/content/zotero/xpcom/connector/server_connector.js` |
| 官方说明 | Zotero Docs | [Connector HTTP Server](https://www.zotero.org/support/dev/client_coding/connector_http_server) |

通信方向：**仅插件 → 本机 HTTP**；Zotero/Agentero 不会主动推消息给插件。

### 2.2 请求惯例

```text
POST http://127.0.0.1:23119/connector/{method}
Content-Type: application/json
X-Zotero-Version: <plugin version>
X-Zotero-Connector-API-Version: 3

Body: JSON（method 相关）
```

- 默认 base：`http://127.0.0.1:23119/`（插件 pref `connector.url`）。
- `ping` 亦支持 GET（浏览器探活页）。
- 成功时响应头建议带回：`X-Zotero-Version`（可用 Agentero 版本或固定兼容串）、`X-Zotero-Connector-API-Version`。

### 2.3 上游安全模型（实现时必须对齐的部分）

来自 `server.js` 的要点（Agentero 应 **等价或更严**）：

1. **只绑 loopback**（`127.0.0.1`，可选另绑 `::1` 视平台；禁止默认 `bindAll`）。
2. **Host 头校验**：仅允许 `localhost` / `127.0.0.1`（可带端口），防 DNS rebinding。
3. **浏览器简单请求防护**：对像浏览器的 UA / 带 Origin 的请求，若缺少 `X-Zotero-Connector-API-Version`（或等价白名单头）且 content-type 为 simple 类型，应 403；`application/json` 依赖预检，不向任意 Origin 滥发 CORS。
4. **无 API Key**：本机任意进程可调用——这是协议现实；产品文案需写明风险，且不得把 server 暴露到局域网。

---

## 3. Agentero 目标架构

```text
官方 Zotero Connector（浏览器）
        │  HTTP POST /connector/*
        ▼
Agentero Host  Connector Server（127.0.0.1:23119）
        │  解析 items / session
        ▼
services/connector  →  map_zotero_item（复用 lookup/map）
        │
        ▼
写 papers/<id>/ + catalog.sqlite
（对齐 lookup_import：NOTES 壳、尽量 PDF、arXiv TeX…）
        │
        ▼
Tauri event: connector:item-saved / connector:error
        │
        ▼
前端：刷新树 / Library；openPaper（打开/聚焦论文 tab）；Toast（成功或失败）
```

| 层 | 职责 |
|---|---|
| **HTTP Server** | 绑定端口、路由、安全头、JSON 编解码、session 表 |
| **Handlers** | `ping` / `saveItems` / `sessionProgress` / stub 集合 |
| **Import core** | Zotero item JSON → `PaperMeta` → 落盘（优先复用 `lookup` 管线） |
| **Lifecycle** | 设置开关、Vault 有无、端口冲突、启停 |
| **Frontend** | 开关 UI、状态、事件消费 |

**不**在 Webview 里开 HTTP server；必须在 **Rust Host**，以便后台入库与 fs 权限一致。

---

## 4. HTTP 契约（实现规范）

### 4.1 版本与兼容策略

| 项 | 约定 |
|---|---|
| 对外宣称 | 兼容 Connector API **v2/v3 常用保存路径**（以官方插件当前主线为准） |
| 未知 endpoint | `404` 明文 `No endpoint found`（与上游风格接近即可） |
| 不支持的 method | `400` / `501` 明确 body |
| 破坏性差异 | 记入本文 §11 与 changelog；避免静默丢附件而不回成功 |

### 4.2 MVP endpoints（必须）

#### `GET|POST /connector/ping`

| | |
|---|---|
| **用途** | 插件与用户探活（`http://127.0.0.1:23119/connector/ping`） |
| **GET 响应** | `200` `text/html`，正文含可识别文案，例如 `Zotero Connector Server is Available`（插件/文档多依赖此语义，**建议保留该英文句**以免探活页误判） |
| **POST 响应** | `200` `application/json`，至少：`{ "prefs": { "automaticSnapshots": false, "downloadAssociatedFiles": true, … } }`（字段可按插件需要逐步补齐） |
| **实现注意** | GET 可无 JSON body；不要要求 API version 头（上游对 ping 有白名单倾向） |

#### `POST /connector/saveItems`

| | |
|---|---|
| **Content-Type** | `application/json` |
| **请求体（概念）** | 见下表 |
| **成功** | `201` + JSON：`{ "items": [ { id, title, itemType, attachments?: […] } ], "singleFile"?: bool }`（字段以插件解析需要为准；可先返回最小集） |
| **会话冲突** | `409` `{ "error": "SESSION_EXISTS" }` |
| **无 Vault / 只读** | `500` 或 `503` + 可读 error；并 `connector:error` 事件 |

**请求体关键字段：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `sessionID` | string | 插件生成；session 表键；冲突则 409 |
| `uri` / `url` | string | 来源页；用于 referrer、id 推导、cookie 沙箱语义（首版可只记 `source_url`） |
| `items` | array | **Zotero item 对象数组**（非 Agentero `PaperMetadata`） |
| `detailedCookies` | string? | 附件下载 cookie；MVP 可忽略并仍存元数据 |
| `proxy` | object? | 首版可忽略 |

**单个 item 常见字段（子集）：**  
`itemType`, `title`, `creators[]`, `abstractNote`, `DOI`, `url`, `publicationTitle`, `date`, `tags`, `attachments[]`（`title`, `url`/`mimeType`, `snapshot`…）, 以及插件自定义的临时 `id`（用于后续 attachment 关联）。

**服务端行为（Agentero）：**

1. 校验：已开启兼容服务、当前窗口/应用有 **活跃 Vault**。
2. 为每个 top-level item：
   - `map_zotero_item`（或等价）→ `PaperMeta`；
   - `meta_source` 建议标记为 `zotero-connector`（或现有枚举扩展）；
   - 目标 `parent_dir`：见 §5.2；
   - 创建 paper 文件夹 + catalog 行（对齐 `lookup_import` / migration 的去重策略，见 §5.3）；
   - **尽量**下载 PDF（attachments 中 PDF URL、或 DOI/arXiv 派生 URL）；失败不导致整次 5xx，但 progress 可标失败。
3. 注册 session，供 `sessionProgress` 查询。
4. 尽快返回 `201`（可先完成元数据落盘，附件异步——若异步，progress 必须反映，避免插件一直转圈）。
5. emit `connector:item-saved`（每篇或批量一次，见 §7）。

#### `POST /connector/sessionProgress`

| | |
|---|---|
| **请求** | `{ "sessionID": "…" }` |
| **响应** | `200` `{ "items": [ progress… ], "done": bool }` |
| **用途** | 插件进度条；`done: true` 后插件停止轮询 |
| **MVP** | 元数据写入完成后即可 `done: true`；附件未完时可阶段性更新百分比 |

#### 已实现的集合与会话

| Endpoint | 行为 |
|---|---|
| `POST /connector/getSelectedCollection` | 当前选中父目录 + **`targets`**：`L1`=`papers`，`Dpapers/…`=组织子文件夹（跳过 paper 单元：`NOTES.md` / `metadata.json` / `{id}.pdf`）；供插件保存位置下拉 |
| `POST /connector/updateSession` | `sessionID` + `target`：解析目标并 **移动** 本 session 已写入的 paper 文件夹 + 更新 catalog path；同时记住默认 `parent_dir`；`tags` 暂未写入 catalog |
| `POST /connector/delaySync` | `204` 空（无真实 sync） |

### 4.3 下一阶段 endpoints（快照 / cookies 未实现）

**已实现（PR3 C4b）：**

| Endpoint | 行为 |
|---|---|
| `POST /connector/saveAttachment` | 浏览器上传的附件（登录墙 PDF，插件用页面 cookie 拉取）。Body = 原始字节；`X-Metadata` 头携 `{ sessionID, parentItemID, title, url }`。按 `parentItemID` → session item 映射解析目标 paper（无映射时回退本 session 最近一篇），校验 `%PDF` magic 后写 `{paper}/{id}.pdf`，触发 `PAPER.md`（幂等）+ `connector:item-saved`。`ping` 回 `supportsAttachmentUpload: true`；body 上限 200 MiB。 |

**未实现：**

| Endpoint | 说明 | 优先级 |
|---|---|---|
| `POST /connector/saveSnapshot` | 网页条目 + 可选快照 | **P0** |
| `POST /connector/saveSingleFile` | SingleFile 整页 HTML | **P0**（可降级为仅元数据 + `html_url`） |
| `detailedCookies`（在 `saveItems` 内消费） | 用浏览器 cookie 下 PDF | **P0** |
| `POST /connector/detect` | 服务端 HTML 检测 translator | P1 |
| `POST /connector/savePage` | 服务端翻译整页；多选时 300 | P1 |
| `POST /connector/selectItems` | 多条目勾选后续 | P1 |
| `POST /connector/attachmentProgress` | 旧版按 id 查附件进度 | P1（新版多用 `sessionProgress`） |

### 4.4 低优先级 / 明确不做

| Endpoint / 能力 | 说明 |
|---|---|
| `POST /connector/getTranslators` | 桌面拉 translator 列表；现代插件多自带缓存 |
| `POST /connector/getTranslatorCode` | 拉单个 translator 源码 |
| `POST /connector/proxies` | 代理规则列表 |
| `POST /connector/getClientHostnames` | 本机反解 hostname |
| `POST /connector/import` | 任意格式导入（与 Library BibTeX 分离） |
| `POST /connector/installStyle` | 安装 CSL |
| `GET /connector/ieHack` | 极旧 IE bookmarklet |
| `/connector/document/*` | Word / Google Docs **引用插入**（另案） |
| `/api/*` Local Read API | 读库；勿与 connector 写路径混在同一开关文案 |

### 4.5 上游 API 覆盖总表（实现 vs 缺口）

对照官方桌面端 `server_connector.js` 与社区常用扩展路径。路由以本机 `http://127.0.0.1:23119` 为准。

| Endpoint | Agentero | 备注 |
|---|---|---|
| `GET/POST /connector/ping` | ✅ | HTML 探活 + prefs JSON |
| `POST /connector/saveItems` | ✅ 基本 | 元数据同步落盘；PDF URL **后台**下；无 cookie；NOTES 不做实时 MT（防 15s 超时） |
| `POST /connector/sessionProgress` | ✅ 简版 | `done` 在元数据完成后即为 true；附件进度多为占位 |
| `POST /connector/getSelectedCollection` | ✅ | `targets` 含组织子文件夹 |
| `POST /connector/updateSession` | ✅ | 切换 target 移动 paper；tags 未写 |
| `POST /connector/delaySync` | ✅ stub | `204` |
| `POST /connector/saveAttachment` | ✅ | 登录墙 PDF：浏览器字节上传；`parentItemID`→paper；`%PDF` 校验；触发 PAPER.md |
| `POST /connector/saveSnapshot` | ❌ | 普通网页保存 |
| `POST /connector/saveSingleFile` | ❌ | 插件 snapshot 链路 |
| `POST /connector/detect` | ❌ | 旧/bookmarklet 路径 |
| `POST /connector/savePage` | ❌ | 服务端翻译 + 多选 |
| `POST /connector/selectItems` | ❌ | 配合 savePage 300 |
| `POST /connector/attachmentProgress` | ❌ | 旧附件进度 |
| `POST /connector/getTranslators` | ❌ | 现代插件通常不依赖 |
| `POST /connector/getTranslatorCode` | ❌ | 同上 |
| `POST /connector/proxies` | ❌ | 可选 |
| `POST /connector/getClientHostnames` | ❌ | 可选 |
| `POST /connector/import` | ❌ | 另有 Library 导入 |
| `POST /connector/installStyle` | ❌ | 不做 |
| `GET /connector/ieHack` | ❌ | 不做 |
| `/connector/document/*` | ❌ | 引用集成另案 |
| `/api/*` | ❌ | Local Read 另案 |

**已实现路径上的行为缺口（有路由但不完整）：**

| 能力 | 现状 |
|---|---|
| 订阅站 / 登录墙 PDF | ✅ `saveAttachment` 浏览器上传；`detailedCookies` 仍未做 |
| `singleFile: true` | 固定回 `false`，不接 `saveSingleFile` |
| 摘要中文 MT | Connector 路径关闭（超时纪律） |
| `updateSession.tags` | 忽略 |
| 附件真实 progress % | 占位；URL 下载在后台 |
| 可配置端口 | 写死 `23119` |

**建议补齐顺序：** ~~`saveAttachment`~~ ✅ → `saveSnapshot` / `saveSingleFile`（可降级）→ `detailedCookies` →（按需）`detect`/`savePage`/`selectItems`。

---

## 5. 数据映射与落盘

### 5.1 Item → PaperMeta

优先 **复用** `services/lookup/map.rs` 的 `map_zotero_item`（魔棒 Translator 与 Zotero 迁移已用同一形状）。

| Zotero / Connector 字段 | Agentero |
|---|---|
| `itemType` | `type` / `zotero_item_type` |
| `title` | `title` |
| `creators` | `authors` + 可选 `creators` JSON |
| `DOI` | `doi`；参与 id 推导 |
| `url` / 页面 `uri` | `html_url` / `source_url` |
| `date` / year | `date` / `year` |
| `abstractNote` | `abstract` |
| `tags` | `tags` |
| attachment PDF url | `pdf_url` + 下载到论文根目录 |
| arXiv 可识别 id | `arxiv_id` + e-print 策略（与 lookup 一致） |

`id` / 文件夹名：沿用 lookup 的 slug 规则（arxiv id、doi 压缩、title slug 等）；**禁止**路径穿越。

### 5.2 目标目录 `parent_dir`

| 策略 | 行为 |
|---|---|
| **默认** | `papers` |
| **插件下拉** | `getSelectedCollection.targets`：`L1` → `papers`；`Dpapers/nlp` → `papers/nlp`（见 `services/connector/targets.rs`） |
| **updateSession** | 改 session + 全局默认 parent；已写入 paper **fs rename** + catalog `move_under_path` |
| **前端同步** | Library 作用域 / `connector_set_parent_dir` 写入默认 parent |

target id 约定（非 Zotero collection 数字 ID）：

- `L1` = 库根 = `papers`
- `D` + vault 相对路径 = 组织文件夹，如 `Dpapers/nlp/pretrain`

### 5.3 去重

| 情况 | 建议行为 |
|---|---|
| 同 `doi` / `arxiv_id` / 规范化 `url` 已在 catalog | **跳过创建**或更新远程 URL；返回 201 但仍用已有 path；事件标明 `deduped: true` |
| 仅标题相同 | 不自动合并；新建 slug 后缀 |
| 重复 `sessionID` | `409 SESSION_EXISTS` |

与魔棒一致：不覆盖用户已有 `NOTES.md` 手写内容；重复导入以 skip / open 语义为主。

### 5.4 附件与 cookie

- **当前**：`saveItems` 元数据返回后，后台 `ensure_paper_assets`（公开 PDF URL / arXiv）；**不**阻塞 201。
- **已做**：`saveAttachment` 二进制上传（浏览器用页面 cookie 拉取登录墙 PDF → Vault；`supportsAttachmentUpload: true`；body 上限 200 MiB）。
- **未做**：`detailedCookies` 注入（无 `saveAttachment` 时校园网 PDF 仍可能失败 → 用户可 Download 补下）。
- **纪律**：`saveItems` 同步路径禁止摘要 MT + 同步大附件，以免官方插件 **15s 超时**。

### 5.5 精读自动触发

与 **批量导入** 一致：**默认不**因 Connector 保存自动跑 paper-reader（避免连点保存打爆 Agent）。用户可手动 Zap；若未来加开关，须独立于 `autoPaperReader` 或明确复用并写进设置说明。

---

## 6. 生命周期与端口冲突

### 6.1 状态机

```text
disabled ──(用户开启 + 有 Vault)──► starting
starting ──(bind 成功)──► listening
starting ──(EADDRINUSE / 其它)──► error（保持开关 UI 可关；显示原因）
listening ──(用户关闭 / 退出应用)──► stopped
listening ──(Vault 关闭)──► 可选：保持 listening 但 saveItems → 503
                     或自动 stop（推荐 **save 时校验 Vault**，进程可仍监听以便 ping）
```

### 6.2 端口

| 项 | 约定 |
|---|---|
| 默认端口 | **23119**（与 Zotero 一致，否则官方插件默认连不上） |
| 可配置 | 设置允许改端口 **仅当**用户同时会改 Connector 高级里的 server URL；文案必须说明；MVP 可 **写死 23119** 降复杂度 |
| 冲突 | bind 失败 → 状态 `error`，i18n 提示「端口被占用（常见：Zotero 正在运行），请退出 Zotero 后重试」 |
| Zotero 后启动 | Zotero 会无法初始化 HTTP server；用户需二选一——产品说明写清 **互斥** |

### 6.3 多窗口

- HTTP server **进程级单例**（不随每个 Webview 起一份）。
- **活跃 Vault**：取「最近聚焦窗口」的 Vault，或「主窗口」Vault；无 Vault 时 `saveItems` 失败。
- 实现可用 `Mutex<ConnectorState>`：`vault_path`、`parent_dir`、sessions。

### 6.4 应用退出

- `RunEvent::Exit` / 窗口全关前 **drop listener**，释放端口。
- 不留孤儿线程占 23119。

---

## 7. Host API（Tauri）与事件

### 7.1 Commands（已落地）

| Command | 方向 | 说明 |
|---|---|---|
| `connector_get_status` | 读 | `{ enabled, listening, port, boundAddress, lastError?, vaultPath?, parentDir }` |
| `connector_set_enabled` | 写 | `{ enabled: bool }` → 启停 server |
| `connector_set_vault` | 写 | `{ vaultPath: string \| null }` |
| `connector_set_parent_dir` | 写 | `{ parentDir: string }` — 默认保存父目录 |

设置权威：**XDG `settings.json`** 存 `connectorEnabled`（前端缓存经 `settings_get` / `settings_set`）；启动时 `App` 调 `set_enabled`；Vault / Library 作用域同步 vault 与 parent。类型细节见 [`api.md`](api.md) §3.5b。

### 7.2 Events

| 事件 | payload（概念） | 前端 |
|---|---|---|
| `connector:status` | 与 get_status 同形 | 设置页指示灯 |
| `connector:item-saved` | `{ path, id, title, deduped?, sessionId }` | 刷新树、`paper_list`、**`openPaper(path)` 打开/聚焦论文 tab**、可选 toast |
| `connector:error` | `{ message, sessionId? }` | `notifyError` |
| `connector:progress` | 可选，细粒度附件进度 | 后台任务条（P1） |

多窗口：`emit` 广播或 `emit_to` 所有标签；刷新逻辑需幂等。

### 7.3 与 `api.md` 的关系

落地时在 [`api.md`](api.md) 增加 **§ Connector 兼容服务**，列出最终 command/event 蛇形名与类型；**HTTP 细节以本文为准**，避免 api.md 膨胀。

---

## 8. 设置与 UI

### 8.1 设置项

| Key | 默认 | 说明 |
|---|---|---|
| `connectorEnabled` | `false` | 总开关 |
| `connectorParentDir` | `"papers"` | 可选；MVP 可省略硬编码 |
| `connectorPort` | `23119` | 可选；MVP 可省略 |

**文案原则（i18n，en 源语言）：**

- 标题类似：**Zotero Connector compatibility**
- 说明必须包含：**与 Zotero 桌面端互斥（同端口）**；**仅本机 loopback**；开启后使用 **官方浏览器扩展** 保存到当前 Vault。
- 不要暗示「官方联合」或替换 Zotero 品牌为必需依赖以外的含义。

### 8.2 设置页位置

- **推荐**：设置 → **General** 一节「Connector」，与 `translatorBaseUrl` 分开（Translator = 魔棒元数据服务；Connector = 收插件保存）。
- 展示：Switch + 状态（Listening / Port in use / No vault / Off）+ 可选「复制探活 URL」。

### 8.3 成功反馈

- 非模态：右上角成功 toast（简短标题）或仅依赖树刷新。
- 失败：`notifyError`，不在侧栏挂常驻错误条。

### 8.4 后台任务条（P1）

若 PDF 下载较慢，可 `kind=connector` 任务；MVP 可省略。

---

## 9. 实现分期

### PR1 — 可保存元数据 ✅

- [x] `services/connector`：loopback server + `ping` + `saveItems` + `sessionProgress`
- [x] Host 校验 + Host/Origin 安全策略
- [x] 复用 `map_zotero_item` + catalog/paper 落盘（含 URL 侧 PDF 尽力下载）
- [x] `connector_set_enabled` / `get_status` / `set_vault` + 设置开关
- [x] 前端刷新 + i18n
- [x] 单测：样例 item 映射

**验收：** 关闭 Zotero → 开启开关 → 浏览器打开 arXiv 摘要页 → 官方 Connector 保存 → Vault 出现 paper 行与 `NOTES.md` 壳。

### PR2 — 体验与稳健性 ✅

- [x] 端口占用/无 Vault 的完整 UX
- [x] 去重策略落地（catalog `id`）
- [x] `getSelectedCollection` 列出组织子文件夹；`updateSession` 移动 paper
- [x] `delaySync` stub；退出释放端口；`connector:*` 事件
- [x] `saveItems` 防 15s 超时（后台资产、无 NOTES MT）
- [x] Library 作用域 → `connector_set_parent_dir`
- [x] `docs/backend/api.md` 命令表同步

### PR3 — 附件与快照（C4b 已做）

- [x] **C4b** `saveAttachment` 二进制上传
- [ ] **C4c** `saveSnapshot` / `saveSingleFile`（可降级）
- [ ] **C5a** `detailedCookies`
- [ ] （可选）`sessionProgress` 真实附件百分比；后台任务条

### PR4 — 可选 / 低优先级

- [ ] `detect` / `savePage` / `selectItems`
- [ ] `getTranslators` / `getTranslatorCode` / proxies
- [ ] 可配置端口（须用户改插件 `connector.url`）

### 非目标

- `/connector/document/*` 引用集成、完整 CSL install、IE hack、自研浏览器扩展为 MVP 前提。

---

## 10. 代码与文档落点（预估）

| 区域 | 规划路径 |
|---|---|
| Host | `src-tauri/src/services/connector/{mod,server,handlers,session}.rs` |
| Commands | `src-tauri/src/commands/connector.rs` |
| 注册 | `lib.rs`、`services/mod.rs`、`commands/mod.rs`、`Cargo.toml`（HTTP 依赖，如 `hyper`/`axum`/`tiny_http` + tokio net） |
| 映射复用 | `services/lookup/map.rs`（可能抽 `import_zotero_items`） |
| 前端 | `settings-window.tsx`、settings store、`App.tsx` 或 layout 事件 |
| i18n | `en/settings.json`、`zh-CN/settings.json` |
| 文档 | 本文、`api.md` 摘要、`roadmap` / `todo`、可选 `ui.md` §4 |

**文件数粗估：** MVP ~15–20；可上线含附件 ~25–35（见前期讨论）。

---

## 11. 风险与纪律

| 风险 | 缓解 |
|---|---|
| 与 Zotero 抢端口 | 默认关；冲突明确文案；不静默失败 |
| 无鉴权本机写接口 | 仅 127.0.0.1；Host 校验；不写进远程 |
| AGPL 污染 | 行为兼容、自主实现；不粘贴上游大段代码 |
| 插件升级改字段 | 契约测例 + 宽松解析；日志可开 debug |
| 误收非学术网页 | 与 Zotero 相同；用户责任；可后续过滤 `itemType` |
| 覆盖用户笔记 | 去重 skip；不覆盖已有 `NOTES.md` 正文 |
| 多 Vault 写错库 | 单例 + 明确「当前 Vault」规则 |
| Connector **15s 超时** | `saveItems` 仅同步写 catalog + NOTES 壳；PDF/TeX/liteparse **后台**下载；NOTES 摘要不做实时 MT |
| 系统 HTTP 代理劫持 `127.0.0.1` | 本机 Clash/Surge 等若代理 localhost，探活/保存会 502；需在代理规则中 **绕过 127.0.0.1 / localhost**（与官方 Zotero 相同） |

**Local-first：** 落盘仍是普通 Markdown + catalog，可被 Vault 外工具读取。

---

## 12. 验收标准（方案一完成定义）

- [x] 文档（本文）与 roadmap/todo/索引已挂上。
- [x] 设置默认 **关闭**；开启后 `curl` 探活 `GET /connector/ping` 成功（需本机手动验证）。
- [ ] 官方 Connector 在 Zotero 未运行时可保存至少一类页面（如 arXiv）到当前 Vault（端到端待手测）。
- [x] catalog + 文件树刷新；重复 id 去重（`deduped` toast）。
- [x] 端口被占时有可读错误；关闭开关 / 退出应用释放端口。
- [x] 仅绑 `127.0.0.1`；Host 校验生效。
- [x] 相关 i18n 中英齐全。

---

## 13. 开放问题（实现前可拍板）

1. **Vault 关闭时** server 是否继续 listen？（建议继续 listen，save 返回 503。）
2. **去重** 默认 skip 还是「打开已有」？（建议 skip + 事件 `deduped`。）
3. **HTTP 栈** 选型：`axum` vs `hyper` vs `tiny_http`（偏好：异步、与现有 tokio 一致、依赖体积可控）。
4. **是否显示为 Zotero 的 collection UI 目标**：首版固定 `papers/` 是否足够？
5. 成功 toast 是否默认开？（建议开，可关。）

---

## 14. 参考链接

- [Zotero Connector HTTP Server](https://www.zotero.org/support/dev/client_coding/connector_http_server)
- [zotero-connectors README](https://github.com/zotero/zotero-connectors)
- [connector.js（callMethod）](https://github.com/zotero/zotero-connectors/blob/master/src/common/connector.js)
- [server.js](https://github.com/zotero/zotero/blob/master/chrome/content/zotero/xpcom/server.js) / [server_connector.js](https://github.com/zotero/zotero/blob/master/chrome/content/zotero/xpcom/connector/server_connector.js)
- 社区 Local API 笔记（非官方）：[gist x1any](https://gist.github.com/x1any/f768fb3d454dfee6c467d7fa69cbf465)
- 本仓库：[`identifier-lookup.md`](identifier-lookup.md) § 映射与下载策略

---

## 修订记录

| 日期 | 说明 |
|---|---|
| 2026-07-18 | 初稿：方案一（兼容官方 Connector / 本机 23119）设计与分期；已挂 mkdocs / roadmap / todo / api §3.5b |
| 2026-07-18 | MVP 实现：Host axum server、commands、设置开关、事件刷新 |
| 2026-07-18 | 防 15s 超时（后台资产）；`targets` 子文件夹 + `updateSession` 移动；§4.5 上游 API 覆盖总表 |
| 2026-07-18 | **C4b `saveAttachment`**：浏览器上传登录墙 PDF（`X-Metadata` `parentItemID`→paper；`%PDF` 校验；触发 PAPER.md；`supportsAttachmentUpload: true`；200 MiB body 上限）。仍待：`saveSnapshot` / `saveSingleFile` / `detailedCookies` |
