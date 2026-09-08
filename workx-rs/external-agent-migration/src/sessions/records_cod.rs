//! Parsing helpers for Codex rollout histories.
//!
//! Codex stores each chat run as a JSONL rollout whose records mirror Workx rollout
//! records: `session_meta`, `turn_context`, `event_msg`, and `response_item` lines.
//! Typed user messages appear as `event_msg` records with payload type
//! `user_message`, and assistant text as `event_msg` records with payload type
//! `agent_message`, so imports only need those two record kinds plus `session_meta`
//! for the working directory.

use super::ConversationMessage;
use super::ExternalAgentSessionMigration;
use super::MessageRole;
use super::ParsedSessionImport;
use super::SessionSummary;
use super::records_common::parse_timestamp;
use super::title::IMPORTED_SESSION_FALLBACK_TITLE;
use super::title::SessionTitleCandidates;
use super::title::fallback_title_from_user_message;
use serde_json::Value as JsonValue;
use sha2::Digest;
use sha2::Sha256;
use std::fs;
use std::io;
use std::path::Path;
use std::path::PathBuf;

/// Fields collected while scanning one rollout file.
struct RolloutScan {
    cwd: Option<PathBuf>,
    messages: Vec<ConversationMessage>,
    saw_user_message: bool,
    fallback_title: Option<String>,
    latest_timestamp: Option<i64>,
}

impl RolloutScan {
    fn handle_line(&mut self, line: &str) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return;
        }
        let Ok(record) = serde_json::from_str::<JsonValue>(trimmed) else {
            return;
        };
        let Some(record_type) = record.get("type").and_then(JsonValue::as_str) else {
            return;
        };
        if record_type == "session_meta" && self.cwd.is_none() {
            self.cwd = record
                .get("payload")
                .and_then(|payload| payload.get("cwd"))
                .and_then(JsonValue::as_str)
                .map(PathBuf::from);
            return;
        }
        if record_type != "event_msg" {
            return;
        }
        let Some(payload) = record.get("payload") else {
            return;
        };
        let Some(payload_type) = payload.get("type").and_then(JsonValue::as_str) else {
            return;
        };
        let role = match payload_type {
            "user_message" => MessageRole::User,
            "agent_message" => MessageRole::Assistant,
            _ => return,
        };
        let Some(text) = payload.get("message").and_then(JsonValue::as_str) else {
            return;
        };
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        let timestamp = record
            .get("timestamp")
            .and_then(JsonValue::as_str)
            .and_then(parse_timestamp);
        if role == MessageRole::User {
            self.saw_user_message = true;
            if self.fallback_title.is_none() {
                self.fallback_title = fallback_title_from_user_message(text);
            }
        }
        if let Some(timestamp) = timestamp {
            self.latest_timestamp = Some(
                self.latest_timestamp
                    .map_or(timestamp, |current| current.max(timestamp)),
            );
        }
        self.messages.push(ConversationMessage {
            role,
            text: text.to_string(),
            timestamp,
        });
    }
}

fn new_scan() -> RolloutScan {
    RolloutScan {
        cwd: None,
        messages: Vec::new(),
        saw_user_message: false,
        fallback_title: None,
        latest_timestamp: None,
    }
}

fn scan_lines(path: &Path, scan: &mut RolloutScan) -> io::Result<()> {
    let raw = fs::read_to_string(path)?;
    for line in raw.lines() {
        scan.handle_line(line);
    }
    Ok(())
}

pub fn summarize_session(path: &Path) -> io::Result<Option<SessionSummary>> {
    let mut scan = new_scan();
    scan_lines(path, &mut scan)?;
    let Some(cwd) = scan.cwd else {
        return Ok(None);
    };
    if scan.messages.is_empty() {
        return Ok(None);
    }
    let Some(latest_timestamp) = scan.latest_timestamp else {
        return Ok(None);
    };
    Ok(Some(SessionSummary {
        latest_timestamp,
        migration: ExternalAgentSessionMigration {
            path: path.to_path_buf(),
            cwd,
            title: SessionTitleCandidates {
                custom_title: None,
                ai_title: None,
                fallback_title: scan.fallback_title.or_else(|| {
                    scan.saw_user_message
                        .then(|| IMPORTED_SESSION_FALLBACK_TITLE.to_string())
                }),
            }
            .select(),
        },
    }))
}

pub(super) fn read_session_import(path: &Path) -> io::Result<ParsedSessionImport> {
    let raw = fs::read_to_string(path)?;
    let mut scan = new_scan();
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    for line in raw.lines() {
        scan.handle_line(line);
    }
    let content_sha256 = format!("{:x}", hasher.finalize());
    Ok(ParsedSessionImport {
        cwd: scan.cwd,
        custom_title: None,
        ai_title: None,
        messages: scan.messages,
        content_sha256,
        attributed_mcp_server_ids: Default::default(),
    })
}

#[cfg(test)]
#[path = "records_cod_tests.rs"]
mod tests;
