use super::*;
use pretty_assertions::assert_eq;
use wiremock::Mock;
use wiremock::MockServer;
use wiremock::ResponseTemplate;
use wiremock::matchers::header;
use wiremock::matchers::method;
use wiremock::matchers::path;
use workx_http_client::OutboundProxyPolicy;
use workx_models_manager::manager::ModelsManager;
use workx_models_manager::manager::OpenAiModelsManager;
use workx_models_manager::manager::RefreshStrategy;
use workx_protocol::openai_models::ReasoningEffort;

#[tokio::test]
async fn external_catalog_uses_configured_path_and_saved_key_without_bundled_models() {
    let server = MockServer::start().await;
    // base_url 的路径前缀必须保留：endpoint 追加在其后，而不是替换整段路径。
    Mock::given(method("GET"))
        .and(path("/vendor/api/catalog"))
        .and(header("authorization", "Bearer saved-test-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            serde_json::json!({"data":[{"id":"vendor-a"},{"id":"vendor-b"},{"id":"vendor-a"}]}),
        ))
        .expect(2)
        .mount(&server)
        .await;
    let info = ModelProviderInfo {
        name: "custom".into(),
        base_url: Some(format!("{}/vendor/api", server.uri())),
        models_endpoint: Some("/catalog".into()),
        balance: None,
        experimental_bearer_token: Some("saved-test-key".into()),
        ..Default::default()
    };
    for _ in 0..2 {
        let manager = OpenAiModelsManager::new_without_cache(
            Arc::new(OpenAiModelsEndpoint::new(info.clone(), None)),
            None,
        );
        let models = manager
            .list_models(
                RefreshStrategy::OnlineIfUncached,
                HttpClientFactory::new(OutboundProxyPolicy::ReqwestDefault),
            )
            .await;
        assert_eq!(
            models.iter().map(|m| m.model.as_str()).collect::<Vec<_>>(),
            vec!["vendor-a", "vendor-b"]
        );
        assert!(models.iter().all(|m| m.show_in_picker));
    }
}

#[tokio::test]
async fn external_catalog_switch_and_empty_results_do_not_reuse_other_models() {
    let server = MockServer::start().await;
    for (route, body) in [
        ("/models", serde_json::json!({"data":[{"id":"only-first"}]})),
        ("/second", serde_json::json!({"data":[]})),
    ] {
        Mock::given(method("GET"))
            .and(path(route))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&server)
            .await;
    }
    for (endpoint, expected) in [(None, vec!["only-first"]), (Some("/second".into()), vec![])] {
        let info = ModelProviderInfo {
            name: "custom".into(),
            base_url: Some(server.uri()),
            models_endpoint: endpoint,
            balance: None,
            ..Default::default()
        };
        let manager = OpenAiModelsManager::new_without_cache(
            Arc::new(OpenAiModelsEndpoint::new(info, None)),
            None,
        );
        let models = manager
            .list_models(
                RefreshStrategy::Online,
                HttpClientFactory::new(OutboundProxyPolicy::ReqwestDefault),
            )
            .await;
        assert_eq!(
            models.iter().map(|m| m.model.as_str()).collect::<Vec<_>>(),
            expected
        );
    }
}

#[tokio::test]
async fn external_catalog_inherits_bundled_reasoning_levels() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/models"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "object": "list",
            "data": [{"id": "gpt-5.6-terra"}, {"id": "vendor-image-model"}],
        })))
        .mount(&server)
        .await;
    let info = ModelProviderInfo {
        name: "custom".into(),
        base_url: Some(server.uri()),
        balance: None,
        ..Default::default()
    };
    let manager = OpenAiModelsManager::new_without_cache(
        Arc::new(OpenAiModelsEndpoint::new(info, None)),
        None,
    );

    let models = manager
        .list_models(
            RefreshStrategy::Online,
            HttpClientFactory::new(OutboundProxyPolicy::ReqwestDefault),
        )
        .await;

    let reasoning: Vec<(String, ReasoningEffort, Vec<ReasoningEffort>)> = models
        .iter()
        .map(|preset| {
            (
                preset.model.clone(),
                preset.default_reasoning_effort.clone(),
                preset
                    .supported_reasoning_efforts
                    .iter()
                    .map(|option| option.effort.clone())
                    .collect(),
            )
        })
        .collect();
    assert_eq!(
        reasoning,
        vec![
            (
                "gpt-5.6-terra".to_string(),
                ReasoningEffort::Medium,
                vec![
                    ReasoningEffort::Low,
                    ReasoningEffort::Medium,
                    ReasoningEffort::High,
                    ReasoningEffort::XHigh,
                    ReasoningEffort::Max,
                    ReasoningEffort::Ultra,
                ],
            ),
            (
                "vendor-image-model".to_string(),
                ReasoningEffort::None,
                Vec::new(),
            ),
        ]
    );
}

#[test]
fn join_models_endpoint_keeps_base_url_path_prefix() {
    let cases = [
        // base_url 是 API 根地址，endpoint 追加在其路径之后，前缀始终保留。
        (
            "https://opencode.ai/zen/go/v1",
            "/models",
            "https://opencode.ai/zen/go/v1/models",
        ),
        (
            "https://codex.echol.top/v1",
            "/models",
            "https://codex.echol.top/v1/models",
        ),
        (
            "https://api.deepseek.com",
            "/v1/models",
            "https://api.deepseek.com/v1/models",
        ),
        // 默认 endpoint `models` 同样追加在 base_url 路径之后。
        (
            "https://opencode.ai/zen/go/v1",
            "models",
            "https://opencode.ai/zen/go/v1/models",
        ),
        (
            "https://codex.echol.top/v1",
            "models",
            "https://codex.echol.top/v1/models",
        ),
        // base_url 已含末尾斜杠时不产生重复斜杠。
        ("https://host/v1/", "/models", "https://host/v1/models"),
        // base_url 无路径时 endpoint 决定路径。
        ("https://host", "/v1/models", "https://host/v1/models"),
        // 完整 URL 原样使用。
        (
            "https://host/v1",
            "https://other.example/models",
            "https://other.example/models",
        ),
    ];
    for (base, endpoint, expected) in cases {
        assert_eq!(
            join_models_endpoint(base, endpoint).expect("join should succeed"),
            expected,
            "base={base} endpoint={endpoint}"
        );
    }
}
