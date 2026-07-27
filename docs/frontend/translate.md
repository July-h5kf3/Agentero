# 翻译

应用级可插拔翻译：免费 MT + BYOA Agent（无付费 API Key 表单）。

## 设置

Settings → **翻译**：服务类型、目标语言、Agent 座（跟随默认或指定）。

## 消费方

- PDF 划词菜单「翻译」（首要入口）。
- API：`runTranslate(task)`（`src/lib/translate/`）。

## 路径

| 类型 | 路径 |
|---|---|
| 免费 MT | Host `translate_text`（内置 Google gtx 或 LibreTranslate URL） |
| Agent | `agent_run_once` + 翻译 prompt |

结果可写入 `marks/`（划词）。Host 细节：[../backend/translate.md](../backend/translate.md)。
