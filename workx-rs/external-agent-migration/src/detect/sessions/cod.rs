use super::common::SessionFileCandidate;
use super::common::detect_recent_sessions;
use crate::model::ExternalAgentSessionImportLimits;
use crate::sessions::ExternalAgentSessionMigration;
use crate::sessions::SessionRecordFormat;
use std::fs;
use std::io;
use std::path::Path;

/// Recursively collect `rollout-*.jsonl` files under the given directory.
fn rollout_candidates(root: &Path) -> io::Result<Vec<SessionFileCandidate>> {
    let mut candidates = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries {
            let Ok(entry) = entry else {
                continue;
            };
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
                continue;
            }
            let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if file_name.starts_with("rollout-") && file_name.ends_with(".jsonl") {
                candidates.push(SessionFileCandidate {
                    path,
                    fallback_cwd: None,
                    record_format: SessionRecordFormat::Cod,
                });
            }
        }
    }
    Ok(candidates)
}

pub fn detect_recent_cod_sessions(
    external_agent_home: &Path,
    workx_home: &Path,
) -> io::Result<Vec<ExternalAgentSessionMigration>> {
    detect_recent_cod_sessions_with_limits(
        external_agent_home,
        workx_home,
        ExternalAgentSessionImportLimits::default(),
    )
}

pub(crate) fn detect_recent_cod_sessions_with_limits(
    external_agent_home: &Path,
    workx_home: &Path,
    limits: ExternalAgentSessionImportLimits,
) -> io::Result<Vec<ExternalAgentSessionMigration>> {
    let sessions_root = external_agent_home.join("sessions");
    if !sessions_root.is_dir() {
        return Ok(Vec::new());
    }
    let candidates = rollout_candidates(&sessions_root)?;
    detect_recent_sessions(
        workx_home, candidates, /*require_existing_cwd*/ true, limits,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions::ledger::record_imported_session;
    use serde_json::Value as JsonValue;
    use std::fs;
    use std::io::Write;
    use std::path::Path;
    use tempfile::TempDir;
    use workx_protocol::ThreadId;

    fn rollout_line(record_type: &str, payload: JsonValue, timestamp: &str) -> String {
        format!("{{\"type\":{record_type:?},\"timestamp\":{timestamp:?},\"payload\":{payload}}}\n")
    }

    fn session_meta(cwd: &Path) -> String {
        rollout_line(
            "session_meta",
            serde_json::json!({ "cwd": cwd, "id": "019b460b-c6b1-7511-be4c-04b4185a2c40" }),
            "2025-12-22T20:32:15.000Z",
        )
    }

    fn event_msg(payload_type: &str, message: &str, timestamp: &str) -> String {
        rollout_line(
            "event_msg",
            serde_json::json!({ "type": payload_type, "message": message }),
            timestamp,
        )
    }

    #[test]
    fn detects_recent_rollout_sessions_with_existing_roots() {
        let root = TempDir::new().expect("tempdir");
        let external_agent_home = root.path().join(".codex");
        let project_root = root.path().join("repo");
        fs::create_dir_all(&project_root).expect("repo dir");
        let day_dir = external_agent_home
            .join("sessions")
            .join("2026")
            .join("09")
            .join("08");
        fs::create_dir_all(&day_dir).expect("session dir");
        let session_path =
            day_dir.join("rollout-2026-09-08T00-00-00-019b460b-c6b1-7511-be4c-04b4185a2c40.jsonl");
        let mut file = fs::File::create(&session_path).expect("session file");
        writeln!(file, "{}", session_meta(&project_root)).expect("meta");
        writeln!(
            file,
            "{}",
            event_msg(
                "user_message",
                "import this codex chat",
                "2026-09-08T00:00:01.000Z"
            )
        )
        .expect("user message");
        writeln!(
            file,
            "{}",
            event_msg("agent_message", "sure", "2026-09-08T00:00:02.000Z")
        )
        .expect("agent message");

        let sessions =
            detect_recent_cod_sessions(&external_agent_home, root.path()).expect("detect");

        assert_eq!(
            sessions,
            vec![ExternalAgentSessionMigration {
                path: session_path,
                cwd: project_root,
                title: Some("import this codex chat".to_string()),
            }]
        );
    }

    #[test]
    fn skips_sessions_already_imported_from_the_same_source_file() {
        let root = TempDir::new().expect("tempdir");
        let external_agent_home = root.path().join(".codex");
        let project_root = root.path().join("repo");
        fs::create_dir_all(&project_root).expect("repo dir");
        let day_dir = external_agent_home
            .join("sessions")
            .join("2026")
            .join("09")
            .join("08");
        fs::create_dir_all(&day_dir).expect("session dir");
        let session_path =
            day_dir.join("rollout-2026-09-08T00-00-00-019b460b-c6b1-7511-be4c-04b4185a2c40.jsonl");
        let mut file = fs::File::create(&session_path).expect("session file");
        writeln!(file, "{}", session_meta(&project_root)).expect("meta");
        writeln!(
            file,
            "{}",
            event_msg("user_message", "hi", "2026-09-08T00:00:01.000Z")
        )
        .expect("user message");
        let source_path = fs::canonicalize(&session_path).expect("canonical");
        record_imported_session(root.path(), &source_path, ThreadId::new()).expect("record import");

        let sessions =
            detect_recent_cod_sessions(&external_agent_home, root.path()).expect("detect");

        assert!(sessions.is_empty());
    }
}
