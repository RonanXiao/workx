use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use http::HeaderMap;
use tokio::time::timeout;
use workx_api::AgentIdentityTelemetry;
use workx_api::ModelsClient;
use workx_api::RequestTelemetry;
use workx_api::ReqwestTransport;
use workx_api::TransportError;
use workx_api::auth_header_telemetry;
use workx_api::map_api_error;
use workx_feedback::FeedbackRequestTags;
use workx_feedback::emit_feedback_request_tags_with_auth_env;
use workx_http_client::ClientRouteClass;
use workx_http_client::HttpClientFactory;
use workx_login::AuthEnvTelemetry;
use workx_login::AuthManager;
use workx_login::WorkxAuth;
use workx_login::collect_auth_env_telemetry;
use workx_login::default_client::create_client_for_route_async;
use workx_model_provider_info::ModelProviderInfo;
use workx_models_manager::manager::ModelsEndpointClient;
use workx_models_manager::manager::ModelsEndpointFuture;
use workx_otel::TelemetryAuthMode;
use workx_protocol::error::Result as CoreResult;
use workx_protocol::error::WorkxErr;
use workx_protocol::openai_models::CustomModelEntry;
use workx_protocol::openai_models::ModelInfo;
use workx_response_debug_context::extract_response_debug_context;
use workx_response_debug_context::telemetry_transport_error_message;

use crate::auth::agent_identity_telemetry;
use crate::auth::resolve_provider_auth;
use crate::provider::enforce_managed_residency;

const MODELS_REFRESH_TIMEOUT: Duration = Duration::from_secs(5);
const MODELS_ENDPOINT: &str = "/models";
/// 未配置 `models_endpoint` 时的默认目录路径，相对 `base_url` 追加。
const DEFAULT_MODELS_ENDPOINT: &str = "models";

/// 拼接模型目录地址，语义与 `Provider::url_for_path` 一致：endpoint 路径追加在
/// `base_url` 之后，`base_url` 自带的路径段始终保留。
///
/// `base_url` 是 API 根地址（例如 `https://host/zen/go/v1`），`models_endpoint` 是相对
/// 它的目录路径（例如 `/models`）。以 `/` 开头的 endpoint 只表示「相对 API 根」，不做
/// 同源绝对路径判定，因此不会丢掉 `base_url` 的路径前缀。传入完整 URL 时按原样使用。
pub(crate) fn join_models_endpoint(
    base_url: &str,
    endpoint: &str,
) -> Result<String, url::ParseError> {
    let trimmed = endpoint.trim();
    // 已经是完整 URL 时直接使用，避免把协议和主机重复拼进路径。
    if trimmed.contains("://") {
        return Ok(trimmed.to_string());
    }
    let mut base = url::Url::parse(base_url)?;
    let base_path = base.path().trim_end_matches('/');
    let endpoint_path = trimmed.trim_start_matches('/');
    // endpoint 一律追加在 base_url 路径之后，不做「同源绝对路径」判定。
    let joined = match (base_path.is_empty(), endpoint_path.is_empty()) {
        (_, true) => base_path.to_string(),
        (true, false) => format!("/{endpoint_path}"),
        (false, false) => format!("{base_path}/{endpoint_path}"),
    };
    base.set_path(&joined);
    Ok(base.to_string())
}

/// Provider-owned OpenAI-compatible `/models` endpoint.
#[derive(Debug)]
pub(crate) struct OpenAiModelsEndpoint {
    provider_info: ModelProviderInfo,
    auth_manager: Option<Arc<AuthManager>>,
    transport_builder: Arc<dyn ModelsTransportBuilder>,
}

impl OpenAiModelsEndpoint {
    pub(crate) fn new(
        provider_info: ModelProviderInfo,
        auth_manager: Option<Arc<AuthManager>>,
    ) -> Self {
        Self {
            provider_info,
            auth_manager,
            transport_builder: Arc::new(RouteAwareModelsTransportBuilder),
        }
    }

    async fn auth(&self) -> Option<WorkxAuth> {
        match self.auth_manager.as_ref() {
            Some(auth_manager) => auth_manager.auth().await,
            None => None,
        }
    }

