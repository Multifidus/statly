//! Sidecar manager for the Python statistics engine.
//!
//! The engine is spawned once and spoken to with JSON-RPC 2.0 over NDJSON on its
//! stdin/stdout (see docs/PROTOCOL.md). A writer thread owns stdin, a reader thread
//! owns stdout and routes responses to waiting callers by `id`.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;
use tokio::sync::oneshot;

/// Per-call timeout.
pub const CALL_TIMEOUT: Duration = Duration::from_secs(30);
/// How long to wait for a graceful exit (stdin EOF) before killing on shutdown.
const SHUTDOWN_GRACE: Duration = Duration::from_millis(1500);

#[cfg(windows)]
const ENGINE_EXE: &str = "statly-engine.exe";
#[cfg(not(windows))]
const ENGINE_EXE: &str = "statly-engine";

/// Path of the bundled engine relative to the Tauri resource directory.
#[cfg(windows)]
pub const BUNDLED_ENGINE_REL_PATH: &str = "resources/engine/statly-engine.exe";
#[cfg(not(windows))]
pub const BUNDLED_ENGINE_REL_PATH: &str = "resources/engine/statly-engine";

// ---------------------------------------------------------------------------
// Errors and status (serialized to the frontend)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EngineError {
    /// The engine executable could not be found or started.
    Spawn { message: String },
    /// The engine process exited (or its pipes closed) before answering.
    Exited { message: String },
    /// No response within the call timeout.
    Timeout { method: String, seconds: u64 },
    /// The engine answered with a JSON-RPC error object.
    Rpc {
        code: i64,
        message: String,
        data: Option<Value>,
    },
    /// The engine sent something that violates the protocol.
    Protocol { message: String },
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EngineError::Spawn { message } => write!(f, "engine spawn failed: {message}"),
            EngineError::Exited { message } => write!(f, "engine exited: {message}"),
            EngineError::Timeout { method, seconds } => {
                write!(f, "engine call `{method}` timed out after {seconds}s")
            }
            EngineError::Rpc { code, message, .. } => write!(f, "engine error {code}: {message}"),
            EngineError::Protocol { message } => write!(f, "engine protocol error: {message}"),
        }
    }
}

