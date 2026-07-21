# 安装与首次使用

本教程带你完成第一次打开 Agentero、创建 Vault 并确认工作区可以使用。

## 准备工作

从项目发布页下载与你的系统匹配的桌面版本。开发者也可以在仓库根目录运行：

```bash
pnpm install
pnpm tauri dev
```

首次使用不需要先安装 Zotero 或 Agent。只有在需要浏览器导入或 AI 辅助阅读时，才需要继续配置对应软件。

## 创建第一个 Vault

1. 启动 Agentero。
2. 在欢迎页选择 **Create Vault**。
3. 选择一个长期保存研究资料的位置，例如 `~/Documents/ResearchVault`。
4. 等待文件树和 Library 加载完成。

Vault 是普通目录。建议不要把它放在临时目录、下载目录或会被自动清理的同步缓存目录中。

创建后，目录通常会包含：

```text
ResearchVault/
├── papers/
├── notes/
├── plans/
└── .agentero/
    └── catalog.sqlite
```

不要手动编辑 `.agentero/catalog.sqlite`。论文正文和笔记可以直接用外部编辑器修改，但结构化论文元数据应通过 Agentero 操作。

## 打开已有 Vault

在欢迎页选择 **Open Vault**，选择包含 `papers/`、`notes/` 或 Markdown 资料的目录。Agentero 会扫描现有文件并建立或补齐论文目录。

如果已有目录中的文件没有立即出现在 Library：

1. 打开 Library。
2. 点击 **Rescan**。
3. 等待扫描完成后重新查看论文列表。

## 第一次检查

打开一个 Vault 后，建议依次确认：

1. 左侧文件树能够展开 `papers/`。
2. Library 能够显示论文或空状态。
3. 可以新建一个 Markdown 文件并保存。
4. 打开 PDF 后可以翻页和搜索。

## 数据位置和备份

Vault 中最重要的用户数据是：

| 路径 | 用途 |
|---|---|
| `papers/<paper>/NOTES.md` | 论文笔记、摘要和整理结果 |
| `papers/<paper>/marks/` | PDF 高亮、批注、提问和翻译结果 |
| `papers/<paper>/*.pdf` | PDF 原文 |
| `papers/<paper>/source/` | arXiv 等来源的 TeX 或其它源文件 |
| `.agentero/catalog.sqlite` | Library 使用的论文集合和元数据 |

建议定期备份整个 Vault。若使用 Git，优先提交 Markdown、JSON、TeX 和其它源文件；`catalog.sqlite` 也应随 Vault 一起备份，以保留 Library 元数据。
