# Agentero CLI 设计（语义 + 技术栈）

> 状态：**MVP 已落地**（`cli/` + workspace；`graph` / `doctor` / completions 仍待）  
> 目标：为 Vault / Catalog / 文献基础能力提供 **headless、Agent 友好** 的 CLI。  
> 相关：[`backend/api.md`](../backend/api.md)、[`backend/data-model.md`](../backend/data-model.md)、[`backend/catalog.md`](../backend/catalog.md)、[`technical-plan.md`](technical-plan.md)。

### 已拍板

| 项 | 结论 |
|---|---|
| 二进制名 | **`agentero`** |
| Agent / BYOA | **CLI 不包含**；不 spawn Agent、不读 Agent 注册表、不跑 paper-reader |
| 范围 | Vault **创建 / 管理 / 发现 / 暴露** + 文献库基础能力（catalog、入库、资源、导出） |
| 设计取向 | **给外部 Agent / 脚本当工具用**（稳定 JSON、可组合、可发现），不是第二个 Agent 运行时 |
| **代码位置** | 仓库根 **`cli/`**（独立 crate，与 `src-tauri` 并列） |
| **domain 复用** | **不迁 core**；path 依赖 `src-tauri` 的 `agentero_lib`，直接 `use services::{vault,catalog,lookup,…}` |
| 实现状态 | **MVP**：`vault` / `tree` / `paper` / `import` / `export` / `config`；集成测试 `cli/tests/cli_mvp.rs` |
| **Vault skill** | Create Vault 种子 **`templates/vault/.agents/skills/agentero-cli/SKILL.md`** → `.agents/skills/agentero-cli/` |

---

## 1. 动机与定位

### 1.1 为什么需要 CLI

桌面 UI 负责审阅与编辑；CLI 负责让 **人、脚本、外部 Agent** 在无 GUI 时也能：

| 诉求 | CLI 交付 |
|---|---|
| 初始化研究库 | `vault create` |
| 知道「我在哪个库、库里有什么」 | 发现与暴露（`vault which|info`、`paper list|get`、`tree`、`reveal`） |
| 把标识符变成本地资产 | `import` / `paper download|parse` |
| 与 Obsidian / jq / 其它工具管道协作 | 稳定 `--json`、路径即文件 |

### 1.2 定位一句话

**`agentero` CLI = Vault 与 Catalog 的机器接口**：管理、发现、暴露本地研究库；**不**做对话、不编排 BYOA、不写精读笔记。

精读 / 总结 / Related Work 仍由 **桌面 App 的 Agent 面板**，或用户自选的外部 Agent（直接读 Vault 文件 + 调本 CLI）完成。

### 1.3 非目标（硬边界）

| 不做 | 原因 |
|---|---|
| `agent *`、ACP、Codex app-server、skill 触发 | BYOA 属于桌面 Host，不进 CLI |
| paper-reader / 自动写 `NOTES.md` 精读 | 会隐式改用户知识层；由外部 Agent 或 GUI 负责 |
| PDF 预览、WYSIWYG、划词 ask UI | GUI 专属 |
| 第二套权威存储 / 云同步事实库 | 违反 local-first |
| 常驻 daemon（v1） | 无需求不先做；可选后续 `serve` 另议 |
| UI 偏好（主题、侧栏） | 与 CLI 无关 |

---

## 2. 设计原则

### 2.1 产品原则

1. **事实来源不变**：人的笔记与 source 是文件；论文集合与 meta 是 `.agentero/catalog.sqlite`。
2. **路径即接口**：优先返回 Vault 相对路径；Agent 用路径直接 `read_file`，不必二次查询。
3. **不覆盖用户手写**：已有 `NOTES.md` / 用户文件默认 skip；覆盖必须 `--force` + 可预期。
4. **小而聚焦**：命令面 = Vault 生命周期 + 发现暴露 + 已落地文献基础能力。

### 2.2 Agent 友好原则（核心）

外部 Agent（Claude Code、Codex、Cursor…）应能把 CLI 当 **稳定工具** 使用，无需理解 Tauri：

