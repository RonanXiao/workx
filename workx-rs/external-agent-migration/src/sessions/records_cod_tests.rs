use super::*;
use pretty_assertions::assert_eq;
use tempfile::TempDir;

fn rollout_line(record_type: &str, timestamp: &str, payload: JsonValue) -> String {
    serde_json::json!({
        "type": record_type,
        "timestamp": timestamp,
        "payload": payload,
    })
    .to_string()
}

fn rollout(cwd: &Path, user_messages: &[&str], assistant_messages: &[&str]) -> String {
    let mut lines = vec![rollout_line(
        "session_meta",
        "2026-06-03T12:00:00Z",
        serde_json::json!({
            "cwd": cwd,
            "id": "019b460b-c6b1-7511-be4c-04b4185a2c40",
            "originator": "Codex Desktop",
        }),
    )];
    for (index, text) in user_messages.iter().enumerate() {
        lines.push(rollout_line(
            "event_msg",
            &format!("2026-06-03T12:00:{index:02}Z"),
            serde_json::json!({ "type": "user_message", "message": text }),
        ));
    }
    for (index, text) in assistant_messages.iter().enumerate() {
        lines.push(rollout_line(
            "event_msg",
            &format!("2026-06-03T12:01:{index:02}Z"),
            serde_json::json!({ "type": "agent_message", "message": text }),
        ));
    }
    lines.join("\n")
}

#[test]
fn reads_rollout_messages_and_summary_title() {
    let root = TempDir::new().expect("tempdir");
    let project_root = root.path().join("repo");
    std::fs::create_dir_all(&project_root).expect("repo dir");
    let path = root.path().join("rollout.jsonl");
    let contents = rollout(&project_root, &["first request"], &["first answer"]);
    std::fs::write(&path, &contents).expect("session");

    let parsed = read_session_import(&path).expect("parse session");

    assert_eq!(parsed.cwd.as_deref(), Some(project_root.as_path()));
    assert_eq!(parsed.custom_title, None);
    assert_eq!(parsed.ai_title, None);
    assert_eq!(parsed.messages.len(), 2);
    assert_eq!(parsed.messages[0].role, MessageRole::User);
    assert_eq!(parsed.messages[0].text, "first request");
    assert_eq!(parsed.messages[1].role, MessageRole::Assistant);
    assert_eq!(parsed.messages[1].text, "first answer");
    assert_eq!(
        parsed.content_sha256,
        format!("{:x}", Sha256::digest(contents))
    );

    let summary = summarize_session(&path)
        .expect("summarize")
        .expect("summary");
    assert_eq!(
        summary.migration,
        ExternalAgentSessionMigration {
            path,
            cwd: project_root,
            title: Some("first request".to_string()),
        }
    );
}

#[test]
fn ignores_injected_and_non_message_records() {
    let root = TempDir::new().expect("tempdir");
    let project_root = root.path().join("repo");
    std::fs::create_dir_all(&project_root).expect("repo dir");
    let path = root.path().join("rollout.jsonl");
    let mut lines = vec![
        rollout_line(
            "session_meta",
            "2026-06-03T12:00:00Z",
            serde_json::json!({ "cwd": project_root }),
        ),
        rollout_line(
            "response_item",
            "2026-06-03T12:00:00Z",
            serde_json::json!({
                "type": "message",
                "role": "developer",
                "content": [{"type": "input_text", "text": "system prompt"}],
            }),
        ),
        rollout_line(
            "event_msg",
            "2026-06-03T12:00:00Z",
            serde_json::json!({ "type": "task_started", "turn_id": "turn-1" }),
        ),
        rollout_line(
            "event_msg",
            "2026-06-03T12:00:01Z",
            serde_json::json!({ "type": "user_message", "message": "hello" }),
        ),
        rollout_line(
            "event_msg",
            "2026-06-03T12:00:02Z",
            serde_json::json!({ "type": "token_count", "info": null }),
        ),
        rollout_line(
            "event_msg",
            "2026-06-03T12:00:03Z",
            serde_json::json!({ "type": "agent_message", "message": "hi there" }),
        ),
    ];
    lines.push("not json".to_string());
    std::fs::write(&path, lines.join("\n")).expect("session");

    let parsed = read_session_import(&path).expect("parse session");

    assert_eq!(parsed.messages.len(), 2);
    assert_eq!(parsed.messages[0].text, "hello");
    assert_eq!(parsed.messages[1].text, "hi there");
}

#[test]
fn returns_none_without_cwd_or_messages() {
    let root = TempDir::new().expect("tempdir");
    let project_root = root.path().join("repo");
    std::fs::create_dir_all(&project_root).expect("repo dir");

    let no_cwd = root.path().join("no-cwd.jsonl");
    std::fs::write(
        &no_cwd,
        rollout_line(
            "event_msg",
            "2026-06-03T12:00:01Z",
            serde_json::json!({ "type": "user_message", "message": "hello" }),
        ),
    )
    .expect("session");
    assert!(summarize_session(&no_cwd).expect("summarize").is_none());

    let no_messages = root.path().join("no-messages.jsonl");
    std::fs::write(
        &no_messages,
        rollout_line(
            "session_meta",
            "2026-06-03T12:00:00Z",
            serde_json::json!({ "cwd": project_root }),
        ),
    )
    .expect("session");
    assert!(
        summarize_session(&no_messages)
            .expect("summarize")
            .is_none()
    );
}
