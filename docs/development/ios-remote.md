# iOS 远程连接方案（paseo 式二维码配对）

> 状态：**未实现草稿**。定位在 roadmap 0.7+「平台」切片。
> 决策：iOS **不做本地 Vault**，App 是桌面端的纯远程客户端 —— 扫码配对后经 **relay + 端到端加密** 连接电脑上的 Agentero，读写电脑上的库，并驱动电脑上的 BYOA Agent。

---

## 1. 背景与决策

### 1.1 为什么改方案

原 iOS 预留方案（`src-tauri/src/app/handlers.rs` 的 `common_commands!` 集）假设 iOS 设备**本地持有 Vault**：iOS 分支注册了 `vault_tree_build`、`paper_list`、`vault_search` 等本地磁盘命令，但不含 `agent_run_once`（BYOA 需要 spawn 本机 CLI 子进程，iOS 沙箱做不到）、不含全部 `remote_*`（SSH 依赖系统 OpenSSH，iOS 没有）。

这条路线的问题：

- iOS 上没有可用的 ACP Agent（无法 spawn `claude` / `codex` 等 CLI）→ 核心能力缺失；
- 本地 Vault 需要 iCloud/文件同步方案，与 local-first 的「catalog.sqlite 单写者」冲突；
- 手机上维护第二份库，与「电脑是科研工作台」的产品定位不符。

### 1.2 新定位

**iOS = 电脑端 Agentero 的远程遥控器 + 阅读器**：

- 文件与 catalog 权威**始终在电脑**；iOS 只有缓存，没有事实来源；
- Agent 全部在电脑上运行（复用现有 ACP/BYOA 链路），iOS 只发指令、看流式输出、答权限弹窗；
- 配对与连接体验照搬 paseo：**桌面出二维码 → 手机扫码 → relay 中转 + E2EE**，任何网络环境可用，无需公网 IP / 端口转发 / VPN。

---

## 2. paseo 机制调研摘要

