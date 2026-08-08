# Zotero Connector 兼容

Host 在 **`127.0.0.1:23119`** 模拟 Zotero 桌面 Connector HTTP，官方浏览器扩展无需修改。

## 行为

- 设置 → 通用：**兼容 Zotero Connector**（`connectorEnabled`，**默认关**）。
- 与 Zotero 桌面端端口互斥；端口可在设置中修改（默认 `23119`）。
- 支持 `saveItems`、目标文件夹选择、**`saveAttachment`**（浏览器上传 PDF）。
- 支持 **`saveStandaloneAttachment`**（在 PDF 标签页直接保存，无父书目条目）。
- 支持 **`hasAttachmentResolvers`** / **`saveAttachmentFromResolver`**：浏览器直连 PDF
  失败时，用 DOI/arXiv 走 Crossref + Unpaywall 再尝试 OA 副本。
- 绑定当前 Vault（本地路径或 `remote:<sessionId>`）。
- 保存后：catalog + paper 目录；刷新树；`openPaper` 聚焦。
- Connector 返回的 Zotero 标签会以 `@zotero:` 前缀保存在 catalog 中，用于保留来源信息；
  这类内部标签不会显示在 Library、Paper Info 或标签筛选中。
- 远程：stage 后 SFTP；catalog 经 work mirror。
- 保存请求只写入 paper 壳和 catalog，PDF/TeX 在后台下载；后台单篇资源阶段最多
  运行 3 分钟，超时会通过 `connector:progress` 报错，不会让任务永久挂起。

## 兼容端点（`127.0.0.1:23119`）

| 端点 | 状态 |
|---|---|
| `ping` | 完整 |
| `saveItems` | 完整 |
| `saveAttachment` | 完整（浏览器上传 PDF） |
| `saveStandaloneAttachment` | 完整（独立 PDF → 新建 paper；`canRecognize: false`） |
| `hasAttachmentResolvers` | 完整（DOI/arXiv 且尚无本地 PDF → true） |
| `saveAttachmentFromResolver` | 完整（Crossref/Unpaywall 下载） |
| `saveSnapshot` / `saveSingleFile` / `savePage` | 完整 |
| `getSelectedCollection` / `updateSession` / `delaySync` | 完整（须返回 `filesEditable: true`，否则扩展跳过 `saveAttachment`） |
| `detect` / `getTranslators` / `proxies` / `selectItems` | stub（空列表/透传） |
| `getRecognizedItem` / `import` / `installStyle` / Google Docs | 未实现 |

## 命令 / 事件

- `connector_get_status`：获取监听状态、端口、绑定地址、当前 Vault。
- `connector_set_enabled`：开启或关闭 Connector HTTP 服务。
- `connector_set_vault`：绑定当前目标 Vault。
- `connector_set_parent_dir`：设置默认保存父目录（如 `papers` 或 `papers/子目录`）。
- `connector_set_port`：修改监听端口（默认 `23119`）。
- 前端事件 `connector:*`（`src/lib/paper/import/connector.ts`）

## 代码

`src-tauri/src/features/connector/`  
用户教程：[../usage/zotero.md](../usage/zotero.md)
