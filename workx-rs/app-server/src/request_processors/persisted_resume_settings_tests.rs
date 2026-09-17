use super::PersistedResumeSettings;
use super::latest_persisted_resume_settings;
use pretty_assertions::assert_eq;
use workx_protocol::config_types::ApprovalsReviewer;
use workx_protocol::config_types::CollaborationMode;
use workx_protocol::config_types::ModeKind;
use workx_protocol::config_types::Settings;
use workx_protocol::models::ActivePermissionProfile;
use workx_protocol::models::PermissionProfile;
use workx_protocol::protocol::AskForApproval;
use workx_protocol::protocol::EventMsg;
use workx_protocol::protocol::SandboxPolicy;
use workx_protocol::protocol::ThreadSettingsAppliedEvent;
use workx_protocol::protocol::ThreadSettingsSnapshot;
use workx_protocol::protocol::TurnContextItem;
use workx_rollout::RolloutItem;
use workx_utils_absolute_path::AbsolutePathBuf;

fn cwd() -> AbsolutePathBuf {
    AbsolutePathBuf::try_from(std::env::current_dir().expect("current directory"))
        .expect("absolute current directory")
}

fn settings_item(
    approval_policy: AskForApproval,
    approvals_reviewer: ApprovalsReviewer,
    active_permission_profile: Option<ActivePermissionProfile>,
) -> RolloutItem {
    RolloutItem::EventMsg(EventMsg::ThreadSettingsApplied(
        ThreadSettingsAppliedEvent {
            thread_id: None,
            thread_settings: ThreadSettingsSnapshot {
                model: "gpt-5".to_string(),
                model_provider_id: "openai".to_string(),
                service_tier: None,
                approval_policy,
                approvals_reviewer,
                permission_profile: PermissionProfile::read_only(),
                active_permission_profile,
                cwd: cwd(),
                reasoning_effort: None,
                reasoning_summary: None,
                personality: None,
                collaboration_mode: CollaborationMode {
                    mode: ModeKind::Default,
                    settings: Settings {
                        model: "gpt-5".to_string(),
                        reasoning_effort: None,
                        developer_instructions: None,
                    },
                },
            },
        },
    ))
}

fn turn_context_item(
    turn_id: &str,
    approval_policy: AskForApproval,
    approvals_reviewer: Option<ApprovalsReviewer>,
    active_permission_profile: Option<ActivePermissionProfile>,
) -> RolloutItem {
    RolloutItem::TurnContext(TurnContextItem {
        turn_id: Some(turn_id.to_string()),
        root_turn_id: None,
        cwd: cwd(),
        workspace_roots: Some(vec![cwd()]),
        current_date: None,
        timezone: None,
        approval_policy,
        approvals_reviewer,
        sandbox_policy: SandboxPolicy::new_read_only_policy(),
        permission_profile: Some(PermissionProfile::read_only()),
        active_permission_profile,
        network: None,
        file_system_sandbox_policy: None,
        model: "gpt-5".to_string(),
        model_provider_id: None,
        comp_hash: None,
        personality: None,
        collaboration_mode: None,
        multi_agent_version: None,
        multi_agent_mode: None,
        realtime_active: None,
        cyber_access_program: None,
        effort: None,
        summary: workx_protocol::config_types::ReasoningSummary::Auto,
    })
}

#[test]
fn latest_settings_snapshot_wins() {
    let expected = PersistedResumeSettings {
        approval_policy: AskForApproval::OnRequest,
        approvals_reviewer: Some(ApprovalsReviewer::AutoReview),
        active_permission_profile: Some(ActivePermissionProfile::new("dev")),
    };
    let history = vec![
        settings_item(
            AskForApproval::Never,
            ApprovalsReviewer::User,
            /*active_permission_profile*/ None,
        ),
        settings_item(
            AskForApproval::OnRequest,
            ApprovalsReviewer::AutoReview,
            Some(ActivePermissionProfile::new("dev")),
        ),
    ];

    assert_eq!(latest_persisted_resume_settings(&history), Some(expected));
}

#[test]
fn latest_turn_context_wins_over_earlier_settings_update() {
    let expected = PersistedResumeSettings {
        approval_policy: AskForApproval::UnlessTrusted,
        approvals_reviewer: Some(ApprovalsReviewer::User),
        active_permission_profile: Some(ActivePermissionProfile::read_only()),
    };
    let history = vec![
        settings_item(
            AskForApproval::Never,
            ApprovalsReviewer::AutoReview,
            Some(ActivePermissionProfile::new("dev")),
        ),
        turn_context_item(
            "turn-2",
            AskForApproval::UnlessTrusted,
            Some(ApprovalsReviewer::User),
            Some(ActivePermissionProfile::read_only()),
        ),
    ];

    assert_eq!(latest_persisted_resume_settings(&history), Some(expected));
}

#[test]
fn older_reviewer_is_used_when_latest_turn_context_omits_it() {
    let history = vec![
        turn_context_item(
            "turn-1",
            AskForApproval::Never,
            Some(ApprovalsReviewer::AutoReview),
            /*active_permission_profile*/ None,
        ),
        turn_context_item(
            "turn-2",
            AskForApproval::OnRequest,
            /*approvals_reviewer*/ None,
            /*active_permission_profile*/ None,
        ),
    ];

    assert_eq!(
        latest_persisted_resume_settings(&history),
        Some(PersistedResumeSettings {
            approval_policy: AskForApproval::OnRequest,
            approvals_reviewer: Some(ApprovalsReviewer::AutoReview),
            active_permission_profile: None,
        })
    );
}
