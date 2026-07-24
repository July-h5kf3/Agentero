# `src/lib` 目录布局

按领域分包，避免根目录扁平堆积。权威结构见下；历史草案 `docs/ref` 与此对齐。

```
src/lib/
├── core/           # 横切：tauri / logger / notify / utils / tasks…
├── settings/       # 应用设置 types / defaults / store / sync
├── vault/          # Vault 生命周期、文件树、路径/FS、remote/
├── paper/          # 论文领域 catalog + 单元语义、import/、reading-heatmap/
├── workspace/      # 中间栏文档工作区 tabs/、viewer、dockview
├── pdf/            # PDF 子系统 ask/ highlight/ selection/ translate/
├── translate/      # 应用级 TranslateService
├── agent/          # BYOA / ACP 客户端侧
├── wiki/           # 双链 / 反链 / 导航
├── markdown/       # 编辑器配套（非 Plate 组件）
├── shell/          # 快捷键、命令面板、外部拖放
└── ui/             # 纯展示偏好 theme / tag-colors
```

## 导入约定

- 领域公共 API 优先经 barrel：`@/lib/settings`、`@/lib/vault`、`@/lib/paper`、`@/lib/workspace/tabs`、`@/lib/agent`、`@/lib/wiki`。
- 横切工具走 `@/lib/core/*`（如 `@/lib/core/utils`、`@/lib/core/notify`）。
- 子模块可直引：`@/lib/paper/api`、`@/lib/pdf/ask`、`@/lib/shell/commands/types`。
- Agent `@` 提及等与 `ComposerStateStorage` 冲突的符号从 `@/lib/agent/mention` 直引，不经 `agent/index` 星导出。

## 拆分要点

| 原文件 | 新位置 |
|--------|--------|
| `settings.ts` | `settings/{types,defaults,store,sync}.ts` |
| `vault.ts` | `vault/{types,session,tree,fs,path,pick,scope,…}.ts` |
| `paper-metadata.ts` | `paper/{types,paths,detect,assets,tree-label,tags,media,load-meta}.ts` |
| `tabs.ts` | `workspace/tabs/{types,model,resources,notes-split,persist}.ts` |
| `agent.ts` | `agent/api.ts` |
| `pdf-*` | `pdf/{ask,highlight,selection,translate}/` |
