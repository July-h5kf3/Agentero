# 诊断信息上报（Telemetry）

Opt-out 的崩溃/错误诊断上报：收集应用版本、设备与系统信息、已安装 ACP Agent 清单和 ERROR 级日志，POST 到服务器。实现：`src-tauri/src/features/telemetry/`（`mod.rs` + `commands.rs`）、前端 `src/lib/core/telemetry.ts`。

## 开关与端点

- **端点**：编译期环境变量 `AGENTERO_TELEMETRY_ENDPOINT`（`option_env!`）注入；**未设置时整个上报为 no-op**，不产生任何网络请求。打包时注入，例如 `AGENTERO_TELEMETRY_ENDPOINT=https://example.com/api/telemetry pnpm tauri build`。
- **用户开关**：`AppSettings.telemetryEnabled`（默认 `true`，Settings → General → Privacy 可关）。关闭后 Host 拒绝一切上报（含手动）。
- **安装 ID**：`~/.config/agentero/telemetry_id` 持久化的匿名 UUID v4，不含账号/设备硬件序列号。

## 上报时机

| 事件 | 触发 | 内容 |
|---|---|---|
| `launch` | 启动后异步（`spawn_startup_report`，不阻塞 boot） | 设备信息 + Agent 清单 + 本地会话队列 + 最近 ERROR 日志 |
| `crash` | 上次运行有 panic（panic hook 落盘 `pending_crash.json`，下次启动补报后删除） | 同 launch + 崩溃 message/location/backtrace |
| `error` | 前端 `window.onerror` / `unhandledrejection` / ErrorBoundary，2s 防抖批量 invoke | 错误 message + stack（脱敏） |
| `manual` | Settings → General「立即发送诊断信息」 | 同 launch |

崩溃时网络不可靠，故 panic hook 只写盘、由下次启动补报。

## 会话记录（活跃/时长）

每次会话落盘、批量上报，服务器端只需存现成行：

- **启动**（telemetry 开启时）：写 `session_start` 时间戳标记。
- **退出**（`RunEvent::Exit`，同步钩子 `record_exit`）：向 `~/.config/agentero/sessions.jsonl` **追加**一条 `SessionRecord { startedAtMs, endedAtMs, durationMs, appVersion }`。
- **下次启动**：`launch`/`crash` 事件带 `sessions` 数组（drain 队列，一次上传全部积压；队列上限 500 条，超出丢最旧）。当前进行中的会话不重复上报——`timestampMs` 即本次启动时间。
- 用户关闭 telemetry 时 `record_exit` 清理标记与队列，不残留。

据此服务器可直接统计 DAU（按 `installId` + 日期）、打开时段（`startedAtMs`）与使用时长（`durationMs`），无需心跳流量。

## 采集字段与脱敏

- **设备**：OS 名称/版本（`os_info`）、CPU 架构、电脑型号（macOS `sysctl hw.model` / Linux DMI / Windows 注册表，best-effort）。
- **版本**：`CARGO_PKG_VERSION`。
- **Agent**：`AgentRegistry::scan_catalog()` 产出的 id + 名称 + 是否安装 + ACP 是否就绪（不含 command 路径）。
- **日志**：仅 `agentero*.log` 中 ERROR 行，最多 100 条、单行截断 500 字符。
- **脱敏**：所有文本将用户 home 目录替换为 `~`；不含论文内容、笔记或 API Key。

## 命令

| Command | 说明 |
|---|---|
| `telemetry_send_diagnostics` | 手动上报；返回 `{ enabled, sent }` |
| `telemetry_report_frontend_errors` | 前端错误批量缓冲上报（`{ args: { errors } }`） |

发送走 `features::network::client_builder()`（遵循全局代理），10s 超时、失败重试一次；失败仅 `log::warn`，不向用户报错。
