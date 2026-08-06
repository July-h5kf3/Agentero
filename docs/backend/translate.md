# 翻译（Host）

| Command | 说明 |
|---|---|
| `translate_text` | 免费 MT + 商用 BYOK 路径（非文献 Translator） |

| 项 | 值 |
|---|---|
| 通用 `timeout_ms` | 可选；钳制 1s–30s；默认 30s |
| 商用 BYOK | DeepL / Azure / Google Cloud / OpenAI-compatible；`apiKey` 可由调用方传入，或由 Host 从 `settings.translate.providerConfigs` 解析（前端仅持有同长度 `*` 掩码） |
| 密钥存储 | 明文写在用户本机 `settings.json`（Unix `0600`）；`settings_get` / 广播按字符 redact 为 `*`；`settings_set` 对纯 `*` 串 merge 保留原值 |
| 导入摘要 `free_mt_to_zh` | **并行竞速** 腾讯 / 火山 / DeepLX，取最先成功；单引擎 5s（`FREE_MT_ZH_TIMEOUT_MS`）；全失败则不写翻译 |
| 设置页探测 | 前端 5s / 引擎 |

Agent 翻译走 `agent_run_once`，不经本 command。  
前端服务层：[../frontend/translate.md](../frontend/translate.md)  
代码：`src-tauri/src/features/translate/`
