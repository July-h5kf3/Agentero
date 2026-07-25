# Logging（运行日志）

> 状态：**P0 已落地**（基础设施 + 关键操作 start/end；P1 导出日志 UI 仍待）。  
> 范围：Tauri Host + React 前端 + 共享 `agentero_lib` + headless CLI 的 **本地运行日志**；与 **错误契约 / 用户 Toast** 分层，不替代现有 UX。  
> 实现入口：`src-tauri/src/log_util.rs`、`src-tauri/src/lib.rs`（`tauri-plugin-log`）、`src/lib/core/logger.ts`、CLI `env_logger`（`cli/src/main.rs`）。  
> 相关：[`technical-plan.md`](technical-plan.md)、[`../backend/api.md`](../backend/api.md)、[`../frontend/ui.md`](../frontend/ui.md) §2.1.2、[`cli.md`](cli.md)、[`roadmap.md`](roadmap.md)、[`todo.md`](todo.md)。

## 1. 背景与问题

当前仓库 **没有统一 logger**：

| 现状 | 问题 |
|---|---|
| Host 零散 `eprintln!` | 无 level、无 rotation、release 几乎不可见 |
| 前端 `console.error`（ErrorBoundary 等） | 仅 WebView 控制台；与 Rust 日志割裂 |
| 用户错误走 `notifyError` / 任务条 / Agent error 行 | 正确，但是 **UX 通道**，不是可检索的运行日志 |
| `AppError` + `ApiResult` / CLI `error.code` | 正确的 **错误契约**，不是 observability |

目标：在 **local-first、无默认遥测** 前提下，让开发与支持能回答：

1. 这次关键操作 **开始了吗、结束了吗、失败原因是什么**？
2. dev 时终端/控制台够用；release 时有 **本机日志文件** 可导出。

## 2. 产品原则

### 2.1 三层分离（硬约束）

```text
┌─────────────────────────────────────────────────────────────┐
│  UX feedback                                                 │
│  notifyError / notifyWarning / 后台任务条 / Agent error 行   │
│  ErrorBoundary 重试 UI                                       │
└─────────────────────────────┬───────────────────────────────┘
                              │ 可同时发生，互不替代
┌─────────────────────────────▼───────────────────────────────┐
│  Observability（本方案）                                      │
│  log facade → stdout / 本机 log 文件 /（dev）Webview console  │
│  关键操作 start / end / fail                                  │
└─────────────────────────────┬───────────────────────────────┘
                              │ 不改契约形态
┌─────────────────────────────▼───────────────────────────────┐
│  Error contract                                              │
│  Host AppError + ApiResult { ok, data?, error? }             │
│  CLI CliError + exit code + --json envelope                  │
└─────────────────────────────────────────────────────────────┘
```

| 层 | 职责 | 禁止 |
|---|---|---|
| **Log** | 可检索诊断；关键操作起止；失败细节 | 替代 Toast；写入 Vault 当事实源 |
| **Contract** | 稳定 `code` / `message` 给前端与 CLI | 为了 log 改 API 形状 |
| **UX** | 用户可读、i18n、短句 | 把整段 stack / 内部 path 堆进 Toast |

### 2.2 Local-first 与隐私

- **默认不上传** 任何日志（无 Sentry / 默认遥测）。
- 日志写在 **应用系统 log 目录**（Tauri `LogDir`），**不**写进 Vault、**不**进 `catalog.sqlite`。
- 禁止记录：笔记/NOTES 全文、PDF 正文、用户粘贴的大段选区、Agent 流式完整输出、翻译原文/译文全文（可记长度与服务 id）。
- 允许记录：操作名、相对 path、paper id、sessionId 截断、error.code、短 message、耗时 ms。
- 远程崩溃上报（若未来需要）：必须 **设置 opt-in + 脱敏**，另开方案，不在本 MVP。

### 2.3 非目标（本方案不做）

- 分布式 tracing / OpenTelemetry 全链路（P3 可选 span，见 §8）。
- 把 `ApiResult` 改成 panic/throw 直穿。
- 用 logger 替代 `notifyError`。
- 结构化审计库（合规审计）或 Vault 内操作历史 UI。
- 默认向第三方发送日志。

## 3. 技术选型

### 3.1 拍板（P0）

