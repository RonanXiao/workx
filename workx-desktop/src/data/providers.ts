// Model-provider helpers shared by the provider manager, Settings and the
// composer pickers. Providers live in config.toml under `model_providers`;
// the desktop never edits that file directly, it goes through the
// app-server `config/batchWrite` RPC exactly like the TUI does.

export type WireApi = 'auto' | 'responses' | 'chat';

export const WIRE_API_OPTIONS: { value: WireApi; label: string }[] = [
  { value: 'responses', label: 'responses' },
  { value: 'chat', label: 'chat' },
  { value: 'auto', label: 'auto' },
];

export function normalizeWireApi(value: unknown): WireApi {
  switch (String(value ?? '').toLowerCase().trim()) {
    case 'auto':
      return 'auto';
    case 'chat':
    case 'chat_completions':
      return 'chat';
    case 'responses':
    default:
      return 'responses';
  }
}

/** One `model_providers.<id>` entry as read from config/read (snake_case). */
export interface ProviderConfigEntry {
  name?: string;
  base_url?: string;
  env_key?: string;
  env_key_instructions?: string;
  models_endpoint?: string;
  experimental_bearer_token?: string;
  wire_api?: string;
  query_params?: Record<string, string>;
  http_headers?: Record<string, string>;
  env_http_headers?: Record<string, string>;
  request_max_retries?: number;
  stream_max_retries?: number;
  stream_idle_timeout_ms?: number;
  websocket_connect_timeout_ms?: number;
  supports_websockets?: boolean;
  requires_openai_auth?: boolean;
}

export interface BuiltinProviderInfo {
  id: string;
  name: string;
  /** Local URL used by built-in gpt-oss providers; null for managed services. */
  baseUrl: string | null;
}

export const BUILTIN_MODEL_PROVIDERS: BuiltinProviderInfo[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: null },
  { id: 'amazon-bedrock', name: 'Amazon Bedrock', baseUrl: null },
  { id: 'amazon-bedrock-runtime', name: 'Amazon Bedrock Runtime', baseUrl: null },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { id: 'lmstudio', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
];

export const BUILTIN_MODEL_PROVIDER_IDS: string[] = BUILTIN_MODEL_PROVIDERS.map((p) => p.id);

export const PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface ProviderSummary {
  id: string;
  name: string;
  baseUrl: string | null;
  /** Present in config.toml (custom entries, or partial overrides of bedrock). */
  configured: boolean;
  /** One of the built-in provider ids that cannot be overridden or removed. */
  builtin: boolean;
  /** Built-in providers can only be switched to, never edited. */
  editable: boolean;
  removable: boolean;
}

const builtinIndex = new Map(BUILTIN_MODEL_PROVIDERS.map((p) => [p.id, p]));

export function providerBaseUrl(entry: ProviderConfigEntry | undefined, id: string): string | null {
  if (entry?.base_url) {
    return entry.base_url;
  }
  return builtinIndex.get(id)?.baseUrl ?? null;
}

export function providerDisplayName(entry: ProviderConfigEntry | undefined, id: string): string {
  if (entry?.name) {
    return entry.name;
  }
  return builtinIndex.get(id)?.name ?? id;
}

/**
 * Build the ordered provider catalog shown to the user: user-configured
 * entries first (sorted), then the built-in ids that are not configured.
 */
export function buildProviderSummaries(
  configured: Record<string, ProviderConfigEntry>,
  activeId: string | null,
): ProviderSummary[] {
  const configuredIds = Object.keys(configured);
  const custom = configuredIds
    .filter((id) => !BUILTIN_MODEL_PROVIDER_IDS.includes(id))
    .sort();
  const rest = [
    ...configuredIds.filter((id) => BUILTIN_MODEL_PROVIDER_IDS.includes(id)),
    ...BUILTIN_MODEL_PROVIDER_IDS.filter((id) => !configuredIds.includes(id)),
  ];
  const toSummary = (id: string): ProviderSummary => {
    const entry = configured[id];
    const builtin = BUILTIN_MODEL_PROVIDER_IDS.includes(id);
    return {
      id,
      name: providerDisplayName(entry, id),
      baseUrl: providerBaseUrl(entry, id),
      configured: entry !== undefined,
      builtin,
      editable: !builtin && entry !== undefined,
      removable: !builtin && entry !== undefined,
    };
  };
  const summaries = [...custom, ...rest].map(toSummary);
  const active = summaries.find((s) => s.id === activeId);
  if (active && active.id !== summaries[0]?.id) {
    summaries.sort((a, b) =>
      a.id === activeId ? -1 : b.id === activeId ? 1 : a.id.localeCompare(b.id),
    );
  }
  return summaries;
}