| 原则 | 做法 |
|---|---|
| **可发现** | `agentero --help` 完整；`vault info` / `paper list` 先轻量索引，再 `get` / 读文件下钻 |
| **可解析** | 默认可人读；**Agent 场景固定 `--json`**；schema 稳定、带 `ok` / `error.code` |
| **可组合** | stdin/stdout 管道；路径与 id 解析规则文档化；退出码稳定 |
| **可预期** | 无隐藏写；写操作在 help 与 JSON 结果里标明 `created` / `skipped` / `modified` |
| **渐进披露** | 对齐 data-model L0→L4：先 list/meta，再 NOTES / PAPER.md / source，不默认 dump 全文 |
| **无副作用默认** | 只读命令绝不写盘；写命令名称即动词（`create`/`import`/`delete`） |
| **单行可教** | `AGENTS.md` 或工具描述里可用一两行说明「如何用 CLI 摸库」 |

推荐给外部 Agent 的最小协议（可写入 Vault `AGENTS.md` 模板注释或 docs）：

```text
1. agentero vault which --json          # 确认库根
2. agentero paper list --json           # L1 索引
3. agentero paper get <path|id> --json  # 单篇 meta + 建议读取路径
4. 按需 read_file: NOTES.md → marks/ → PAPER.md → source/
5. 入库: agentero import id <arxiv|doi|url> --json
```

---

## 3. 能力边界

### 3.1 纳入 CLI（基础能力）

| 域 | 含义 | 现网 Host 锚点 |
|---|---|---|
| **Vault 生命周期** | 创建、识别、校验、摘要 | `vault_create`、`services/vault` |
| **发现** | 当前 vault 是谁、树形结构、catalog 有哪些 paper | 上溯解析 + catalog + 目录扫描 |
| **暴露** | 把库内容以稳定结构交给 Agent/脚本（路径、meta、资源状态） | `paper_list` / `paper_get` + 落盘状态探测 |
| **文献基础** | 标识符入库、补 PDF/TeX、`PAPER.md`、bib 导入导出 | `lookup_*` / `paper_*` import-export / parse |
| **双链索引（只读+重建）** | 反链查询、图导出、重建 | `graph_*`（不依赖 Agent） |
| **Catalog 标记** | `is_read` / `tags` 等字段读写（**仅字段**，不触发精读） | `paper_set_is_read`、`paper_set_tags` |

### 3.2 明确不进 CLI

| 域 | 归属 |
|---|---|
| BYOA / ACP / 会话 / 权限模式 | 桌面 Host |
| paper-reader 与一切「跑 Agent 写笔记」 | 桌面 或 外部 Agent 自行完成 |
| 窗口、菜单、i18n 菜单 | GUI |
| 关键词 Agent 候选检索 | 未来 Host；CLI 只做精确 id/URL 入库 |

---

## 4. CLI 语义

### 4.1 二进制与风格

| 项 | 定稿 |
|---|---|
| 二进制 | **`agentero`** |
| 风格 | `agentero <域> <动词>`（kubectl / gh 式） |
| 框架 | clap 4 derive |
| 用户消息语言 | v1 **英文**（机器接口优先） |

### 4.2 全局选项

```text
agentero [GLOBAL] <command> ...

GLOBAL:
  -v, --vault <PATH>     Vault 根（绝对或相对）
  --json                 等价 --output json（Agent / 脚本推荐始终使用）
  --output <FMT>         text | json（默认 text；短选项 `-o` 留给 export 等写文件）
  -q, --quiet            成功时少说话；错误仍走 stderr
  -y, --yes              跳过破坏性确认
  --translator-url <URL> 覆盖 Translator base
  --color <WHEN>         auto | always | never
  -h, --help
  -V, --version
```

**退出码**

| Code | 含义 |
|---|---|
| `0` | 成功 |
| `1` | 业务失败（not found、import 失败、parse 失败…） |
| `2` | 用法错误 |
| `3` | Vault 未解析到 / 无效 |
| `4` | 需确认但未给 `--yes` |

### 4.3 命令树

