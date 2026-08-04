# Agent 面板

BYOA：连接本机（或远程）ACP Agent。Host 协议见 [../backend/agent.md](../backend/agent.md)。

## UI 分层

```text
AI Elements (Conversation / Message / PromptInput / Sources / Reasoning)
  → AgentPanel 状态机（含 zen）
  → invoke agent_* + 订阅 agent:* 事件
```

流式：`agent:stream`（message | thought）→ 完成 / 失败事件。写 NOTES 后统一 Diff（Keep / Revert）。

## 面板行为

- 空态建议 chips → workflow：`summary` / `qa` / `related_work`。
- **当前论文默认 context**（可 X 移除）；`@` 提及或文件树拖入 → context chip。
- **选区上下文**（Cursor 式）：Markdown / PDF 中选中文字 → composer 出现瞬时选区 chip（虚线，实时跟随最新选区；取消选区即消失）；`⌘L` 或 PDF 划词菜单「加入对话」将其**固定**（实底，最多 4 个）并打开 Agent 面板；无选区时 `⌘L` 仍是开关侧栏。发送时选区以 `Selected text from {path} (page N):` + `> 引用` 追加进 prompt，随该轮消费清空；不落 localStorage，超长截断 4000 字符。Store：`src/lib/agent/selection-store.ts`。
- `@`：空时优先最近路径与浅层目录；› 进入子目录；论文标签与 `paperTreeLabelMode` 一致。`@`、`$` 与 `/` 候选菜单由 viewport 碰撞处理定位，空间不足时翻转并在可用高度内滚动。
- ACP `plan` 事件使用 AI Elements `Plan` / `PlanStep` 展示，可折叠查看步骤；步骤状态由图标、完成态和无障碍文案表达。
- 运行中可继续输入 → Queue waitlist；标题保持简洁，条目等宽并可单独移除；Esc / 停止中止。
- 会话空闲时 hover 用户消息可 **Edit** 后重发。
- Slash 命令完全来自当前 ACP session 的 `available_commands_update`；Agentero 不再注册本地 action/template。命令以 `/name` 填入 Composer，并在当前 provider session 中原样发送。

## 禅模式

- `⌥⌘Z` / Layout 菜单。
- 全屏对话；左侧弱对比历史；精读 / 划词等 `hideFromChatHistory`。

## 权限 UI

全局模式（设置）：`restricted` / `ask` / `auto`。  
`ask` 时弹权限对话框 → `agent_respond_permission`。

## 精读（paper-reader）

| 触发 | 条件 |
|---|---|
| Zap | 有 PDF +（TeX 或 `PAPER.md`）且未读 |
| 自动 | `autoPaperReader`（默认关）；魔棒/单篇 Download 后 |

成功写 `NOTES.md`，`is_read = true`；进度在后台任务条。批量导入不连跑。  
Skill 语法由 Host 按 provider 分流（Claude `/id`，其它注入 `SKILL.md`）。

## 个人偏好

`agentPersonalPrompt`：非空时经 Host `build_prompt` 注入 envelope。

## 代码

- UI：`src/components/agent/`
- 状态：`src/lib/agent/`（chat-state、composer-state、stream-parse、mention）
- 精读编排：`src/lib/paper/reader.ts`
