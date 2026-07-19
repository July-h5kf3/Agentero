## 一、论文入库与 PDF 处理
- 重构 paper 入库流程（见 [#16](https://github.com/poco-ai/Agentero/issues/16) `paper_commit`）
- 本地 PDF 导入时 metadata 与 note.md 初始化未做（[#7](https://github.com/poco-ai/Agentero/issues/7) 剩余）
- [x] 把本地 PDF 直接拖入窗口会跳 PDF 预览器并卡死 → 窗口级 `preventDefault`；仅拖到 `papers/` 组织夹时弹 metadata 确认再入库；非 PDF 无反应（[#7](https://github.com/poco-ai/Agentero/issues/7) 部分）
- Note MD 在下载有问题时初始化有问题（[#7](https://github.com/poco-ai/Agentero/issues/7) 剩余）

## 二、Agent / 对话
- [x] Update / 打开 Vault 时补种缺失的 bundled skills（`vault_ensure`，仅新增、不覆盖；[#9](https://github.com/poco-ai/Agentero/issues/9)）
- 在根目录下放一个 chat 文件做全局对话/对话历史记录 → 讨论见 [#33](https://github.com/poco-ai/Agentero/issues/33)（非 Codex 持久化）
