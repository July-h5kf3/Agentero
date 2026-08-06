# 翻译

应用级可插拔翻译：免费 MT + 商用 BYOK + BYOA Agent。

## 设置

Settings → **翻译**：服务类型、目标语言、免费 MT endpoint、商用 API key / region / model、Agent 座（跟随默认或指定）。

## 消费方

- PDF 划词菜单「翻译」（首要入口）。
  - 结果卡贴合选区锚点（`trackPin`），PDF 滚轮滚动时随页重定位。
  - 翻译完成后若未悬停结果卡 / 原文黄高亮 / 页边针，约 1s 后自动收起；流式输出期间保持可见。隐藏后仍可从页边针重新打开。
- API：`runTranslate(task)`（`src/lib/translate/`）。

## 路径

| 类型 | 路径 |
|---|---|
| 免费 MT | Host `translate_text`（内置 Google gtx 或 LibreTranslate URL） |
| 商用 BYOK | Host `translate_text`（DeepL / Azure / Google Cloud / OpenAI-compatible） |
| Agent | `agent_run_once` + 翻译 prompt |

结果可写入 `marks/`（划词）。Host 细节：[../backend/translate.md](../backend/translate.md)。
