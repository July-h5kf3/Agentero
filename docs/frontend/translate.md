# 翻译

应用级可插拔翻译：免费 MT + 商用 BYOK + BYOA Agent。

## 设置

Settings → **翻译**：

- **默认服务** 下拉：免费 MT 与 Agent 始终可选；商用仅列出已配置者。打开下拉时对免费 MT 与已配置商用并行 probe。
- 目标语言、划词自动翻译。
- **商用 API** 卡片仅填写 key / endpoint / region / model；点「确定」后：
  - 将 API key 写入 Host `settings.json`（Unix 权限 `0600`）；WebView 只保留同长度 `*` 掩码，不再回显明文。
  - Host `settings_get` / `settings:changed` 对 key 按字符 redact 为 `*`；`settings_set` 收到纯 `*` 串时保留原密钥。
  - `translate_text` 在 key 缺省或为 `*` 掩码时从 Host 配置解析真实密钥。
  - 随后做一次连通性 probe。卡片不承担「设为默认」选择。
- 默认服务为 Agent 时展示 Agent / 模型座。

## 消费方

- PDF 划词菜单「翻译」（首要入口）。
  - 结果卡贴合选区锚点（`trackPin`），PDF 滚轮滚动时随页重定位。
  - 翻译完成后若未悬停结果卡 / 原文黄高亮 / 页边针，约 1s 后自动收起；流式输出期间保持可见。隐藏后仍可从页边针重新打开。
- API：`runTranslate(task)`（`src/lib/translate/`）。

## 路径

| 类型 | 路径 |
|---|---|
| 免费 MT | Host `translate_text`（腾讯交互翻译 / 火山 Web / DeepLX / Google gtx） |
| 商用 BYOK | Host `translate_text`（DeepL / Azure / Google Cloud / OpenAI-compatible） |
| Agent | `agent_run_once` + 翻译 prompt |

结果可写入 `marks/`（划词）。Host 细节：[../backend/translate.md](../backend/translate.md)。
