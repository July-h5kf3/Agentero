//! Minimal localization for the native application menu.
//!
//! The renderer owns the locale preference; it pushes the active locale to the
//! host via the `set_locale` command, which rebuilds the menu with these labels.

pub struct MenuLabels {
    pub settings: &'static str,
    pub new_window: &'static str,
    pub open_vault: &'static str,
    pub create_vault: &'static str,
    pub refresh_tree: &'static str,
    pub close: &'static str,
    pub toggle_sidebar: &'static str,
    pub toggle_chat: &'static str,
    pub app: &'static str,
    pub file: &'static str,
    pub edit: &'static str,
    pub view: &'static str,
    pub window: &'static str,
}

const EN: MenuLabels = MenuLabels {
    settings: "Settings…",
    new_window: "New Window",
    open_vault: "Open Vault…",
    create_vault: "Create Vault…",
    refresh_tree: "Refresh File Tree",
    // Closes the active document tab first; with no tabs, closes the window.
    close: "Close",
    toggle_sidebar: "Toggle Sidebar",
    toggle_chat: "Toggle Chat",
    app: "Agentero",
    file: "File",
    edit: "Edit",
    view: "View",
    window: "Window",
};

const ZH_CN: MenuLabels = MenuLabels {
    settings: "设置…",
    new_window: "新建窗口",
    open_vault: "打开知识库…",
    create_vault: "创建知识库…",
    refresh_tree: "刷新文件树",
    close: "关闭",
    toggle_sidebar: "切换侧边栏",
    toggle_chat: "切换对话",
    app: "Agentero",
    file: "文件",
    edit: "编辑",
    view: "视图",
    window: "窗口",
};

/// Return the menu label set for a locale, falling back to English.
pub fn menu_labels(lang: &str) -> &'static MenuLabels {
    match lang {
        "zh-CN" | "zh" => &ZH_CN,
        _ => &EN,
    }
}
