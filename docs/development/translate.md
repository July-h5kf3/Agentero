# 翻译服务（Translate Service）

> 状态：**首版已落地**（免费 MT + BYOA Agent；无付费 API）。  
> 范围：应用级 **文本翻译服务层**（架构对齐 [zotero-pdf-translate](https://github.com/windingwind/zotero-pdf-translate)）→ **免费 MT** 与 **BYOA Agent** → **设置 → 翻译** → 消费方经 `runTranslate` / Agent 流式 prompt。  
> 实现入口：`src/lib/translate/`、Host `services/translate/` + `translate_text`、`src/components/settings/settings-window.tsx`（Translate 页）、PDF 划词菜单（[`pdf-ask.md`](pdf-ask.md)）。  
> 相关：[`../frontend/ui.md`](../frontend/ui.md) §4 设置、[`../backend/api.md`](../backend/api.md)、[`pdf-ask.md`](pdf-ask.md)、[`roadmap.md`](roadmap.md)、[`todo.md`](todo.md)。

## 1. 产品目标

为应用提供 **横切的翻译能力**：任意模块传入原文，按用户所选服务得到译文。不是「只服务 PDF 划词」的特化功能，而是 **可被多处调用的基础设施**。

| 目标 | 说明 |
|---|---|
| **应用级能力** | 统一 API：`runTranslate(task)`；PDF 划词、后续标题/摘要/批注/Notes 等均可调用，不各自接 API |
| **架构对齐 Zotero PDF Translate** | 每种后端是独立 `TranslateService`；UI / 缓存 / 错误处理共用；加服务 = 加 adapter，不改调用方 |
| **免费可用** | 零配置或最少配置即可翻译（默认服务不依赖用户 API Key） |
| **Agent 可用** | 复用本机 BYOA ACP；**不**在 Agentero 内填写模型 API Key |
| **设置可管** | 独立 **设置 → 翻译** 页：默认服务、目标语言、各服务状态与可选 endpoint |
| **Local-first** | 不把第三方账号当作 Vault 事实源；密钥仅存本机设置；可选结果缓存 |

### 1.1 消费方（Consumers）

翻译服务是 **provider 层**；具体入口是 **consumer**。

| 阶段 | 消费方 | 说明 |
|---|---|---|
| **首版接入** | PDF 划词菜单「翻译」 | 已有交互；改为走 `runTranslate`（见 [`pdf-ask.md`](pdf-ask.md)） |
| **后续可选** | 标题 / 摘要翻译、批注评论译写、Notes 选区、Agent 工具内译、Library 字段等 | 同一服务表与设置，不新开一套后端 |

首版交付以 **服务层 + 设置 + 至少一个消费方（PDF 划词）** 为验收；文档与命名始终以「翻译服务」为准，不以「划词」限定能力边界。

### 1.2 非目标（首版不做）

- 堆齐 Zotero 的 20+ 引擎（DeepL 官方 Key、百度/阿里/有道付费等 → 后续按需加 adapter）。
- 整篇 PDF 版式级双语（BabelDOC / 沉浸式翻译类）。
- 离线本地小模型（TranslateGemma 等）内嵌。
- 词典专用服务（单词释义 / 发音）；可后续以 `type: "word"` 扩展。
- 在 PDF 二进制内写入译文注解。
- 把文献元数据 **Translator Runtime**（魔棒入库）与文本翻译混成同一设置项（命名分离，见 §10）。

## 2. 参考：Zotero PDF Translate 架构

[zotero-pdf-translate](https://github.com/windingwind/zotero-pdf-translate) 的核心不是「某一个翻译 API」，而是 **可注册的服务表**：

```text
调用方（任意 UI / 工作流）
   │
   ▼
TranslateTask（原文、源/目标语言、result、error）
   │
   ▼
services/index 按 id 取 TranslateService
   │
   ▼
service.translate(data)  →  data.result
   │
   ▼
调用方负责展示（弹层 / 侧栏 / 写入字段 …）
```

服务对象字段（概念对齐其 `_template.ts`）：

| 字段 | 含义 |
|---|---|
| `id` | 稳定标识（如 `free`、`agent`） |
| `type` | `sentence`（句段）或 `word`（词典）；首版只做 `sentence` |
| `name` | 展示名（走 i18n） |
| `requireSecret` | 是否需要用户 secret |
| `defaultSecret` / `secretValidator` | 密钥格式校验（首版免费服务多为 false） |
| `config` | 可选额外设置（endpoint、model 等） |
| `requireExternalConfig` | 是否依赖本机外部程序（如 Agent CLI） |
| `translate(data)` | 执行翻译，成功写入 `data.result`，失败 throw |

Agentero **复用同一分层心智**，实现落在 TypeScript +（必要时）Rust Host，而不是直接 fork 插件代码。

## 3. Agentero 目标架构

### 3.1 分层

```text
消费方 A：PDF 划词「翻译」
消费方 B：…（后续）
        │
        ▼
src/lib/translate/run.ts          # 读设置 → 选 provider → 调 service
        │
        ├─ free                     # 免费 MT（HTTP，建议经 Host 转发）
        └─ agent                    # BYOA：translate prompt + agent_run_once
        │
        ▼
返回 TranslateTask.result（或流式回调）
        │
        ▼
各消费方自行展示 / 落盘
```

| 层 | 职责 | 是否新增 |
|---|---|---|
| **Service 注册表** | `id → TranslateService`；列表供设置页与运行时 | 是（`src/lib/translate/`） |
| **Settings** | 默认服务、目标语言、各服务 secret/config | 是（`AppSettings` 字段 + 设置页） |
| **Host 转发（免费 MT）** | `translate_text` command：出网、超时、限流；避免 WebView CORS / 暴露细节 | 建议首版即有 |
| **Agent 路径** | 已有 ACP Client + 翻译用 prompt | 抽到 service adapter |
| **消费方 UI** | 只调 `runTranslate`，不直连 HTTP/厂商 SDK | 改接线 / 新增入口 |

### 3.2 服务接口（TypeScript 契约）

```ts
/** 一次翻译任务的可变状态（对齐 Zotero data 对象） */
export type TranslateTask = {
  text: string;
  sourceLang: string; // "auto" | BCP-47 / 产品枚举
  targetLang: string;
  result?: string;
  error?: string;
  /**
   * 可选上下文：供 Agent 等需领域提示的服务使用。
   * 通用服务可忽略；PDF 消费方可传 page / paperId。
   */
  context?: {
    page?: number;
    paperId?: string;
    quote?: string;
    /** 调用场景标识，便于 prompt / 埋点，如 "pdf-selection" */
    surface?: string;
  };
};

export type TranslateServiceType = "sentence" | "word";

export type TranslateService = {
  id: string;
  type: TranslateServiceType;
  /** i18n key，如 settings:translate.service.free */
  nameKey: string;
  /** 是否需要用户填写 secret（首版 free=false，agent=false） */
  requireSecret: boolean;
  /** 是否依赖本机 Agent / 外部配置 */
  requireExternalConfig?: boolean;
  /** 可选：校验 secret 字符串 */
  secretValidator?: (secret: string) => { ok: boolean; hint?: string };
  /** 执行翻译：成功写 task.result；失败 throw 或写 task.error */
  translate: (task: TranslateTask, opts: TranslateRunOptions) => Promise<void>;
};

export type TranslateRunOptions = {
  settings: AppSettings;
  /** 覆盖设置中的默认 provider（某次调用强制某引擎 / agent） */
  providerId?: string;
  /** Agent 路径需要的 runOnce 等由调用方注入，避免 lib 循环依赖 */
  agent?: {
    runOnce: (prompt: string) => Promise<string>; // 或流式回调
  };
};
```

注册方式（对齐 Zotero `services/index.ts`）：

```ts
// src/lib/translate/services/index.ts
export const TRANSLATE_SERVICES: TranslateService[] = [
  BingTranslateService,
  AgentTranslateService,
];

export function getTranslateService(id: string): TranslateService | undefined {
  return TRANSLATE_SERVICES.find((s) => s.id === id);
}
```

**加新服务的步骤（与 Zotero 文档一致）**：

1. 新增 `src/lib/translate/services/<id>.ts`，实现 `TranslateService`。
2. 在 `services/index.ts` 注册。
3. 补 `en` / `zh-CN` 文案（`settings:translate.service.*`）。
4. 若需 secret/config，在设置页「服务详情」或通用 secret 字段中暴露。
5. 单测 mock HTTP / Agent。

**加新消费方的步骤**：

1. 组装 `TranslateTask`（原文 + 可选 `context.surface`）。
2. 调用 `runTranslate`（或带 `providerId` 覆盖）。
3. 用 `task.result` 更新本场景 UI / 持久化；**不要**在消费方内写死 HTTP 或 Agent prompt。

### 3.3 首版服务清单

| `id` | 类型 | Secret | 说明 |
|---|---|---|---|
| **`bing`** | sentence | 否 | **默认**。Edge 免费 token + Microsoft Translator |
| **`youdao`** | sentence | 否 | 有道网页接口 |
| **`huoshanweb`** | sentence | 否 | 火山 / 火山引擎 Web |
| **`tencenttransmart`** | sentence | 否 | 腾讯交互翻译 Web |
| **`googleapi`** | sentence | 否 | `translate.googleapis.com` gtx |
| **`google`** | sentence | 否 | `translate.google.com` gtx |
| **`libre`** | sentence | 否 | 需配置 LibreTranslate `freeBaseUrl` |
| **`agent`** | sentence | 否（BYOA） | 本机 Agent；prompt 见 `src/lib/translate/prompt.ts` |

以上免费引擎为**非官方网页接口**，可能限流或失效。

### 3.4 默认与回退

| 规则 | 行为 |
|---|---|
| 默认服务 | `translate.provider = "bing"`（开箱即用；较 Google gtx 在更多网络可用） |
| 调用覆盖 | `runTranslate(..., { providerId })` 可单次指定，不改全局默认 |
| Agent 不可用 | 若选用 `agent` 但未配置/未启用 Agent → 错误返回 / Toast，并提示设置 → 翻译或 Agent |
| 免费失败 | Toast；可选后续：「用 Agent 再试」（非首版必做） |
| 空文本 | 不发起请求 |

## 4. 免费引擎实现约束

### 4.1 原则

- 首版免费引擎对齐 Zotero PDF Translate 的网页接口（Google / Bing Edge / 有道 / 海词 / CNKI / DeepLX / 火山 Web / 腾讯交互翻译）；**零 API Key**，但**非官方**，可能限流或失效。
- 与魔棒的 **Translator Runtime**（`translatorBaseUrl`，文献元数据解析）**分离命名**。
- `freeBaseUrl`：LibreTranslate 必填；DeepLX 可覆盖 JSON-RPC / 自建地址。

### 4.2 Host 契约

```text
command: translate_text
args: {
  text: string,
  source_lang: string,   // "auto" | ...
  target_lang: string,
  provider: string,      // googleapi | bing | youdao | ...
  free_base_url?: string
}
returns: { text: string, provider: string } | error
```

- 超时、长度上限（约 ≤ 5k 字符；CNKI ≤800）、错误映射到前端 `notifyError`。
- Agent 路径**不**经此 command（继续走 `agent_run_once`）。

## 5. Agent 服务（`agent`）

### 5.1 行为

1. 读取设置：目标语言、**Agent 座**、**模型**（见 §5.4 / §7.6）。
2. 组装 prompt（`buildTranslatePrompt`；PDF 场景可附页码/引文，通用场景仅原文 + 目标语言）。
3. 调用既有 **`agent_run_once`**（传入解析后的 `agentId` / `modelId`）+ 流式事件；**`hideFromChatHistory: true`**。
4. 将结果写回 `task.result`；是否落盘由 **消费方** 决定。

### 5.2 与 BYOA 一致

- **禁止**在「翻译」设置页要求用户填写 OpenAI/Anthropic API Key。
- Agent 未安装 / 未启用：调用失败 Toast；设置页可选轻量状态文案（非常驻错误条）。
- 权限模式沿用全局 Agent 设置；翻译 prompt 已指定目标语言，**优先 `translate.targetLang`**，不被「回答语言」覆盖。

### 5.3 Prompt 要求

- 仅返回译文，无开场白。
- 保留科技术语与公式（学术场景）。
- 目标语言为人类可读名或稳定 locale（`Chinese` / `English` / 与 i18n 对齐）。

### 5.4 Agent 座与模型：解析规则（运行时）

翻译 **不绑定** 当前 Chat 会话的瞬时选中项，而读 **设置里的显式偏好**；未配置时再回落到全局默认，避免「Chat 里换了模型、划词翻译也跟着变」的意外。

| 设置值 | 运行时解析 |
|---|---|
| `agentId` 为空（默认） | 使用 Host 注册表 **`defaultId`**（与设置 → Agent 的「默认 Agent」一致） |
| `agentId` 有值但不可用 / 已删 | 回落 `defaultId`；若仍不可用 → Toast 错误 |
| `modelId` 为空（默认） | 使用该 Agent 的 **`loadModelPref(agentId)`**（Chat 里上次为该 Agent 选过的模型）；再无则让 Agent 自带 current |
| `modelId` 有值但不在目录中 | 仍传给 `runOnce`（Agent 侧可能拒绝）；失败 Toast |

```text
resolveTranslateAgent():
  id = settings.translate.agentId || registry.defaultId
  if !available(id) → error

resolveTranslateModel(id):
  mid = settings.translate.modelId || loadModelPref(id) || undefined
  return mid
```

与 Chat 的关系：

| 场景 | 行为 |
|---|---|
| 用户从未改过翻译 Agent 设置 | 与「默认 Agent + 该 Agent 在 Chat 的模型偏好」一致，**零配置** |
| 用户为翻译指定 Claude + 某模型 | 划词翻译固定用该组合，**不受** Chat 当前选中 Agent 影响 |
| 用户在 Chat 换模型 | 仅当翻译 `modelId` 为空时，通过 `loadModelPref` 间接跟上；若翻译页钉死了 `modelId` 则不变 |

## 6. 首版消费方：PDF 划词

当前（已落地）：菜单「翻译」→ 建 ask 线程 → `buildPdfTranslatePrompt` → Agent 流式 → AskPopover。

目标：改为应用翻译服务的 **一个** 消费方：

```text
菜单「翻译」
   → runTranslate({ text, context: { page, surface: "pdf-selection" }, ... })
   → 按 settings.translate.provider 分发
        free  → 短请求 → 消费方轻量结果 UI
        agent → 流式 Popover（可多轮追问：可选）
```

| 决策 | 建议 |
|---|---|
| free 结果是否落盘 asks | 由消费方决定；首版 **可选不落盘** 或 `kind: "translate"` |
| agent 结果 | 可继续 asks JSON；字段可增加 `provider` |
| 选区自动翻译 | 消费方可选设置 `translate.autoTranslateSelection`（默认 **关**）；属 PDF UX，非服务层必选 |

划词交互细节以 [`pdf-ask.md`](pdf-ask.md) 为准；**服务契约与设置以本文为准**。

## 7. 设置 → 翻译页面

### 7.1 信息架构

设置窗左侧导航 **Translate（翻译）**，与 General · Appearance · Agent · Keyboard · Privacy · About 并列。

实现：`settings-window.tsx`；持久化 `src/lib/settings.ts`。

### 7.2 设计原则：最小选择

| 原则 | 做法 |
|---|---|
| **默认即能用** | Agent 座 / 模型默认「跟随全局」；用户不必配置也能用默认 Agent 翻译 |
| **渐进披露** | 仅当「默认服务 = Agent」时显示 Agent 座 / 模型两行；免费引擎时不出现 |
| **最多两下选择** | 换座：1 次下拉；换模型：再 1 次下拉。不引入第二套 ModelSelector 复杂 UI |
| **复用已有数据** | Agent 列表 = 注册表已就绪项；模型列表 = `loadModelCatalog(agentId)`（Chat / warm 已缓存） |
| **不重复 Agent 页** | 不在此页 Probe / 安装 / 填 API Key；缺 Agent 时一行短提示指向 **设置 → Agent** |
| **不钉死 Chat 会话** | 翻译偏好独立存储；见 §5.4 |

### 7.3 页面布局（线框）

```text
┌ Settings › Translate ─────────────────────────────┐
│                                                   │
│  默认服务     [ ✓ Bing (Edge free)            ▾ ] │  ← 打开下拉：并行 probe 免费引擎；可用显示 ✓
│  目标语言     [ 跟随界面语言                   ▾ ] │
│  划词自动译   [ 关 ]                              │
│                                                   │
│  ── 仅当 默认服务 = Agent 时显示 ──               │
│  Agent        [ 跟随默认 (Codex)              ▾ ] │  ← 见 §7.6
│  模型         [ 跟随 Agent 默认               ▾ ] │  ← 见 §7.6
│                                                   │
│  ── 仅 libre / deeplx 等需要时 ──                 │
│  自定义端点   [ https://…                       ] │
│                                                   │
│  footer: 免费引擎为非官方接口… Agent 经本机 CLI…  │
└───────────────────────────────────────────────────┘
```

**不采用**（刻意砍掉）：

- 服务对比表 / 多引擎并行**试译**（质量对比）；仅做可用性 probe 图标
- 翻译页内完整 ModelSelector（搜索、收藏星标、分组）— Chat 已有，此处只用 **短 Select**
- 翻译专用「权限 / 温度 / system prompt」高级项
- 在翻译页维护第二套 API Key

### 7.4 分组 A：通用（已有）

| 控件 | 设置键 | 默认 | 说明 |
|---|---|---|---|
| 默认翻译服务 | `translate.provider` | `bing` | 全引擎 Select（含 `agent`） |
| 目标语言 | `translate.targetLang` | `ui` | 跟随界面 / en / zh-CN |
| PDF 划词后自动翻译 | `translate.autoTranslateSelection` | `false` | 仅 PDF 消费方 |

**默认服务下拉 · 并行可用性 probe**：

- 触发：用户 **打开**「默认服务」Select（`onOpenChange(true)`）。
- 范围：`FREE_MT_PROVIDER_IDS` 全部免费引擎；**不** probe `agent`。
- 实现：`probeFreeMtProviders`（`src/lib/translate/probe.ts`）对每引擎 `translate_text` 短样例（`Hi` en→zh-CN），`timeoutMs=5000`，`Promise.all` 并行；结果经 `onResult` 渐进更新。
- Libre：未配置 `freeBaseUrl` 时直接记为不可用，不发请求。
- UI（免费引擎均显示状态图标；Agent 无图标）：未探测灰色 `Circle`；探测中 `Loader2`；可用绿色 `CheckCircle2`；失败红色 `XCircle`。
- 并发：同一时刻只跑一轮 probe（`probingRef`）；卸载 abort。

### 7.5 分组 B：端点（条件显示）

| 控件 | 设置键 | 何时显示 |
|---|---|---|
| 自定义端点 | `translate.freeBaseUrl` | `provider` 为 `libre` / `deeplx`，或已有非空 URL |

### 7.6 分组 C：Agent 座与模型（核心）

**仅当** `translate.provider === "agent"` 时渲染该分组（同一卡片内紧挨通用区，或独立卡片，二选一保持视觉简洁即可）。

#### 行 1：Agent

| 项 | 说明 |
|---|---|
| 标签 | `Agent`（i18n `settings:translate.agentId.label`） |
| 控件 | 单个 **Select** |
| 选项 0（默认） | **跟随默认** — 展示文案：`跟随默认` + 若已知则括号显示当前 default 名，如 `跟随默认 (Codex)` |
| 选项 1…n | 本机 **可用** Agent：`listAgents` / `scanCatalog` 中 `available` 或 catalog `acpStatus === "ready"` 且已 `registeredId` |
| 不可用项 | **不进列表**（避免选了跑不了）；若当前保存的 `agentId` 已失效，Select 回显「跟随默认」并在 blur/打开时静默清空非法 id |
| 空列表 | 不显示空 Select；改为一行 muted 文案：`尚未配置可用 Agent` + 文字链/按钮「打开 Agent 设置」（`onSectionChange("agent")`） |

**仅一台可用 Agent 时**：仍显示「跟随默认 (Name)」一项即可，或显示固定只读行 `使用 {Name}`（无下拉）— 推荐 **仍用同一 Select 只有 1～2 项**，避免特殊分支。

#### 行 2：模型

| 项 | 说明 |
|---|---|
| 标签 | `模型` |
| 控件 | 单个 **Select** |
| 选项 0（默认） | **跟随 Agent 默认** — 运行时 = `loadModelPref(resolvedAgentId)` 或 Agent 上报的 current |
| 选项 1…n | `loadModelCatalog(resolvedAgentId)?.models` 的 `name` / `id` |
| 无缓存目录 | 只保留「跟随 Agent 默认」一项；footer 一句：`在 Chat 中打开该 Agent 一次后可在此选择具体模型`（非错误条） |
| 切换 Agent 时 | 若新 Agent 的 catalog 不含当前 `modelId`，**自动把 modelId 清空为「跟随」**（避免脏引用） |

**解析用的 `resolvedAgentId`**：设置里选的 id，或「跟随默认」时的 `defaultId`（用于拉 catalog / 显示模型列表）。

#### 打开本页时的数据加载（异步、不阻塞）

```text
打开 Translate 页
  → scanCatalog / listAgents（轻量，与 Agent 页同源）
  → 若 provider=agent 且 resolvedAgentId 有值：
       · 读 loadModelCatalog(id) 填模型 Select
       · 可选：后台 agent_warm({ agentId }) 刷新目录（失败忽略，不 Toast）
```

不在翻译页做全量 Probe 按钮；需要安装/探测仍去 **Agent** 页。

#### 交互状态机（极简）

```text
provider ≠ agent
  → 隐藏 Agent / 模型两行

provider = agent
  → 显示 Agent 行
  → 模型行始终显示（至少「跟随 Agent 默认」）
  → 换 Agent → 清空 modelId（回到跟随）→ 重载该 Agent 的 catalog
  → 选具体 modelId → 写入 settings
```

### 7.7 设置类型

```ts
export type TranslateSettings = {
  provider: TranslateProviderId; // googleapi | bing | … | agent
  targetLang: TranslateTargetLang;
  sourceLang: "auto";
  freeBaseUrl: string;
  autoTranslateSelection: boolean;
  /**
   * Agent 座。空字符串 = 跟随注册表 defaultId。
   * 仅 provider==="agent" 时生效。
   */
  agentId: string;
  /**
   * 模型 id（ACP model config value）。空字符串 = 跟随该 Agent 的 model pref / current。
   * 仅 provider==="agent" 时生效。
   */
  modelId: string;
};
```

默认：

```ts
agentId: ""
modelId: ""
```

### 7.8 运行时接线（PDF / runTranslate）

```ts
// 伪代码
if (provider === "agent") {
  const agentId = settings.translate.agentId || registry.defaultId;
  const modelId =
    settings.translate.modelId || loadModelPref(agentId) || undefined;
  await runOnce({
    agentId,
    modelId,
    prompt: buildTranslatePrompt(...),
    hideFromChatHistory: true,
    autoApprove: true, // 与现 PDF 划词一致，可再议
  });
}
```

非流式 `AgentTranslateService.translate` 的 `opts.agent.runOnce` 应由调用方闭包注入已解析的 agentId/modelId。

### 7.9 i18n 词条（建议）

| key | en（示意） |
|---|---|
| `translate.agentId.label` | Agent |
| `translate.agentId.followDefault` | Follow default |
| `translate.agentId.followDefaultNamed` | Follow default ({{name}}) |
| `translate.agentId.empty` | No available agents |
| `translate.agentId.openAgentSettings` | Open Agent settings |
| `translate.modelId.label` | Model |
| `translate.modelId.followAgent` | Follow agent default |
| `translate.modelId.needWarm` | Open this agent in Chat once to list models |
| `translate.footer` | （已有，可补一句 Agent 跟随规则） |

### 7.10 UI 规范对齐

- 左标签、右 Select；与 General / Agent 页同一 `SettingsRow` 密度。
- 无常驻大段说明；空态 / 需 warm 用一行 muted。
- 失败：`notifyError`。
- 不在侧栏挂翻译入口。

## 8. 模块与文件规划

```text
src/lib/translate/
  types.ts              # TranslateTask, TranslateService, ...
  run.ts                # runTranslate(task, opts)  — 应用统一入口
  prompt.ts             # Agent 译 prompt（通用 + 可选 surface 变体）
  probe.ts              # 设置页：并行 probe 免费引擎可用性
  services/
    index.ts            # 注册表
    free.ts
    agent.ts
  defaults.ts           # DEFAULT_FREE_BASE_URL 等

src-tauri/src/
  commands/translate.rs # translate_text（free）
  services/translate/   # HTTP 客户端、错误映射

src/components/settings/settings-window.tsx  # Translate 导航页
src/lib/settings.ts                 # translate 字段
src/i18n/locales/{en,zh-CN}/settings.json

# 消费方（示例，不独占服务层）
src/components/viewer/pdf-viewer.tsx / pdf-ask/  → 调用 runTranslate
```

测试：

- `test/translate-*.test.ts`：注册表、targetLang 解析、prompt 快照。
- Host：`translate_text` 长度限制与错误映射单测（mock HTTP）。

## 9. 实现里程碑

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **T0 文档** | 本文 + 交叉引用 | 设计可评审 |
| **T1 服务层 + Agent adapter** | `TranslateService` 注册表；`agent`；设置页骨架（`provider` / `targetLang`）；PDF 划词改调 `runTranslate` | 设为 agent 时与今日行为一致；可切换目标语言 |
| **T2 免费服务** | Host `translate_text` + 多引擎 free-MT；默认 provider=`bing` | 无 Agent 也能完成翻译；失败 Toast |
| **T3 体验** | 消费方结果 UI 细化；自动译等场景选项；可选 `provider` 落盘字段 | 设置项生效；Agent 路径不进主对话历史 |
| **T4+** | 更多服务 adapter；更多消费方（标题/摘要等） | 只加 adapter / 新入口，不改核心契约 |

## 10. 与现有概念的命名区分

| 名称 | 用途 | 设置位置 |
|---|---|---|
| **Translator Runtime**（`translatorBaseUrl`） | 魔棒 / 标识符 → **论文元数据**（非文本翻译） | General |
| **Translate Service**（本文） | **任意文本 → 译文**（应用能力） | **Translate** |
| **Agent 回答语言**（`aiResponseLanguage`） | 通用 Agent 输出语言 | Agent |
| **Translate 目标语言**（`translate.targetLang`） | 翻译服务默认目标语言 | Translate（优先于回答语言） |

## 11. 安全与隐私

- 免费 MT：原文离开本机；设置页 footer 与隐私说明各一句即可。
- Agent：原文进本机 Agent CLI，是否再出网由用户所选 Agent 决定（BYOA）。
- Secret（未来）：仅存 `localStorage` / 后续 Tauri Store，不进 Vault、不上云、不进 git。
- 是否写入 `NOTES.md` / 批注由 **消费方** 决定；服务层默认只返回字符串。

## 12. 文档与代码同步清单

实现时须同步：

- [x] 本文状态行改为「首版已落地」
- [x] [`pdf-ask.md`](pdf-ask.md) 翻译入口改为服务层
- [x] [`../frontend/ui.md`](../frontend/ui.md) §4 分类含 Translate
- [x] [`../backend/api.md`](../backend/api.md) 增加 `translate_text`
- [x] [`todo.md`](todo.md) / [`roadmap.md`](roadmap.md) 勾选 T1–T3
- [x] `AGENTS.md` 应用能力简述（翻译服务）

## 13. 参考链接

- [zotero-pdf-translate](https://github.com/windingwind/zotero-pdf-translate) — 服务表、设置 Service 页、可插拔引擎
- [LibreTranslate](https://github.com/LibreTranslate/LibreTranslate) — 自托管 MT 参考
- 本仓库：[`pdf-ask.md`](pdf-ask.md)（首个消费方）、`src/lib/pdf-ask/prompt.ts`（现有 Agent 译 prompt，待迁入 `lib/translate`）
