## 一、论文入库与 PDF 处理
- 重构 paper 入库流程（见 [#16](https://github.com/poco-ai/Agentero/issues/16) `paper_commit`）
- 本地 PDF 导入时 metadata 与 note.md 初始化未做（[#7](https://github.com/poco-ai/Agentero/issues/7) 剩余）
- [x] 把本地 PDF 直接拖入窗口会跳 PDF 预览器并卡死 → 窗口级 `preventDefault`；仅拖到 `papers/` 组织夹时弹 metadata 确认再入库；非 PDF 无反应（[#7](https://github.com/poco-ai/Agentero/issues/7) 部分）
- Note MD 在下载有问题时初始化有问题（[#7](https://github.com/poco-ai/Agentero/issues/7) 剩余）

## 二、Agent / 对话
- [x] 当前论文默认加到对话当中（[#8](https://github.com/poco-ai/Agentero/issues/8)）
- [x] Update / 打开 Vault 时补种缺失的 bundled skills（`vault_ensure`，仅新增、不覆盖；[#9](https://github.com/poco-ai/Agentero/issues/9)）
- 在根目录下放一个 chat 文件做全局对话/对话历史记录 → 讨论见 [#33](https://github.com/poco-ai/Agentero/issues/33)（非 Codex 持久化）
- [x] 加用户可定义系统提示词插入（`agentPersonalPrompt`，[#8](https://github.com/poco-ai/Agentero/issues/8)）

## 三、Markdown 编辑器
- [x] Markdown 编辑器编辑时卡顿（输入路径 memo / 避免整应用重渲染；[#10](https://github.com/poco-ai/Agentero/issues/10)）
- [x] 有序 / 无序列表可用（Plate list 插件；[#10](https://github.com/poco-ai/Agentero/issues/10)）
- [x] 选中文字中性色（非高饱和蓝；[#10](https://github.com/poco-ai/Agentero/issues/10)）
- [x] 末行可点、可追加新行；图片后保持 trailing paragraph（[#10](https://github.com/poco-ai/Agentero/issues/10)）
- [x] 笔记写后审阅用统一 Diff（`NotesReviewDiff`），非双栏对比（[#11](https://github.com/poco-ai/Agentero/issues/11)）

## 四、文件树 / Vault
- [x] `@` 空态：最近路径 + 浅层目录树；行内可下钻子目录（[#12](https://github.com/poco-ai/Agentero/issues/12)）
- [x] `@` 论文标签与文件树 `paperTreeLabelMode` 一致（[#12](https://github.com/poco-ai/Agentero/issues/12)）
- [x] 文件夹排序按显示名称（`paperTreeSortMode` + 显示名；[#12](https://github.com/poco-ai/Agentero/issues/12)）
- [x] 目录树收缩快捷键：`⌘←` 折叠选中 / `⇧⌘←` 折叠至默认只展开 `papers/`（[#12](https://github.com/poco-ai/Agentero/issues/12)）

## 五、批注 / PDF UI
- [x] 批注默认文字颜色减弱对比（[#13](https://github.com/poco-ai/Agentero/issues/13)）
- [x] 批注内联编辑：`Enter` 保存 / `Shift+Enter` 换行（[#13](https://github.com/poco-ai/Agentero/issues/13)）

## 六、界面 / 图标
- [x] 整体页面 icon 偏小，小屏幕下更小（[#14](https://github.com/poco-ai/Agentero/issues/14)）
- [x] 配置「面板」的 Icon 换新的，和另一个太像（[#14](https://github.com/poco-ai/Agentero/issues/14)）
- [x] 热力图标在标题文字背景上（横条左→右 = 文首→文末，深度 = 该位置交互强度；颜色不显眼）（[#14](https://github.com/poco-ai/Agentero/issues/14)）