```text
agentero
├── vault
│   ├── create <path> [--open]     # 脚手架 + catalog
│   ├── which                      # 当前解析到的 vault 绝对路径
│   ├── info                       # 校验 + 统计摘要（发现入口）
│   ├── check                      # 结构/schema 健康检查（非 0 = 有问题）
│   └── use <path>                 # 写入 CLI default_vault（可选）
│
├── tree [path] [--depth N]        # 文件树暴露（Vault 相对）
│
├── paper
│   ├── list [--query] [--tag …] [--unread] [--status …]
│   ├── tags                       # 库内 tag 汇总（名 + 计数）
│   ├── get <path|id>              # meta + 资源探测 + 建议读取路径
│   ├── paths <path|id>            # 仅输出相关文件路径（极简 Agent 用）
│   ├── delete <path> [--files]    # 默认只删 catalog；--files 删目录
│   ├── set-read <path|id> [--false]  # 仅改 is_read 字段
│   ├── set-tags <path|id> [tags…] [--add|--remove]  # 仅改 tags
│   ├── download <path|id>         # 补 PDF / arXiv TeX
│   └── parse <path|id> [--force]  # 无 TeX 时 liteparse → PAPER.md
│
├── import
│   ├── id <text> [--parent …]     # 魔棒：精确 ID/URL
│   └── bib <file|-> [--parent …]
│
├── export
│   ├── bib [--format …] [-o|--out file|-]
│   └── papers-md [-o|--out file|-]      # 可选；Host 落地后对齐
│
├── graph
│   ├── backlinks <path>
│   ├── export [--format json|dot] [-o|--out …]
│   └── rebuild
│
├── config
│   ├── show
│   └── set <key> <value>          # 仅 CLI 配置（default_vault、translator）
│
└── doctor                         # Translator 可达性、catalog schema、路径权限（无 Agent 探测）
```

### 4.4 域语义细则

#### A. Vault：创建与管理

**`vault create <path>`**

- 对齐 `vault_create`：
  - 目录：`papers/`、`notes/`、`plans/`、`.agentero/`、`.agents/skills/`
  - 初始化 `catalog.sqlite`
  - 默认 `AGENTS.md`、`.agents/README.md`（**不覆盖已有**）
  - **不**生成根级 `PAPERS.md` / `library.bib`
- JSON：`{ path, created[], openPath? }`
- 可选：在默认 `AGENTS.md` 中保留一小节「How agents should use this vault / CLI」（短、可删）

**`vault which`**

- 只打印解析到的绝对路径（text 一行；json `{ "path": "..." }`）
- Agent 会话第一步常用

**`vault info`**

发现入口，**只读**：

```json
{
  "ok": true,
  "data": {
    "path": "/abs/vault",
    "valid": true,
    "schemaVersion": 3,
    "counts": {
      "papers": 42,
      "unread": 7,
      "notesFiles": 12
    },
    "hasAgentsMd": true,
    "layers": {
      "L0": "AGENTS.md",
      "L1": "catalog.sqlite (use: paper list)"
    }
  }
}
```

**`vault check`**

- 结构缺失、catalog 打不开、schema 过旧等 → 非 0 + 可机器读 `issues[]`
- 适合 CI / 外部 Agent 开工前自检

**`vault use <path>`**

- 写入 CLI `default_vault`（§5），不碰 GUI localStorage

#### B. 发现与暴露

**`tree [path]`**

- 列出 Vault 相对文件树（默认 depth 有限，如 3；`--depth -1` 全量慎用）
- JSON：`{ nodes: [{ path, type: "file"|"dir", children? }] }`
- **不是** Library 虚拟节点；真实磁盘树

**`paper list`**

- L1 索引：读 catalog，不扫全文
- text 列：`path` `id` `title` `year` `tags` `is_read`（`tags` 为**名称**逗号拼接，空为 `-`；不展示 color）
- 过滤：
  - `--unread`：仅 `is_read = false`
  - `--status <s>`：status 字段（ignore case）
  - `--query <q>`：title / authors / id / path / **tags 名称** 子串（ignore case）
  - `--tag <name>`：**可重复**；每篇须 **同时含** 全部给定 tag 名（AND；精确匹配、ignore case）
- JSON：`PaperRecord[]`（字段与 Host 对齐；`tags` 元素为字符串或 `{name,color?}`，与 catalog 序列化一致）

