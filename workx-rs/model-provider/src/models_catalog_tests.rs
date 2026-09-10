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

#[tokio::test]
async fn external_catalog_uses_configured_path_and_saved_key_without_bundled_models() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/catalog"))
        .and(header("authorization", "Bearer saved-test-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            serde_json::json!({"data":[{"id":"vendor-a"},{"id":"vendor-b"},{"id":"vendor-a"}]}),
        ))
        .expect(2)
        .mount(&server)
        .await;
    let info = ModelProviderInfo {
        name: "custom".into(),
        base_url: Some(format!("{}/v1/responses", server.uri())),
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
        (
            "/v1/models",
            serde_json::json!({"data":[{"id":"only-first"}]}),
        ),
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