/** API-key mode offered by the provider editor. */
export type ApiKeyMode = 'none' | 'env' | 'inline';

export interface ProviderFormValue {
  id: string;
  name: string;
  baseUrl: string;
  modelsEndpoint: string;
  wireApi: WireApi;
  apiKeyMode: ApiKeyMode;
  envVar: string;
  /** Inline key. When editing an entry that already has one, an empty
   *  value keeps the stored key (use the clear switch to remove it). */
  token: string;
  clearStoredToken: boolean;
  defaultModel: string;
  headers: { key: string; value: string }[];
  envHeaders: { key: string; value: string }[];
  queryParams: { key: string; value: string }[];
  requestMaxRetries: string;
  streamMaxRetries: string;
  streamIdleTimeoutMs: string;
  websocketConnectTimeoutMs: string;
  supportsWebsockets: boolean;
}

export function emptyProviderFormValue(): ProviderFormValue {
  return {
    id: '',
    name: '',
    baseUrl: '',
    modelsEndpoint: '/v1/models',
    wireApi: 'responses',
    apiKeyMode: 'none',
    envVar: '',
    token: '',
    clearStoredToken: false,
    defaultModel: '',
    headers: [],
    envHeaders: [],
    queryParams: [],
    requestMaxRetries: '',
    streamMaxRetries: '',
    streamIdleTimeoutMs: '',
    websocketConnectTimeoutMs: '',
    supportsWebsockets: false,
  };
}

export function formValueFromEntry(id: string, entry: ProviderConfigEntry): ProviderFormValue {
  const hasToken = Boolean(entry.experimental_bearer_token);
  return {
    ...emptyProviderFormValue(),
    id,
    name: entry.name ?? id,
    baseUrl: entry.base_url ?? '',
    modelsEndpoint: entry.models_endpoint ?? '/v1/models',
    wireApi: normalizeWireApi(entry.wire_api),
    apiKeyMode: hasToken ? 'inline' : entry.env_key ? 'env' : 'none',
    envVar: entry.env_key ?? '',
    token: entry.experimental_bearer_token ?? '',
    headers: toRows(entry.http_headers),
    envHeaders: toRows(entry.env_http_headers),
    queryParams: toRows(entry.query_params),
    requestMaxRetries: entry.request_max_retries?.toString() ?? '',
    streamMaxRetries: entry.stream_max_retries?.toString() ?? '',
    streamIdleTimeoutMs: entry.stream_idle_timeout_ms?.toString() ?? '',
    websocketConnectTimeoutMs: entry.websocket_connect_timeout_ms?.toString() ?? '',
    supportsWebsockets: entry.supports_websockets ?? false,
  };
}

function toRows(map: Record<string, string> | undefined): { key: string; value: string }[] {
  return Object.entries(map ?? {}).map(([key, value]) => ({ key, value }));
}

export type ProviderFormError = string | null;

export function validateProviderForm(value: ProviderFormValue): ProviderFormError {
  const id = value.id.trim();
  if (!id || !PROVIDER_ID_PATTERN.test(id)) {
    return 'provider.errorId';
  }
  const baseUrl = value.baseUrl.trim();
  if (!baseUrl) {
    return 'provider.errorBaseUrlRequired';
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return 'provider.errorBaseUrl';
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    return 'provider.errorBaseUrl';
  }
  const endpoint = value.modelsEndpoint.trim();
  if (
    endpoint &&
    !(endpoint.startsWith('/') || endpoint.startsWith('https://') || endpoint.startsWith('http://'))
  ) {
    return 'provider.errorModelsEndpoint';
  }
  if (value.apiKeyMode === 'env' && !value.envVar.trim()) {
    return 'provider.errorEnvVar';
  }
  if (value.apiKeyMode === 'inline' && !value.clearStoredToken && !value.token.trim()) {
    return 'provider.errorToken';
  }
  for (const group of [value.headers, value.envHeaders, value.queryParams]) {
    for (const row of group) {
      if (!row.key.trim()) {
        return 'provider.errorRowKey';
      }
      const key = row.key.trim();
      if (
        group.some(
          (other) => other !== row && other.key.trim().toLowerCase() === key.toLowerCase(),
        )
      ) {
        return 'provider.errorDuplicateKeys';
      }
    }
  }
  const numericFields = [
    value.requestMaxRetries,
    value.streamMaxRetries,
    value.streamIdleTimeoutMs,
    value.websocketConnectTimeoutMs,
  ];
  for (const text of numericFields) {
    if (!text.trim()) {
      continue;
    }
    const number = Number(text.trim());
    if (!Number.isInteger(number) || number <= 0) {
      return 'provider.errorPositiveInteger';
    }
  }
  return null;
}