    async fn uses_workx_backend(&self) -> bool {
        self.auth()
            .await
            .as_ref()
            .is_some_and(WorkxAuth::uses_workx_backend)
    }

    async fn list_models(
        &self,
        client_version: &str,
        http_client_factory: HttpClientFactory,
    ) -> CoreResult<(Vec<ModelInfo>, Option<String>)> {
        let _timer =
            workx_otel::start_global_timer("workx.remote_models.fetch_update.duration_ms", &[]);
        let auth = self.auth().await;
        let auth_mode = auth.as_ref().map(WorkxAuth::auth_mode);
        let mut api_provider = self.provider_info.to_api_provider(auth_mode)?;
        enforce_managed_residency(&mut api_provider);
        let api_auth = resolve_provider_auth(auth.as_ref(), &self.provider_info)?;
        let external = self.provider_info.uses_external_models();
        let request_url = if external {
            let endpoint = self
                .provider_info
                .models_endpoint
                .as_deref()
                .unwrap_or(DEFAULT_MODELS_ENDPOINT);
            join_models_endpoint(&api_provider.base_url, endpoint)
                .map_err(|err| WorkxErr::InvalidRequest(err.to_string()))?
        } else {
            ModelsClient::<ReqwestTransport>::request_url(&api_provider, client_version)
        };
        let auth_telemetry = auth_header_telemetry(api_auth.as_ref());
        let agent_identity_telemetry = if let Some(WorkxAuth::AgentIdentity(auth)) = auth.as_ref() {
            Some(agent_identity_telemetry(auth))
        } else {
            None
        };
        let request_telemetry: Arc<dyn RequestTelemetry> = Arc::new(ModelsRequestTelemetry {
            auth_mode: auth_mode.map(|mode| TelemetryAuthMode::from(mode).to_string()),
            auth_header_attached: auth_telemetry.attached,
            auth_header_name: auth_telemetry.name,
            agent_identity_telemetry,
            auth_env: self.auth_env(),
        });
        timeout(MODELS_REFRESH_TIMEOUT, async {
            let transport = self
                .transport_builder
                .build(http_client_factory, request_url.clone())
                .await?;
            let client = ModelsClient::new(transport, api_provider, api_auth)
                .with_telemetry(Some(request_telemetry));
            if !external {
                return client
                    .list_models(request_url, HeaderMap::new())
                    .await
                    .map_err(map_api_error);
            }
            let (body, etag) = client
                .list_catalog(request_url, HeaderMap::new())
                .await
                .map_err(map_api_error)?;
            if body.get("models").is_some() {
                let catalog: workx_protocol::openai_models::ModelsResponse =
                    serde_json::from_value(body).map_err(|err| {
                        WorkxErr::InvalidRequest(format!("Invalid model catalog: {err}"))
                    })?;
                return Ok((catalog.models, etag));
            }
            let entries = body["data"].as_array().ok_or_else(|| {
                WorkxErr::InvalidRequest("Model catalog must contain a data array".to_string())
            })?;
            let mut models = Vec::new();
            for entry in entries {
                let id = entry["id"]
                    .as_str()
                    .filter(|id| !id.trim().is_empty())
                    .ok_or_else(|| {
                        WorkxErr::InvalidRequest("Model catalog entry is missing id".to_string())
                    })?;
                if models.iter().any(|model: &ModelInfo| model.slug == id) {
                    continue;
                }
                let mut model = workx_models_manager::model_info::model_info_from_slug(id);
                model.visibility = workx_protocol::openai_models::ModelVisibility::List;
                model.supports_reasoning_summary_parameter = false;
                model.context_window = None;
                model.max_context_window = None;
                // OpenAI-style catalogs only carry IDs, so reasoning levels come from the
                // bundled catalog when it describes the slug.
                workx_models_manager::model_info::inherit_bundled_reasoning_levels(&mut model);
                model.used_fallback_model_metadata = false;
                models.push(model);
            }
            Ok((models, etag))
        })
        .await
        .map_err(|_| WorkxErr::Timeout)?
    }

