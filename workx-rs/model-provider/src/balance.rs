//! Provider-owned balance lookups.
//!
//! A provider can declare `[model_providers.<id>.balance]` in `config.toml` to expose a
//! remaining balance or quota. The endpoint is requested with the provider's own inference
//! credentials, so one provider entry covers both chat traffic and balance reads. The response
//! is interpreted with a small `.`/`[n]` path subset instead of provider-specific parsing, which
//! keeps this working for any OpenAI-compatible gateway that publishes a balance endpoint.

use std::time::Duration;

use http::HeaderValue;
use http::Method;
use http::header::ACCEPT;
use serde_json::Value;
use workx_api::ReqwestTransport;
use workx_http_client::ClientRouteClass;
use workx_http_client::HttpClientFactory;
use workx_http_client::HttpTransport;
use workx_http_client::Request;
use workx_login::WorkxAuth;
use workx_login::default_client::create_client_for_route_async;
use workx_model_provider_info::ModelProviderInfo;
use workx_protocol::error::Result as WorkxResult;
use workx_protocol::error::WorkxErr;

use crate::auth::resolve_provider_auth;
use crate::provider::enforce_managed_residency;

const BALANCE_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_BALANCE_RESPONSE_BYTES: usize = 64 * 1024;

/// Resolved balance value ready to be displayed next to a provider.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderBalance {
    /// Formatted value read from the configured `value_path`.
    pub value: String,
    /// Optional currency or unit read from the configured `currency_path`.
    pub currency: Option<String>,
    /// Optional row label read from the provider's balance config.
    pub label: Option<String>,
}

/// Reads a provider's remaining balance.
///
/// Returns `Ok(None)` when the provider has no `balance` endpoint configured. Errors describe a
/// failed lookup only; callers are expected to surface them as non-fatal status text.
pub async fn fetch_provider_balance(
    provider_info: &ModelProviderInfo,
    auth: Option<&WorkxAuth>,
    http_client_factory: HttpClientFactory,
) -> WorkxResult<Option<ProviderBalance>> {
    let Some(config) = provider_info.balance.as_ref() else {
        return Ok(None);
    };
    let segments = parse_path(&config.value_path).map_err(WorkxErr::InvalidRequest)?;
    let currency_segments = config
        .currency_path
        .as_deref()
        .map(parse_path)
        .transpose()
        .map_err(WorkxErr::InvalidRequest)?;

    let mut api_provider = provider_info.to_api_provider(auth.map(WorkxAuth::auth_mode))?;
    enforce_managed_residency(&mut api_provider);
    let base_url = url::Url::parse(&api_provider.base_url).map_err(|err| {
        WorkxErr::InvalidRequest(format!(
            "invalid provider base URL for balance lookup: {err}"
        ))
    })?;
    let request_url = base_url
        .join(&config.endpoint)
        .map_err(|err| {
            WorkxErr::InvalidRequest(format!(
                "invalid balance endpoint `{}`: {err}",
                config.endpoint
            ))
        })?
        .to_string();

    let auth_provider = resolve_provider_auth(auth, provider_info)?;
    let http_client = create_client_for_route_async(
        http_client_factory,
        request_url.clone(),
        ClientRouteClass::Api,
    )
    .await
    .map_err(|err| {
        WorkxErr::InvalidRequest(format!("failed to build balance HTTP client: {err}"))
    })?;
    let transport = ReqwestTransport::from_http_client(http_client);

    let mut request = Request::new(Method::GET, request_url);
    request
        .headers
        .insert(ACCEPT, HeaderValue::from_static("application/json"));
    request.timeout = Some(BALANCE_REQUEST_TIMEOUT);
    let request = auth_provider.apply_auth(request).await.map_err(|err| {
        WorkxErr::InvalidRequest(format!("failed to authenticate balance request: {err}"))
    })?;

    let response = transport
        .execute(request)
        .await
        .map_err(|err| WorkxErr::InvalidRequest(format!("balance request failed: {err}")))?;
    if response.body.len() > MAX_BALANCE_RESPONSE_BYTES {
        return Err(WorkxErr::InvalidRequest(format!(
            "balance response exceeded {MAX_BALANCE_RESPONSE_BYTES} bytes"
        )));
    }
    let document: Value = serde_json::from_slice(&response.body).map_err(|err| {
        WorkxErr::InvalidRequest(format!("balance response was not valid JSON: {err}"))
    })?;

    let value = lookup(&document, &segments)
        .and_then(display_value)
        .ok_or_else(|| {
            WorkxErr::InvalidRequest(format!(
                "balance path `{}` did not resolve to a value",
                config.value_path
            ))
        })?;
    let currency = currency_segments
        .as_deref()
        .and_then(|segments| lookup(&document, segments))
        .and_then(display_value);

    Ok(Some(ProviderBalance {
        value,
        currency,
        label: config.label.clone(),
    }))
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Segment {
    Key(String),
    Index(usize),
}

/// Parses the supported subset of JSON paths: dotted keys plus `[index]` accessors.
///
/// A leading `$` is accepted and ignored so JSONPath-shaped values copied from provider docs
/// keep working. Anything richer than that is rejected rather than silently misread.
fn parse_path(path: &str) -> Result<Vec<Segment>, String> {
    let trimmed = path.trim();
    let trimmed = trimmed.strip_prefix('$').unwrap_or(trimmed);
    let mut segments = Vec::new();
    let mut key = String::new();
    let mut chars = trimmed.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '.' => {
                if !key.is_empty() {
                    segments.push(Segment::Key(std::mem::take(&mut key)));
                }
            }
            '[' => {
                if !key.is_empty() {
                    segments.push(Segment::Key(std::mem::take(&mut key)));
                }
                let mut index = String::new();
                for index_ch in chars.by_ref() {
                    if index_ch == ']' {
                        break;
                    }
                    index.push(index_ch);
                }
                let index = index.trim().parse::<usize>().map_err(|_| {
                    format!("unsupported balance path segment `[{index}]`; expected an array index")
                })?;
                segments.push(Segment::Index(index));
            }
            ']' => return Err(format!("unbalanced `]` in balance path `{path}`")),
            _ => key.push(ch),
        }
    }
    if !key.is_empty() {
        segments.push(Segment::Key(key));
    }
    if segments.is_empty() {
        return Err(format!("balance path `{path}` is empty"));
    }
    Ok(segments)
}

fn lookup<'a>(root: &'a Value, segments: &[Segment]) -> Option<&'a Value> {
    let mut current = root;
    for segment in segments {
        current = match segment {
            Segment::Key(key) => current.get(key)?,
            Segment::Index(index) => current.get(*index)?,
        };
    }
    Some(current)
}

fn display_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        }
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(boolean) => Some(boolean.to_string()),
        Value::Null | Value::Array(_) | Value::Object(_) => None,
    }
}

#[cfg(test)]
#[path = "balance_tests.rs"]
mod tests;