impl std::error::Error for EngineError {}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EngineState {
    NotStarted,
    Running,
    Exited,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LaunchSource {
    Env,
    Bundled,
    Dev,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineStatus {
    pub state: EngineState,
    pub source: Option<LaunchSource>,
    pub command: Option<String>,
    pub pid: Option<u32>,
    pub spawn_count: u32,
    pub last_error: Option<String>,
}

// ---------------------------------------------------------------------------
// Launch resolution
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct LaunchSpec {
    source: LaunchSource,
    program: PathBuf,
    args: Vec<String>,
    cwd: Option<PathBuf>,
}

impl LaunchSpec {
    fn describe(&self) -> String {
        let mut s = self.program.display().to_string();
        for a in &self.args {
            s.push(' ');
            s.push_str(a);
        }
        s
    }
}

/// Repo root, derived at compile time from this crate's location (app/src-tauri).
fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
}

/// Resolution order:
/// 1. `STATLY_ENGINE_CMD` (full command line; dev/testing).
/// 2. Bundled onedir executable under the Tauri resource dir (skipped when `STATLY_ENGINE_DEV=1`).
/// 3. Dev fallback: `<repo>/engine/.venv/bin/python -m statly_engine`, cwd `<repo>/engine`.
fn resolve_launch(bundled: Option<&Path>) -> Result<LaunchSpec, EngineError> {
    if let Ok(cmdline) = std::env::var("STATLY_ENGINE_CMD") {
        let cmdline = cmdline.trim();
        if !cmdline.is_empty() {
            let mut parts = shlex::split(cmdline).ok_or_else(|| EngineError::Spawn {
                message: format!("could not parse STATLY_ENGINE_CMD: {cmdline}"),
            })?;
            if parts.is_empty() {
                return Err(EngineError::Spawn {
                    message: "STATLY_ENGINE_CMD is empty".into(),
                });
            }
            let program = PathBuf::from(parts.remove(0));
            return Ok(LaunchSpec {
                source: LaunchSource::Env,
                program,
                args: parts,
                cwd: None,
            });
        }
    }

    let force_dev = std::env::var("STATLY_ENGINE_DEV").map(|v| v == "1").unwrap_or(false);
    if !force_dev {
        if let Some(exe) = bundled.filter(|p| p.is_file()) {
            return Ok(LaunchSpec {
                source: LaunchSource::Bundled,
                program: exe.to_path_buf(),
                args: vec![],
                cwd: exe.parent().map(Path::to_path_buf),
            });
        }
    }

    let engine_dir = repo_root().join("engine");
    #[cfg(windows)]
    let python = engine_dir.join(".venv").join("Scripts").join("python.exe");
    #[cfg(not(windows))]
    let python = engine_dir.join(".venv").join("bin").join("python");
    if python.is_file() {
        return Ok(LaunchSpec {
            source: LaunchSource::Dev,
            program: python,
            args: vec!["-m".into(), "statly_engine".into()],
            cwd: Some(engine_dir),
        });
    }

    Err(EngineError::Spawn {
        message: format!(
            "no engine found: STATLY_ENGINE_CMD unset, no bundled {ENGINE_EXE}, and no dev venv at {}",
            python.display()
        ),
    })
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

type Reply = Result<Value, EngineError>;

struct Pending {
    generation: u64,
    tx: oneshot::Sender<Reply>,
}

struct Shared {
    bundled: Option<PathBuf>,
    /// The live child process, if any.
    child: Mutex<Option<Child>>,
    /// Channel into the writer thread; dropping it closes the engine's stdin.
    writer: Mutex<Option<mpsc::Sender<String>>>,
    /// Bumped on every spawn so threads of a dead process never touch a newer one.
    generation: AtomicU64,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, Pending>>,
    status: Mutex<EngineStatus>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // A panicked holder must not wedge the app; the data is still usable.
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub struct EngineManager {
    shared: Arc<Shared>,
}

impl EngineManager {
    pub fn new(bundled: Option<PathBuf>) -> Self {
        Self {
            shared: Arc::new(Shared {
                bundled,
                child: Mutex::new(None),
                writer: Mutex::new(None),
                generation: AtomicU64::new(0),
                next_id: AtomicU64::new(1),
                pending: Mutex::new(HashMap::new()),
                status: Mutex::new(EngineStatus {
                    state: EngineState::NotStarted,
                    source: None,
                    command: None,
                    pid: None,
                    spawn_count: 0,
                    last_error: None,
                }),
            }),
        }
    }

    /// Spawn at app setup. Errors are recorded in status rather than aborting startup.
    pub fn start(&self) {
        if let Err(e) = self.ensure_running() {
            eprintln!("[statly] engine start failed: {e}");
        }
    }

    pub fn status(&self) -> EngineStatus {
        lock(&self.shared.status).clone()
    }

    /// Returns the current generation, spawning the engine if it is not alive.
    fn ensure_running(&self) -> Result<u64, EngineError> {
        let sh = &self.shared;
        let mut child_slot = lock(&sh.child);
        if let Some(child) = child_slot.as_mut() {
            match child.try_wait() {
                Ok(None) => return Ok(sh.generation.load(Ordering::SeqCst)),
                Ok(Some(code)) => eprintln!("[statly] engine had exited ({code}); respawning"),
                Err(e) => eprintln!("[statly] engine try_wait failed ({e}); respawning"),
            }
            let _ = child.kill();
            let _ = child.wait();
            *child_slot = None;
            lock(&sh.writer).take();
        }

        let spec = match resolve_launch(sh.bundled.as_deref()) {
            Ok(s) => s,
            Err(e) => {
                let mut st = lock(&sh.status);
                st.state = EngineState::Failed;
                st.last_error = Some(e.to_string());
                return Err(e);
            }
        };

        let mut cmd = Command::new(&spec.program);
        cmd.args(&spec.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            // Keep engine output unbuffered/UTF-8 when running from source.
            .env("PYTHONUNBUFFERED", "1")
            .env("PYTHONIOENCODING", "utf-8");
        if let Some(cwd) = &spec.cwd {
            cmd.current_dir(cwd);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let err = EngineError::Spawn {
                    message: format!("{}: {e}", spec.describe()),
                };
                let mut st = lock(&sh.status);
                st.state = EngineState::Failed;
                st.source = Some(spec.source);
                st.command = Some(spec.describe());
                st.last_error = Some(err.to_string());
                return Err(err);
            }
        };

        let generation = sh.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let stdin = child.stdin.take().expect("stdin piped");
        let stdout = child.stdout.take().expect("stdout piped");
        let pid = child.id();

        // Writer thread: serializes all writes to stdin. Ends (closing stdin) when
        // every Sender is dropped or a write fails.
        let (tx, rx) = mpsc::channel::<String>();
        thread::Builder::new()
            .name(format!("engine-writer-{generation}"))
            .spawn(move || {
                let mut stdin = stdin;
                for line in rx {
                    if stdin
                        .write_all(line.as_bytes())
                        .and_then(|_| stdin.write_all(b"\n"))
                        .and_then(|_| stdin.flush())
                        .is_err()
                    {
                        break;
                    }
                }
            })
            .map_err(|e| EngineError::Spawn {
                message: format!("writer thread: {e}"),
            })?;

        // Reader thread: routes responses by id until stdout closes.
        let shared = Arc::clone(sh);
        thread::Builder::new()
            .name(format!("engine-reader-{generation}"))
            .spawn(move || reader_loop(shared, stdout, generation))
            .map_err(|e| EngineError::Spawn {
                message: format!("reader thread: {e}"),
            })?;

        *child_slot = Some(child);
        *lock(&sh.writer) = Some(tx);
        {
            let mut st = lock(&sh.status);
            st.state = EngineState::Running;
            st.source = Some(spec.source);
            st.command = Some(spec.describe());
            st.pid = Some(pid);
            st.spawn_count += 1;
            st.last_error = None;
        }
        eprintln!(
            "[statly] engine spawned (pid {pid}, {:?}): {}",
            spec.source,
            spec.describe()
        );
        Ok(generation)
    }

    pub async fn call(&self, method: String, params: Value) -> Result<Value, EngineError> {
        let generation = self.ensure_running()?;
        let id = self.shared.next_id.fetch_add(1, Ordering::SeqCst);
        let frame = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let line = serde_json::to_string(&frame).map_err(|e| EngineError::Protocol {
            message: format!("could not encode request: {e}"),
        })?;

        let (tx, rx) = oneshot::channel();
        lock(&self.shared.pending).insert(id, Pending { generation, tx });

        let sent = lock(&self.shared.writer)
            .as_ref()
            .map(|w| w.send(line).is_ok())
            .unwrap_or(false);
        if !sent {
            lock(&self.shared.pending).remove(&id);
            return Err(EngineError::Exited {
                message: "engine stdin is closed".into(),
            });
        }

        match tokio::time::timeout(CALL_TIMEOUT, rx).await {
            Ok(Ok(reply)) => reply,
            Ok(Err(_)) => Err(EngineError::Exited {
                message: "engine dropped the request".into(),
            }),
            Err(_) => {
                lock(&self.shared.pending).remove(&id);
                Err(EngineError::Timeout {
                    method,
                    seconds: CALL_TIMEOUT.as_secs(),
                })
            }
        }
    }

    /// Graceful stop: close stdin (engine exits 0 on EOF), then kill after a grace period.
    pub fn shutdown(&self) {
        let sh = &self.shared;
        lock(&sh.writer).take();
        let mut slot = lock(&sh.child);
        if let Some(mut child) = slot.take() {
            let deadline = Instant::now() + SHUTDOWN_GRACE;
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) if Instant::now() < deadline => {
                        thread::sleep(Duration::from_millis(25))
                    }
                    _ => {
                        let _ = child.kill();
                        let _ = child.wait();
                        break;
                    }
                }
            }
            eprintln!("[statly] engine stopped");
        }
        lock(&sh.status).state = EngineState::Stopped;
    }
}

