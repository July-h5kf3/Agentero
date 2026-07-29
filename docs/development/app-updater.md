# Agentero 应用内更新计划

## Requirements Summary

1. 在设置的「关于」页面增加更新卡片。
2. 卡片显示当前版本和更新状态；用户可点击「检查更新」。
3. 发现新版本时，卡片右侧显示下载/安装按钮。
4. 应用启动后后台检查一次更新；发现新版本时弹出全局 toast，提供下载/安装入口。
5. 下载和安装必须由用户明确触发，不静默安装；安装完成后按 updater 语义重启应用。
6. 更新包必须经过 Tauri updater 签名校验；开发环境、未配置签名或检查失败不能阻塞应用启动。
7. 所有新增用户文案进入 `en` 与 `zh-CN` i18n。
8. 同步设置文档、发布文档、发布工作流和相关测试 checklist。

## Codebase Facts

- 当前版本显示仅存在于 `src/components/settings/panes/about-pane.tsx`，只有 `getVersion()` 和静态 About 内容。
- 设置页通过 `SettingsContent` 挂载 About pane；About 是独立原生窗口，主窗口和设置窗口都会渲染 Sonner。
- 启动入口 `src/main.tsx` 已有统一 `boot()`，适合在主窗口完成初始化后异步触发后台更新检查。
- Tauri 插件在 `src-tauri/src/app/mod.rs` 统一注册；当前尚未注册 updater plugin。
- `src-tauri/tauri.conf.json` 没有 updater 配置；`src-tauri/capabilities/default.json` 也没有 updater 权限。
- Release workflow `.github/workflows/release.yml` 目前只构建并上传普通 installer 和 CLI 产物，没有 updater JSON、签名公钥或 updater 私钥配置。
- 当前项目版本来源同步规则见 `docs/development/release.md`，不能只改 tag。

## Acceptance Criteria

1. 打开「设置 → 关于」后：
   - 显示当前应用版本；
   - 显示「检查更新」按钮；
   - 检查中按钮进入 loading/disabled 状态；
   - 无更新显示当前已是最新版本；
   - 有更新显示目标版本和发布说明摘要（如果 updater metadata 提供），右侧显示下载/安装按钮；
   - 下载中显示进度或明确的下载中状态；
   - 下载/安装失败通过全局错误 toast 告知，页面可再次检查。
2. 主应用正常启动后，后台自动检查一次：
   - 不阻塞首屏和 Vault 初始化；
   - 有更新时只弹一次带「下载并安装」操作的 toast；
   - 无更新、网络失败、开发构建或不支持平台不弹错误 toast；
   - 用户点击 toast 操作后复用同一更新服务和安装流程。
3. 更新安装行为：
   - 仅接受 Tauri updater 的签名验证通过的包；
   - 下载完成后调用 updater install，并按官方 API 重启应用；
   - 用户未点击下载/安装时不写入或替换当前安装。
4. Release：
   - Release 产出 Tauri updater 所需的签名安装包和 metadata；
   - metadata 的 endpoint 与公钥配置和应用一致；
   - 未配置签名 secret 时 CI 明确失败或跳过 updater 资产，不能生成看似可用但无法验证的更新 metadata；
   - 现有普通安装包和 CLI 产物继续保留。
5. 验证：
   - `pnpm typecheck`
   - `pnpm lint:ts`
   - `cargo check` 或等价 Tauri Rust 检查
   - updater 配置 schema 校验
   - 至少在 `pnpm tauri dev` 下验证 About 页按钮状态和启动检查不会阻塞应用。

## Implementation Steps

### 1. 引入并配置 Tauri updater

- 在 `src-tauri/Cargo.toml` 增加与当前 Tauri 2 版本兼容的 `tauri-plugin-updater`。
- 在 `package.json` 增加匹配版本的 `@tauri-apps/plugin-updater`。
- 在 `src-tauri/src/app/mod.rs` 注册 updater plugin；保持移动端/不支持平台的条件编译边界清晰。
- 在 `src-tauri/tauri.conf.json` 增加 updater endpoint 和签名公钥配置。
- 在 `src-tauri/capabilities/default.json` 增加 updater 最小必要权限。
- 生成 updater key pair；公钥进入配置，私钥只作为本地/CI secret，绝不写入仓库。
- 先确认 updater 官方 v2 API 的当前安装调用、事件类型、配置字段和权限名称，再落代码，避免按旧版 API 实现。

### 2. 建立前端更新服务

- 新增 `src/lib/update/`，建议拆为：
  - `types.ts`：更新状态、版本信息、下载进度；
  - `service.ts`：封装 `check()`、`downloadAndInstall()`、并发去重和当前 update 对象；
  - `index.ts`：对组件和启动逻辑暴露稳定 API。
- 服务要求：
  - `isTauri()` 为 false 时返回 unsupported，不执行 updater；
  - 同一时间只允许一个 check/download；
  - 统一把 updater 异常转换为可展示错误；
  - 下载事件只更新状态，不直接产生重复 toast；
  - 支持 About pane 和启动 toast 共用当前更新结果。
