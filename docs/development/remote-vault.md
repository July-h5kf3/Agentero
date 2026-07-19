# 远程 Vault（SSH / SFTP）与远端 BYOA

> **状态**：**MVP 已落地**（M0–M3）；M4 加固中（远端 trash ✅、入库写远端 ✅、blob LRU ✅、Connector 远程 ✅；Codex-SSH 待办）  
> **分支**：`docs/remote-vault-ssh`  
> **相关**：[`data-model.md`](../backend/data-model.md)、[`catalog.md`](../backend/catalog.md)、[`api.md`](../backend/api.md)、Agent 运行时 `src-tauri/src/services/agent/`  
> **代码**：`src-tauri/src/services/fs/`、`services/remote/`、`commands/remote.rs`；前端 `src/lib/remote-vault.ts`、`vault.ts` 远程 IO

本文定义：如何通过 SSH 打开**服务器上的** Agentero Vault，并在**同一台远端机器**上运行 BYOA Agent（ACP），使文件权威与 Agent 工作目录始终同机。

---

## 1. 目标与非目标

### 1.1 目标（MVP）

| # | 目标 | 说明 |
|---|---|---|
| G1 | **文件权威全在远端** | `papers/`、`NOTES.md`、PDF、`.agentero/catalog.sqlite` 等均以远端磁盘为唯一事实来源 |
| G2 | **SFTP 服务 UI 文件 IO** | 文件树、读写 Markdown、PDF 预览、目录操作经 SFTP（经 SSH 会话） |
| G3 | **BYOA 跑在远端** | Codex / Claude-ACP / OpenCode 等进程在服务器上启动；`cwd` = 远端 Vault 根 |
| G4 | **本机不持有第二套库** | 允许 ephemeral 工作副本与 PDF blob 缓存；断开后不得变成可独立打开的「本地 Vault」 |
| G5 | **复用现有产品契约** | Vault 相对路径、catalog 语义、ACP 事件、权限三档、notes-review 尽量同构 |

### 1.2 非目标（MVP 不做）

- 劫持 / 嵌入 **VS Code Server** / code-server 协议
- 本机 spawn Agent 再去「同步」远端文件（双权威）
- 多人同时写同一远端 Vault 的自动合并
- 离线编辑队列（会变成第二权威）
- 系统级挂载（sshfs / FUSE）作为唯一路径
- 在 Agentero 内填写模型 API Key（仍 BYOA：Key 在**服务器**上配置）
- Finder 显示 / 系统终端打开远端路径（无本机 path 语义）

### 1.3 产品表述（期望管理）

> **Open Remote Vault**：经 SSH 连接服务器上的目录。笔记与 catalog 保存在服务器；本机仅缓存预览与会话工作文件。Agent 在服务器上运行并直接读写该目录。同一远端库请勿多客户端并发写入。

---

## 2. SSH 与 SFTP（实现前必读）

| | **SSH** | **SFTP** |
|---|---|---|
| 角色 | 加密会话、认证、多路 channel | SSH 之上的**文件子系统** |
| 用途（本特性） | 远程执行 Agent、stdio 转发 ACP | 列目录、读写、rename、stat |
| 类比 | 高速公路 | 公路上的货运通道 |

```text
TCP
 └─ SSH 会话（认证 · 加密 · 多 channel）
      ├─ session / exec  → 远端 agent 进程（ACP over stdio）
      ├─ subsystem sftp  → Vault 文件 API
      └─ （可选）端口转发
```

- **不是二选一**：MVP **同时**需要 SFTP（UI 文件）与 SSH exec（远端 BYOA）。
- 优先**复用同一 TCP / ControlMaster**，避免文件一条连接、Agent 再登一次。

---

## 3. 架构总览

