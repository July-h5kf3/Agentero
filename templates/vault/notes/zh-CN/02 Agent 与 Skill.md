# Agent 与 Skill

Agentero 采用 **BYOA**（Bring Your Own Agent）：由你在本机安装并登录兼容 ACP 的 Agent，Agentero 负责把当前 Vault 上下文交给它。应用内不需要填写模型 API Key。

## 添加 Agent

1. 打开 **Settings**（`⌘,`）。
2. 进入 **Agent**。
3. 选择自动探测到的 Agent，或新增自定义 Agent。
4. 如果应用探测不到，填写可执行文件的**绝对路径**。
5. 选择默认 Agent。
6. 发起一次测试对话。

## Agent 面板

点击右上角的侧边栏按钮打开 **Agent** 面板。（`⌘+L`）

打开论文时，当前论文会自动加入 Agent 上下文。你可以：

- 直接输入问题。
- 点击空状态建议 chip，如 **Summarize**、**Draft Related Work**。
- 用 `@` 提及 Vault 中的任意路径。
- 从文件树拖入文件或文件夹到输入区。

Agent 回复过程中仍可继续输入，后续消息会进入队列，当前回复结束后自动发送。

## 权限模式

设置 → Agent → **全局权限模式**（对所有 Agent 生效）：

| 模式 | 行为 |
|---|---|
| restricted（受限，默认） | 限制写入与敏感操作。 |
| ask（每次询问） | 每个权限请求都弹窗确认。 |
| auto（自动批准） | 自动批准，适合已信任的 Agent。 |

## Skill

Skill 存放在 `.agents/skills/<id>/SKILL.md`，Agent 可以通过 `$skill-id` 或 `/skill-id` 调用。

- 修改 Skill：直接编辑对应的 `SKILL.md`。
- 新增 Skill：在 `.agents/skills/` 下新建文件夹并放入 `SKILL.md`。

内置 Skill 包括：

- `paper-reader` — 精读论文并写入 `NOTES.md`。
- `agentero-cli` — 通过 CLI 执行 Vault 操作。
- `deep-research` — 多轮研究并带引用。
- `idea-evaluator` — 多角度评估研究想法。

## 精读论文

论文需有本地 PDF 且具备可读正文（TeX 或 `PAPER.md`）：

- **手动精读**：在未读论文行点击 **Zap** 图标。
- **自动精读**：设置 → Agent 开启 **autoPaperReader**（默认关闭）。

精读结果写入该论文的 `NOTES.md`，完成后论文标记为已读。

## 下一步

- [[01 Markdown 与双链]]
- [[03 论文导入与管理]]