**`paper tags`**

- 库内全部 tag 汇总（从 catalog 扫描，不另建 tags 表）
- text 列：`tag` `count`（按 tag 名排序）
- JSON：`{ items: [{ tag, count }] }`
- 用途：外部 Agent 先摸有哪些标签，再 `paper list --tag …`

**`paper get <ref>`**

暴露单篇时给 Agent 足够导航信息，仍不 dump 正文：

```json
{
  "ok": true,
  "data": {
    "paper": { /* PaperRecord */ },
    "assets": {
      "pdf": true,
      "tex": true,
      "paperMd": false,
      "notesMd": true,
      "marksDir": true
    },
    "suggestedReads": [
      "papers/1706.03762/NOTES.md",
      "papers/1706.03762/marks",
      "papers/1706.03762/PAPER.md"
    ]
  }
}
```

- `assets.marksDir`：`{paper}/marks/` 是否存在（阅读器划词 JSON：`kind` ∈ highlight / ask / translate）
- `suggestedReads` 按 L2 → L2.5（`marks/`）→ L3 顺序，**仅包含存在的路径**（目录或文件）
- 正文内容不进 JSON；Agent 自己读文件

**`paper paths <ref>`**

- 极简：只输出相关路径列表（text 每行一个 / json `string[]`）
- 含 paper 根、`NOTES.md`、`marks/`（若有）、`PAPER.md`、本地 PDF、`source/`（有 TeX 时）
- 适合 Agent tool 描述极短、只要路径清单的场景

#### C. 文献基础（无 Agent）

**`import id <text>`**

- 对齐 `lookup_import`：Translator → catalog + 壳文件 + 默认下 PDF（arXiv + TeX）
- **不**触发精读、不写综述体 NOTES（仅脚手架壳，与现网入库一致）
- 成功 JSON 含 `path` `id` `title` `created[]` `skipped[]`

**`import bib` / `export bib`**

- 对齐现网；stdin/stdout 用 `-`
- 已存在 path → skip，不覆盖 `NOTES.md`

**`paper download` / `paper parse`**

- 只做资源与 `PAPER.md` 派生
- **绝不**调用 Agent

**`paper delete`**

- 默认仅 catalog（对齐 Host）；`--files` 删磁盘需 `--yes`

**`paper set-read`**

- **仅**更新 catalog `is_read` 布尔值
- 语义：外部 Agent 自己读完写完 NOTES 后，可用此标记；CLI 不负责「读」

**`paper set-tags`**

- **仅**更新 catalog `tags`（`tags_json`）；同步 `metadata.json` 投影（与 Host `paper_set_tags` / `papers::set_tags` 同一 service）
- **默认 = 整表替换**：`agentero paper set-tags <ref> nlp rl` → tags 变为 `["nlp","rl"]`（CLI 只写名称，**不设 color**）
- **清空**：`agentero paper set-tags <ref>`（无额外 tag 参数）
- **增量**（与 replace 互斥）：
  - `--add t1 t2`：在现有列表上追加（trim + 大小写不敏感去重；新 tag 无色）
  - `--remove t1 t2`：按 ignore-case 按**名称**移除
- 规范化与 Host 一致：trim 空白、丢弃空串、大小写不敏感去重（保留首次写法）；有色标签需在桌面 Paper Info 设置
- 不触发精读、不改 NOTES

**`graph *`**

- 从 Markdown 重建的双链能力；与 BYOA 无关
- 图导出给 Agent 做导航时可用

### 4.5 引用解析

```text
resolve_paper(ref):
  if looks_like_path(ref):  # 含 "/" 或 papers/ 前缀
      paper_get by path
  else:
      match by id
      0 hits → error paper_not_found
      1 hit  → that paper
      n hits → error paper_ambiguous + candidates[]
```

环境变量：

| 变量 | 含义 |
|---|---|
| `AGENTERO_VAULT` | 默认 vault（低于 `--vault`） |
| `AGENTERO_TRANSLATOR_URL` | Translator base |
| `AGENTERO_OUTPUT` | 默认 `text` / `json` |
| `NO_COLOR` | 禁用颜色 |

