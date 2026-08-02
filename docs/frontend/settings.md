# 设置与主题

## 设置窗口

- 独立原生单例：`settings_window_open` + `?window=settings` → `SettingsNativeRoot`。
- macOS Overlay 标题栏 + 交通灯；Windows/Linux 系统原生边框。
- 开/关：`⌘,`、菜单、齿轮；`Esc` / 标题栏 X 关闭。
- 不查询或展示本机 hostname / OS 身份。
- 保存：`settings_set` → 广播 `settings:changed` 跨窗口同步。
- 落盘：XDG `$XDG_CONFIG_HOME/agentero/settings.json`。
- 加载策略：设置 webview 不加载完整 `App`，也不加载 PDF 引擎与 KaTeX（二者随 `App` 动态 import）。各分区 pane 按 `lazy()` 分 chunk；**当前分区**的 pane 与外壳并行预热（`preloadSettingsPane`），避免窗口刚可交互时才去拉 pane 而卡一下；其余分区首次访问才加载，已访问的保持挂载。
- 通用页的「网络代理」是 Host 级配置，启用后用于 Host 创建的 HTTP(S)/SOCKS 请求，并同步注入本地与远端 Agent 进程的 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`。旧版 Settings → Agent 的代理配置会在首次启动时迁移。

## 主要分类

| 分类 | 内容示例 |
|---|---|
| 通用 | Translator URL、Connector 开关、文件树标签/排序、打开行为 |
| Appearance | 明暗、`uiTheme`（tweakcn 预设）、`uiScale` |
| Agent | 默认 Agent、权限模式、自动精读、个人提示词、划词提问 Agent |
| 翻译 | 服务与语言 |
| 关于 | 版本信息与应用更新 |

## 应用更新

- 正式桌面构建的主窗口会在启动后异步检查一次稳定版更新，不阻塞首屏或 Vault 初始化；检查失败只记日志。
- 设置 → 关于可手动检查。发现新版后显示版本和 Release notes，用户点击「安装并重启」后才下载、验证、安装并重启；不会静默替换应用。
- 更新包由 Tauri Updater 使用内置公钥验证签名，并根据当前系统/架构从 GitHub Release 的 `latest.json` 选择产物。
- 浏览器预览、`pnpm tauri dev`、移动端不检查更新；设置页会说明该限制。
- 只有 GitHub **已发布**的稳定版 Release 可作为更新源；Draft 和 prerelease 不会推送给普通稳定版用户。

## 主题

- `uiTheme` 默认 `default`（内置外观）。
- 外观设置中的配色主题以紧凑预览网格展示背景、卡片、主色和强调色；点击预览项即可应用主题。
- 36 个 tweakcn 预设：`src/themes/tweakcn.json`；`src/lib/ui/theme.ts` 注入 CSS 变量。
- 刷新主题数据：`node scripts/fetch-tweakcn-themes.mjs`。
- `uiScale`：80%–150% 五档，改 `html` font-size。
- `batchImportConcurrency`：魔棒批量导入及后续资源下载的并发上限，范围 1–10，默认 3。

## i18n

- 用户文案一律 `t()` / `react-i18next`；en 源语言，同步 `zh-CN`。
- 词条：`src/i18n/locales/`。

## 代码

- UI：`src/components/settings/`
- 状态：`src/lib/settings/`
- 更新服务：`src/lib/update/`
