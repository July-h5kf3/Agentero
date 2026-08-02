# 翻译（Host）

| Command | 说明 |
|---|---|
| `translate_text` | 免费 MT 路径（非文献 Translator） |

| 项 | 值 |
|---|---|
| 通用 `timeout_ms` | 可选；钳制 1s–30s；默认 30s |
| 导入摘要 `free_mt_to_zh` | 链：bing → 火山 → 腾讯；**单引擎 5s**（`FREE_MT_ZH_TIMEOUT_MS`） |
| 设置页探测 | 前端 5s / 引擎 |

Agent 翻译走 `agent_run_once`，不经本 command。  
前端服务层：[../frontend/translate.md](../frontend/translate.md)  
代码：`src-tauri/src/features/translate/`