| 层级 | 选型 | 说明 |
|---|---|---|
| **桌面 Host 胶水** | [`tauri-plugin-log`](https://v2.tauri.app/plugin/logging/) | 官方插件；stdout / LogDir / Webview；rotation、level、按模块过滤 |
| **Rust facade** | [`log`](https://crates.io/crates/log) `0.4` | `log::info!` / `error!`；commands / services 统一入口 |
| **前端** | `@tauri-apps/plugin-log` + `src/lib/core/logger.ts` | 统一 `logger.info/warn/error`；浏览器 dev 回退 `console` |
| **CLI** | 同一 `log` facade + `env_logger`（或等价） | `RUST_LOG`；业务 `--json` 仍只走 stdout envelope |
| **用户可见错误** | 保持现有 `notify.ts` 等 | 不改产品行为 |

### 3.2 中长期（P3，不阻塞 P0）

当 Agent / ACP / 入库链路需要 **span**（一次 run 关联多步）时：

- 业务层迁 [`tracing`](https://crates.io/crates/tracing) + `#[instrument]`
- [`tracing-log`](https://crates.io/crates/tracing-log) 桥回现有 `log` / `tauri-plugin-log` sink
- CLI 用 `tracing-subscriber` + `EnvFilter`

P0 **不**同时上 tracing，避免双栈。

### 3.3 明确不采用

| 技术 | 原因 |
|---|---|
| 前端 pino / winston | WebView 内过重；与 Host 分裂 |
| 默认 Sentry 等 | 隐私与 local-first |
| 继续堆 `eprintln!` | 无 level / 文件 / 前端汇聚 |
| 日志写入 Vault | 污染用户库 |

## 4. 环境行为：dev vs release

| | `pnpm tauri dev`（`debug_assertions`） | 打包 release |
|---|---|---|
| **默认 level** | `Debug`；Agent/ACP 模块可 `Trace` | `Info`（可配置为 `Warn`） |
| **Stdout** | 开 | 关或仅 `Error`（Windows release 无 console） |
| **LogDir 文件** | 建议开（与 release 路径一致，便于对照） | 开 |
| **Webview console 转发** | 可选 `attachConsole` | 默认关 |
| **Rotation** | `max_file_size` + `KeepAll`（或 Keep 最近 N） | 同左 |
| **时区** | local | local |

**日志目录（`LogDir`，随 bundle id）**（官方约定）：

| 平台 | 路径模式 |
|---|---|
| macOS | `~/Library/Logs/{bundleIdentifier}/` |
| Linux | `$XDG_DATA_HOME/{bundleIdentifier}/logs` 或 `~/.local/share/.../logs` |
| Windows | `%LocalAppData%\{bundleIdentifier}\logs` |

当前 bundle id 见 `src-tauri/tauri.conf.json` → `identifier`（如 `com.poco-ai.agentero`）。

**CLI**：不写 LogDir 强制文件（避免 headless 噪音）；默认 **stderr + 级别 `warn`**（无 `op start/end` 刷屏）。需要诊断时设 `RUST_LOG=info` 或 `RUST_LOG=agentero::op=info`。可选后续 `--log-file`。

## 5. 关键操作：开始 / 结束日志规范

### 5.1 约定格式

统一 **成对** 记录，便于 grep：

```text
op start  <name>  key=value …
op end    <name>  ok=true|false  duration_ms=N  key=value …  [error_code=…] [error=…]
```

Rust 示例：

```rust
log::info!(target: "agentero::op", "op start vault_create path={}", path);
// …
log::info!(target: "agentero::op", "op end vault_create ok=true duration_ms={}", ms);
// 失败：
log::error!(
    target: "agentero::op",
    "op end vault_create ok=false duration_ms={} error_code={} error={}",
    ms, err.code(), err
);
```

前端示例：

```ts
logger.info("op start openVault");
// …
logger.info(`op end openVault ok=true duration_ms=${ms}`);
// 失败：
logger.error(`op end openVault ok=false duration_ms=${ms} error=${msg}`);
```

**规则：**

1. 每个关键操作 **必须** 有 `start`；正常结束或失败 **必须** 有 `end`（禁止只打 start）。
2. `end` 必须带 `ok=`；失败时尽量带 `error_code`（若有）与短 `error`。
3. 异步后台任务（入库、下载、paper-reader）：start 在入队/真正开跑时；end 在终态（完成/失败/取消）。
4. 高频只读（如每次渲染触发的无副作用查询）**默认不打** start/end，避免刷屏；仅在失败时 `log::warn!` / `logger.warn`。
5. target / 模块名稳定：`agentero::op`（横切操作）、`agentero::agent`、`agentero::lookup`、`agentero::connector`、`agentero::catalog` 等。

### 5.2 操作清单（P0 必覆盖）

按「用户可感知、有副作用或长耗时」优先。

#### Host (Rust command / service)

| 操作名（log name） | 入口 | 必记字段（脱敏） | 备注 |
|---|---|---|---|
| `vault_create` | `vault_create` | path（绝对路径可记；勿记目录内文件内容） | |
| `path_trash` / `path_untrash` / `path_purge_*` | trash commands | count、batch_id | |
| `lookup_import` | `lookup_import` | query/id 类型与截断 id | 魔棒入库 |
| `paper_download_assets` | 同名 command | paper path/id | |
| `paper_import_local_pdf` | 同名 | 文件名（非全文） | |
| `paper_parse_body` | 同名 | paper path | liteparse |
| `paper_export` / `paper_import` | 同名 | format、count | |
| `paper_rescan` | 同名 | vault、result count | |
| `paper_move` / `paper_delete` | 同名 | count | |
| `paper_set_tags` / `paper_set_is_read` | 同名 | paper id | 写字段；可只 end+ok |
| `agent_run_once` | 同名 | sessionId、agentId | **勿**记 prompt 全文 |
| `agent_warm` / `agent_probe*` / `agent_cancel_run` | 同名 | agentId | |
| `agent_codex_list_threads` / `read_thread` | 同名 | thread id | 读操作；失败才 error |
| `zotero_scan` / `zotero_migrate` | 同名 | 库路径、imported/skipped | |
| `translate_text` | 同名 | service id、src/tgt lang、text_len | 勿记正文 |
| `fs_watch_start` / `stop` | watcher | vault path | |
| `connector_set_enabled` / 服务启停 | connector | enabled、port 冲突原因 | |
| `window_new` | window | — | 失败 log::error |
| `graph_rebuild` | graph | vault | 重索引 |

**实现偏好：** 在 **command 层** 包一层 start/end（统一看到 IPC 边界）；service 内部深层失败用 `log::error!` 补细节，避免每层重复 start。

可选小工具（P0 或紧随）：

```rust
// 示意：src-tauri/src/log_util.rs
pub struct OpGuard { name: &'static str, start: Instant, /* fields */ }
// Drop 或显式 finish(ok, err) 保证 end
```

#### 前端（React / lib）

| 操作名 | 入口建议 | 备注 |
|---|---|---|
| `openVault` / `createVault` | `App` / `vault.ts` | 与 Host create 可双端都有；字段对齐 |
| `runBackgroundTask` | `background-tasks.ts` | **统一包一层**：任意 kind 自动 start/end |
| `lookupImport` / 批量下载 | lookup 调用点 / App | 若已走 background task，可只靠 task 层 |
| `paperRead` | `paper-read.ts` | 与 agent session 关联 sessionId |
| `agentRunOnce`（Chat） | agent-panel | start 发消息；end 在 completed/failed |
| `connectorToggle` | settings / connector | |
| `zoteroMigrate` | migrate dialog | |
| `exportPapers` / `importPapers` | library 工具栏 | |
| `ErrorBoundary catch` | `error-boundary.tsx` | 单次 error 日志（非 op pair） |

`runBackgroundTask` 是横切抓手：所有已接入后台任务的长操作 **自动** 获得 start/end，优先改造此处，减少散落埋点。

#### CLI

| 操作 | 行为 |
|---|---|
| 每个子命令（`main` 包一层） | 打 `agentero::op` 的 `op start` / `op end`，但 **默认 filter=`warn` 不可见**；`RUST_LOG=info`（或更细 target）时才出现在 stderr |
| `--json` 成功/失败 envelope | **不变**；日志不得污染 stdout |

### 5.3 不必 start/end 的（默认）

- `paper_list` / `paper_get` 成功路径（高频；失败打 warn）
- `graph_get_backlinks` / `graph_get_graph` 成功路径
- `connector_get_status` 轮询
- UI 布局、主题、纯渲染

若日后调试需要，用 `RUST_LOG=agentero::catalog=debug` 等打开，而不是默认 Info 刷屏。

## 6. 前端模块设计

### 6.1 `src/lib/core/logger.ts`

```ts
// 职责：统一门面；Tauri 用 plugin-log；纯浏览器用 console
export const logger = {
  trace(msg: string): void;
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
};

/** 关键操作计时助手 */
export function logOp<T>(name: string, fields: Record<string, unknown>, fn: () => Promise<T>): Promise<T>;
```

- `logOp`：自动 `start` → await → `end ok=true|false duration_ms=`。
- 字段序列化：只允许 string/number/boolean；过长 string 截断（如 200 字符）。

### 6.2 初始化

- `main.tsx`（或 App mount）：若 `isTauri()`，可选 dev 下 `attachConsole()`。
- **不要**默认把所有 `console.log` 转发到插件（噪音大）；仅 ErrorBoundary 与显式 `logger.*`。

### 6.3 与 `notifyError` 配合

```ts
catch (e) {
  const msg = errorMessage(e);
  logger.error(`op end foo ok=false error=${msg}`);
  notifyError(msg); // UX 不变
}
```

若使用 `logOp`，失败日志在 helper 内完成，调用方仍负责 Toast。

## 7. Host / CLI 落地要点

### 7.1 依赖与权限

- `src-tauri/Cargo.toml`：`tauri-plugin-log`、`log`
- `package.json`：`@tauri-apps/plugin-log`
- `capabilities/default.json`：`log:default`
- `lib.rs`：`.plugin(tauri_plugin_log::Builder::new()…)`，按 §4 配置 targets / level

### 7.2 替换既有 `eprintln!`

逐步替换（P0 关键路径必须换掉）：

| 位置 | 处理 |
|---|---|
| `watcher.rs` | `log::warn!` / `error!` |
| `agent/acp.rs`、`codex`、`registry` | `log::debug!` / `error!` |
| `lib.rs` `window_new` menu | `log::error!` |
| 测试内 `eprintln!` | 可保留 |

### 7.3 CLI

- `cli/src/main.rs`：初始化 `env_logger`（或 `tracing-subscriber` fmt，二选一；P0 推荐 `env_logger` 简单）
- 与 `emit_ok` / `emit_err` 正交：日志永远不写 stdout 业务流

### 7.4 与 `AppError` 的边界

```rust
match do_thing() {
    Ok(v) => {
        log::info!(target: "agentero::op", "op end … ok=true …");
        ApiResult::ok(v)
    }
    Err(e) => {
        log::error!(target: "agentero::op", "op end … ok=false error_code={} error={}", e.code(), e);
        map_err(e)
    }
}
```

不在 `ApiResult::err` 内隐式打全局 log（避免库式二次包装重复）；优先 **command 边界** 明确成对。

## 8. 分阶段执行

### P0 — 基础设施 + 关键操作起止（本方案主交付）

1. 接入 `tauri-plugin-log` + `log` + capabilities + Builder（dev/release level/targets）。
2. 前端 `src/lib/core/logger.ts` + `logOp`；`main.tsx` 初始化（dev attachConsole 可选）。
3. `runBackgroundTask` 自动 start/end。
4. Host 表 §5.2 中 **写/长耗时 command** 成对 log；替换关键 `eprintln!`。
5. ErrorBoundary → `logger.error`。
6. CLI：`env_logger` + 写命令 start/end（至少 vault create / import / paper download）。
7. 文档：本文件状态改为「P0 已落地」；`ui.md` 可补一句「诊断日志见 logging.md」；`development/index.md` 链入。
8. **验收**：见 §9。

### P1 — 可支持性

- 设置 → 通用（或关于）：**打开日志文件夹**、**导出最近日志 zip**（仅 log 文件，无 Vault 内容）。
- 可选：设置内日志 level（持久化到 plugin-store / 设置 JSON）。
- 过滤噪音依赖（reqwest/hyper 等）的 `level_for` / filter。

### P2 — 覆盖度与约定硬化

- 剩余 command 失败路径统一 warn/error。
- `OpGuard` 或宏减少样板代码。
- 集成测试或手工 checklist：入库 / 精读 / connector 启停各走一轮，确认文件中有成对 op。

### P3 — 可选 tracing

- services 关键路径 `tracing` + span；桥接 `tracing-log`。
- 不改变前端 API 与 Toast 行为。

## 9. 验收标准（P0）

| # | 标准 |
|---|---|
| 1 | `pnpm tauri dev` 终端可见 `op start` / `op end`（至少：vault create、lookup import、agent_run_once、background download/paperRead 之一） |
| 2 | release 或 dev 配置的 LogDir 下产生日志文件，含同样 op 对 |
| 3 | 操作失败时：有 `op end ok=false` **且** 用户仍收到 Toast/任务条/对话错误（UX 不退化） |
| 4 | 日志中 **无** NOTES/PDF 正文、无完整 Agent prompt 流 |
| 5 | CLI `agentero … --json` 的 stdout 仍为纯 JSON envelope；日志在 stderr 或仅文件 |
| 6 | `capabilities` 含 `log:default`；未授权时前端 log 不静默拖垮主流程（失败应降级 console） |
| 7 | `cargo clippy` / 前端 lint 对新增代码干净 |

## 10. 建议改动文件清单（实现时）

| 区域 | 路径 |
|---|---|
| 依赖 | `src-tauri/Cargo.toml`、`package.json`、lockfiles |
| 插件注册 | `src-tauri/src/lib.rs` |
| 权限 | `src-tauri/capabilities/default.json` |
| 可选 util | `src-tauri/src/log_util.rs`（OpGuard） |
| Commands | `src-tauri/src/commands/{vault,lookup,agent,paper,trash,zotero,connector,translate,watcher,graph,window}.rs`（按 §5.2） |
| 替换 eprintln | `services/watcher.rs`、`agent/*`、`lib.rs` menu 等 |
| 前端 logger | `src/lib/core/logger.ts` |
| 横切 | `src/lib/core/background-tasks.ts`、`src/main.tsx`、`src/components/shell/error-boundary.tsx` |
| 业务埋点 | `src/lib/{vault,paper,agent}/…`、`agent-panel` 发消息路径等 |
| CLI | `cli/src/main.rs` + 写命令 |
| 文档 | 本文、`development/index.md`、`mkdocs.yml`；落地后勾 `todo.md` / roadmap 一句 |

**原则：** 小而聚焦；不借机重构 invoke 契约或 UI 布局。

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 日志刷屏（list/get） | §5.3 默认不打；level 分层 |
| 双端重复 start（前端 + Host） | 允许双端；字段用同一 `name`；前端偏用户动作，Host 偏 IPC |
| 异步任务只 start 不 end | `runBackgroundTask` / `OpGuard` 用 defer/finally |
| 隐私泄漏 | §2.2 黑名单 + code review 清单 |
| plugin 权限遗漏 | capabilities 必加；前端 isTauri 降级 console |
| CLI 污染 stdout | 强制日志走 stderr |

## 12. 决策记录（ADR 摘要）

| 决策 | 选择 | 理由 |
|---|---|---|
| 首版 facade | `log` + tauri-plugin-log | 官方路径、前后端汇聚、成本低 |
| 暂缓 tracing | P3 | 当前痛点是「有没有、成对、落盘」，不是分布式 span |
| 日志目录 | 系统 LogDir，非 Vault | local-first 与可迁移边界清晰 |
| 关键操作 | 强制 start/end + duration_ms | 可回答「卡在哪」 |
| 遥测 | 默认无 | 产品原则 |

## 13. 实现检查清单（执行时勾选）

- [x] Host：依赖 + plugin + capabilities + Builder
- [x] 前端：`logger.ts` + `logOp` + main 初始化
- [x] `runBackgroundTask` 自动 op 对
- [x] §5.2 Host 表 P0 项（vault/lookup/trash/agent_run/paper_rescan/zotero/translate/connector/watcher/graph_rebuild/window）
- [x] §5.2 前端表 P0 项（`createVault` / background_task / ErrorBoundary / boot）
- [x] 关键 `eprintln!` 替换（watcher / agent 路径）
- [x] CLI logger + 每命令 op 对（`command_label`）
- [x] ErrorBoundary 打 error 日志
- [x] §9 验收（CLI 成对 op + JSON 隔离；`log_util` 单测；`cargo check` / tsc）
- [x] 本文状态改为「P0 已落地」；index / todo 同步

### 13.1 临时验证记录（开发机）

| 项 | 结果 |
|---|---|
| `cargo test -p agentero log_util` | `trunc` + `OpTimer` ok/err 通过 |
| `agentero vault create <tmp> --json`（无 `RUST_LOG`） | stderr **无** `op start/end`；stdout 纯 JSON `ok:true` |
| `RUST_LOG=info agentero vault create <tmp> --json` | stderr：`op start/end cli.vault.create`；stdout 纯 JSON `ok:true` |
| `agentero vault which --vault /nonexistent --json` | stderr：业务 `error:` 行；stdout `ok:false`；exit 3（无默认 op 日志） |
| `cargo check -p agentero` / `agentero-cli` | 通过 |
| `pnpm exec tsc --noEmit` | 通过 |

**桌面 LogDir（release/dev 文件 sink）：** macOS `~/Library/Logs/com.poco-ai.agentero/`（`agentero*.log`）。完整 GUI 路径需 `pnpm tauri dev` 手动点一次入库/创建 Vault 再 `tail -f` 该目录。

---

**下一步：** P1 设置「打开/导出日志」；其余 command 失败路径统一 warn；可选 `OpGuard` 宏减样板。