- 使用已有 `notifyError`/Sonner 机制；如需带操作按钮，扩展 `src/lib/core/notify.ts` 为通用 action toast，而不是在业务层直接依赖 Sonner。

### 3. 修改 About 页面

- 修改 `src/components/settings/panes/about-pane.tsx`：
  - 保留现有版本与 tagline；
  - 增加更新卡片/行；
  - 右侧使用带无障碍名称和 tooltip 的图标按钮；
  - 检查、已是最新、发现更新、下载中、安装中、失败分别渲染稳定状态；
  - 下载完成后显示「重启安装」或直接按 updater API 安装并重启，具体以官方 updater 语义为准。
- About pane unmount 时取消监听/避免 setState；设置窗口关闭不应留下悬挂 updater 事件。

### 4. 启动后台检查与 toast

- 在 `src/main.tsx` 的主窗口 boot 路径中，完成 i18n 和主题初始化后异步触发一次更新检查。
- 设置窗口单独打开时不重复触发启动检查；可通过 `isSettingsWindow` 分支排除。
- 启动检查使用稳定 toast id，避免 StrictMode、重复窗口或多次 boot 造成重复提醒。
- 有新版本时 toast 展示目标版本，并提供「下载并安装」动作；点击后调用更新服务。
- 检查失败只写 logger，不打扰用户；下载/安装失败才在用户主动操作后显示错误 toast。

### 5. 国际化

- 在 `src/i18n/locales/en/settings.json` 和 `src/i18n/locales/zh-CN/settings.json` 增加 About 更新相关词条。
- 在需要时为启动 toast 增加 `app` namespace 词条；React 外部使用全局 `i18n.t()`。
- 不在更新服务和组件中硬编码面向用户的文案。

### 6. Release workflow 与文档

- 修改 `.github/workflows/release.yml`：
  - 注入 updater 私钥和 key password（仅 CI secret）；
  - 让 Tauri action/build 生成并上传 updater metadata 与各平台签名包；
  - 保证 draft release 在 metadata 生成前后顺序正确；
  - 对缺失 secret 做显式校验；
  - 保留现有 CLI 上传逻辑。
- 更新 `docs/frontend/settings.md`，描述 About 更新卡片、启动检查和用户触发安装语义。
- 更新 `docs/development/release.md`，增加 updater key 管理、CI secret、metadata/installer 发布检查。
- 更新 `docs/test/release-checklist.md`，增加最新版本、无更新、有更新、下载失败和安装后版本校验项目。
- 检查 `docs/development/roadmap.md` 与 `docs/development/todo.md`；若该能力属于已完成切片，按仓库规则同步勾选/说明。

## Risks and Mitigations

| 风险 | 缓解 |
|---|---|
| 旧版 Tauri updater API 与当前依赖不一致 | 实现前读取当前官方 Tauri v2 updater 文档和 crate/API 类型；用最小 demo 或编译验证确认 |
| Release 没有签名资产，用户永远检查不到更新 | CI 对签名 secret 和 metadata 产物做显式校验；发布 checklist 增加资产检查 |
| GitHub draft release 的 metadata 不可用 | 以已发布 Release 作为 updater endpoint 的事实来源；不要把 draft 当线上更新源 |
| 启动检查造成白屏或首屏变慢 | 启动检查完全异步，catch 后仅记录日志 |
| StrictMode/多窗口重复 toast | 统一 toast id、服务层并发去重，并只在主窗口启动检查 |
| 用户手动下载到不匹配架构/平台包 | 使用 updater metadata 的 target/arch 选择，不自行拼接下载 URL |
| 安装过程中应用退出或下载中断 | 使用官方 download/install 流程和进度事件；失败后保留当前版本并允许重试 |
| 私钥泄露 | 私钥只放 CI secret/开发者本机安全存储，`.gitignore` 和文档明确禁止提交 |
| 开发环境没有可用 updater metadata | dev 构建返回 unsupported/检查失败，不显示错误提醒；用已发布测试版本做真实升级验证 |

## Verification Steps

1. 静态验证：`pnpm typecheck`、`pnpm lint:ts`、`cargo check`。
2. 配置验证：`pnpm tauri info`/Tauri build 读取 updater 配置成功，capability schema 通过。
3. UI 验证：启动 `pnpm tauri dev`，打开设置 About，覆盖检查中、无更新和错误状态。
4. 启动验证：主窗口启动时检查在后台进行，首屏可用；无网络时不弹误报。
5. 发布验证：使用测试 tag 生成一份已发布测试 Release，确认 metadata、签名资产和不同平台目标均可下载。
6. 升级验证：安装旧版本，检查到新版本，点击 toast/卡片下载并安装，重启后 About 显示新版本。
7. 回归验证：设置窗口、普通启动、CLI 构建、现有 macOS 签名/公证流程不受影响。