```text
┌─────────────────────── 本机 Agentero ───────────────────────┐
│  React：文件树 / 编辑器 / Library / PDF / Agent 面板          │
│  路径语义：vault-relative（papers/…/NOTES.md）               │
│         │ invoke / events                                   │
│  Tauri Host                                                 │
│    ├── RemoteSession（SSH 连接 · 状态机）                     │
│    ├── SftpFs : VaultFs     ──SFTP──► 远端文件               │
│    ├── CatalogWorkMirror    ──GET/PUT► catalog.sqlite        │
│    └── AcpBridge(SshStdio)  ──exec───► 远端 agent stdio      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────── 远端服务器 ──────────────────────────┐
│  /data/my-vault/          ← 唯一权威 Vault                   │
│  codex / claude-agent-acp / opencode …  ← 用户预装 BYOA      │
│  cwd = vault root；Agent 眼中 = 普通本地目录                  │
└─────────────────────────────────────────────────────────────┘
```

**同构原则**：今日「本机 Host ↔ 本机 Agent ↔ 本机盘」整体平移为「本机 Host ↔ SSH ↔ 远端 Agent ↔ 远端盘」。UI 通过 SFTP 看同一棵树。

### 3.1 本机 ephemeral 布局（可丢）

```text
~/.cache/agentero/remote/<session-hash>/
├── work/
│   └── .agentero/catalog.sqlite   # 仅会话内 rusqlite 工作副本
└── blobs/                         # PDF 等 LRU 预览缓存
```

- **权威写成功** = SFTP PUT / 远端 Agent 写盘成功。
- Disconnect / 关闭远程 Vault：flush dirty catalog → 删除 `work/`；blob 可 LRU，但**不得**进入「最近本地 Vault」列表。

---

## 4. 核心抽象

### 4.1 `VaultFs` + `FsCaps`

业务代码禁止继续散落 `std::fs` 直连（渐进迁移）。统一：

```rust
// 概念接口（实现时落在 src-tauri/src/services/fs/ 或 remote/）
trait VaultFs: Send + Sync {
    async fn list(&self, rel: &str) -> Result<Vec<DirEntry>>;
    async fn stat(&self, rel: &str) -> Result<FileStat>;
    async fn read(&self, rel: &str) -> Result<Vec<u8>>;
    async fn read_range(&self, rel: &str, off: u64, len: u64) -> Result<Vec<u8>>;
    async fn write(&self, rel: &str, data: &[u8], opts: WriteOpts) -> Result<()>;
    async fn mkdir(&self, rel: &str) -> Result<()>;
    async fn rename(&self, from: &str, to: &str) -> Result<()>;
    async fn remove(&self, rel: &str, recursive: bool) -> Result<()>;
    fn caps(&self) -> FsCaps;
}

struct FsCaps {
    atomic_rename: bool,
    reliable_watch: bool,   // 远端 false
    sqlite_native: bool,    // 远端 false：须 work mirror
    cheap_random_read: bool,
    agent_cwd_local: bool,  // 远端 false：Agent 在 SSH 对端
    finder_reveal: bool,    // 远端 false
}
```

| 实现 | 用途 |
|---|---|
| `LocalFs` | 现网本地 Vault |
| `SftpFs` | 远程文件权威路径 |
| （可选后续）`CachedSftpFs` | 读缓存 + write-through，仍以远端为准 |

### 4.2 `VaultSession`

```text
VaultSession
├── kind: Local | Remote
├── display_root: 展示用（本地绝对路径 或 user@host:remotePath）
├── fs: Arc<dyn VaultFs>
├── catalog: CatalogHandle   # Local 直接 open；Remote = work mirror + push
└── agent_transport: LocalStdio | SshStdio
```

前端相对路径不变；`vaultPath` 对远程可为逻辑 handle（如 `remote:<sessionId>`），Host 解析。

### 4.3 Catalog：远端权威 + 会话内 work 副本

`rusqlite` **不能**直接 open SFTP 路径。MVP：

```text
open remote vault:
  SFTP GET .agentero/catalog.sqlite → work/…
  记录远端 FileMeta（mtime + size）
  rusqlite open 工作副本

mutation（tags / rescan / is_read…）:
  写本地 work 事务
  立刻 SFTP PUT（建议 catalog.sqlite.tmp + rename）
  更新 FileMeta；失败则整次操作失败 + toast

写前乐观锁:
  stat 远端；与打开/上次 push 的 meta 不一致 → Conflict，提示重新打开
```

