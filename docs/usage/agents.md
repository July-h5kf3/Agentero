# 接入 Agent

Agentero 使用 BYOA（Bring Your Own Agent）：Agent 由你安装和登录，Agentero 负责把当前 Vault 的上下文交给它，并展示结果。

## 支持方式

当前 Agent 通过 ACP 接入。常见选项包括：

- Claude ACP；
- Codex ACP；
- OpenCode；
- Gemini 或其它兼容 ACP 的命令行 Agent；
- 自定义 ACP Agent。

Agent 不随 Agentero 一起分发。首次配置前，请先按照对应 Agent 的官方说明完成安装和登录。

## 添加 Agent

1. 打开 **Settings**。
2. 进入 **Agent**。
3. 查看自动探测到的 Agent，或新增自定义 Agent。
4. 检查命令路径和参数。
5. 选择默认 Agent。
6. 启动一次测试对话，确认 Agent 可以访问当前 Vault。

如果 Agent 在终端中能运行、但 Agentero 探测不到，优先检查命令是否在 Agentero 进程的 PATH 中。macOS 图形应用启动时使用的 PATH 可能与交互式终端不同；必要时填写可执行文件的绝对路径。

## 第一次对话

1. 打开一篇论文。
2. 打开右侧 **Agent** 面板。
3. 直接发送问题，或选择空状态中的总结、问答和 Related Work 工作流。
4. 检查回答中的论文上下文。
5. 如果 Agent 修改了笔记，在 Diff 页面选择 Keep 或 Revert。

当前论文默认会作为上下文。也可以使用 `@` 提及 Vault 中的论文目录、Markdown 文件或文件夹，或把文件从文件树拖进输入框。

## 权限模式

在 Settings → Agent 中选择全局权限模式：

| 模式 | 适合场景 |
|---|---|
| 受限 | 第一次试用，限制 Agent 的写入和外部操作 |
| 每次询问 | 希望逐次确认 Agent 请求的权限 |
| 自动批准 | 已信任 Agent 和当前 Vault，追求连续操作效率 |

建议第一次使用时选择 **每次询问**。确认 Agent 的行为符合预期后，再考虑切换权限模式。

## 让 Agent 精读论文

论文需要有本地 PDF，并且有 TeX 或 `PAPER.md` 等可读正文资源。

### 手动精读

1. 在文件树中找到资源齐全且尚未精读的论文。
2. 点击论文行上的 Zap 图标。
3. 等待左下角后台任务完成。
4. 打开该论文的 `NOTES.md` 检查结果。

### 自动精读

在 Settings → Agent 开启 **自动精读**。之后通过魔棒导入论文或对单篇论文补下载资源时，Agentero 可以在资源准备好后自动运行精读。

自动精读默认关闭；批量导入和批量下载不会自动为每篇论文连续启动精读。

## 常见问题

### Agent 显示探测失败

确认命令已经安装、当前用户可以在终端执行，并在 Agent 设置中填写正确路径。若使用 Node 全局安装，检查全局 bin 目录是否在应用 PATH 中。

### Agent 能回答，但不能写 NOTES.md

检查全局权限模式和 Agent 进程的工作目录。对于远程 Vault，Agent 必须安装在远程服务器上，并以远程 Vault 根目录作为工作目录。

### 不想让 Agent 修改笔记

使用受限模式，或在每次询问模式下拒绝写入权限。Agent 写入后的笔记会先进入统一 Diff 审阅流程。
