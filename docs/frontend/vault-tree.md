# 文件树

左侧 Vault 文件树：虚拟 Library / Recycle Bin、魔棒、paper 行操作、多选拖拽。

## 虚拟节点

| 节点 | 路径常量 | 行为 |
|---|---|---|
| Library | `agentero:library` | 打开全库表格；右键导出 BibTeX |
| Recycle Bin | `agentero:trash` | 打开回收站视图；右键清空 |

## 建树

- 本地：Host `vault_tree_build` **一次 IPC** 递归（`features/vault/tree.rs`）。
- 远程：`remote_list` 前端递归。
- **全量递归**：`papers/`、`notes/`、`plans/`、`.agents/`；论文内 `source/` **懒加载**（`childrenPending` → `vault_tree_children`）。
- 其它根目录只 list 一层，展开再 list。
- **缺失目录**：本地 `read_dir` 失败返回空列表；远程 list 的 `NoSuchFile` 同样按空处理（`isPathMissingError`），避免删除后刷新把整棵树清空。删除成功后会先 `removeTreeNode` 乐观剪枝，再 `refreshTree`。
- 忽略：`.git`、`.venv`、`node_modules` 等（`TREE_IGNORE_NAMES`）。
- 默认只展开 `papers/` 及其一级子目录。
- 虚拟化：`@tanstack/react-virtual` 拍平窗口化；`getItemKey` 用行稳定 id，避免内联新建草稿插入/移除后按索引缓存行高留下空隙。

## Paper 行

| 展示 | 说明 |
|---|---|
| 标签 | 默认「标题 · 作者」；`paperTreeLabelMode` 可改（展示用，不改磁盘名） |
| 排序 | `paperTreeSortMode`（标题/作者/年份/添加时间等） |
| Download | 缺 PDF，或既无 TeX 也无 `PAPER.md`（`source/` 为懒壳时按其 `hasTex` 标记判定） |
| Zap | 资源齐且 `is_read === false` → paper-reader |

## 交互

| 操作 | 方式 |
|---|---|
| 新建文件/文件夹 | 右键 → 树内联命名；菜单会按实际尺寸在窗口边缘自动翻转或滚动，不会被窗口下沿截断。**远程 Vault** 的重名预检走 `vaultPathExists`（`remote_list` 父目录），不可用本机 `plugin-fs` `exists`（伪路径 `remote:<id>/…` 不在本地 scope） |
| Finder 显示 | 右键 / `⌥⌘R` |
| 终端打开 | 右键 / `⌥⌘T`（文件夹=自身，文件=父目录） |
| 删除 | 右键 / `⌘⌫` → 回收站（无确认） |
| 多选拖拽 | ⌘/Shift + 拖到 `papers/` 组织夹 |
| 折叠 | `⌘←` 选中夹；`⇧⌘←` 折叠至默认 |
| 定位 | 激活文档 / 入库后展开祖先并 `scrollToIndex` |
| 刷新 | File → Refresh（`⌘R`）；watcher 局部刷新 |

## 代码

- UI：`src/components/sidebar/file-tree.tsx`、AI Elements `FileTree`
- 逻辑：`src/lib/vault/`（store、tree、fs-watch、reveal）
- 标签/排序：`src/lib/paper/tree-label.ts`、`tree-modes.ts`

## 开发注意

纯浏览器 `pnpm dev` 时本地盘 IO 受限；完整文件树/读写需 `pnpm tauri dev`。
