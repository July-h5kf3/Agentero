# Motif / notemd 数据模型（精简版）

> MVP 最小数据结构。时间戳为 ISO 8601 字符串。

## 1. Vault

```ts
interface VaultInfo {
  id: string;
  name: string;
  root_path: string;
}
```

## 2. 文件树

```ts
interface FileNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}
```

## 3. 论文

```ts
interface Paper {
  id: string;              // arxiv_id
  title: string;
  authors: string[];
  year: number;
  abstract: string;
  tags: string[];
  pdf_url?: string;
  html_url?: string;
  source_url?: string;
  vault_path: string;      // papers/<id>/  始终存在
  notes_path: string;      // papers/<id>/NOTES.md  始终存在
  source_dir: string;      // papers/<id>/source/  始终存在
  paper_md_path?: string;  // papers/<id>/source/PAPER.md，无 tex 源或不需要时为 undefined
  pdf_path?: string;       // 本地 PDF 路径，未下载时为 undefined
  citation_count?: number;
  status: 'pending' | 'importing' | 'completed' | 'failed';
}
```