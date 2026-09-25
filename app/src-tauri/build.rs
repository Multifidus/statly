use std::path::Path;

fn main() {
    // `resources/engine/` is populated by scripts/stage-engine.* and is gitignored.
    // Tauri refuses to build when a configured resource path is missing, so make sure
    // the directory exists (with a placeholder) for fresh clones and dev builds.
    let engine_dir = Path::new("resources/engine");
    if !engine_dir.exists() {
        std::fs::create_dir_all(engine_dir).expect("create resources/engine");
    }
    let keep = engine_dir.join(".keep");
    if !keep.exists() {
        std::fs::write(&keep, b"").expect("create resources/engine/.keep");
    }
    tauri_build::build()
}
