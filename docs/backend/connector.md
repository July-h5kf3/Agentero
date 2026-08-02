# Zotero Connector 兼容

Host 在 **`127.0.0.1:23119`** 模拟 Zotero 桌面 Connector HTTP，官方浏览器扩展无需修改。

## 行为

- 设置 → 通用：**兼容 Zotero Connector**（**默认关**）。
- 与 Zotero 桌面端端口互斥。
- 支持 `saveItems`、目标文件夹选择、**`saveAttachment`**（浏览器上传 PDF）。
- 绑定当前 Vault（本地路径或 `remote:<sessionId>`）。
- 保存后：catalog + paper 目录；刷新树；`openPaper` 聚焦。
- Connector 返回的 Zotero 标签会以 `@zotero:` 前缀保存在 catalog 中，用于保留来源信息；
  这类内部标签不会显示在 Library、Paper Info 或标签筛选中。
- 远程：stage 后 SFTP；catalog 经 work mirror。
- 保存请求只写入 paper 壳和 catalog，PDF/TeX 在后台下载；后台单篇资源阶段最多
  运行 3 分钟，超时会通过 `connector:progress` 报错，不会让任务永久挂起。

## 命令 / 事件

- `connector_start` / `connector_stop` / `connector_status` / `connector_set_vault`
- 前端事件 `connector:*`（`src/lib/paper/import/connector.ts`）

## 代码

`src-tauri/src/features/connector/`  
用户教程：[../usage/zotero.md](../usage/zotero.md)
