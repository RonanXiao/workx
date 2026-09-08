use crate::RewriteProfile;

/// Static source metadata for Codex (the product this distribution was forked from).
///
/// Workx shares Codex's rollout and config formats, so Codex migration only offers
/// chat-session imports; everything else already has the Workx shape.
pub struct CodSource;

impl CodSource {
    pub const CONFIG_DIR: &'static str = ".codex";
    pub const MIGRATION_SOURCE: &'static str = "codex";
    /// Unused placeholder so `settings_file_name` stays coherent. Codex's own
    /// `config.toml` is never read as JSON settings during detection.
    pub const SETTINGS_FILE: &'static str = "config.json";
    pub const REWRITE_PROFILE: RewriteProfile = RewriteProfile::new("", &[]);
}
