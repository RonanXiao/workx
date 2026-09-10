use anyhow::Result;
use app_test_support::MockResponsesConfig;
use app_test_support::TestAppServer;
use pretty_assertions::assert_eq;
use serde_json::json;
use tempfile::TempDir;
use wiremock::Mock;
use wiremock::MockServer;
use wiremock::ResponseTemplate;
use wiremock::matchers::method;
use wiremock::matchers::path;
use workx_app_server_protocol::ClientRequest;
use workx_app_server_protocol::ModelProviderBalanceReadParams;
use workx_app_server_protocol::ModelProviderBalanceReadResponse;

#[tokio::test]
async fn balance_read_reports_unconfigured_provider() -> Result<()> {
    let workx_home = TempDir::new()?;
    let mut mcp = TestAppServer::builder()
        .with_workx_home(workx_home.path())
        .without_auto_env()
        .build_initialized()
        .await?;

    let response: ModelProviderBalanceReadResponse = mcp
        .request(|request_id| ClientRequest::ModelProviderBalanceRead {
            request_id,
            params: ModelProviderBalanceReadParams {},
        })
        .await?;

    assert_eq!(
        response,
        ModelProviderBalanceReadResponse {
            configured: false,
            value: None,
            currency: None,
            label: None,
            updated_at: response.updated_at,
            error: None,
        }
    );
    Ok(())
}

#[tokio::test]
async fn balance_read_uses_provider_balance_config() -> Result<()> {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/user/balance"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": {"balance": "7.25", "currency": "USD"},
        })))
        .expect(1)
        .mount(&server)
        .await;

    let workx_home = TempDir::new()?;
    MockResponsesConfig::new(&server.uri())
        .with_provider_config(
            r#"
[model_providers.mock_provider.balance]
endpoint = "/v1/user/balance"
value_path = "data.balance"
currency_path = "data.currency"
label = "Mock balance"
"#,
        )
        .write(workx_home.path())?;
    let mut mcp = TestAppServer::builder()
        .with_workx_home(workx_home.path())
        .without_auto_env()
        .build_initialized()
        .await?;

    let response: ModelProviderBalanceReadResponse = mcp
        .request(|request_id| ClientRequest::ModelProviderBalanceRead {
            request_id,
            params: ModelProviderBalanceReadParams {},
        })
        .await?;

    assert_eq!(response.configured, true);
    assert_eq!(response.value, Some("7.25".to_string()));
    assert_eq!(response.currency, Some("USD".to_string()));
    assert_eq!(response.label, Some("Mock balance".to_string()));
    assert_eq!(response.error, None);
    Ok(())
}