/**
 * Serialize the editor state into the JSON object stored under
 * `model_providers.<id>`. Empty/optional fields are dropped; values with
 * engine defaults are omitted so the stored entry stays minimal. Pass
 * `storedToken` when editing a provider that already has an inline token and
 * the user left the field blank (keep the existing token).
 */
export function toProviderConfigEntry(value: ProviderFormValue, storedToken: string | null): ProviderConfigEntry {
  const id = value.id.trim();
  const entry: ProviderConfigEntry = {
    name: value.name.trim() || id,
  };
  const baseUrl = value.baseUrl.trim();
  if (baseUrl) {
    entry.base_url = baseUrl;
  }
  const endpoint = value.modelsEndpoint.trim();
  if (endpoint) {
    entry.models_endpoint = endpoint;
  }
  if (value.wireApi !== 'responses') {
    entry.wire_api = value.wireApi;
  }
  if (value.apiKeyMode === 'env' && value.envVar.trim()) {
    entry.env_key = value.envVar.trim();
  } else if (value.apiKeyMode === 'inline') {
    const token = value.token.trim();
    if (token) {
      entry.experimental_bearer_token = token;
    } else if (storedToken && !value.clearStoredToken) {
      entry.experimental_bearer_token = storedToken;
    }
  }
  entry.http_headers = rowsToMap(value.headers);
  entry.env_http_headers = rowsToMap(value.envHeaders);
  entry.query_params = rowsToMap(value.queryParams);
  if (entry.http_headers && Object.keys(entry.http_headers).length === 0) {
    delete entry.http_headers;
  }
  if (entry.env_http_headers && Object.keys(entry.env_http_headers).length === 0) {
    delete entry.env_http_headers;
  }
  if (entry.query_params && Object.keys(entry.query_params).length === 0) {
    delete entry.query_params;
  }
  const retries = optionalPositiveInt(value.requestMaxRetries);
  const streamRetries = optionalPositiveInt(value.streamMaxRetries);
  const idleTimeout = optionalPositiveInt(value.streamIdleTimeoutMs);
  const connectTimeout = optionalPositiveInt(value.websocketConnectTimeoutMs);
  if (retries !== null) entry.request_max_retries = retries;
  if (streamRetries !== null) entry.stream_max_retries = streamRetries;
  if (idleTimeout !== null) entry.stream_idle_timeout_ms = idleTimeout;
  if (connectTimeout !== null) entry.websocket_connect_timeout_ms = connectTimeout;
  if (value.supportsWebsockets) {
    entry.supports_websockets = true;
  }
  return entry;
}

function optionalPositiveInt(text: string): number | null {
  if (!text.trim()) {
    return null;
  }
  const parsed = Number(text.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function rowsToMap(rows: { key: string; value: string }[]): Record<string, string> | undefined {
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim()) {
      map[row.key.trim()] = row.value;
    }
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

/** Custom model registered for a provider (a model id not in model/list). */
export interface CustomModel {
  id: string;
  label?: string;
}

/** Registry stored in config.toml under the opaque `desktop` section:
 *  providerId -> modelId -> { label? }. Keyed by provider so a custom model
 *  only shows up while that provider is active. */
export type CustomModelRegistry = Record<string, Record<string, { label?: string }>>;

export const CUSTOM_MODELS_CONFIG_PATH = 'desktop.customModels';

export function registryToCustomModels(
  registry: CustomModelRegistry | undefined,
  providerId: string | null,
): CustomModel[] {
  const byModelId = registry?.[providerId ?? ''] ?? {};
  return Object.entries(byModelId)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, meta]) => ({ id, label: meta.label }));
}

export function withRegistryCustomModel(
  registry: CustomModelRegistry,
  providerId: string,
  model: CustomModel,
): CustomModelRegistry {
  return {
    ...registry,
    [providerId]: {
      ...(registry[providerId] ?? {}),
      [model.id]: model.label ? { label: model.label } : {},
    },
  };
}

export function withoutRegistryCustomModel(
  registry: CustomModelRegistry,
  providerId: string,
  modelId: string,
): CustomModelRegistry {
  const byModelId = { ...(registry[providerId] ?? {}) };
  delete byModelId[modelId];
  const next = { ...registry };
  if (Object.keys(byModelId).length > 0) {
    next[providerId] = byModelId;
  } else {
    delete next[providerId];
  }
  return next;
}

export function registryIsEmpty(registry: CustomModelRegistry): boolean {
  return Object.values(registry).every((byModelId) => Object.keys(byModelId).length === 0);
}