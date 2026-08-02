# 导入 NOTES 摘要翻译：回退链与超时

**状态**：已优化（回退链改 bing → 火山 → 腾讯；单引擎超时 15s → 5s）  
**影响面**：魔棒 / CLI `import id` 写 `NOTES.md` 摘要中译；Connector 后台摘要翻译  
**相关代码**：

- `src-tauri/src/features/translate/mod.rs` — `ZH_FALLBACK_CHAIN`、`FREE_MT_ZH_TIMEOUT_MS`、`free_mt_to_zh`
- `src-tauri/src/features/import/mod.rs` — `abstract_for_notes` / `write_paper_shell_opts`
- `src-tauri/src/features/import/paper_import/mod.rs` — `translate_abstract: true`
- 文档：[`../backend/translate.md`](../backend/translate.md)、[`../backend/identifier-lookup.md`](../backend/identifier-lookup.md)

---

## 1. 问题现象

1. **导入一篇 arXiv 论文体感偏慢**（端到端常 17–35s），除 PDF / TeX 下载外，**写 `NOTES.md` 之前**还要等一段「空档」。
2. 怀疑瓶颈在 **摘要免费 MT** 或 **Translator 元数据**，但原先缺少分步耗时数据。
3. 摘要翻译**看起来像在用谷歌**（代码链首为 `googleapi`），与 Settings → 翻译默认 **bing** 不一致；用户无法在 UI 改导入路径的引擎。

---

## 2. 调查过程

### 2.1 Translator 服务可用性（文献元数据，非 MT）

与 PDF 划词 / 摘要中译无关。默认 Base：`https://translator.philfan.cn`（`DEFAULT_TRANSLATOR_BASE_URL`）。

工具：`node test/scripts/probe-translator.mjs`（`pnpm probe:translator` 在部分环境因 pnpm 版本问题不可用，可直接 node）。

| 检查 | 结果 | 耗时量级 |
|---|---|---|
| DNS | ✅ Cloudflare | ~7ms |
| `POST /search` arXiv | ✅ | ~2s |
| `POST /search` DOI | ✅ | ~2.7s |
| `POST /web` arXiv URL | ✅ | ~1.8s |
| `POST /import` / `export` | ✅ | ~0.4s |

**结论**：公网 Translator 当时可用；Critical（search + web）PASS。

### 2.2 单篇导入端到端：`2607.21804`

CLI：`agentero --json -v <temp-vault> import id 2607.21804`  
论文：*Adversarial Prompts for Acceptance Collapse in Speculative Decoding*  
结果：`usedTranslator=true`，PDF ✅，TeX ✅，无 `PAPER.md`（有 TeX 跳过 liteparse）；`NOTES.md` 摘要为中文。

**Host 串行流水线**（`import_by_identifier` → `paper_commit`）：

```text
resolve_metadata (Translator /web)
  → paper_commit
       → write_paper_shell（含 abstract free_mt_to_zh）
       → catalog upsert
       → ensure_paper_assets：PDF → TeX e-print
       → liteparse（仅 !tex && pdf）
```

**多次 wall clock**（临时 Vault，网络有抖动）：

| 轮次 | 总耗时 | 备注 |
|---|---:|---|
| 1 | ~28s | 与其它 probe 并行，网络抢占 |
| 2 | ~34s | 串行干净环境 |
| 3 | **~17s** | 带文件 mtime 时间线（主参考） |

**第 3 次按 mtime 还原的阶段耗时**（相对进程启动）：

| 阶段 | 耗时 | 占比 | 说明 |
|---|---:|---:|---|
| ① Translator + 摘要 MT + shell/catalog → `NOTES.md` | **~10.6s** | **~62%** | 主瓶颈区 |
| ② PDF 下载 → `2607.21804.pdf`（~0.93MB） | **~3.3s** | ~19% | `arxiv.org/pdf/…` |
| ③ TeX e-print + 解压 → `source/` | **~3.3s** | ~19% | `arxiv.org/e-print/…` gzip ~659KB |
| ④ 收尾（liteparse 跳过） | ~0s | — | `skip: local TeX present` |
| **合计** | **~17.2s** | 100% | |

同机另测**隔离网络步骤**（非同一次进程，仅对照）：

| 步骤 | 耗时 | 状态 |
|---|---:|---|
| Translator `POST /web` | ~3.4s | ✅ 1051 字摘要 |
| MT `googleapi`（旧链首位） | ~10.5s | ❌ `fetch failed` |
| PDF | ~1.7s | ✅ |
| TeX e-print | ~1.1s | ✅ |

要点：旧链上 **googleapi 失败仍可能空等近 15s**，直接拉长阶段 ①。

### 2.3 导入摘要为什么是「谷歌」？

| 路径 | 引擎来源 |
|---|---|
| **导入 `NOTES` 摘要** | Host 硬编码 `ZH_FALLBACK_CHAIN` + `free_mt_to_zh`，**不读** Settings |
| **PDF 划词翻译** | Settings → 翻译，默认 `provider: "bing"` |