### 4.6 JSON 契约（稳定、可版本化）

成功：

```json
{ "ok": true, "data": { } }
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "paper_not_found",
    "message": "No paper for ref '1706.03762'",
    "details": {}
  }
}
```

约定：

- `--json` 时：**业务结果只在 stdout**；进度/诊断在 stderr
- `error.code` 使用稳定 snake_case 字符串表（实现时集中枚举，文档同步）
- 不在 json 成功体里塞 ANSI / 表格

常见 `error.code`（初稿）：

| code | 场景 |
|---|---|
| `vault_not_found` | 无法解析 vault |
| `vault_invalid` | 缺关键结构 / catalog 损坏 |
| `paper_not_found` | path/id 无匹配 |
| `paper_ambiguous` | id 多 path |
| `import_failed` | Translator / 写盘失败 |
| `export_failed` | Translator export / 写文件失败 |
| `asset_missing` | download/parse 缺前置文件 |
| `needs_confirmation` | 破坏性操作无 `--yes` / 非 TTY 或用户取消 prompt |
| `catalog_busy` | SQLite 锁冲突（可选） |

---

## 5. Vault 解析与配置

### 5.1 解析顺序

1. `--vault`
2. `AGENTERO_VAULT`
3. 从 cwd 向上：存在 `.agentero/catalog.sqlite`，或标准三目录 `papers/`+`notes/`+`plans/`
4. CLI config `default_vault`
5. 失败 → exit `3`

### 5.2 CLI 配置（与 GUI 隔离）

```text
~/.config/agentero/config.toml
```

```toml
default_vault = "/Users/me/research-vault"
translator_base_url = "https://translator.philfan.cn"
```

- **不**读取桌面 `localStorage` 最近列表
- **不**读取 / 写入 BYOA Agent 注册表
- GUI 与 CLI 通过 **同一 Vault 目录** 协作，不通过共享 Agent 配置

---

## 6. 技术栈与架构

### 6.0 底层能力能否复用？（结论：**能，且应以复用为主**）

当前仓库已是 **「薄 command + 厚 service」**，CLI 应对齐同一 service，**禁止**再写一套 catalog/入库逻辑。

#### 分层现状（代码事实）

```text
commands/*     → 参数校验、ApiResult 包装、部分 State/AppHandle
services/*     → 真正的业务（文件系统、SQLite、HTTP、liteparse、wiki）
```

| 模块 | 路径 | 是否依赖 `tauri` | CLI 复用 |
|---|---|---|---|
| `services/vault` | `create_vault` 等 | **否** | ✅ 直接 `use` |
| `services/catalog` | `papers::list_all/get/delete/set_is_read/set_tags/add_tags/remove_tags/list_all_tags` | **否** | ✅ 直接 `use` |
| `services/lookup` | `import_by_identifier`、`download_paper_assets`、export/import | **否** | ✅ 直接 `use`（async） |
| `services/pdf_parse` | `parse_paper_body` | **否** | ✅ 直接 `use` |
| `services/wiki` | 索引 / 反链 / 图 | **service 本身否**；`commands/graph` 用 `State<WikiIndexState>` | ✅ 调 service；CLI 自建 `WikiIndexState` 或每次 rebuild |
| `error` / `ApiResult` | 统一错误 | **否** | ✅ 可共用；CLI 映射到退出码 + JSON |
| `commands/vault|paper|lookup` | 薄包装 | 仅 `#[tauri::command]` 宏 | ⚠️ 不调用 command；CLI 自己做 argv → 调 service |
| `services/agent/*` | ACP / Codex / registry | **是**（`AppHandle`/`Emitter`） | ❌ **不复用、不链接**（CLI 无 BYOA） |
| `commands/window`、菜单 | GUI | **是** | ❌ |

证据要点：