impl Drop for EngineManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn reader_loop(shared: Arc<Shared>, stdout: std::process::ChildStdout, generation: u64) {
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[statly] engine stdout read error: {e}");
                break;
            }
        };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let msg: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => {
                eprintln!("[statly] engine wrote non-protocol stdout: {line}");
                continue;
            }
        };
        let Some(id) = msg.get("id").and_then(Value::as_u64) else {
            // Notifications and id:null parse errors are ignored in Phase 0.
            eprintln!("[statly] engine message without usable id: {line}");
            continue;
        };
        let Some(pending) = lock(&shared.pending).remove(&id) else {
            // Late reply to a call that already timed out.
            continue;
        };
        let reply = if let Some(err) = msg.get("error") {
            Err(EngineError::Rpc {
                code: err.get("code").and_then(Value::as_i64).unwrap_or(-32000),
                message: err
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown engine error")
                    .to_string(),
                data: err.get("data").cloned(),
            })
        } else if let Some(result) = msg.get("result") {
            Ok(result.clone())
        } else {
            Err(EngineError::Protocol {
                message: format!("response {id} has neither result nor error"),
            })
        };
        let _ = pending.tx.send(reply);
    }

    // stdout closed: this generation is dead. Fail its in-flight calls.
    let failed: Vec<Pending> = {
        let mut map = lock(&shared.pending);
        let ids: Vec<u64> = map
            .iter()
            .filter(|(_, p)| p.generation == generation)
            .map(|(id, _)| *id)
            .collect();
        ids.into_iter().filter_map(|id| map.remove(&id)).collect()
    };
    for p in failed {
        let _ = p.tx.send(Err(EngineError::Exited {
            message: "engine closed its output before replying".into(),
        }));
    }
    if shared.generation.load(Ordering::SeqCst) == generation {
        let mut st = lock(&shared.status);
        if st.state == EngineState::Running {
            st.state = EngineState::Exited;
            st.pid = None;
            st.last_error = Some("engine process exited".into());
        }
    }
    eprintln!("[statly] engine reader {generation} finished");
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn engine_call(
    state: State<'_, EngineManager>,
    method: String,
    params: Option<Value>,
) -> Result<Value, EngineError> {
    let params = match params {
        None | Some(Value::Null) => json!({}),
        Some(p) => p,
    };
    state.call(method, params).await
}

#[tauri::command]
pub fn engine_status(state: State<'_, EngineManager>) -> EngineStatus {
    state.status()
}
