# Agentero 用户指南

这组教程面向第一次使用 Agentero 的研究者。你不需要先了解 Tauri、ACP 或 Catalog；按照自己的目标选择一篇教程即可。

Agentero 的核心工作方式是：

1. 用一个 **Vault** 保存论文、PDF、Markdown 笔记和阅读标注。
2. 用 Library 统一浏览论文，用文件树访问原始文件。
3. 用 PDF 阅读器完成高亮、批注、提问和翻译。
4. 按需连接你已经安装的 Agent，让 Agent 在当前 Vault 中总结论文、回答问题或整理笔记。

## 推荐路径

| 你想做什么 | 从哪里开始 |
|---|---|
| 第一次使用 Agentero | [安装与首次使用](getting-started.md) |
| 把 DOI、arXiv 或网页上的论文保存下来 | [导入和管理论文](import-papers.md) |
| 阅读 PDF、做高亮、写批注 | [阅读、标注与整理](read-and-organize.md) |
| 让 Claude、Codex 或其它 ACP Agent 参与研究 | [接入 Agent](agents.md) |
| 在浏览器中点击 Zotero Connector 保存论文 | [使用 Zotero Connector](zotero.md) |
| 使用服务器上的研究资料库 | [打开远程 Vault](remote-vault.md) |

## 先理解三个概念

### Vault

Vault 是一个普通文件夹。论文目录、`NOTES.md`、PDF、Markdown 和 `marks/` 都保存在其中；离开 Agentero 后仍可以用编辑器、终端或 Git 访问这些文件。

### Library

Library 是 Agentero 根据 Vault 中论文数据生成的论文列表。排序、标签与论文元数据来自 `.agentero/catalog.sqlite`，而笔记正文仍以 Vault 中的普通文件为准。

### Agent

Agentero 不内置模型，也不托管模型 API Key。它通过 ACP 连接你本机或远程服务器上已经安装并完成登录的 Agent。Agent 的权限由设置中的权限模式控制。

## 当前使用边界

- 远程 Vault 当前支持 macOS 和 Linux 客户端；Windows 客户端不能打开远程 Vault。
- Zotero Connector 与 Zotero 桌面端不能同时占用本机 `23119` 端口。
- Connector 当前支持保存条目和 PDF 附件；网页快照、Cookies 等能力尚未覆盖。
- PDF 标注保存在论文目录的 `marks/` 中，不会改写原始 PDF。
- 自动精读默认关闭，需要在设置中主动开启。
