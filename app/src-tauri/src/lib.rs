mod engine;

use tauri::{path::BaseDirectory, Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
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
            engine::engine_status
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(manager) = handle.try_state::<engine::EngineManager>() {
                manager.shutdown();
            }
        }
    });
}
