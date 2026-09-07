use std::{
    env, io::Write,
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug)]
struct RunningServer {
    child: std::process::Child,
    binary: String,
}

#[derive(Default)]
pub struct AppServerManager {
    inner: Arc<Mutex<Option<RunningServer>>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppServerStatus {
    running: bool,
    binary: Option<String>,
}

fn resolve_binary() -> Option<String> {
    if let Some(path) = env::var_os("WORKX_APP_SERVER_BIN") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path.to_string_lossy().into_owned());
        }
    }

    let fallback_name = if cfg!(windows) {
        "workx-app-server.exe"
    } else {
        "workx-app-server"
    };

    env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| env::split_paths(&paths).collect::<Vec<_>>())
        .map(|dir| dir.join(fallback_name))
        .find(|candidate| candidate.is_file())
        .map(|path| path.to_string_lossy().into_owned())
}

impl AppServerManager {
    /// Kills the child process when the desktop app exits.
    pub fn shutdown(&self) {
        let Ok(mut guard) = self.inner.lock() else {
            return;
        };

        if let Some(mut server) = guard.take() {
            let _ = server.child.kill();
            let _ = server.child.wait();
        }
    }
}

#[tauri::command]
pub fn app_server_start(
    app: AppHandle,
    state: State<'_, AppServerManager>,
) -> Result<AppServerStatus, String> {
    let mut guard = state.inner.lock().map_err(|_| "app server lock poisoned".to_string())?;

    if let Some(server) = guard.as_ref() {
        return Ok(AppServerStatus {
            running: true,
            binary: Some(server.binary.clone()),
        });
    }

    let binary = resolve_binary().ok_or_else(|| {
        format!(
            "Workx app server binary not found. Build it with `cargo build -p workx-app-server` and set WORKX_APP_SERVER_BIN to the resulting executable, or add it to PATH."
        )
    })?;

    let mut child = Command::new(&binary)
        .args(["--listen", "stdio://", "--session-source", "vscode"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to start {binary}: {err}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "missing app-server stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "missing app-server stderr".to_string())?;

    *guard = Some(RunningServer {
        child,
        binary: binary.clone(),
    });

    spawn_stdout_reader(app.clone(), stdout);
    spawn_stderr_reader(app.clone(), stderr);
    spawn_exit_monitor(app, state.inner.clone());

    Ok(AppServerStatus {
        running: true,
        binary: Some(binary),
    })
}

#[tauri::command]
pub fn app_server_stop(
    app: AppHandle,
    state: State<'_, AppServerManager>,
) -> Result<AppServerStatus, String> {
    let mut guard = state.inner.lock().map_err(|_| "app server lock poisoned".to_string())?;

    if let Some(mut server) = guard.take() {
        let _ = server.child.kill();
        let _ = server.child.wait();
        let _ = app.emit("app-server://exit", serde_json::json!({ "code": None::<i32> }));
    }

    Ok(AppServerStatus {
        running: false,
        binary: None,
    })
}

#[tauri::command]
pub fn app_server_status(
    state: State<'_, AppServerManager>,
) -> Result<AppServerStatus, String> {
    let guard = state.inner.lock().map_err(|_| "app server lock poisoned".to_string())?;
    let binary = guard.as_ref().map(|server| server.binary.clone());
    Ok(AppServerStatus {
        running: guard.is_some(),
        binary,
    })
}

#[tauri::command]
pub fn app_server_write(
    state: State<'_, AppServerManager>,
    payload: String,
) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|_| "app server lock poisoned".to_string())?;
    let server = guard
        .as_mut()
        .ok_or_else(|| "app server is not running".to_string())?;

    let stdin = server
        .child
        .stdin
        .as_mut()
        .ok_or_else(|| "app-server stdin is not available".to_string())?;

    stdin
        .write_all(payload.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|err| format!("failed to write to app-server: {err}"))
}

fn spawn_stdout_reader(app: AppHandle, stdout: std::process::ChildStdout) {
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            let _ = app.emit("app-server://message", line);
        }
    });
}

fn spawn_stderr_reader(app: AppHandle, stderr: std::process::ChildStderr) {
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            let _ = app.emit("app-server://stderr", line);
        }
    });
}

fn spawn_exit_monitor(app: AppHandle, inner: Arc<Mutex<Option<RunningServer>>>) {
    thread::spawn(move || loop {
        let exited = {
            let mut guard = match inner.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };

            let Some(server) = guard.as_mut() else {
                return;
            };

            match server.child.try_wait() {
                Ok(Some(status)) => {
                    let code = status.code();
                    *guard = None;
                    Some(code)
                }
                Ok(None) => None,
                Err(_) => {
                    *guard = None;
                    Some(None)
                }
            }
        };

        if let Some(code) = exited {
            let _ = app.emit("app-server://exit", serde_json::json!({ "code": code }));
            return;
        }

        thread::sleep(Duration::from_millis(200));
    });
}
