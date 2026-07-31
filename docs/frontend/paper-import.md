# 入库 UI

前端入库入口与后置动作（刷树、开 paper、任务条）。落盘内核见 [../backend/paper-import.md](../backend/paper-import.md)。

## 魔棒

- 入口：侧栏 `WandSparkles` / `⇧⌘I`。
- 粘贴一个或多个论文标识符或 Skill 来源（空格/逗号/分号/换行）；去重后顺序处理。
- 目标：`papers/` 或当前选中的 Papers 子文件夹。
- 弹层内 **FileUp**：多选本地 PDF。
- 成功后：刷新树、展开并滚到新论文、`openPaper`；批量**不**自动连跑精读。
- Host：`lookup_import_batch` 等。

### Skill 导入

- 支持 GitHub 仓库 URL，以及 `npx skills add <source> --skill <name>`。
- Skill 解析后先弹出多选窗口，展示名称、描述、来源和已安装状态；只有点击确认后才安装到 `.agents/skills/<name>/`，并保留 `SKILL.md`、`scripts/`、`references/`、`assets/`。
- 取消窗口会删除本次解析产生的临时 discovery，不会修改 Vault。
- 已存在的 Skill 不覆盖；成功后仅刷新树并显示汇总 Toast，不打开 paper。
- 远程 Vault 当前不支持 Skill 导入。

## 本地 PDF

| 方式 | 行为 |
|---|---|
| 魔棒 FileUp | 多选 → metadata 确认 → `paper_import_local_pdf`；任务条显示 PDF 解析阶段 |
| 拖到 `papers/` 组织夹 | metadata 确认后入库；无 TeX 时隔离运行 liteparse → `PAPER.md` |
| 拖到窗口其它区域 | 不入库（窗口级 `preventDefault` 防 WebView 导航） |

PDF 解析最多等待 120 秒，取消任务会终止当前解析子进程。解析失败或超时时，后台入库任务仍会结束，已复制的 PDF、`NOTES.md` 与 catalog 记录保持可用；用户可稍后通过 CLI `paper parse` 重试派生正文。

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