- **禁止**远端 Agent 直接改 `catalog.sqlite`（AGENTS.md / skill / 权限约定）；`is_read` 等由 Host 在 Agent 成功后编排再 PUT。
- MVP **单写者假设**：同一远端库同时只应有一个 Agentero 写入。

### 4.4 普通文件与 PDF

| 类型 | 读 | 写 |
|---|---|---|
| Markdown / 小文件 | SFTP → 编辑器；保存 write-through | 写前 `stat` 冲突检测（对齐 diskConflict） |
| PDF / 大文件 | GET → `blobs/` → `blob:` 预览 | 入库等直接 SFTP 写远端 paper 目录 |
| 删除 | — | 远端 `.agentero/.trash/`（与本地语义对齐；`path_trash` 经 `trash_bridge`） |

### 4.5 Watch

远端无可靠 inotify。MVP：

- **不做**完整 `vault:file-changed` 等价物
- Agent 会话结束 / 用户保存后：对**已打开**文件 SFTP `stat` + 按需 re-read
- 文件树：手动刷新或展开时 readdir

---

## 5. 远端 BYOA（ACP over SSH）

### 5.1 与现网差异

| | 本地（现网） | 远程 MVP |
|---|---|---|
| 进程 | `Command::new(local_bin)` | SSH `exec` 远端 bin |
| cwd | 本机 vault 绝对路径 | **远端** vault 绝对路径 |
| Transport | 本机 stdio pipe | SSH channel stdin/stdout 泵到 ACP Client |
| 发现 | 扫本机 PATH | 远端 `command -v` / 配置绝对路径 |
| 密钥 | 本机环境 / login | **远端**环境 / `codex login` 等 |
| 文件 | Agent 本机 fs | Agent **远端本机** fs（与 SFTP 同一树） |

### 5.2 启动示意

```bash
# Host 经 SSH session channel 执行（非交互优先；视 agent 是否需要 PTY）
cd /data/my-vault && exec claude-agent-acp
# 或
cd /data/my-vault && exec opencode acp
```

本机 `AcpBridge`：

1. 建立 / 复用 `RemoteSession` 的 SSH  
2. `exec` 上述命令  
3. channel stdout → 现有 ACP 解析 / 事件 `emit`  
4. ACP 写入 → channel stdin  
5. 退出码 / 断开 → `agent:completed` / `agent:failed`  

**协议与 UI 复用**：`agent:stream`、`agent:permission-request`、`agent:notes-review`、权限三档、paper-reader skill 触发语法不变；路径展示尽量 strip 为 vault-relative。

### 5.3 Provider 配置扩展（草案）

```ts
// 概念：在现有 AgentDescriptor / 设置模型上扩展
type RemoteAgentLaunch = {
  /** 绑定当前 RemoteVaultSession，不另建无 vault 的 SSH */
  useVaultSession: true;
  /** 远端可执行文件，PATH 或绝对路径 */
  remoteCommand: string;
  remoteArgs: string[];
  /** 可选：需要 login shell 以加载 nvm 等 */
  loginShell?: boolean;
};
```

远程 Vault 打开时：Agent 面板只列出 **远端可发现** 或用户配置的 remote launch；不混用本机 bin（避免 cwd 错位）。

### 5.4 精读 / Zap

- 资源检查：SFTP `stat` 远端 PDF / TeX / `PAPER.md`
- 运行：远端 agent + 现有 skill 注入（`$id` / `/id` 等按 provider）
- 成功：SFTP 确认 `NOTES.md` → Host `paper_set_is_read` → catalog PUT
- 进度：沿用左下角后台任务条

### 5.5 用户侧远端前置条件

1. SSH 可登录（密钥 / agent 优先；密码 MVP 可后置）  
2. SFTP subsystem 可用  
3. 已安装选用的 ACP agent，且在 PATH 或配置了绝对路径  
4. 已在**服务器**完成 agent login / API 配置  
5. SSH 用户对 Vault 目录可读写  

