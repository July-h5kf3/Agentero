# CLI（`agentero`）

Headless Vault / Catalog / Wiki 接口；**不含** BYOA / paper-reader。

## 位置

- 目录：`cli/`（crate `agentero-cli`）
- path 依赖 `agentero_lib`：`features::{vault,catalog,import,wiki}` + `core::{error,fs}`
- 桌面安装包内置同版本 CLI（规划）：[../development/bundled-cli.md](../development/bundled-cli.md)（[#165](https://github.com/poco-ai/Agentero/issues/165)）

## 命令组

| 组 | 用途 |
|---|---|
| `vault` | create / which / info 等 |
| `tree` | 列树 |
| `paper` | list/get、tag list/set/add/rm、move、download/parse… |
| `trash` | list / restore / purge 本地回收站 |
| `import` | 标识符入库 |
| `export` | 导出 |
| `config` | 配置 |
| `wiki` | 只读双链语义检查 |
| `doctor` | 聚合诊断与显式确认的论文 aliases 修复 |

稳定 `--json` 输出，供脚本与外部 Agent 组合。

### 规划中（未实现）

阅读标注与翻译进 CLI（[#170](https://github.com/poco-ai/Agentero/issues/170)）：`mark` list/get/add/update/delete、`translate` 文本等。设计见 [../development/mark-cli-roadmap.md](../development/mark-cli-roadmap.md)；文字定位见 [惰性](../development/mark-locate-lazy.md) / [即时](../development/mark-locate-eager.md)。  
当前 `paper get` 仅报告 `assets.marksDir` 是否存在；skill 仍将 marks 作 L2.5 只读，直至命令落地后改 skill。

```bash
cargo build -p agentero-cli
cargo run -p agentero-cli -- vault which --json
cargo run -p agentero-cli -- wiki check papers/demo/NOTES.md --json
cargo run -p agentero-cli -- doctor --json
cargo test -p agentero-cli
```

## 论文与 Tag

Tag 写入支持桌面端相同的 8 色后缀格式：

```bash
agentero paper tag add papers/demo "survey:blue"
agentero paper tag set papers/demo "nlp:green" "must-read:orange"
```

只有合法颜色后缀会被解析为颜色；例如 `owner:alice` 仍是普通 Tag 名称。

`@zotero:` 是 Connector 内部标签，默认不参与论文列表筛选和 Tag 汇总；需要包含它们时传 `--all`：

```bash
agentero paper list --tag topic
agentero paper list --tag "@zotero:imported" --all
agentero paper tag list --all
```

`paper delete` 默认移入可恢复回收站；明确传 `--files` 才会物理删除。回收站操作：

```bash
agentero trash list
agentero trash restore <batch-id> <stored>
agentero -y trash purge <batch-id> <stored>
agentero -y trash purge
```

论文移动会更新文件夹和 Catalog 路径：

```bash
agentero paper move papers/inbox/demo papers/archive
```

## 双链检查

`agentero wiki check [<source>] --json` 使用桌面端导航、嵌入、反链和重命名事务共用的 `WikiIndex` resolver，不维护第二套正则解析器。

- 不传 `source`：检查整个 Vault。
- 传 Markdown 文件：只检查该文件，适合 paper-reader 写入后的局部验收。
- 传目录：检查该目录下的 Markdown。
- 输入必须是 Vault 相对路径；命令只读，不创建目标或重写来源。
- 派生正文 `PAPER.md` 保留为可链接目标和标题来源，但不作为出链来源参与检查。
- 全部解析成功时退出码为 0；发现 `missing`、`ambiguous`、`invalidFragment` 时返回非零，错误码为 `wikilink_check_failed`，报告位于 `error.details`。
- 批注双链 `[[target@id]]` / `[[target#@id]]`：按 path 解析 target，并校验 id 形态；**不**读取 `marks/` 判断 id 是否仍存在（与桌面 resolve 一致）。

报告包含 `checkedFiles`、四类状态计数，以及每个问题的 `source`、`line`、`targetRaw`、`syntax`、`embed`、`targetPath?`、`candidates` 和 `context?`。指定单文件作用域后，Vault 中其它历史坏链不会影响本次验收。

## Doctor

`agentero doctor` 只读聚合 Vault 结构、Catalog schema、双链语义与 Catalog 论文 `NOTES.md` aliases；任一错误存在时返回 `doctor_issues` 和非零退出码。

`agentero doctor fix aliases` 在 TTY 中逐篇展示已有 alias，并允许编辑生成的标题 alias / 短 alias，最后进行一次批量确认。`-y` 接受全部安全默认值；`--json` 从不提示，未同时传 `-y` 时返回 `needs_confirmation`。修复会保留已有自定义 aliases，以内容哈希做竞态检查，并作为一个可回滚批次写入。详见 [doctor.md](doctor.md)。

Skill 种子：`templates/vault/.agents/skills/agentero-cli/`。
