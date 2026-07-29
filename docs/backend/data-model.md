# Vault 数据模型

事实来源分层：

| 数据 | 权威 |
|---|---|
| 笔记、PDF、TeX、marks | Vault 普通文件 |
| 论文集合与结构化 metadata | `.agentero/catalog.sqlite` |
| 双链索引 | 由 Markdown 重建（不落业务库） |

`PAPERS.md` / `library.bib` **不**默认生成；需要时导出。

## 根目录

```text
Vault/
├── AGENTS.md
├── papers/
├── notes/
├── plans/
├── .agents/skills/
└── .agentero/
    ├── catalog.sqlite
    └── .trash/
```

## Paper 单元

```text
papers/<id>/
├── NOTES.md          # 人/Agent 笔记
├── <id>.pdf          # 可选
├── marks/            # 高亮/批注/提问/翻译 JSON
├── source/           # TeX 等（可懒加载）
│   └── agentero-cite.json  # 参考文献 sidecar（可重建，见 api.md paper_refs_parse）
├── PAPER.md          # 无 TeX 时 liteparse 正文
├── assets/           # NOTES 内嵌图等
└── metadata.json     # 可选投影（catalog 为权威）
```

## marks/

- 高亮/批注：`annotations.json`（含 `comment` 的为批注）
- 提问/翻译：`<id>.json`（`kind`）
- 不写 PDF 二进制，不强制写入 NOTES

## Markdown 内嵌图

`{mdDir}/assets/` + 相对路径 `![](./assets/…)`；前端 GC 无引用文件。

## 远程

逻辑模型相同；物理 IO 为 SFTP，catalog 有 work mirror。见 [remote.md](remote.md)。

## 类型

时间戳 ISO 8601 字符串。运行时 TS/Rust 类型以代码与 [api.md](api.md) 为准。  
Catalog 列定义：[catalog.md](catalog.md)。
