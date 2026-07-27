# Agent（ACP Host）

Agentero 作为 **ACP Client**，stdio JSON-RPC 连接用户本机或远端 Agent（BYOA，不托管模型 Key）。

## 协议与运行时

- Crate：`agent-client-protocol`（及 Codex 的 npm ACP 适配器进程）。
- 会话 `cwd` = 当前 Vault 根（远程则为远端 Vault 根）。
- 统一接口：OpenCode、Gemini、Claude ACP、Codex ACP、Qoder、Grok、自定义 `command`/`args`/`env`。

```text
spawn 用户配置的 agent
  → ACP ready
  → session create / load
  → build_prompt（workflow + 可选 agentPersonalPrompt）
  → 流式 stdout → agent:stream
  → 权限请求 → 前端（ask 模式）
  → 完成 / 失败事件
```

## 命令（摘要）

| Command | 说明 |
|---|---|
| `agent_probe` / `agent_warm` | 探测与预热 |
| `agent_run_once` | 发起一轮（含 workflow / permissionMode） |
| `agent_list_sessions` / `agent_load_session` | 会话历史 |
| `agent_list_skills` | Vault skill 列表 |
| `agent_respond_permission` | 回答权限请求 |

## 权限

全局 `agentPermissionMode`：

| 模式 | 行为 |
|---|---|
| `restricted` | 默认；收紧写/敏感操作 |
| `ask` | `agent:permission-request` → 用户选择 → `agent_respond_permission` |
| `auto` | 自动批准策略项 |

## 工作流与 Skill

- workflow：`summary` / `qa` / `related_work` 等（面板 chips 映射）。
- Skill：Claude 倾向 `/id`；其它注入 `SKILL.md` 文本（`SkillMentionStyle`）。
- paper-reader：写 NOTES + `paper_set_is_read`；前端任务条编排。
- 输出约定：工作流要求 `## Sources`（相对 Vault 路径）；双链保留 `[[...]]`。
- 规划：自动注入 Vault 根 `AGENTS.md`（路线图 0.3）。

## 注册表（非模型 BYOK）

配置「如何启动本机 Agent」：id、name、template、command、args、env、默认 id。  
持久化在应用配置目录；**不**要求填写模型 API Key。

## 远程

远程 Vault 时在 **SSH 远端** 启动 Agent。见 [remote.md](remote.md)。

## 代码

`src-tauri/src/features/agent/`  
前端：[../frontend/agent.md](../frontend/agent.md)
