# 远程 Vault：删除文件夹后 list 报 NoSuchFile

**Issue**：用户报告  
**影响面**：远程 Vault 文件树删除文件夹 / 文件后的刷新  
**状态**：已修复

## 现象

远程 Vault 右键删除文件夹（如 `papers/test`）后 Toast：

```text
sftp list /…/papers/test: Sftp server reported error kind NoSuchFile, msg: … No such file
```

侧栏树可能被清空或刷新失败；本地 Vault 删除无此问题。

## 根因

1. **本地建树**（`features/vault/tree.rs`）对 `read_dir` 失败是 **best-effort**：子目录不可读 → 空列表，不整树失败。
2. **远程建树**（`src/lib/vault/tree.ts`）对每次 `remote_list` **硬失败**：任一子路径 `NoSuchFile` 会抛错。
3. 删除后 `refreshTree` → `loadVaultTree` 递归 list。若并发刷新 / 乐观路径仍访问已移入回收站的目录，SFTP 返回 `NoSuchFile`，整次建树失败。
4. 原 `refreshTree` 在 catch 里 `setTree([])`，把侧栏直接清空，错误信息即上述 sftp list 文案。

写路径本身（`path_trash` → remote trash rename/copy）可以成功；问题在**删除后的树刷新语义**，不是 trash 协议本身。

## 修复

1. `isPathMissingError` + `listTreeEntries`：远程 list 遇 NoSuchFile / not found / ENOENT 时返回 `[]`（与本地 Host 一致）。
2. `removeTreeNode`：删除成功后先从内存树剪掉目标，再 `refreshTree`。
3. `loadDirChildren`：展开时路径已消失 → 安静移除节点，不 Toast sftp 原文。
4. `refreshTree` 失败时**保留旧树**，仅 Toast，避免整栏空白。

## 验证

- 远程：新建空文件夹 → 删除 → 树去掉该节点，无 NoSuchFile Toast；其它目录仍在。
- 远程：删除非空文件夹 / 论文夹 → 同上，库表同步刷新。
- 本地删除行为不变。
- 单测：`isPathMissingError`、`removeTreeNode`（`test/vault-tree.test.ts`）。