- `vault_create` / `paper_list` / `lookup_import` 等 command 本体只是 `PathBuf` 校验后调用 `services::*`，**无** `AppHandle`。
- 全仓 `services/` 里 **`use tauri` 仅出现在 `services/agent/events.rs` 及 agent 运行时**；vault/catalog/lookup/pdf_parse/wiki 与 Tauri 解耦。
- `agentero_lib` 已是 `crate-type = ["staticlib", "cdylib", "rlib"]`，可被外部 crate **path 依赖** 并 `use agentero_lib::services::…`（实现时注意 service 项需 `pub`，若现为 `pub(crate)` 则放宽可见性或加 thin re-export）。

#### 目录布局（已拍板）

**放在仓库根 `cli/`，不迁 core，不放进 `src-tauri`。**

```text
motif/
├── Cargo.toml                 # workspace（实现时新增）
│                              # members = ["src-tauri", "cli"]
├── cli/                       # ← CLI crate（独立目录）
│   ├── Cargo.toml             # name = "agentero-cli"；bin name = "agentero"
│   │                          # agentero_lib = { path = "../src-tauri" }
│   └── src/
│       └── main.rs            # clap → services::*
├── src-tauri/                 # 桌面 Host（不变）
│   └── src/services/          # domain 仍在此；CLI path 复用
│       ├── vault / catalog / lookup / pdf_parse / wiki
│       └── agent/             # BYOA：仅桌面；CLI 禁止 use
└── src/                       # React 前端
```

| 决策 | 结论 |
|---|---|
| CLI 路径 | **`cli/`**（与 `src-tauri`、`src` 并列） |
| core 迁移 | **现阶段不做**；domain 继续住在 `src-tauri/src/services/*` |
| 依赖方向 | `cli` → path → `agentero_lib`（`src-tauri`） |
| 不用 | `src-tauri/src/bin/*`、Node CLI、`crates/agentero-core`（可留作远期选项） |

**代价（已知且接受）**：CLI 编译会带上 `agentero_lib` 的依赖图（含 tauri 等），即使不初始化 Tauri、不调用 `services/agent`。纪律：CLI 源码 **禁止** `use agentero_lib::services::agent`。

**远期（非现在）**：若体积/边界需要，再把无 Agent 的 service 抽到独立 core；当前文档与排期 **不** 以此为前提。

#### 复用关系

```text
┌─ commands/*          (Tauri only)
Desktop ─┤
         └─ services/{vault,catalog,lookup,wiki,pdf_parse}  ←─┐
                                                              │ 同一实现（不迁）
cli/ (clap, bin: agentero) ── path ──► agentero_lib ──────────┘
Desktop-only: services/agent/*   （CLI 不引用）
```

#### CLI 需要「新写」的部分（非业务重复）

| 新写 | 位置 | 说明 |
|---|---|---|
| clap 命令树 / argv | `cli/src/` | 无现成 |
| Vault 上溯解析、`config.toml` | `cli/src/` | Host 目前多在前端；CLI 自管 |
| `tree` / `suggestedReads` 编排 | `cli/src/` | service 结果 + 磁盘 `exists` |
| text 表格、退出码、JSON 包装 | `cli/src/` | 展示层 |
| `WikiIndexState` 生命周期 | `cli/src/` | GUI 用 `manage`；CLI 进程内新建 |

#### 语义一致性纪律

- 入库 / 删 catalog / parse 规则 **只改** `src-tauri` 的 service；UI 与 CLI 同步受益。
- CLI 的 `--json` 字段尽量对齐现有 `PaperRecord` / `LookupImportResult` 等 serde 形状，避免第三套 DTO。
- **禁止** CLI 直接 `INSERT` catalog 或手写 paper 目录绕过 `lookup`/`catalog`。
- service 若当前 `pub(crate)`，实现 CLI 时改为 `pub` 或经 `lib.rs` re-export（**小改可见性，不迁模块**）。

### 6.1 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 语言 | **Rust** | 与 Host 共用 catalog / lookup / vault / wiki / pdf_parse |
| CLI crate | **`cli/`** + clap 4 | 独立目录；bin 名 `agentero` |
| domain | **`agentero_lib` path 依赖** | **不迁 core** |
| 异步 | **tokio** | 下载 / Translator 已有 |
| HTTP / SQLite | 随 `agentero_lib` | 不在 CLI 重复引入业务栈亦可（传递依赖） |
| 配置 | toml + dirs（或 figment） | CLI 自有 `config.toml` |
| 错误 | 映射 `AppError` → 退出码 + JSON | 与 Host 错误语义对齐 |
| 表格 / 进度 | 轻量手写或 comfy-table；进度走 stderr | 不污染 stdout JSON |
| 交互确认 | **`inquire`**（TTY only） | `--json` 永不 prompt；破坏性确认可用 `-y` 跳过 |

