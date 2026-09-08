use super::codex_session_import_resume_target;
use pretty_assertions::assert_eq;
use workx_app_server_protocol::ExternalAgentConfigImportCompletedNotification;
use workx_app_server_protocol::ExternalAgentConfigImportItemTypeFailure;
use workx_app_server_protocol::ExternalAgentConfigImportItemTypeSuccess;
use workx_app_server_protocol::ExternalAgentConfigImportTypeResult;
use workx_app_server_protocol::ExternalAgentConfigMigrationItemType;

fn sessions_result(
    successes: Vec<ExternalAgentConfigImportItemTypeSuccess>,
) -> ExternalAgentConfigImportTypeResult {
    ExternalAgentConfigImportTypeResult {
        item_type: ExternalAgentConfigMigrationItemType::Sessions,
        successes,
        failures: Vec::<ExternalAgentConfigImportItemTypeFailure>::new(),
    }
}

fn notification(
    results: Vec<ExternalAgentConfigImportTypeResult>,
) -> ExternalAgentConfigImportCompletedNotification {
    ExternalAgentConfigImportCompletedNotification {
        import_id: "import-1".to_string(),
        item_type_results: results,
    }
}

#[test]
fn picks_first_imported_session_thread_as_resume_target() {
    let notification = notification(vec![sessions_result(vec![
        ExternalAgentConfigImportItemTypeSuccess {
            item_type: ExternalAgentConfigMigrationItemType::Sessions,
            cwd: None,
            source: Some("/home/user/.codex/sessions/rollout.jsonl".to_string()),
            target: Some("01a079b1-280e-7682-9338-44bb1267fddd".to_string()),
            title: Some("fix the relay".to_string()),
        },
        ExternalAgentConfigImportItemTypeSuccess {
            item_type: ExternalAgentConfigMigrationItemType::Sessions,
            cwd: None,
            source: Some("/home/user/.codex/sessions/rollout-2.jsonl".to_string()),
            target: Some("01a07990-0d98-7f30-b7e9-ac89aa2c7363".to_string()),
            title: Some("wire the agent".to_string()),
        },
    ])]);

    assert_eq!(
        codex_session_import_resume_target(&notification).as_deref(),
        Some("01a079b1-280e-7682-9338-44bb1267fddd")
    );
}

#[test]
fn ignores_failed_session_imports_and_other_item_types() {
    let notification = notification(vec![
        sessions_result(vec![ExternalAgentConfigImportItemTypeSuccess {
            item_type: ExternalAgentConfigMigrationItemType::Sessions,
            cwd: None,
            source: Some("/home/user/.codex/sessions/rollout.jsonl".to_string()),
            target: None,
            title: None,
        }]),
        ExternalAgentConfigImportTypeResult {
            item_type: ExternalAgentConfigMigrationItemType::Skills,
            successes: Vec::new(),
            failures: Vec::new(),
        },
    ]);

    assert_eq!(codex_session_import_resume_target(&notification), None);
}
