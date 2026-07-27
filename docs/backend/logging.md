# 运行日志

| 层 | 实现 |
|---|---|
| Host | `tauri-plugin-log` + `log`；`src-tauri/src/core/log_util.rs` |
| 前端 | `src/lib/core/logger.ts` |
| CLI | `env_logger` |

- 与用户 Toast / `ApiResult` **分层**：日志不替代错误 UX。
- 关键操作记录 op start/end。
- 日志目录由插件约定；设置内「打开日志文件夹」若未做则仍可用系统日志路径排查。