**刻意不做**：初始化 Tauri app、调用 ACP/Agent registry、任何模型 SDK。  
**编译期已知**：因 path 依赖整包 `agentero_lib`，会带上 tauri 等依赖；可接受。

### 6.2 架构（当前目标）

```text
┌─────────────────────┐     ┌──────────────────────┐
│  Desktop (src-tauri)│     │  cli/ → agentero bin │
│  UI + BYOA / ACP    │     │  clap · no agent     │
└──────────┬──────────┘     └──────────┬───────────┘
           │                           │ path dep
           ▼                           ▼
┌──────────────────────────────────────────────────┐
│  agentero_lib::services（仍在 src-tauri，不迁）     │
│  vault · catalog · lookup · wiki · pdf_parse     │
│  （agent/* 仅 Desktop 使用）                        │
└──────────────────────────────────────────────────┘
           │
           ▼
        Vault 目录（Markdown + catalog.sqlite）
```

### 6.3 落地阶段

| Phase | 内容 |
|---|---|
| 0 | 本文定稿（含 `cli/`、不迁 core） |
| 1 | 根 `Cargo.toml` workspace；新建 **`cli/`**；path 依赖 `agentero_lib`；实现 vault/tree/paper/import/export |
| 2 | graph / doctor / completions；按需放宽 service `pub` |
| 3 | Release 附带 `agentero` 二进制 |
| 远期（可选） | 若需要再抽 core；**非当前范围** |

### 6.4 测试

- 集成：`assert_cmd` + 临时 Vault fixture
- 契约：`--json` 字段快照
- 网络：Translator mock；**无** Agent e2e

### 6.5 并发

- 与 GUI 同开同一 Vault：SQLite 短连接；文档提醒避免并行写
- 冲突 → `catalog_busy`（若实现 busy_timeout）

---

## 7. 分阶段交付

### MVP（基础：管理 + 发现 + 暴露 + 入库资源）

- [x] `vault create|which|info|check|use`
- [x] `tree`
- [x] `paper list|get|paths|delete|set-read|set-tags|tags|download|parse`
- [x] `paper list --tag`（AND、ignore case）+ `--query` 匹配 tags
- [x] `import id|bib`、`export bib`
- [x] 全局 `--vault` / env / 上溯 / `--json` / 退出码
- [x] 稳定 error.code 表

### 随后

- [ ] `graph backlinks|export|rebuild`
- [ ] `export papers-md`（Host 具备后）
- [ ] `doctor`、shell completions
- [ ] `import pdf`（V0.5 Importer 后）

### 永不（除非产品重新立项）

- [ ] ~~`agent run` / BYOA / paper-reader~~

---

## 8. 文档与发布

实现后同步：

| 文档 | 变更 |
|---|---|
| `README.md` | 构建：`cargo build -p agentero-cli`；安装与示例 |
| `docs/index.md` | 仓库树增加 `cli/` |
| `docs/backend/api.md` | CLI ↔ service 对照表 |
| `AGENTS.md`（本仓库） | 可选：开发时如何跑 CLI |
| `templates/vault` 的 `AGENTS.md` | 可选：外部 Agent 用 CLI 摸库 |
| roadmap / todo | CLI MVP 条目 |

开发期构建（目标）：

```bash
cargo build -p agentero-cli
# 或
cargo run -p agentero-cli -- vault which --json
```

Release（已接 CI）：推送 `v*` tag 时，`.github/workflows/release.yml` 拆成独立 job：

1. **prepare**：创建草稿 GitHub Release（共用 release notes）
2. **installers**（矩阵 macOS / Ubuntu / Windows）：Tauri 桌面安装包 → 上传草稿
3. **cli**（同矩阵，与 installers **并行**）：`cargo build -p agentero-cli --release` → 打包 `agentero-<version>-<rustc-host-triple>.tar.gz`（macOS/Linux）或 `.zip`（Windows）→ 上传同一草稿