旧回退链：

```text
googleapi → bing → youdao → huoshanweb → tencenttransmart
```

每个引擎 `timeout_ms: Some(15_000)`。  
`googleapi` 在本环境常失败；链会串行试后续引擎，**失败等待累加**。

Settings 默认 bing 的注释明确写了：比 Google gtx 在更多网络下可用——但**导入路径未复用该默认**。

### 2.4 摘要 MT 专项 bench（改链后）

端点与 Host 一致（Edge Bing auth + translate、火山 crx、腾讯 Transmart）。  
链：`bing → huoshanweb → tencenttransmart`。  
样本：5 篇 arXiv 摘要（≈0.9–1.8k 字符）。

| 论文 | 字数 | bing | 火山 | 腾讯 | 整链（先成功即停） |
|---|---:|---:|---:|---:|---:|
| 2607.21804 | 1051 | 1.3s | 0.9s | 0.9s | **0.4s** (bing) |
| 1706.03762 | 1136 | 0.6s | 0.5s | 0.9s | **0.5s** (bing) |
| 2303.08774 | 876 | 0.5s | 0.5s | 0.5s | **0.4s** (bing) |
| 1412.6980 | 1109 | 0.6s | 0.5s | 0.6s | **0.4s** (bing) |
| 2005.14165 | 1789 | 0.6s | 0.5s | 1.1s | **0.4s** (bing) |

**引擎汇总**：

| 引擎 | 成功率 | p50 | max |
|---|---|---|---|
| bing | 5/5 | ~0.6s | **1.3s** |
| huoshanweb | 5/5 | ~0.5s | 0.9s |
| tencenttransmart | 5/5 | ~0.9s | 1.1s |
| **整链** | **5/5**（均 bing 命中） | **~0.4s** | **~0.5s** |

**超时选取**：

- 成功路径 max ≈ **1.3s**；正常整链 **&lt;0.5s**。
- 旧 **15s/引擎** 过宽；三引擎全挂最坏 **45s**，显著拖慢导入。
- 取 **5s/引擎**（约 4× 实测最慢成功）：
  - 慢网 / 稍长摘要仍有余量；
  - 死引擎少等约 10s；
  - 整链最坏 **15s**（3×5s）。

---

## 3. 根因归纳

1. **导入体感慢** = Translator 网络 + **串行摘要 MT** + PDF/TeX 下载；其中 ① 在慢链/失败链时占比可超一半。
2. **摘要 MT 与设置页解耦**，硬编码旧链首位 `googleapi`，在不可达环境制造 **~10–15s 无效等待**。
3. **单引擎 15s 超时**相对实测成功（0.4–1.3s）过大，放大回退成本。

---

## 4. 修复 / 优化

| 项 | 旧值 | 新值 |
|---|---|---|
| `ZH_FALLBACK_CHAIN` | googleapi → bing → youdao → 火山 → 腾讯 | **bing → huoshanweb → tencenttransmart** |
| 导入摘要单引擎超时 | 15s | **5s**（`FREE_MT_ZH_TIMEOUT_MS`） |
| 整链最坏 | 45s | **15s** |

未改：

- `translate_text` 通用默认仍 30s（PDF 划词等）；
- 设置页探测仍 5s/引擎；
- Settings 默认 provider 仍为 bing（与导入链首位一致，但导入仍不读设置）。

单测：`features::translate::tests::free_providers_listed` 断言链顺序与超时落在 3–8s 合理区间。

---

## 5. 复现与对照命令

```bash
# Translator 可用性
node test/scripts/probe-translator.mjs

# 端到端导入计时（需已 build CLI）
VAULT=$(mktemp -d /tmp/agentero-import-XXXXXX)
cargo run -p agentero-cli -- vault create "$VAULT" -q
/usr/bin/time -p ./target/debug/agentero --json -v "$VAULT" import id 2607.21804
```

摘要 MT 可用与 Host 同 URL 的脚本自测三引擎；或依赖导入后 `NOTES.md` 是否为中文 + 导入总时长对照。

---

## 6. 后续可选

- 摘要 MT 与 PDF/TeX 下载 **并行**（现在写 shell 在下载前串行完成）。
- 导入摘要是否 **跟随 Settings provider**（或提供开关关闭摘要中译）。
- 在 `import_by_identifier` 打分步 `duration_ms` 日志，避免再靠 mtime 反推。

---

## 7. 时间线（调查日 2026-08-02）

1. 探测 Translator 公网可用性 → 正常。  
2. 导入 `2607.21804` 分阶段计时 → ① 元数据+摘要 MT 为主瓶颈。  
3. 确认导入摘要用硬编码链、首位 googleapi、15s 超时。  
4. 改链为 bing → 火山 → 腾讯。  
5. 五篇摘要 bench → 成功 0.4–1.3s；超时定为 **5s**。  
6. 文档与本复盘落盘。