    fn auth_env(&self) -> AuthEnvTelemetry {
        let workx_api_key_env_enabled = self
            .auth_manager
            .as_ref()
            .is_some_and(|auth_manager| auth_manager.workx_api_key_env_enabled());
        collect_auth_env_telemetry(&self.provider_info, workx_api_key_env_enabled)
    }
}

impl ModelsEndpointClient for OpenAiModelsEndpoint {
    fn is_authoritative(&self) -> bool {
        self.provider_info.uses_external_models()
    }

    fn custom_models(&self) -> Vec<CustomModelEntry> {
        self.provider_info.custom_models.clone()
    }

    fn supports_model_discovery(&self) -> bool {
        self.provider_info.uses_external_models()
            || self.provider_info.has_command_auth()
            || self.provider_info.env_key.is_some()
            || self.provider_info.experimental_bearer_token.is_some()
    }

    fn has_command_auth(&self) -> bool {
        self.provider_info.has_command_auth()
    }

    fn uses_workx_backend(&self) -> ModelsEndpointFuture<'_, bool> {
        Box::pin(OpenAiModelsEndpoint::uses_workx_backend(self))
    }

    fn list_models<'a>(
        &'a self,
        client_version: &'a str,
        http_client_factory: HttpClientFactory,
    ) -> ModelsEndpointFuture<'a, CoreResult<(Vec<ModelInfo>, Option<String>)>> {
        Box::pin(OpenAiModelsEndpoint::list_models(
            self,
            client_version,
            http_client_factory,
        ))
    }
}

type ModelsTransportFuture<'a> =
    Pin<Box<dyn Future<Output = std::io::Result<ReqwestTransport>> + Send + 'a>>;

/// Builds the concrete transport selected for one models request.
///
/// Implementations must honor the supplied request-time client factory and exact request URL.
trait ModelsTransportBuilder: fmt::Debug + Send + Sync {
    fn build(
        &self,
        http_client_factory: HttpClientFactory,
        request_url: String,
    ) -> ModelsTransportFuture<'_>;
}

#[derive(Debug)]
struct RouteAwareModelsTransportBuilder;

impl ModelsTransportBuilder for RouteAwareModelsTransportBuilder {
    fn build(
        &self,
        http_client_factory: HttpClientFactory,
        request_url: String,
    ) -> ModelsTransportFuture<'_> {
        Box::pin(async move {
            create_client_for_route_async(http_client_factory, request_url, ClientRouteClass::Api)
                .await
                .map(ReqwestTransport::from_http_client)
        })
    }
}

#[derive(Clone)]
struct ModelsRequestTelemetry {
    auth_mode: Option<String>,
    auth_header_attached: bool,
    auth_header_name: Option<&'static str>,
    agent_identity_telemetry: Option<AgentIdentityTelemetry>,
    auth_env: AuthEnvTelemetry,
}