CLI job **不**装 Node/pnpm/前端；Linux 仍需 WebKit 等系统库（path 依赖 `agentero_lib`/Tauri 链接）。一侧失败不会取消另一侧（`fail-fast: false`）。

用户从 Releases 下载解压即可，无需 npm/pypi。  
**不**发 crates.io（当前 path 依赖整包 `agentero_lib`/Tauri）；开发者可用 `cargo install --git … --package agentero-cli`。不绑签名公证第一步。

---

## 9. 示例

### 人 / 脚本

```bash
agentero vault create ~/vaults/ml
cd ~/vaults/ml

agentero import id 1706.03762
agentero paper list
agentero paper download 1706.03762
agentero paper parse papers/1706.03762
agentero export bib -o library.bib
```

### 外部 Agent 友好（固定 JSON）

```bash
export AGENTERO_VAULT=~/vaults/ml

agentero vault which --json
agentero vault info --json
agentero paper list --json
agentero paper get 1706.03762 --json
# → 根据 suggestedReads 读本地 Markdown / TeX

agentero import id 2401.12345 --json
# 外部 Agent 自行精读并写 NOTES.md 后：
agentero paper set-read papers/2401.12345 --json

# Tags（仅 catalog 字段）
agentero paper tags --json
agentero paper set-tags papers/2401.12345 nlp survey --json
agentero paper set-tags papers/2401.12345 --add draft --json
agentero paper list --tag nlp --json
```

### 管道

```bash
agentero paper list --json | jq -r '.data[].path'
agentero paper list --tag nlp --json | jq -r '.data[].path'
agentero paper paths 1706.03762 | xargs -I{} echo "read {}"
```

---

## 10. 决策记录

| # | 问题 | 结论 |
|---|---|---|
| Q1 | 二进制名 | `agentero` |
| Q2 | 是否包含 Agent / BYOA | **否** |
| Q3 | 是否自动精读 | **否** |
| Q4 | `is_read` | 仅字段读写，不触发精读 |
| Q4b | `tags` | 仅字段读写；`set-tags` 默认 replace；`--add`/`--remove` 增量；`list --tag` AND 精确匹配 |
| Q5 | `paper delete` | 默认只 catalog；`--files` 需确认 |
| Q6 | 与 GUI 共享 | **仅 Vault 目录** |
| Q7 | **代码目录** | **`cli/`**（与 `src-tauri` 并列） |
| Q8 | **是否迁 core** | **否（现阶段）**；path 依赖 `agentero_lib` |
| Q9 | 消息语言 | 英文 |
| Q10 | 实现节奏 | 先文档；再 scaffold `cli/` + workspace |

---

## 11. 原则一致性

| 原则 | CLI |
|---|---|
| Local-first | 只碰用户指定 Vault |
| Catalog 权威 | list/get/import 经 catalog service |
| 不覆盖用户笔记 | import skip；parse 默认不 force |
| BYOA | **桌面专属**；`cli/` 零引用 agent |
| Agent-friendly | JSON、路径、渐进披露、无隐藏写 |
| 不迁 core | domain 留在 `src-tauri`；CLI 只做壳 |
| Obsidian 兼容 | 不改文件语法；graph 从 MD 重建 |

---

## 12. 下一步（实现启动时）

1. 根目录增加 Cargo workspace（`members = ["src-tauri", "cli"]`）。  
2. 新建 **`cli/`**：`Cargo.toml`（package `agentero-cli`，bin `agentero`）+ path 依赖 `../src-tauri`。  
3. 按需把 `services::*` 可见性改为 CLI 可 `use`（小改，不搬模块）。  
4. 实现 MVP：vault / tree / paper / import / export + `--json`。  
5. 集成测试与 README 构建说明。  
6. **不做** core 迁移，除非后续单独立项。  

排期勾选：[`roadmap.md`](roadmap.md)（CLI 节 + Milestone H + P0/P1）、[`todo.md`](todo.md)（P0-5 / P1-7）。
