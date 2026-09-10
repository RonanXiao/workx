use super::*;
use pretty_assertions::assert_eq;
use serde_json::json;
use wiremock::Mock;
use wiremock::MockServer;
use wiremock::ResponseTemplate;
use wiremock::matchers::header;
use wiremock::matchers::method;
use wiremock::matchers::path;
use workx_http_client::OutboundProxyPolicy;
use workx_model_provider_info::BalanceEndpointConfig;

fn provider_with_balance(
    base_url: &str,
    value_path: &str,
    currency_path: Option<&str>,
) -> ModelProviderInfo {
    ModelProviderInfo {
        name: "custom".into(),
        base_url: Some(base_url.to_string()),
        experimental_bearer_token: Some("saved-test-key".into()),
        balance: Some(BalanceEndpointConfig {
            endpoint: "/user/balance".to_string(),
            value_path: value_path.to_string(),
            currency_path: currency_path.map(std::string::ToString::to_string),
            label: Some("DeepSeek balance".to_string()),
        }),
        ..Default::default()
    }
}

#[test]
fn parse_path_accepts_dotted_keys_indexes_and_leading_root() {
    for (path, expected) in [
        (
            "balance_infos[0].total_balance",
            vec![
                Segment::Key("balance_infos".to_string()),
                Segment::Index(0),
                Segment::Key("total_balance".to_string()),
            ],
        ),
        (
            "$.data.balance",
            vec![
                Segment::Key("data".to_string()),
                Segment::Key("balance".to_string()),
            ],
        ),
        (
            "$[0].credits",
            vec![Segment::Index(0), Segment::Key("credits".to_string())],
        ),
    ] {
        assert_eq!(
            expected,
            parse_path(path).expect("path should parse"),
            "{path}"
        );
    }
}

#[test]
fn parse_path_rejects_empty_or_unsupported_paths() {
    for path in ["", "   ", "$", "a.[].b", "a]b"] {
        assert!(parse_path(path).is_err(), "{path} should be rejected");
    }
}

#[test]
fn lookup_resolves_nested_values_and_missing_paths() {
    let document = json!({"balance_infos": [{"total_balance": "42.50", "currency": "CNY"}]});
    let segments = parse_path("balance_infos[0].total_balance").expect("path should parse");
    assert_eq!(Some(&json!("42.50")), lookup(&document, &segments));
    let missing = parse_path("balance_infos[1].total_balance").expect("path should parse");
    assert_eq!(None, lookup(&document, &missing));
}

#[test]
fn display_value_formats_scalars_only() {
    assert_eq!(Some("42.50".to_string()), display_value(&json!(" 42.50 ")));
    assert_eq!(Some("42.5".to_string()), display_value(&json!(42.5)));
    assert_eq!(Some("true".to_string()), display_value(&json!(true)));
    assert_eq!(None, display_value(&json!(null)));
    assert_eq!(None, display_value(&json!({"a": 1})));
    assert_eq!(None, display_value(&json!("   ")));
}

#[tokio::test]
async fn fetch_provider_balance_returns_none_without_config() {
    let provider = ModelProviderInfo::default();
    let balance = fetch_provider_balance(
        &provider,
        /*auth*/ None,
        HttpClientFactory::new(OutboundProxyPolicy::ReqwestDefault),
    )
    .await
    .expect("provider without balance config should succeed");
    assert_eq!(None, balance);
}

#[tokio::test]
async fn fetch_provider_balance_reads_value_and_currency_with_provider_auth() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/user/balance"))
        .and(header("authorization", "Bearer saved-test-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "is_available": true,
            "balance_infos": [{"currency": "CNY", "total_balance": "110.00"}],
        })))
        .expect(1)
        .mount(&server)
        .await;

    let provider = provider_with_balance(
        &server.uri(),
        "balance_infos[0].total_balance",
        Some("balance_infos[0].currency"),
    );
    let balance = fetch_provider_balance(
        &provider,
        /*auth*/ None,
        HttpClientFactory::new(OutboundProxyPolicy::ReqwestDefault),
    )
    .await
    .expect("balance lookup should succeed")
    .expect("balance config should produce a result");

    assert_eq!(
        ProviderBalance {
            value: "110.00".to_string(),
            currency: Some("CNY".to_string()),
            label: Some("DeepSeek balance".to_string()),
        },
        balance
    );
}

#[tokio::test]
async fn fetch_provider_balance_reports_unresolved_path() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/user/balance"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"data": {}})))
        .mount(&server)
        .await;

    let provider =
        provider_with_balance(&server.uri(), "data.balance", /*currency_path*/ None);
    let error = fetch_provider_balance(
        &provider,
        /*auth*/ None,
        HttpClientFactory::new(OutboundProxyPolicy::ReqwestDefault),
    )
    .await
    .expect_err("missing path should fail");

    assert!(
        error.to_string().contains("data.balance"),
        "unexpected error: {error}"
    );
}