---

## 6. 前端与 UX

| 区域 | 行为 |
|---|---|
| 欢迎页 | **Open Remote Vault…**：选 SSH host（`~/.ssh/config` alias 优先）+ 远端路径 |
| 最近列表 | `{ kind: "remote", host, remotePath, label }`，非本机绝对路径 |
| 标题栏 | 远程徽章：`user@host:path`；连接中 / 重连 / 失败态 |
| 文件树 | 懒加载 list；隐藏 Finder / 系统终端菜单（`FsCaps`） |
| Agent 面板 | 仅远端 transport；warm 显示 SSH 延迟 |
| 设置 | 最近远程、默认 identity、缓存上限、「清除远程缓存」 |
| i18n | 全部 `t()`；先 `en` 再 `zh-CN` |

多窗口：每窗口独立 `RemoteSession`（对齐现有 vault session 隔离）。MVP **不**支持两窗口写同一 `host+remotePath`（可检测后警告）。

---

## 7. Host API 草案

命名随实现可调整为 snake_case invoke；语义如下。

| Command | 作用 |
|---|---|
| `remote_connect` | `{ hostAlias \| endpoint, remotePath }` → `{ sessionId, caps, displayName }` |
| `remote_disconnect` | flush + 拆连接 + 清 work |
| `remote_status` | connecting / ready / reconnecting / failed + 可选 latency |
| `remote_list_dir` | 连接后选路径用（未 open vault 前） |
| 现有 `path_*` / 读写 | 经 `VaultSession.fs`，签名尽量保持 |
| `paper_*` | catalog 经 work mirror；mutation 触发 PUT |
| `agent_warm` / `agent_run_*` | `kind=remote` 时走 `SshStdio` |
| Events | `remote:status`；现有 `agent:*` 复用 |

路径：一律 vault-relative；Host 防 `..` 逃逸，拼在 `remote_root` 下。

---

## 8. 分阶段交付

| 阶段 | 交付 | 权威 |
|---|---|---|
| **M0** | `VaultFs` + `LocalFs` 迁移关键读写路径；本地零回归 | 本地 |
| **M1** | SSH 连接、SFTP 树、md 读写、PDF blob 预览、远程徽章 | 文件远端 |
| **M2** | catalog GET/PUT、`paper_list` / tags / rescan、冲突 stat | **含 sqlite 远端** |
| **M3** | `SshStdio` ACP、远端 discover/warm、精读 Zap、permission/notes-review | 远端 BYOA |
| **M4** | 连接复用、atomic catalog PUT、**trash ✅**、**入库写远端 ✅**、**缓存 LRU ✅** | 加固 |

**MVP 闭环** = M0–M3。M1 无 catalog 不算完整远程 Vault；M2 无 Agent 不满足「要 BYOA」。

### 8.1 验收（MVP）

1. 仅 SSH，不选本机文件夹，可打开远端 Vault。  
2. 保存 `NOTES.md` 后，另一终端 `ssh` + `cat` 可见新内容。  
3. 改 tags / rescan 后远端 `catalog.sqlite` 更新；清本机 cache 再连，Library 一致。  
4. 远端已装 agent 时，Chat / 精可读盘并改 `NOTES.md`；`is_read` 反映在远端 catalog。  
5. 权限「每次询问」弹本机对话框，批准后远端 agent 继续。  
6. Disconnect 后 work 副本删除；最近列表无「伪本地路径」。  
7. 本机未安装对应 agent 时，远程会话仍可用（只要远端有）。

---

## 9. 技术栈建议

### 9.1 已有（沿用）

| 层 | 技术 |
|---|---|
| 桌面 | Tauri 2、Rust、React 19、TypeScript |
| 本地 catalog | `rusqlite`（bundled） |
| Agent | ACP Client（`agent_client_protocol` 等现网依赖）、Codex app-server 分支 |
| 日志 | `tauri-plugin-log` / 现有 `OpTimer` |

### 9.2 建议新增（Host）