impl RequestTelemetry for ModelsRequestTelemetry {
    fn on_request(
        &self,
        attempt: u64,
        status: Option<http::StatusCode>,
        error: Option<&TransportError>,
        duration: Duration,
    ) {
        let success = status.is_some_and(|code| code.is_success()) && error.is_none();
        let error_message = error.map(telemetry_transport_error_message);
        let response_debug = error
            .map(extract_response_debug_context)
            .unwrap_or_default();
        let status = status.map(|status| status.as_u16());
        tracing::event!(
            target: "workx_otel.log_only",
            tracing::Level::INFO,
            event.name = "workx.api_request",
            duration_ms = %duration.as_millis(),
            http.response.status_code = status,
            success = success,
            error.message = error_message.as_deref(),
            attempt = attempt,
            endpoint = MODELS_ENDPOINT,
            auth.header_attached = self.auth_header_attached,
            auth.header_name = self.auth_header_name,
            auth.env_openai_api_key_present = self.auth_env.openai_api_key_env_present,
            auth.env_workx_api_key_present = self.auth_env.workx_api_key_env_present,
            auth.env_workx_api_key_enabled = self.auth_env.workx_api_key_env_enabled,
            auth.env_provider_key_name = self.auth_env.provider_env_key_name.as_deref(),
            auth.env_provider_key_present = self.auth_env.provider_env_key_present,
            auth.env_refresh_token_url_override_present = self.auth_env.refresh_token_url_override_present,
            auth.request_id = response_debug.request_id.as_deref(),
            auth.cf_ray = response_debug.cf_ray.as_deref(),
            auth.error = response_debug.auth_error.as_deref(),
            auth.error_code = response_debug.auth_error_code.as_deref(),
            auth.mode = self.auth_mode.as_deref(),
            auth.agent_id = self.agent_identity_telemetry.as_ref().map(|metadata| metadata.agent_id.as_str()),
            auth.task_id = self.agent_identity_telemetry.as_ref().map(|metadata| metadata.task_id.as_str()),
        );
        tracing::event!(
            target: "workx_otel.trace_safe",
            tracing::Level::INFO,
            event.name = "workx.api_request",
            duration_ms = %duration.as_millis(),
            http.response.status_code = status,
            success = success,
            error.message = error_message.as_deref(),
            attempt = attempt,
            endpoint = MODELS_ENDPOINT,
            auth.header_attached = self.auth_header_attached,
            auth.header_name = self.auth_header_name,
            auth.env_openai_api_key_present = self.auth_env.openai_api_key_env_present,
            auth.env_workx_api_key_present = self.auth_env.workx_api_key_env_present,
            auth.env_workx_api_key_enabled = self.auth_env.workx_api_key_env_enabled,
            auth.env_provider_key_name = self.auth_env.provider_env_key_name.as_deref(),
            auth.env_provider_key_present = self.auth_env.provider_env_key_present,
            auth.env_refresh_token_url_override_present = self.auth_env.refresh_token_url_override_present,
            auth.request_id = response_debug.request_id.as_deref(),
            auth.cf_ray = response_debug.cf_ray.as_deref(),
            auth.error = response_debug.auth_error.as_deref(),
            auth.error_code = response_debug.auth_error_code.as_deref(),
            auth.mode = self.auth_mode.as_deref(),
            auth.agent_id = self.agent_identity_telemetry.as_ref().map(|metadata| metadata.agent_id.as_str()),
            auth.task_id = self.agent_identity_telemetry.as_ref().map(|metadata| metadata.task_id.as_str()),
        );
        emit_feedback_request_tags_with_auth_env(
            &FeedbackRequestTags {
                endpoint: MODELS_ENDPOINT,
                auth_header_attached: self.auth_header_attached,
                auth_header_name: self.auth_header_name,
                auth_mode: self.auth_mode.as_deref(),
                auth_retry_after_unauthorized: None,
                auth_recovery_mode: None,
                auth_recovery_phase: None,
                auth_connection_reused: None,
                auth_request_id: response_debug.request_id.as_deref(),
                auth_cf_ray: response_debug.cf_ray.as_deref(),
                auth_error: response_debug.auth_error.as_deref(),
                auth_error_code: response_debug.auth_error_code.as_deref(),
                auth_recovery_followup_success: None,
                auth_recovery_followup_status: None,
            },
            &self.auth_env,
        );
    }
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;
    use std::sync::Mutex;

    use super::*;
    use pretty_assertions::assert_eq;
    use wiremock::Mock;
    use wiremock::MockServer;
    use wiremock::ResponseTemplate;
    use wiremock::matchers::header;
    use wiremock::matchers::method;
    use wiremock::matchers::path;
    use wiremock::matchers::query_param;
    use workx_http_client::OutboundProxyPolicy;
    use workx_login::default_client::RESIDENCY_HEADER_NAME;
    use workx_login::default_client::ResidencyRequirement;
    use workx_login::default_client::create_client;
    use workx_login::default_client::set_default_client_residency_requirement;
    use workx_protocol::config_types::ModelProviderAuthInfo;
    use workx_protocol::openai_models::ModelsResponse;

    #[derive(Debug)]
    struct RecordingTransportBuilder {
        observed_request: Arc<Mutex<Option<(OutboundProxyPolicy, String)>>>,
    }

