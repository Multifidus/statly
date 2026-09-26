mod engine;

use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager, RunEvent};

/// Forces the app to exit (used after the frontend's unsaved-changes guard clears the
/// user's Cmd+Q / menu Quit request). Runs the same `RunEvent::Exit` shutdown path as any
/// other exit, so the engine subprocess is still stopped.
#[tauri::command]
fn quit(handle: AppHandle) {
    handle.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // File pickers for import/open/save. Paths the user picks are added to the fs
        // scope by the dialog plugin; the capability grants no static fs scope.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let bundled = app
                .path()
                .resolve(engine::BUNDLED_ENGINE_REL_PATH, BaseDirectory::Resource)
                .ok();
            let manager = engine::EngineManager::new(bundled);
            // Spawn once at startup; failures are recorded in status and surfaced to the UI.
            manager.start();
            app.manage(manager);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine::engine_call,
            engine::engine_status,
            quit
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        match event {
            RunEvent::Exit => {
                if let Some(manager) = handle.try_state::<engine::EngineManager>() {
                    manager.shutdown();
                }
            }
            // macOS Cmd+Q / menu Quit (and OS session end) land here instead of the
            // window's close-requested event. Block the immediate exit and hand off to
            // the frontend's unsaved-changes guard, same as closing the window; the
            // frontend calls the `quit` command to actually exit once it's clear.
            RunEvent::ExitRequested { api, .. } => {
                api.prevent_exit();
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.emit("quit-requested", ());
                }
            }
            _ => {}
        }
    });
}
