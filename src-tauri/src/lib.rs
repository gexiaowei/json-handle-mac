use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const SEARCH_SHORTCUT: &str = "CmdOrCtrl+F";
const FOCUS_SEARCH_SCRIPT: &str =
    "window.dispatchEvent(new CustomEvent('json-handle-focus-string-search'))";

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://github.com/gexiaowei/json-handle-mac/releases")
        || url == "https://github.com/gexiaowei/json-handle-mac")
    {
        return Err("Blocked unsupported external URL".into());
    }

    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).status();

    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("cmd")
        .args(["/C", "start", "", &url])
        .status();

    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg(&url).status();

    result
        .map_err(|error| format!("Failed to open URL: {error}"))
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err(format!("Open URL command exited with {status}"))
            }
        })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }

                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("menu-action", "edit_search");
                        let _ = window.eval(FOCUS_SEARCH_SCRIPT);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![open_external_url])
        .setup(|app| {
            let menu = build_menu(&app.handle())?;
            app.set_menu(menu)?;
            if let Some(window) = app.get_webview_window("main") {
                if window.is_focused().unwrap_or(true) {
                    let _ = app.global_shortcut().register(SEARCH_SHORTCUT);
                }
                let window_for_focus = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(focused) = event {
                        if *focused {
                            let _ = window_for_focus
                                .app_handle()
                                .global_shortcut()
                                .register(SEARCH_SHORTCUT);
                        } else {
                            let _ = window_for_focus
                                .app_handle()
                                .global_shortcut()
                                .unregister(SEARCH_SHORTCUT);
                        }
                    }
                });
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().0.clone();
            if let Some(window) = app.get_webview_window("main") {
                if id == "edit_search" {
                    let _ = window.eval(FOCUS_SEARCH_SCRIPT);
                }
                let _ = window.emit("menu-action", id);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn build_menu(app: &tauri::AppHandle<Wry>) -> tauri::Result<Menu<Wry>> {
    let app_sub = Submenu::new(app, "JSON Handle", true)?;
    let about_item = MenuItem::with_id(app, "app_about", "About JSON Handle", true, None::<&str>)?;
    let check_updates_item =
        MenuItem::with_id(app, "app_check_updates", "Check for Updates...", true, None::<&str>)?;
    let settings_item =
        MenuItem::with_id(app, "app_settings", "Settings...", true, Some("CmdOrCtrl+,"))?;
    app_sub.append(&about_item)?;
    app_sub.append(&PredefinedMenuItem::separator(app)?)?;
    app_sub.append(&check_updates_item)?;
    app_sub.append(&PredefinedMenuItem::separator(app)?)?;
    app_sub.append(&settings_item)?;
    app_sub.append(&PredefinedMenuItem::separator(app)?)?;
    app_sub.append(&PredefinedMenuItem::quit(app, Some("Quit JSON Handle"))?)?;

    let file_open = MenuItem::with_id(app, "file_open", "Open", true, Some("CmdOrCtrl+O"))?;
    let file_save = MenuItem::with_id(app, "file_save", "Save", true, Some("CmdOrCtrl+S"))?;
    let file_sub = Submenu::new(app, "File", true)?;
    file_sub.append(&file_open)?;
    file_sub.append(&file_save)?;

    let edit_search =
        MenuItem::with_id(app, "edit_search", "Search Strings", true, Some("CmdOrCtrl+F"))?;
    let edit_format = MenuItem::with_id(
        app,
        "edit_format",
        "Format",
        true,
        Some("CmdOrCtrl+Shift+F"),
    )?;
    let edit_minify = MenuItem::with_id(
        app,
        "edit_minify",
        "Minify",
        true,
        Some("CmdOrCtrl+Shift+M"),
    )?;
    let edit_validate = MenuItem::with_id(
        app,
        "edit_validate",
        "Validate",
        true,
        Some("CmdOrCtrl+Shift+V"),
    )?;
    let edit_sub = Submenu::new(app, "Edit", true)?;
    edit_sub.append(&edit_search)?;
    edit_sub.append(&PredefinedMenuItem::separator(app)?)?;
    edit_sub.append(&edit_format)?;
    edit_sub.append(&edit_minify)?;
    edit_sub.append(&edit_validate)?;
    edit_sub.append(&PredefinedMenuItem::separator(app)?)?;
    edit_sub.append(&PredefinedMenuItem::select_all(app, Some("Select All"))?)?;
    edit_sub.append(&PredefinedMenuItem::copy(app, Some("Copy"))?)?;
    edit_sub.append(&PredefinedMenuItem::paste(app, Some("Paste"))?)?;

    let view_expand = MenuItem::with_id(
        app,
        "view_expand",
        "Expand All",
        true,
        Some("CmdOrCtrl+Shift+]"),
    )?;
    let view_collapse = MenuItem::with_id(
        app,
        "view_collapse",
        "Collapse All",
        true,
        Some("CmdOrCtrl+Shift+["),
    )?;
    let view_sub = Submenu::new(app, "View", true)?;
    view_sub.append(&view_expand)?;
    view_sub.append(&view_collapse)?;

    let menu = Menu::new(app)?;
    menu.append(&app_sub)?;
    menu.append(&file_sub)?;
    menu.append(&edit_sub)?;
    menu.append(&view_sub)?;

    Ok(menu)
}