    impl ModelsTransportBuilder for RecordingTransportBuilder {
        fn build(
            &self,
            http_client_factory: HttpClientFactory,
            request_url: String,
        ) -> ModelsTransportFuture<'_> {
            let observed_request = Arc::clone(&self.observed_request);
            Box::pin(async move {
                *observed_request
                    .lock()
                    .expect("observed request lock should not be poisoned") =
                    Some((http_client_factory.outbound_proxy_policy(), request_url));
                Ok(ReqwestTransport::from_http_client(create_client()))
            })
        }
    }

    fn provider_info_with_command_auth() -> ModelProviderInfo {
        ModelProviderInfo {
            auth: Some(ModelProviderAuthInfo {
                command: "print-token".to_string(),
                args: Vec::new(),
                timeout_ms: NonZeroU64::new(5_000).expect("timeout should be non-zero"),
                refresh_interval_ms: 300_000,
                cwd: std::env::current_dir()
                    .expect("current dir should be available")
                    .try_into()
                    .expect("current dir should be absolute"),
            }),
            requires_openai_auth: false,
            ..ModelProviderInfo::create_openai_provider(/*base_url*/ None)
        }
    }

    #[test]
    fn command_auth_provider_reports_command_auth_without_cached_auth() {
        let endpoint = OpenAiModelsEndpoint::new(
            provider_info_with_command_auth(),
            /*auth_manager*/ None,
        );

        assert!(endpoint.has_command_auth());
    }

    #[test]
    fn provider_without_command_auth_reports_no_command_auth() {
        let endpoint = OpenAiModelsEndpoint::new(
            ModelProviderInfo::create_openai_provider(/*base_url*/ None),
            /*auth_manager*/ None,
        );

        assert!(!endpoint.has_command_auth());
    }

    #[tokio::test]
    async fn model_request_uses_request_time_proxy_policy_and_exact_url() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/models"))
            .and(query_param("client_version", "0.0.0"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(ModelsResponse { models: Vec::new() }),
            )
            .expect(1)
            .mount(&server)
            .await;

        let observed_request = Arc::new(Mutex::new(None));
        let endpoint = OpenAiModelsEndpoint {
            provider_info: ModelProviderInfo::create_openai_provider(Some(server.uri())),
            auth_manager: None,
            transport_builder: Arc::new(RecordingTransportBuilder {
                observed_request: Arc::clone(&observed_request),
            }),
        };

        endpoint
            .list_models(
                "0.0.0",
                HttpClientFactory::new(OutboundProxyPolicy::RespectSystemProxy),
            )
            .await
            .expect("models request should succeed");

        assert_eq!(
            *observed_request
                .lock()
                .expect("observed request lock should not be poisoned"),
            Some((
                OutboundProxyPolicy::RespectSystemProxy,
                format!("{}/models?client_version=0.0.0", server.uri()),
            ))
        );
    }

    #[tokio::test]
    async fn model_discovery_enforces_managed_residency_over_provider_headers() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/models"))
            .and(header(RESIDENCY_HEADER_NAME, "us"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(ModelsResponse { models: Vec::new() }),
            )
            .expect(1)
            .mount(&server)
            .await;

        let mut provider_info = ModelProviderInfo::create_openai_provider(Some(server.uri()));
        provider_info.http_headers = Some(std::collections::HashMap::from([(
            RESIDENCY_HEADER_NAME.to_string(),
            "eu".into(),
        )]));
        let endpoint = OpenAiModelsEndpoint {
            provider_info,
            auth_manager: None,
            transport_builder: Arc::new(RecordingTransportBuilder {
                observed_request: Arc::new(Mutex::new(None)),
            }),
        };

        set_default_client_residency_requirement(Some(ResidencyRequirement::Us));
        endpoint
            .list_models(
                "0.0.0",
                HttpClientFactory::new(OutboundProxyPolicy::ReqwestDefault),
            )
            .await
            .expect("managed residency model discovery should succeed");
        set_default_client_residency_requirement(/*enforce_residency*/ None);

        assert_eq!(
            endpoint
                .provider_info
                .http_headers
                .as_ref()
                .and_then(|headers| headers.get(RESIDENCY_HEADER_NAME)),
            Some(&"eu".into())
        );
    }
}

#[cfg(test)]
#[path = "models_catalog_tests.rs"]
mod catalog_tests;
