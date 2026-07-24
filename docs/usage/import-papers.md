# 导入和管理论文

Agentero 提供四种常用入口。选择哪一种取决于你手上的资料，而不是论文来源。

| 手上的资料 | 推荐入口 |
|---|---|
| DOI、arXiv ID、PMID、ISBN 或论文链接 | 魔棒 |
| 浏览器中正在打开的论文网页 | Zotero Connector |
| 本地 PDF 文件 | 魔棒中的本地文件导入 |
| 已有 Zotero 文库 | 从 Zotero 迁移 |

## 用魔棒导入标识符或链接

1. 打开一个 Vault。
2. 在左侧选择魔棒，或使用命令面板中的导入入口。
3. 粘贴 DOI、arXiv ID、PMID、ISBN 或论文 URL。
4. 检查识别出的标题和作者。
5. 确认导入。

导入成功后，Agentero 会创建论文目录，写入元数据，并尽量下载 PDF。对于 arXiv 论文，还会尝试把 LaTeX 源码解压到 `source/`。

导入后的论文通常位于：

```text
papers/<paper-id>/
├── NOTES.md
├── <paper-id>.pdf
└── source/          # 有可用源文件时才会出现
```

### 识别失败时

- 优先粘贴单篇论文的 DOI 或 URL，不要一次粘贴带多个候选结果的搜索页。
- 检查设置中的 Translator 服务地址是否可访问。
- arXiv 论文可以直接使用 arXiv ID 作为备用入口。
- 元数据成功但 PDF 下载失败时，先保留论文条目，再在 Library 或论文行上使用 Download。

## 导入本地 PDF

1. 打开魔棒的本地文件导入入口。
2. 选择一个或多个 PDF。
3. 选择目标目录。
4. 等待解析和写入完成。

本地 PDF 的文件名不一定包含完整论文信息。导入后应在 Paper Info 中检查标题、作者、年份和标签；需要时再手动修改。

## 从 Zotero 迁移

适合把已有 Zotero 文库整体迁移到一个新的 Agentero Vault：

1. 在欢迎页选择 **Migrate from Zotero**，或在侧栏打开对应入口。
2. 选择包含 `zotero.sqlite` 和 `storage/` 的 Zotero 数据目录。
3. 先查看扫描结果，确认论文、PDF 和笔记数量。
4. 选择是否复制本地 PDF。
5. 选择是否按 Zotero collection 创建子文件夹。
6. 选择是否迁移笔记和 PDF 高亮批注。
7. 开始迁移并等待进度完成。

迁移过程不会把 Zotero 数据库作为 Agentero 的运行时数据库；论文文件、笔记和 PDF 会写入当前 Vault，Library 元数据写入当前 Vault 的 Catalog。

## 管理论文

### 用标签查找

在 Library 中使用搜索框（匹配标题或标签子串）或 tags 列查看标签。标签可以在 Paper Info 中新增、删除和设置颜色。

### 补下载资源

如果论文行显示缺少 PDF，选择 Download。没有 TeX 且没有 `PAPER.md` 时，Agentero 也可能提供正文资源下载或解析入口。

### 处理重复导入

重复导入通常会复用已有论文目录或显示去重结果。确认结果后，不要手动删除目录中的 `NOTES.md`；其中可能已经包含你的阅读记录。
