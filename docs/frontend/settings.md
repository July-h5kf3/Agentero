# 设置与主题

## 设置窗口

- 独立原生单例：`settings_window_open` + `?window=settings` → `SettingsNativeRoot`。
- macOS Overlay 标题栏 + 交通灯；Windows/Linux 系统原生边框。
- 开/关：`⌘,`、菜单、齿轮；`Esc` / 标题栏 X 关闭。
- 保存：`settings_set` → 广播 `settings:changed` 跨窗口同步。
- 落盘：XDG `$XDG_CONFIG_HOME/agentero/settings.json`。

## 主要分类

| 分类 | 内容示例 |
|---|---|
| 通用 | Translator URL、Connector 开关、文件树标签/排序、打开行为 |
| Appearance | 明暗、`uiTheme`（tweakcn 预设）、`uiScale` |
| Agent | 默认 Agent、权限模式、自动精读、个人提示词、划词提问 Agent |
| 翻译 | 服务与语言 |

## 主题

- `uiTheme` 默认 `default`（内置外观）。
- 外观设置中的配色主题以紧凑预览网格展示背景、卡片、主色和强调色；点击预览项即可应用主题。
- 36 个 tweakcn 预设：`src/themes/tweakcn.json`；`src/lib/ui/theme.ts` 注入 CSS 变量。
- 刷新主题数据：`node scripts/fetch-tweakcn-themes.mjs`。
- `uiScale`：80%–150% 五档，改 `html` font-size。

## i18n

- 用户文案一律 `t()` / `react-i18next`；en 源语言，同步 `zh-CN`。
- 词条：`src/i18n/locales/`。

## 代码

- UI：`src/components/settings/`
- 状态：`src/lib/settings/`
