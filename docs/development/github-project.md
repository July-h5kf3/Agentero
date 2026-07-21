# GitHub Project 结构（Agentero）

> **Project**：[`poco-ai/Agentero` → Org Project #1](https://github.com/orgs/poco-ai/projects/1)（标题 **Agentero**）  
> **Roadmap 导航**：[**#41 ROADMAP**](https://github.com/poco-ai/Agentero/issues/41)（现状 / 开放 issue 地图 / 建议顺序；2026-07 起）  
> **语料**：`docs/development/todo.md`（未勾选）、`docs/development/bug.md`、`docs/development/roadmap.md`  
> **原则**：相似问题合成 **一条 Issue**；子任务写在 Issue body checklist。  
> **Issue 已创建**（2026-07-19）：规划 ID → GitHub number 见 §3.0；看板已灌入 Project #1。  
> **已修复记录**（如 `docs/bug_fix/`）不进 backlog，仅作对照。

---

## 1. Project 本体

| 项 | 值 |
|---|---|
| Owner | `poco-ai`（Organization） |
| Number | `1` |
| Title | Agentero |
| Visibility | 私有（org 默认；可在网页改为 Public） |
| 关联仓库 | [`poco-ai/Agentero`](https://github.com/poco-ai/Agentero)（`gh project link`） |
| 看板 URL | https://github.com/orgs/poco-ai/projects/1 |

### 1.1 推荐视图

| 视图 | 用途 |
|---|---|
| **Board**（默认） | 按 Status 拖拽：Todo → In Progress → Done |
| **Table**（可选） | 按 Priority / Area 筛选、批量改字段 |
| **Roadmap**（可选） | 若启用迭代/目标日期再开 |

### 1.2 字段策略

GitHub Projects v2 自带 **Status** 等内置字段。自定义字段（Type / Area / Priority）可在网页 **Settings → Fields** 添加；CLI 创建字段视 token 与权限而定。

| 字段 | 类型 | 取值建议 |
|---|---|---|
| **Status** | 内置 | Todo / In Progress / Done（以 Project 实际列为准） |
| **Priority** | Single select | `P0` 近期 · `P1` 中期 · `P2` 远期/可选 |
| **Type** | Single select | `bug` · `feature` · `epic` |
| **Area** | Single select | 见 §2 Labels 中的 `area:*` |

**无自定义字段时**：完全依赖 **Labels**（§2）区分类型与区域。

### 1.3 与 PR / 分支

| 资产 | Project 中的角色 |
|---|---|
| [PR #6](https://github.com/poco-ai/Agentero/pull/6) WIP Remote Vault | 链到草案 **F15**；看板 Status = In Progress |
| 其它 PR | 实现某 Issue 时 `Closes #n` 或手动 item-add |

---

## 2. Labels（仓库级，创建 Issue 时使用）

| Label | 含义 |
|---|---|
| `type:bug` | 缺陷 / 体验回归 |
| `type:feature` | 功能 |
| `type:epic` | 多周跨模块 |
| `area:import` | 入库 / 魔棒 / Connector / Bib |
| `area:agent` | BYOA / skill / workflow |
| `area:editor` | Markdown / Plate / 双链 |
| `area:tree` | 文件树 / Vault UX / 采纳 |
| `area:pdf` | PDF / 批注 / 划词 |
| `area:ui` | 布局 / 图标 / 分屏 / 命令面板 |
| `area:remote` | SSH/SFTP 远程 Vault |
| `area:cli` | headless CLI |
| `area:release` | 发布 / 签名 |
| `area:platform` | 多端 / 同步 / Git 集成 |
| `area:graph` | 引用图 / 作者机构图 / Connected Papers 式 |
| `priority:p0` | 近期 |
| `priority:p1` | 中期 |
| `priority:p2` | 远期 |
| `status:wip` | 进行中（epic/PR） |

---

## 3. Issue 目录（规划 ID ↔ GitHub）

规划 ID（B*/F*）为产品语料编号；**#n** 为仓库 `poco-ai/Agentero` 的 GitHub issue number。

### 3.0 映射一览

| 规划 ID | GitHub | Status |
|---|---|---|
| **ROADMAP** | [#41](https://github.com/poco-ai/Agentero/issues/41) | **导航**（汇总现状 + 开放 issue；非交付项） |
| **B1** | [#7](https://github.com/poco-ai/Agentero/issues/7) → 并入 [#16](https://github.com/poco-ai/Agentero/issues/16) | **Closed**（跟进见 #16） |
| **B2, B4–B8** | [#8](https://github.com/poco-ai/Agentero/issues/8), [#10](https://github.com/poco-ai/Agentero/issues/10)–[#14](https://github.com/poco-ai/Agentero/issues/14) | **Done** |
| **B3** | [#9](https://github.com/poco-ai/Agentero/issues/9) | **Done**（`vault_ensure` 打开时补种缺失 skills） |
| F1–F14 | [#15](https://github.com/poco-ai/Agentero/issues/15)–[#28](https://github.com/poco-ai/Agentero/issues/28) | Todo |
| **F15** | [#29](https://github.com/poco-ai/Agentero/issues/29) | **In Progress** |
| F16–F18 | [#30](https://github.com/poco-ai/Agentero/issues/30)–[#32](https://github.com/poco-ai/Agentero/issues/32) | Todo |
| 历史持久化（讨论） | [#33](https://github.com/poco-ai/Agentero/issues/33) | Todo（非 Codex 对话落盘） |
| Remote PR | [PR #6](https://github.com/poco-ai/Agentero/pull/6) | **In Progress**（链 F15） |

### 3.1 Bug（语料：`bug.md`）

| ID | # | 标题 | Labels |
|---|---|---|---|
| **B1** | [#7](https://github.com/poco-ai/Agentero/issues/7) | bug: 入库 / 本地 PDF / NOTES 初始化异常 | `type:bug` `area:import` `priority:p0` · **Partial** |
| **B2** | [#8](https://github.com/poco-ai/Agentero/issues/8) | bug: Agent 上下文与系统提示体验 | `type:bug` `area:agent` `priority:p1` · **Done** |
| **B3** | [#9](https://github.com/poco-ai/Agentero/issues/9) | bug: Skill 随应用更新同步 | `type:bug` `area:agent` `priority:p1` · **Done** |
| **B4** | [#10](https://github.com/poco-ai/Agentero/issues/10) | bug: Markdown 编辑器卡顿与选区/末行 | `type:bug` `area:editor` `priority:p0` · **Done** |
| **B5** | [#11](https://github.com/poco-ai/Agentero/issues/11) | bug: 笔记审阅应用 Diff 展示 | `type:bug` `area:editor` `area:agent` `priority:p1` · **Done** |
| **B6** | [#12](https://github.com/poco-ai/Agentero/issues/12) | bug/ux: 文件树 @ 提及与显示名排序 | `type:bug` `area:tree` `priority:p1` · **Done** |
| **B7** | [#13](https://github.com/poco-ai/Agentero/issues/13) | bug: 批注默认色与 Enter 快捷键 | `type:bug` `area:pdf` `priority:p1` · **Done** |
| **B8** | [#14](https://github.com/poco-ai/Agentero/issues/14) | bug/ux: 标题栏图标与热力图样式 | `type:bug` `area:ui` `priority:p2` · **Done** |

### 3.2 Feature / Epic（语料：`todo.md` 未勾选 + 产品远期）

| ID | # | 标题 | Labels |
|---|---|---|---|
| **F1** | [#15](https://github.com/poco-ai/Agentero/issues/15) | epic: Vault 采纳 / 打开已有文件夹整理 | `type:epic` `area:tree` `priority:p0` |
| **F2** | [#16](https://github.com/poco-ai/Agentero/issues/16) | feature: 统一 paper 入库管线 (`paper_commit`) | `type:feature` `area:import` `priority:p0` |
| **F3** | [#17](https://github.com/poco-ai/Agentero/issues/17) | feature: 魔棒增强（候选 / 拖拽 / 元数据确认） | `type:feature` `area:import` `priority:p1` |
| **F4** | [#18](https://github.com/poco-ai/Agentero/issues/18) | feature: Translator sidecar 本机捆绑 | `type:feature` `area:import` `priority:p1` |
| **F5** | [#19](https://github.com/poco-ai/Agentero/issues/19) | feature: Agent AGENTS.md 注入与写前草稿拦截 | `type:feature` `area:agent` `priority:p0` |
| **F6** | [#20](https://github.com/poco-ai/Agentero/issues/20) | feature: 文献引用图 + Connected Papers 式邻域 + 引用 workflow | `type:epic` `area:graph` `area:agent` `priority:p1` |
| **F7** | [#21](https://github.com/poco-ai/Agentero/issues/21) | feature: 双链 / Graph 增强 | `type:feature` `area:editor` `priority:p1` |
| **F8** | [#22](https://github.com/poco-ai/Agentero/issues/22) | feature: 工作区分屏（V0.6） | `type:feature` `area:ui` `priority:p1` |
| **F9** | [#23](https://github.com/poco-ai/Agentero/issues/23) | feature: PDF 批注系统深化 | `type:feature` `area:pdf` `priority:p1` |
| **F10** | [#24](https://github.com/poco-ai/Agentero/issues/24) | feature: Zotero Connector 协议（C4c/C5a/C5b/C5c 已落地） | **Done** · `type:feature` `area:import` `priority:p1` |
| **F11** | [#25](https://github.com/poco-ai/Agentero/issues/25) | feature: 命令面板 / 搜索增强 | `type:feature` `area:ui` `priority:p1` |
| **F12** | [#26](https://github.com/poco-ai/Agentero/issues/26) | feature: CLI P1 | `type:feature` `area:cli` `priority:p1` |
| **F13** | [#27](https://github.com/poco-ai/Agentero/issues/27) | feature: 偏好迁 Tauri Store + 日志文件夹入口 | `type:feature` `area:ui` `priority:p1` |
| **F14** | [#28](https://github.com/poco-ai/Agentero/issues/28) | feature: 发布签名 / 公证 / changelog / artifact 命名 | `type:feature` `area:release` `priority:p2` |
| **F15** | [#29](https://github.com/poco-ai/Agentero/issues/29) | epic: 远程 Vault 后续（M4+） | `type:epic` `area:remote` `status:wip` `priority:p1` |
| **F16** | [#30](https://github.com/poco-ai/Agentero/issues/30) | feature: 翻译 / 导入边界可选增强 | `type:feature` `area:import` `priority:p2` |
| **F17** | [#31](https://github.com/poco-ai/Agentero/issues/31) | epic: 平台扩展（iPad / Git / 云同步） | `type:epic` `area:platform` `priority:p2` |
| **F18** | [#32](https://github.com/poco-ai/Agentero/issues/32) | epic: 作者 / 机构 / 会议关系图谱（Connected Papers 式扩展） | `type:epic` `area:graph` `priority:p2` |

### 3.3 关系示意

```text
F2 paper_commit ──┬── F3 魔棒增强
                  ├── F10 Connector 协议
                  └── F15 远程入库加固

F6 引用邻域 ──────── F18 作者/机构/会议图
F7 双链 Graph（wikilink，非文献引用）

F1 Vault 采纳 ────── F17 平台/同步（远期可共用路径语义）

B1 入库 bug ──────── F2（修 bug 时避免与 commit 管线冲突）
B4/B5 编辑器 ─────── F7 / notes-review UX
```

### 3.4 远期 Epic 范围拆解（结构冻结；非 GitHub Issue）

以下仅作 Project / roadmap 规划用的子范围清单，**不单独开 Issue**，待排期时再拆。

#### F17 · 平台扩展（iPad / Git / 云同步）· `area:platform` · P2

| 子范围 | 说明 | 与现有能力关系 |
|---|---|---|
| **iPad / 触控** | iPadOS 或大屏触控布局；侧栏折叠、手势、点按目标；阅读优先 | 复用现有工作台布局语义；可能依赖 Tauri 多端或独立壳 |
| **Git 集成** | Vault 作为 Git 工作区：状态、diff、commit、分支感知；冲突提示 | 与 local-first 一致；**不**替代 catalog 权威；笔记/源文件仍以 Markdown 为准 |
| **云同步（可选）** | 多设备阅读/笔记同步；默认关；云端**非**默认事实来源 | 与 **F15 远程 Vault（SSH）** 正交：SSH=远端权威文件树；云同步=多端副本策略 |
| **多设备阅读** | 只读或轻量端打开已同步 Vault；批注/高亮策略待定 | 依赖 Git 或云同步其中一条路径落地 |

**原则**（见 §7.6）：与 local-first 冲突时以 PRD / Agents.md 为准——默认可选，不把私有云库当权威。

#### F18 · 作者 / 机构 / 会议关系图谱 · `area:graph` · P2

| 子范围 | 说明 | 与 **F6** 的边界 |
|---|---|---|
| **节点类型** | 作者、机构、会议/期刊；与 paper 节点并存 | F6 = paper↔paper 引用/被引邻域；F18 = 实体关系层 |
| **边类型** | 作者–论文、作者–机构、论文–会议；合著边 | 不替代 wikilink Graph（**F7**） |
| **布局** | Connected Papers 式 prior / derivative、相似度聚类 | 可复用 F6 邻域 UI 与布局引擎 |
| **数据来源** | catalog metadata + 可选外部 API；可重建，不手写图库 | 与 Graph「来自可重建索引」原则一致 |
| **跨库联合** | 多 Vault / 远程 catalog 联合图（远期） | 依赖 F15 远程与 catalog 契约稳定 |

**依赖**：优先落地 **F6**（文献引用邻域），再扩展 F18。

---

## 4. 看板列建议（Status）

| 列 | 放什么 |
|---|---|
| **Todo** | 未开工的 B*/F* |
| **In Progress** | 有人做 / 有 open PR（如 F15 + PR #6） |
| **Done** | 已合并且验收 |

可选列：**Blocked**、**Icebox**（P2 暂缓）。

---

## 5. 执行状态

| 步骤 | 状态 |
|---|---|
| 创建 Org Project「Agentero」 | ✅ https://github.com/orgs/poco-ai/projects/1 |
| Link 仓库 Agentero | ✅ |
| 本结构文档入库 | ✅ 本文 |
| 创建仓库 Labels | ✅ `type:*` / `area:*` / `priority:*` / `status:wip` |
| 批量创建 GitHub Issue（B1–B8, F1–F18） | ✅ **#7–#32**（26 条） |
| Issues + PR #6 加入 Project | ✅ **27 items**；F15 + PR #6 → **In Progress** |
| B2 / B4–B8 落地关闭 | ✅ 文档同步后 close #8、#10–#14；B1 #7 部分完成保持 open；#33 记录非 Codex 历史 |

---

## 6. 后续命令备忘（创建 Issue 时）

```bash
# Labels（示例）
gh label create "type:bug" --repo poco-ai/Agentero --color "d73a4a" --force
# …其余 label 同理

# Issue（示例，确认后再跑）
gh issue create --repo poco-ai/Agentero \
  --title "bug: 入库 / 本地 PDF / NOTES 初始化异常" \
  --label "type:bug,area:import,priority:p0" \
  --body "…"

# 加入 Project
gh project item-add 1 --owner poco-ai --url https://github.com/poco-ai/Agentero/issues/N
gh project item-add 1 --owner poco-ai --url https://github.com/poco-ai/Agentero/pull/6
```

---

## 7. 维护约定

1. **新功能**：先改 `todo.md` / roadmap，再在本目录补 F* 或开 Issue 并 item-add。  
2. **新 bug**：可先记 `bug.md`，再开 B* 或并入现有 bug issue。  
3. **完成**：关 Issue + Project 列 Done；`todo.md` 勾选与 Issue 关闭尽量同步。  
4. **远程 Vault**：以 F15 + PR #6 为入口，避免再拆碎片 issue。  
5. **F6 vs F18**：F6 = 论文引用/被引邻域；F18 = 作者/机构/会议与更深 Connected Papers 布局；实现时可先 F6 再 F18。  
6. **F17**：平台能力与 local-first 原则冲突时，以 PRD / Agents.md 为准（默认可选、非默认云权威）。