调研对象：**源码仓库** [`getpaseo/paseo`](https://github.com/getpaseo/paseo)（monorepo，clone 于 `~/f/paseo`，约 0.2.3）+ 本机 `@getpaseo/cli` 0.1.53 发行产物 + 本机 `~/.paseo/` 运行时数据。下文路径均相对 `~/f/paseo`。

> **许可证约束（重要）**：paseo 是 **AGPLv3**（`LICENSE`，Copyright Mohamed Boudra）。Agentero 是 **MIT**（`LICENSE`）。因此**只能参考其协议设计与交互流程，绝不复制其源码**（含片段、逐行改写）。本方案的所有实现必须独立编写（Rust Host + 现有 React 前端），协议字段名可以兼容/借鉴（接口事实不受版权保护），代码不得搬运。

### 2.1 三方架构

| 角色 | 说明 |
|---|---|
| Client | 移动 App（Expo/React Native，`packages/app`）/ Web App（`app.paseo.sh`），协议 `role=client` |
| Server（daemon） | Node 守护进程（`packages/server`），默认监听 `127.0.0.1:6767`，同时**主动出站**连 relay |
| Relay | 官方 relay 是**独立开源 Elixir 服务** [`getpaseo/paseo-relay`](https://github.com/getpaseo/paseo-relay)；monorepo 内另有 Cloudflare Workers + Durable Objects 适配（`packages/relay/src/cloudflare-adapter.ts`，按 `(版本, serverId)` 一个 DO 实例）。两者都只做 WS 帧转发，**不持有明文** |

选路（`public-docs/security.md`）：**relay 为推荐路径**（daemon 出站，无需开端口）；直连支持 TCP / Unix socket / named pipe，其中 socket/pipe 仅 CLI 可用，移动端与 Web 必须走网络。直连**不加密**，官方建议配合 Tailscale + 密码认证。

### 2.2 二维码内容

daemon 首次启动生成两个长期身份（`$PASEO_HOME`，默认 `~/.paseo/`）：

- `server-id`：`srv_` + 9 随机字节 base64url，兼作 relay 会话 ID；
- `daemon-keypair.json`：Curve25519（NaCl box）静态密钥对，`0600`。

`paseo onboard` / `paseo daemon pair` 组装 **ConnectionOfferV2**（`packages/protocol/src/connection-offer.ts:9-17`）并渲染二维码：

```
https://app.paseo.sh/#offer=base64url({
  v: 2,
  serverId: "srv_…",
  daemonPublicKeyB64: "<32B 公钥>",
  relay: { endpoint: "relay.paseo.sh:443", useTls?: true }
})
```

QR = App URL + fragment 中的 offer；解析入口 `parseConnectionOfferFromUrl`（同文件 :56）。**没有 token、没有挑战值、没有局域网 IP**——offer 是 relay-only。

### 2.3 配对与 E2EE 握手

1. App 解析 `#offer`，连 `wss://relay…/ws?serverId=…&role=client&v=2`；relay 分配 `connectionId` 并通过 daemon 的控制通道通知它；
2. daemon 为该 connectionId 建一条 `role=server&connectionId=…` 数据 WS；
3. App 生成临时 NaCl 密钥对，发**明文** `{"type":"e2ee_hello","key":<clientPub>,"capabilities":{"binaryCiphertext"?}}`；双方 X25519 ECDH 得共享密钥，daemon 回 `{"type":"e2ee_ready"}`（`packages/relay/src/encrypted-channel.ts:41-68`）；
4. 之后全部流量 XSalsa20-Poly1305 加密（`[24B nonce][密文]`，按 capability 走二进制帧或 base64 文本帧）；
5. 握手可重试：client 未收到 `e2ee_ready` 时可重发 `e2ee_hello`，daemon **重发 ready 但不换密钥**（同文件 :44-51 注释）。

**认证模型**（`public-docs/security.md` 明确承认）：daemon 在握手完成前不处理任何命令，故 relay 无法冒充；但**客户端不被认证**——「QR 码/配对链接就是密码，拿到即可连接」。轮换方式：重启 daemon 生成新会话。直连路径另有可选**密码认证**：bcrypt 存 `config.json`，HTTP 用 `Authorization: Bearer`、WS 用 subprotocol 认证，`/api/health` 豁免。

### 2.4 移动端配对实现（源码）

| 关注点 | 证据 |
|---|---|
| 扫码界面 | `packages/app/src/app/pair-scan.tsx`：`expo-camera` `CameraView`，`barcodeTypes:["qr"]`；只接受含 `#offer=` 的载荷；扫到后先 `connectToDaemon` 探活拿 hostname，再 `upsertConnectionFromOfferUrl` 落库 |
| 三种添加方式 | `packages/app/src/components/add-host-method-modal.tsx`：**直连**（手动 host:port）/ **扫码**（F-Droid 构建下隐藏）/ **粘贴配对链接**（`components/pair-link-modal.tsx`）。无 mDNS 发现 |
| 多台电脑 | `packages/app/src/types/host-connection.ts:40-48` `HostProfile{serverId,label,connections[],preferredConnectionId,...}`；一台 host 可有多条通道（`relay` / `directTcp` / `directSocket` / `directPipe`），按候选顺序回退；`orderHostsLocalFirst` 本机优先 |
| 持久化 | `packages/app/src/runtime/host-runtime.ts:1362` —— host 列表落 **AsyncStorage**（非 Keychain/SecureStore）；`utils/client-id.ts` 的 clientId 同样 AsyncStorage |
| 深链 | `packages/app/src/app/_layout.tsx:618-655` `OfferLinkListener`：App 外点配对链接可直接入库 |
| 首启 | `packages/app/src/components/welcome-screen.tsx` → `pair-scan?source=onboarding` → 成功后 `router.replace(hostRoot)` |

### 2.5 应用协议与推送

- 协议 schema 集中在 `packages/protocol/src/messages.ts`（zod，被 server/client/app 共享，另有 `generated/`）：外层 `hello`（clientId / clientType / protocolVersion / capabilities）+ `ping/pong` + `session` 包裹；内层大 discriminated union（agent 流式 timeline、权限请求/应答、文件浏览、终端 PTY、git/PR、schedule/loop…），`requestId` 关联，`clientId` 作会话键支持断线恢复。
- 传输抽象在 `packages/client/src/`：`daemon-client-websocket-transport.ts`（直连）与 `daemon-client-relay-e2ee-transport.ts`（relay + E2EE）实现同一 `daemon-client-transport-types.ts` 接口，`daemon-client.ts` 之上不感知选路。
- 推送：App 上报 Expo push token（`register_push_token`）→ daemon 持久化 `push-tokens.json` → agent 需关注且**无前台活跃客户端**时，`packages/server/src/server/push/push-service.ts` 直接 POST Expo Push API。

### 2.6 借鉴与不照搬

| 借鉴 | 不照搬 |
|---|---|
| offer-in-QR（serverId + 公钥 + relay 地址），无账号体系 | **代码**：AGPLv3，只参考设计不复制实现 |
| relay 只转发密文、daemon 出站连接（无公网暴露面） | 客户端零认证（「QR 即密码」）：我们加**配对确认 + 设备密钥**（见 §5.3） |
| E2EE：静态 daemon 公钥 + 临时 client 密钥 ECDH，握手前不受理命令 | 直连明文 + 可选 bcrypt 密码：我们的直连也走同一套 E2EE |
| 多 host / 多通道 profile + 候选回退 + 深链配对 | host 凭据存 AsyncStorage：我们存 **iOS Keychain** |
| 双层 WS 协议、requestId 关联、断线会话恢复；transport 接口统一 | Expo 推送与 Node daemon：我们是 Tauri iOS + Rust Host（见 §8.4） |


---

## 3. 总体架构

```
┌─────────────┐   wss (E2EE 密文)   ┌──────────────┐   wss (出站)   ┌───────────────────────┐
│  iOS App    │ ◄────────────────► │    Relay      │ ◄───────────► │  桌面 Agentero (Host)  │
│  (Tauri 2,  │                    │ (CF Workers/  │               │  features/bridge/      │
│   复用 src/) │                    │  自托管, 仅转发)│               │   ├ RPC → 现有命令面    │
└─────────────┘                    └──────────────┘               │   ├ 事件转发 agent:* 等 │
      扫码 ▲                                                       │   └ 设备配对/密钥       │
          └── 桌面 Settings → 远程访问 → 显示二维码 offer            └───────────────────────┘
```

- **桌面 Bridge**（新 feature `src-tauri/src/features/bridge/`）：桌面 App 内的连接端点，不是独立进程。开关在 Settings → 远程访问（默认关）。开启后向 relay 建立控制通道，并为每个已配对设备的连接建数据通道。
- **Relay**：**自建**（决策已定，见 §3.1）。拓扑照 paseo（serverId 路由 + 纯密文转发），代码独立编写（官方 paseo relay 是 AGPL Elixir 服务，不复用）。
- **iOS App**：Tauri 2 iOS 壳 + 复用现有 React 前端；不注册任何本地 Vault 命令，所有数据经 Bridge RPC。

### 3.1 Relay 服务（自建）

relay 解决的唯一问题：手机在外网、电脑在 NAT 后面，双方都无法主动连对方 —— relay 是公网**会合点**。它不存数据、不解密、无数据库；因为上层已 E2EE，relay 只见 IP / 时间 / 包大小。本质是一个按 `serverId` 配对两条 WebSocket 的交换机。

**技术选型**：Cloudflare Workers + Durable Objects。理由：全球 anycast 边缘、原生 WebSocket hibernation、按 DO 名字天然做「每 serverId 一个单点」，无需自己管进程/负载均衡；免费额度对个人与早期用户量级足够。仓库：**独立 repo [`poco-ai/agentero-relay`](https://github.com/poco-ai/agentero-relay)**（现为 private，实现完成后转公开 MIT 以支持自托管），不进本 monorepo —— 部署节奏（`wrangler deploy`）与桌面 `v*` tag 发布无关，CF 凭据也不应进桌面仓库；relay 不解析上层协议，只需共享少量常量（query 参数名、控制消息 type），复制常量比耦合构建更划算。

**路由与角色**（一个 DO 实例 = 一个 `serverId`）：

```
GET /ws?v=1&serverId=<agt_…>&role=host                       → host-control（每 serverId 唯一）
GET /ws?v=1&serverId=<agt_…>&role=host&connectionId=<conn_…> → host-data（每设备连接一条）
GET /ws?v=1&serverId=<agt_…>&role=client                     → client（relay 分配 connectionId）
```

- client 接入 → DO 分配 `conn_<16hex>`，经 host-control 下发 `{type:"connected",connectionId}`；host 建对应 host-data 通道后按 connectionId 一对一转发；
- host-data 未就绪期间 client 帧进环形缓冲（上限 ~200 帧 / 4MB，超限直接关连接，避免 DO 内存放大）；
- 断开时向对端发 `{type:"disconnected",connectionId}`；host-control 重连后经 `{type:"sync",connectionIds:[…]}` 对账；
- host-control 每 10s 应用层 ping，30s 无响应视为掉线；client 侧指数退避重连（1s→30s，带抖动）。

**relay 自身不做认证**（照 paseo）：`serverId` 是路由键不是秘密，安全性完全由 Bridge 侧的 E2EE + 设备验签兜底（§5.3）。relay 只做**滥用防护**：每 serverId 并发 client 上限、每 IP 建连速率限制、单帧大小上限、空闲会话回收。

**运维与自托管**：官方实例 `bridge.agentero.app`（域名待定）；协议与 Worker 源码开源，设置里 relay endpoint 可改（企业/隐私用户自托管）。offer 里携带 `relay.endpoint`，所以换 relay 只需重新出二维码。日志只记连接元数据（serverId 前缀哈希、时长、字节数），不记内容，不记完整 IP。

---

## 4. 桌面端 Bridge

### 4.1 身份与持久化

存放在 XDG 配置目录（与 `settings.json` 同级）：

| 文件 | 内容 |
|---|---|
| `bridge/server-id` | `agt_` + 随机 base64url，长期不变 |
| `bridge/keypair.json` | X25519 静态密钥对（`{v, publicKeyB64, secretKeyB64}`，0600） |
| `bridge/devices.json` | 已配对设备列表：`{deviceId, name, devicePublicKeyB64, pairedAt, lastSeenAt, revoked}` |

Rust 侧密码学选型：`crypto_box`（X25519 + XSalsa20-Poly1305，与 NaCl box 兼容）或 `x25519-dalek` + `chacha20poly1305`；nonce 24B 前置，密文走 WS 二进制帧（不做 base64，省流量）。

### 4.2 生命周期

- Settings 开启「远程访问」→ Bridge 随桌面 App 启动/停止；桌面 App 退出即失联（iOS 端显示「电脑离线」）。
- 控制通道：`wss://<relay>/ws?serverId=…&role=server`，应用层 ping 10s 保活，断线指数退避重连。
- relay 经控制通道下发 `{type:"connected", connectionId}` → Bridge 建对应数据通道并做 E2EE 握手。
- 后续（0.8+）：可选「无界面常驻」模式复用 `agentero-cli`（`agentero bridge serve`），电脑不开 GUI 也能连——依赖 CLI 侧补 agent 能力，暂不承诺。

### 4.3 与 Vault 的绑定

Bridge 服务的是**桌面当前打开的 Vault**（多窗口时取发起开关的窗口 session）。切换 Vault 时向已连接设备广播 `vault_changed`，iOS 端清空面板并重新拉树。不做「iOS 挑选任意历史 Vault」——保持单写者与心智简单。

---

## 5. 二维码配对

### 5.1 Offer 格式

```jsonc
// QR 内容：agentero://pair#offer=base64url(JSON)
{
  "v": 1,
  "serverId": "agt_…",
  "hostPublicKeyB64": "…",         // Bridge 静态公钥
  "relay": { "endpoint": "bridge.agentero.example:443" },
  "hostName": "Phil 的 MacBook Pro", // 展示用
  "pin": false                       // 预留：true 时要求确认码
}
```

- 主 scheme 用 `agentero://pair`（App 已安装场景，Universal Link 域名后置）；桌面同时提供**可复制配对链接**，iOS 侧支持「粘贴链接」与深链直接入库（照 paseo 的三入口：扫码 / 粘贴 / 手动直连）。
- 与 paseo 同构：offer 不含 token、不含局域网 IP；但拿到 offer ≠ 拿到访问权（见 5.3，与 paseo 的关键差异）。

### 5.2 UX 流程

桌面：Settings → 远程访问 → 开启 → 显示二维码 + 可复制配对链接（含「重新生成身份」按钮，等价踢掉所有设备）。

iOS 首启：

1. 欢迎页只有一个动作：「扫码连接电脑」（`NSCameraUsageDescription`）；
2. 扫码 → 解析 offer → 生成本机长期设备密钥对（存 Keychain）→ 连 relay → E2EE 握手；
3. 发送 `pair_request {deviceId, deviceName, devicePublicKeyB64}`；
4. **桌面弹确认**：「iPhone 15 Pro 请求连接，确认码 483-921」，iOS 同屏显示相同确认码，用户在桌面点允许；
5. 桌面把设备写入 `devices.json`，回 `pair_ok`；iOS 保存 `{offer, deviceKeypair}`，进入主界面。

再次启动：直接用保存的 offer + 设备密钥静默重连；失败时显示离线态与「重新扫码」入口。

**多台电脑**：借鉴 paseo 的 `HostProfile` 模型 —— iOS 侧保存 `hosts[]`（每台 `{serverId, label, connections[], preferredConnectionId}`，一台 host 可同时有 relay 与 LAN 两条通道，按候选顺序回退），顶部可切换当前电脑。与 paseo 不同：凭据（设备私钥 + host 公钥）存 **iOS Keychain**，不落 AsyncStorage 明文。

### 5.3 客户端认证（对 paseo 的安全修正）

paseo 不认证客户端（见 §2.3），我们补三层：

1. **配对确认**：首次连接必须桌面侧人工允许 + 双端确认码比对（防 offer 泄露后被静默配对）；
2. **设备密钥**：E2EE 握手后加一步挑战签名——Bridge 发随机 nonce，设备用长期 Ed25519 设备私钥签名，Bridge 对照 `devices.json` 中登记的公钥验签；未登记/已吊销设备只允许发 `pair_request`；
3. **设备管理**：Settings → 远程访问列出已配对设备（名称 / 最近在线），可单个吊销；「重新生成身份」全量作废。

### 5.4 无 relay 兜底

relay 不可达时（自托管用户 / 断网内网）：offer 的 `relay.endpoint` 可换成 `lan:<host>:<port>` 直连桌面 Bridge 本地监听端口，E2EE 与设备认证流程**完全相同**——这优于 paseo（其直连不加密，只有可选 bcrypt 密码，官方建议叠 Tailscale）。iOS 需 `NSLocalNetworkUsageDescription`；同样支持手动输入 `host:port`（Tailscale IP 场景）。此项为 P2，不进 MVP。

---

## 6. 应用协议（RPC over E2EE WS）

### 6.1 封装

沿用 paseo 双层结构，JSON 编码：

```jsonc
// 外层
{"type":"hello","deviceId":"…","protocolVersion":1,"appVersion":"0.7.0"}
{"type":"ping"} / {"type":"pong"}
{"type":"rpc","id":"req_42","method":"paper_list","params":{…}}       // iOS → 桌面
{"type":"rpc_result","id":"req_42","ok":true,"data":{…}}              // 桌面 → iOS
{"type":"event","name":"agent:stream","payload":{…}}                  // 桌面 → iOS 推送
```

`hello` 后桌面回 `server_info {serverId, hostName, appVersion, vault:{name, root}}`。`deviceId` 作会话键：短暂断线重连不丢 agent 订阅。

### 6.2 RPC 方法 = 现有 Tauri 命令面

Bridge 不发明新领域 API：`method` 直接映射到现有 `#[tauri::command]` 背后的领域函数（`features/catalog/papers.rs`、`features/vault/tree.rs`、`features/search/mod.rs` 均以 `&Path` 为根、不依赖 Tauri State，天然可复用）。白名单制：

| 组 | 方法（首批） |
|---|---|
| Vault | `vault_tree_build` / `vault_tree_children` / `vault_read_text` / `vault_write_text` / `vault_search` |
| Catalog | `paper_list` / `paper_get` / `paper_set_tags` / `paper_set_is_read` |
| 文件 | `bridge_read_bytes`（分块拉 PDF/图片，见 6.3） |
| Agent | `agent_run_once` / `agent_cancel` / `agent_respond_permission` / `agent_list_sessions` / `agent_load_session` |
| Wiki | `wiki_backlinks` / `wiki_graph`（P1） |

**不暴露**：`remote_*`（SSH）、window/terminal/finder、Zotero connector、settings 写入、任意绝对路径读写（所有 path 参数强制 Vault 相对路径 + canonicalize 防逃逸）。

### 6.3 大文件

`bridge_read_bytes {path, offset, len}` 分块（256KB）传输，iOS 端拼装后存 App 沙箱 LRU 缓存（对齐现有 `blob_cache.rs` 语义），PDF/图片预览走本地 blob。带 `{size, mtime, sha256}` 头做缓存校验。

### 6.4 事件转发

桌面 Host 现有按窗口 emit 的事件（`events.rs`）增加一路 Bridge sink，按订阅转发给设备：

- `agent:stream` / `agent:completed` / `agent:failed` / `agent:tool` / `agent:plan` / `agent:usage` / `agent:permission-request`；
- `vault:file-changed`（驱动 iOS 端打开中的 NOTES.md 自动重载）；
- `vault_changed`（§4.3）。

---

## 7. iOS 客户端

### 7.1 复用现有前端

- Tauri 2 iOS 工程（`src-tauri/gen/apple/` 已有 `tauri ios init` 骨架），前端仍是 `src/` 的 React 代码；
- 关键抽象：在 `src/lib/core/` 加 **transport 层** —— 桌面构建下 `invoke` 直连本地命令；iOS 构建下同名调用路由到 Bridge RPC（WS 客户端可放 Rust 侧、经本地 `invoke("bridge_rpc")` 代理，密钥不出 Rust）；
- Vault handle 采用伪路径 `bridge:<serverId>`，复用现有 `isRemoteVaultHandle` 式分流经验（远端已有 `remote:<sessionId>` 先例）：跳过 fs-watch、跳过本地 wiki 索引（wiki 数据改从 RPC 拿）。

### 7.2 界面裁剪（手机优先）

不搬桌面三栏 Dockview。iOS MVP 四个面板：

| Tab | 内容 | 复用 |
|---|---|---|
| Library | 论文列表（搜索 / 标签筛选 / 已读态） | `paper_list` 数据模型 |
| 阅读 | PDF 预览（分块缓存）+ NOTES.md 只读→可编辑 | pdf.js / Markdown 渲染 |
| Agent | 对话面板，等价桌面禅模式（AgentPanel `variant="zen"` 思路） | AI Elements |
| 设置 | 连接状态 / 已配对电脑 / 重新扫码 / 断开 | — |

iPad 后续可回到双栏（Library + 阅读/Agent 分屏）。

### 7.3 handlers.rs 收敛

原 `common_commands!` iOS 分支的本地 Vault 命令**移除**；iOS 目标只注册：`bridge_pair_scan`（相机结果入口）、`bridge_connect/disconnect/status`、`bridge_rpc`、`settings_get/set`（仅 App 本地偏好）、translate（可选，走免费 MT 直连）。桌面命令集不变。

### 7.4 离线行为

- 已缓存的 PDF / 最近打开的 NOTES 只读可看；
- 一切写操作与 Agent 需在线；离线时置灰并提示「电脑离线」；
- 不做离线写回队列（单写者原则，避免冲突语义）。

---

## 8. Agent 使用（核心场景）

### 8.1 执行位置

Agent **只在桌面**运行：iOS 发 `agent_run_once` RPC → 桌面走完全现成的链路（`resolve` 默认 agent → ACP spawn → `build_prompt` envelope，含 `agentPersonalPrompt`）→ 事件经 §6.4 流回 iOS。iOS 不装、不 spawn 任何 CLI。

### 8.2 对话体验

- iOS Agent 面板 = 精简禅模式：流式 markdown、tool call 折叠、plan 展示，全部复用 AI Elements 组件；
- 上下文 chips：当前打开论文默认加入（与桌面一致）；`@` 提及数据源改走 `vault_tree_children` RPC；
- 运行中锁屏/切后台：桌面侧继续跑（这是远程执行的天然优势）；回前台经 `agent_load_session` 补齐时间线。

### 8.3 权限弹窗

`agent:permission-request` 事件转发到 iOS → 原生风格弹窗（Allow / Deny）→ `agent_respond_permission` RPC 回传。全局权限模式沿用桌面设置（`restricted/ask/auto`），iOS 只读展示当前模式、不可改（避免手机上误开 auto）。

### 8.4 通知（分期）

- **P0**：App 在前台时应用内横幅（agent 完成 / 需权限）；
- **P1**：本地通知——iOS 的 WS 后台存活受限，效果有限，明确不承诺；
- **P2**：APNs 远程推送。参考 paseo 的 attention 策略（有前台活跃客户端就不推）；需要一个推送微服务（可与 relay 同部署）持有 APNs key，推送体只含「需要你的关注」级别信息，不带正文（保持 E2EE 语义）。

---

## 9. 与现有 SSH 远程 Vault 的关系

两条远程链路**并存、不合并**：

| | `remote:` (现有) | `bridge:` (本方案) |
|---|---|---|
| 拓扑 | 桌面 Agentero → SSH → 服务器 | iOS → relay → 桌面 Agentero |
| 传输 | 系统 OpenSSH/SFTP | WS + E2EE（自实现） |
| catalog | work mirror + push-back | 无镜像，RPC 直查桌面 |
| Agent | 远端 SSH spawn | 桌面本机 spawn |
| 客户端 | macOS/Linux 桌面 | iOS |

组合场景天然成立：iOS → 桌面 → （桌面已打开 `remote:` Vault）→ 服务器。Bridge 的 RPC 打到桌面当前 Vault 的命令面即可，无需感知底层是本地盘还是 SFTP（首版可先限制为本地 Vault，验证后放开）。

## 10. 安全模型小结

- **relay 零信任**：只见密文与握手公钥；serverId 是路由键不是秘密；
- **握手前不受理命令**（与 paseo 一致）：E2EE + 设备验签未完成时，Bridge 只接受 `pair_request`；
- **offer 泄露**：对方最多能发 `pair_request`，需桌面人工允许 + 确认码（**优于 paseo 的「QR 即密码」**）；
- **设备被盗**：桌面端可吊销单个设备；「重新生成身份」全量作废；
- **命令面**：白名单 + Vault 相对路径校验，无 shell、无任意文件系统访问；Agent 的写操作仍受桌面权限模式约束；
- **密钥存放**：桌面 0600 文件；iOS 设备私钥进 Keychain（`kSecAttrAccessibleAfterFirstUnlock`），不落明文 storage。

## 11. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| M0 Relay | 独立 repo `agentero-relay`：CF Workers + DO，三角色路由、缓冲、限流、部署到官方域名 | 两个 `wscat` 客户端经 relay 互通；断线重连与 sync 对账通过 |
| M1 Bridge 内核 | `features/bridge/`：身份/密钥、relay 控制+数据通道、E2EE、设备配对与验签、RPC 白名单映射；Settings 开关 + 二维码 | 桌面↔桌面模拟 client 经**真实 relay** 跑完配对 + RPC + Agent 流式 e2e |
| M2 iOS MVP | 扫码配对 + Library / 阅读（PDF+NOTES 只读）/ Agent 对话 + 权限应答 | TestFlight 内测；`docs/development/release.md` 上架清单 |
| M3 打磨 | NOTES 编辑（含保存冲突检查）、标签/已读、wiki backlinks、多主机切换、iPad 双栏 | — |
| P2 之后 | APNs 推送、LAN 直连兜底（含 Tailscale 手动地址）、headless `agentero bridge serve`、`remote:` Vault 透传 | — |

## 12. 开放问题

- relay 域名与免费额度耗尽后的成本分担（官方实例托底 + 自托管开放，已定；定价/限额策略未定）；
- 协议 schema 的单一来源：Rust 定义 + 生成 TS 类型（`ts-rs`/specta），避免手写两份；
- iOS 端 Markdown 编辑器裁剪范围（桌面 CodeMirror 栈在移动端的可用性）；
- 多设备同时在线的写并发（MVP：允许多设备连接，写入走桌面现有保存冲突检查即可）。

## 相关文档

- 调研来源：paseo `@getpaseo/{cli,server,relay}` 发行产物（§2 有函数/文件级证据）
- [../backend/remote.md](../backend/remote.md) · [../backend/agent.md](../backend/agent.md) · [../backend/catalog.md](../backend/catalog.md)
- [release.md](release.md)（iPadOS/iOS 上架清单） · [roadmap.md](roadmap.md)
