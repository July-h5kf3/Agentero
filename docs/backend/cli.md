# CLI（`agentero`）

Headless Vault / Catalog 接口；**不含** BYOA / paper-reader。

## 位置

- 目录：`cli/`（crate `agentero-cli`）
- path 依赖 `agentero_lib`：`features::{vault,catalog,import}` + `core::error`

## 命令组

| 组 | 用途 |
|---|---|
| `vault` | create / which / info 等 |
| `tree` | 列树 |
| `paper` | list/get、tag list/set/add/rm、download/parse… |
| `import` | 标识符入库 |
| `export` | 导出 |
| `config` | 配置 |

稳定 `--json` 输出，供脚本与外部 Agent 组合。

```bash
cargo build -p agentero-cli
cargo run -p agentero-cli -- vault which --json
cargo test -p agentero-cli
```

Skill 种子：`templates/vault/.agents/skills/agentero-cli/`。