| 用途 | 候选 | 备注 |
|---|---|---|
| SSH 客户端 | [`russh`](https://github.com/Eugeny/russh) | 纯 Rust；与 r-shell 同栈；需自接 config/agent 或简化配置 |
| SSH + 系统兼容 | [`openssh`](https://crates.io/crates/openssh) + 系统 `ssh` | **优先吃 `~/.ssh/config`、ProxyJump、ssh-agent**；MVP 打通快 |
| SFTP | [`russh-sftp`](https://crates.io/crates/russh-sftp) 或 [`openssh-sftp-client`](https://crates.io/crates/openssh-sftp-client) | 与上表 SSH 选型配对 |
| 备选 | [`ssh2`](https://crates.io/crates/ssh2)（libssh2） | 成熟但 FFI / 构建链更重 |
| 异步 | 现有 Tokio 运行时 | channel 泵与 SFTP 同 runtime |
| 密钥 | ssh-agent / 本机 key 路径；密码入 keychain（后置） | **禁止**明文写进 Vault |

**MVP 推荐组合（务实）**：

1. **Phase 连接打通**：系统 `ssh`/`scp` 或 `openssh` + `openssh-sftp-client`（配置兼容性最好）。  
2. **Phase 产品化**：评估迁 `russh` + `russh-sftp` 做连接池与细粒度 channel（参考 r-shell）。

### 9.3 前端

- 无新重视图库；状态：远程 session + caps  
- PDF 仍 `blob:` / react-pdf  
- 设置页：远程条目；i18n `en` + `zh-CN`

### 9.4 明确不采用（MVP）

| 技术 | 原因 |
|---|---|
| VS Code Server / 闭源 remote agent 协议 | 无稳定 API、目标是 IDE 非 Vault |
| code-server / openvscode-server 内嵌 | 第二套 IDE，非 FS/ACP 后端 |
| sshfs 作为唯一 IO | FUSE 依赖、断线与 SQLite 风险 |
| SQLite over 网络盘直 open | 损坏与锁问题 |

---

## 10. 可参考的开源项目

### 10.1 同栈 / 直接可抄

| 项目 | 地址 | 可参考点 |
|---|---|---|
| **r-shell** | [GOODBOY008/r-shell](https://github.com/GOODBOY008/r-shell) | **Tauri 2 + russh + SFTP** 客户端；连接态、SFTP 会话、认证 UX |
| Fileman 类 SFTP 管理器 | 社区 Tauri SFTP 文件管理器文章/仓库 | 列表、传输进度、书签 |

### 10.2 SSH / SFTP 库与工具

| 项目 | 地址 | 可参考点 |
|---|---|---|
| russh | [Eugeny/russh](https://github.com/Eugeny/russh) | 纯 Rust SSH 服务端/客户端生态 |
| openssh-sftp-client | crates.io | 与系统 OpenSSH 配合的 SFTP |
| OpenSSH | 系统自带 | `~/.ssh/config`、`ControlMaster`、ProxyJump 语义 |

### 10.3 远程开发架构（学思路，不抄协议）

| 项目 | 地址 | 可参考点 |
|---|---|---|
| VS Code Remote-SSH | [文档](https://code.visualstudio.com/docs/remote/ssh) | **UI 本地、工具远端**；勿劫持 server |
| code-server | [coder/code-server](https://github.com/coder/code-server) | 浏览器 IDE；**对比**说明我们为何只做 SFTP+ACP |
| openvscode-server | [gitpod-io/openvscode-server](https://github.com/gitpod-io/openvscode-server) | 开源 VS Code web server；同上，非目标依赖 |
| Mutagen | [mutagen-io/mutagen](https://github.com/mutagen-io/mutagen) | 双向同步思路；我们是 **write-through 权威远端**，非默认同步引擎 |

### 10.4 Agent 协议

| 项目 | 地址 | 可参考点 |
|---|---|---|
| Agent Client Protocol | [agentclientprotocol.com](https://agentclientprotocol.com/) | 现有 BYOA 契约；远程仅换 transport |
| 各 ACP agent 发行版 | Claude ACP、OpenCode、Codex 等 | 远端安装与 `cwd` 行为验证矩阵 |

### 10.5 反模式参考

| 做法 | 问题 |
|---|---|
| 本机 Agent + SFTP 当盘 | 双权威、延迟、工具路径混乱 |
| catalog 仅本地侧车当权威 | 违背「所有文件在远端」 |
| 解析 VS Code 私有 RPC | 闭源、无保证、维护税极高 |

---

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| catalog PUT 中断 | 远端 tmp + rename；失败不更新 FileMeta；reopen 以远端为准 |
| 多客户端写坏 sqlite | 产品假设单写者；mtime 冲突拒写 |
| SSH 延迟导致 Chat 慢 | warm 状态；流式仍用现有事件；超时可配 |
| 远端无 agent / PATH 怪 | discover 报错可操作；设置绝对路径；loginShell 选项 |
| nvm/conda 未加载 | `loginShell` 或用户写 wrapper 脚本 |
| PDF 反复下载 | blob LRU + mtime 校验 |
| 安全：远端→本机 | ACP 桥只转发协议字节；不自动 ForwardAgent 除非用户显式 |
| Host key | 校验 known_hosts；未知 host 提示确认 |

---

## 12. 文档与代码落点（实现时）

| 区域 | 建议路径 |
|---|---|
| 设计（本文） | `docs/development/remote-vault.md` |
| API 契约增补 | `docs/backend/api.md`（落地 command 时） |
| Host | `src-tauri/src/services/remote/`、`services/fs/`、`agent` transport 分支 |
| 前端 | 欢迎页远程入口、session store、caps 驱动菜单、设置 |
| i18n | `src/i18n/locales/en` → `zh-CN` |
| 路线图 / backlog | [`roadmap.md`](roadmap.md)、[`todo.md`](todo.md) |

**实现顺序建议**：M0 抽象 → M1 SFTP UI → M2 catalog → M3 远端 ACP（BYOA）→ M4 加固。不要在未抽 `VaultFs` 前散落 `if remote`。

---

## 13. 决议记录（讨论收敛）

| 议题 | 决议 |
|---|---|
| 文件放哪 | MVP **全部权威在远端** |
| catalog | 远端权威；会话内 work 副本 + GET/PUT |
| BYOA | **需要**；进程在**远端**，非本机 |
| VS Code Server | **不**劫持 |
| 本机 cache | 仅 ephemeral，非第二 Vault |
| SSH vs SFTP | 同会话两用：SFTP=文件，exec=Agent |

---

## 14. Live SSH 冒烟（可选）

在本机 `~/.ssh/config` 配置好 Host 别名，远端准备符合 data-model 的 Vault 目录后：

```bash
# 远端脚手架示例（替换 HOST 与路径）
ssh HOST 'mkdir -p ~/agentero-remote-test-vault/{papers/demo-paper,notes,plans,.agents/skills/hello}
  && printf "# AGENTS.md\n" > ~/agentero-remote-test-vault/AGENTS.md
  && printf "# Demo Paper\n\nnotes\n" > ~/agentero-remote-test-vault/papers/demo-paper/NOTES.md'

# Host 集成测试（ignored，需环境变量；勿把具体主机名写进仓库）
cd src-tauri
AGENTERO_REMOTE_SSH_HOST=<ssh-config-Host> \
AGENTERO_REMOTE_SSH_PATH=<absolute-remote-vault-path> \
cargo test --lib live_ssh_remote_vault -- --ignored --nocapture
```

覆盖：connect / list / read / write-through / catalog checkout·push / paper upsert / `remote_which`（login shell PATH，`bash -lc`）。

完整 Chat 依赖远端已安装 **ACP-compatible** agent（`claude-agent-acp` / `opencode acp` 等）；仅有 Claude Code / 其它 CLI 时，文件层可用，Agent 面板需对应 ACP 入口。

## 15. 后续（非 MVP）

- Codex App Server 经 SSH  
- 更完整设置页远程偏好（默认 identity 等）  
- 更广的 `std::fs` → `VaultFs` 迁移 
