# 入库 UI

前端入库入口与后置动作（刷树、开 paper、任务条）。落盘内核见 [../backend/paper-import.md](../backend/paper-import.md)。

## 魔棒

- 入口：侧栏 `WandSparkles` / `⇧⌘I`。
- 粘贴一个或多个标识符（空格/逗号/分号/换行）；去重后顺序入库。
- 目标：`papers/` 或当前选中的 Papers 子文件夹。
- 弹层内 **FileUp**：多选本地 PDF。
- 成功后：刷新树、展开并滚到新论文、`openPaper`；批量**不**自动连跑精读。
- Host：`lookup_import_batch` 等。

## 本地 PDF

| 方式 | 行为 |
|---|---|
| 魔棒 FileUp | 多选 → metadata 确认 → `paper_import_local_pdf` |
| 拖到 `papers/` 组织夹 | metadata 确认后入库；无 TeX 时 liteparse → `PAPER.md` |
| 拖到窗口其它区域 | 不入库（窗口级 `preventDefault` 防 WebView 导航） |

## Zotero

| 入口 | 说明 |
|---|---|
| 欢迎页迁移 | 读 `zotero.sqlite` + `storage/` 整库迁移 |
| Connector | 设置开启后浏览器扩展保存；见 [../backend/connector.md](../backend/connector.md)、[../usage/zotero.md](../usage/zotero.md) |

## 补资源 / 精读触发

- Download：缺 PDF 或无正文资源时。
- Zap / 自动精读：见 [agent.md](agent.md)。

## 代码

- `src/lib/paper/lookup.ts`、`import-actions.ts`、`import/`
- `src/components/sidebar/` 魔棒 Popover、本地 PDF 对话框
