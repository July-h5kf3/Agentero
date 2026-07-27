# Vault 文件系统

## 职责

打开/创建 Vault；读写文本与二进制；目录树；回收站；文件监听；终端打开。本地或远程 session（远程见 [remote.md](remote.md)）。

## 初始化

```text
用户选择目录（dialog）
  → vault_create / 打开已有
  → papers/ notes/ plans/ .agents/skills/ AGENTS.md
  → .agentero/catalog.sqlite
  → 前端加载树（Create 后可打开 AGENTS.md）
```

模板：`templates/vault/`。

## 文件树

| Command | 说明 |
|---|---|
| `vault_tree_build` | 本地一次 IPC 整树 |
| `vault_tree_children` | 懒加载（如 `source/`） |
| 路径读写 | `path_read_text` / `path_write_text` / `path_mkdir` / 移动等 |

规则：产品目录全量递归；`source/` 与其它根子目录懒加载；忽略 `.git`/`node_modules`/…  
前端：[../frontend/vault-tree.md](../frontend/vault-tree.md)。

## 回收站

| Command | 说明 |
|---|---|
| `path_trash` | 移入 `.agentero/.trash/`（含 catalog 快照） |
| `path_list_trash` | 列表 |
| `path_restore_item` | 恢复 |
| `path_purge_item` / `path_purge_trash` | 永久删除 / 清空 |

## 文件监听

- Host `notify` → `vault:file-changed`。
- 前端：打开 md 自动重载（有未存则提示）；结构变化局部刷树。
- 代码：`features/watcher/`、`src/lib/vault/fs-watch.ts`。

## Capabilities（摘要）

`src-tauri/capabilities/default.json`：`fs:*` 读写/dir、`dialog`、`opener`（含 reveal）、scope 覆盖 `$HOME/**` 等用户可选目录。

## 其它

- `path_open_in_terminal`：系统默认终端。
- 多窗口：`window_new`、`settings_window_open`。

## 代码

`features/vault/` · `trash/` · `watcher/` · `terminal/` · `window/`
