import type { AgentMessageDeltaNotification } from '@protocol/v2/AgentMessageDeltaNotification';
import type { CommandExecutionRequestApprovalParams } from '@protocol/v2/CommandExecutionRequestApprovalParams';
import type { ConfigReadResponse } from '@protocol/v2/ConfigReadResponse';
import type { ErrorNotification } from '@protocol/v2/ErrorNotification';
import type { FileChangeRequestApprovalParams } from '@protocol/v2/FileChangeRequestApprovalParams';
import type { FuzzyFileSearchResponse } from '@protocol/FuzzyFileSearchResponse';
import type { InitializeResponse } from '@protocol/InitializeResponse';
import type { FuzzyFileSearchResult } from '@protocol/FuzzyFileSearchResult';
import type { ItemCompletedNotification } from '@protocol/v2/ItemCompletedNotification';
import type { ItemStartedNotification } from '@protocol/v2/ItemStartedNotification';
import type { Model } from '@protocol/v2/Model';
import type { ModelListResponse } from '@protocol/v2/ModelListResponse';
import type { MarketplaceLoadErrorInfo } from '@protocol/v2/MarketplaceLoadErrorInfo';
import type { McpServerStatus } from '@protocol/v2/McpServerStatus';
import type { ListMcpServerStatusResponse } from '@protocol/v2/ListMcpServerStatusResponse';
import type { PluginListResponse } from '@protocol/v2/PluginListResponse';
import type { PluginMarketplaceEntry } from '@protocol/v2/PluginMarketplaceEntry';
import type { Project } from '@protocol/v2/Project';
import type { ProjectChangedNotification } from '@protocol/v2/ProjectChangedNotification';
import type { SkillErrorInfo } from '@protocol/v2/SkillErrorInfo';
import type { SkillMetadata } from '@protocol/v2/SkillMetadata';
import type { SkillsListResponse } from '@protocol/v2/SkillsListResponse';
import type { Thread } from '@protocol/v2/Thread';
import type { ThreadArchivedNotification } from '@protocol/v2/ThreadArchivedNotification';
import type { ThreadDeletedNotification } from '@protocol/v2/ThreadDeletedNotification';
import type { ThreadForkResponse } from '@protocol/v2/ThreadForkResponse';
import type { ThreadGoal } from '@protocol/v2/ThreadGoal';
import type { ThreadGoalGetResponse } from '@protocol/v2/ThreadGoalGetResponse';
import type { ThreadGoalSetResponse } from '@protocol/v2/ThreadGoalSetResponse';
import type { ThreadGoalStatus } from '@protocol/v2/ThreadGoalStatus';
import type { ThreadGoalUpdatedNotification } from '@protocol/v2/ThreadGoalUpdatedNotification';
import type { ThreadItem } from '@protocol/v2/ThreadItem';
import type { ThreadListResponse } from '@protocol/v2/ThreadListResponse';
import type { ThreadNameUpdatedNotification } from '@protocol/v2/ThreadNameUpdatedNotification';
import type { ThreadProjectUpdatedNotification } from '@protocol/v2/ThreadProjectUpdatedNotification';
import type { ThreadReadResponse } from '@protocol/v2/ThreadReadResponse';
import type { ThreadResumeResponse } from '@protocol/v2/ThreadResumeResponse';
import type { ThreadStartResponse } from '@protocol/v2/ThreadStartResponse';
import type { ThreadStatusChangedNotification } from '@protocol/v2/ThreadStatusChangedNotification';
import type { Turn } from '@protocol/v2/Turn';
import type { TurnCompletedNotification } from '@protocol/v2/TurnCompletedNotification';
import type { TurnStartedNotification } from '@protocol/v2/TurnStartedNotification';
import type { TurnStartResponse } from '@protocol/v2/TurnStartResponse';
import type { UserInput } from '@protocol/v2/UserInput';
import type { WarningNotification } from '@protocol/v2/WarningNotification';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import {
  INIT_AGENTS_PROMPT,
  type ComposerMenuBinding,
  type SlashCommandInfo,
} from '../data/composerMenu';
import { FALLBACK_SLASH_COMMANDS } from '../data/slashCommandFallback';
import { PERMISSION_MODES, type PermissionMode } from '../data/workspace';
import { useI18n } from '../lib/i18n';
import {
  type ProjectCreateResponse,
  type ProjectDeleteResponse,
  type ProjectListResponse,
  type ProjectUpdateResponse,
  type ThreadListRequestParams,
  type ThreadSearchResponse,
} from './protocolExtensions';
import { buildTranscript, textFromUserInput, type TranscriptEntry, type TurnView } from './transcript';

function projectWorkspaceRoots(
  projects: Project[],
  projectId: string | null,
): string[] | undefined {
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) {
    return undefined;
  }
  return [...new Set(project.roots.map((root) => root.path))];
}

export const BUILTIN_MODEL_PROVIDER_IDS = [
  'openai',
  'amazon-bedrock',
  'amazon-bedrock-runtime',
  'ollama',
  'lmstudio',
];

export const LOCAL_MODEL_PROVIDER_DEFAULTS = {
  lmstudio: { name: 'LM Studio', base_url: 'http://localhost:1234/v1' },
  ollama: { name: 'Ollama', base_url: 'http://localhost:11434/v1' },
};

export type ProviderWireApi = 'responses' | 'chat' | 'auto';

export type InputModality = 'text' | 'image' | 'audio';

export const DEFAULT_CUSTOM_MODEL_MODALITIES: InputModality[] = ['text', 'image'];

/// 自定义模型可声明的推理强度，顺序即下拉展示顺序。
export const REASONING_EFFORT_OPTIONS: string[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
];

export interface CustomModelConfig {
  id: string;
  contextWindow: number | null;
  maxContextWindow: number | null;
  inputModalities: InputModality[];
  defaultReasoningLevel: string | null;
  supportedReasoningLevels: string[];
}

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  envKey: string;
  wireApi: ProviderWireApi;
  modelsEndpoint: string;
  balance: ProviderBalanceConfig;
  customModels: CustomModelConfig[];
}

/// Provider 的展示信息：ID 是配置键，name 是用户可读名称。
export interface ProviderOption {
  id: string;
  name: string;
}

/// 解析 provider 展示名称：优先使用配置里的 name，未配置时回退到 ID。
export function providerDisplayName(
  id: string,
  configs: Record<string, ProviderConfig>,
): string {
  return configs[id]?.name?.trim() || id;
}

/// Provider-owned balance endpoint used by `modelProvider/balance/read`.
export interface ProviderBalanceConfig {
  endpoint: string;
  valuePath: string;
  currencyPath: string;
  label: string;
}

/// Result of reading a provider's balance endpoint.
export interface ProviderBalanceView {
  configured: boolean;
  value: string | null;
  currency: string | null;
  label: string | null;
  updatedAt: number;
  error: string | null;
}

/// Provider keys the manager owns. When a field is cleared we must explicitly
/// remove it, because saving uses an upsert merge that preserves unknown keys
/// such as the `experimental_bearer_token` written by the CLI onboarding flow.
const OPTIONAL_PROVIDER_CONFIG_KEYS = [
  'experimental_bearer_token',
  'env_key',
  'models_endpoint',
  'balance',
  'custom_models',
];

function asPositiveInteger(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return null;
  }
  const value = Math.trunc(raw);
  return value > 0 ? value : null;
}

function normalizeInputModalities(raw: unknown): InputModality[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const modalities = raw.filter(
    (modality): modality is InputModality =>
      modality === 'text' || modality === 'image' || modality === 'audio',
  );
  return modalities.length > 0 ? [...new Set(modalities)] : null;
}

function normalizeReasoningLevels(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const levels = raw
    .filter((level): level is string => typeof level === 'string')
    .map((level) => level.trim())
    .filter((level) => level.length > 0);
  return [...new Set(levels)];
}

function normalizeReasoningLevel(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function normalizeCustomModel(raw: unknown): CustomModelConfig | null {
  if (typeof raw === 'string') {
    const id = raw.trim();
    return id
      ? {
          id,
          contextWindow: null,
          maxContextWindow: null,
          inputModalities: [...DEFAULT_CUSTOM_MODEL_MODALITIES],
          defaultReasoningLevel: null,
          supportedReasoningLevels: [],
        }
      : null;
  }
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  if (!id) {
    return null;
  }
  return {
    id,
    contextWindow: asPositiveInteger(value.context_window),
    maxContextWindow: asPositiveInteger(value.max_context_window),
    inputModalities:
      normalizeInputModalities(value.input_modalities) ?? [...DEFAULT_CUSTOM_MODEL_MODALITIES],
    defaultReasoningLevel: normalizeReasoningLevel(value.default_reasoning_level),
    supportedReasoningLevels: normalizeReasoningLevels(value.supported_reasoning_levels),
  };
}

export function normalizeProviderConfig(raw: unknown): ProviderConfig {
  const value = (raw ?? {}) as Record<string, unknown>;
  const wireApi = value.wire_api;
  const rawBalance = (value.balance ?? {}) as Record<string, unknown>;
  return {
    name: typeof value.name === 'string' ? value.name : '',
    baseUrl: typeof value.base_url === 'string' ? value.base_url : '',
    apiKey:
      typeof value.experimental_bearer_token === 'string'
        ? value.experimental_bearer_token
        : '',
    envKey: typeof value.env_key === 'string' ? value.env_key : '',
    wireApi: wireApi === 'chat' ? 'chat' : wireApi === 'auto' ? 'auto' : 'responses',
    modelsEndpoint:
      typeof value.models_endpoint === 'string' ? value.models_endpoint : '',
    balance: {
      endpoint: typeof rawBalance.endpoint === 'string' ? rawBalance.endpoint : '',
      valuePath: typeof rawBalance.value_path === 'string' ? rawBalance.value_path : '',
      currencyPath:
        typeof rawBalance.currency_path === 'string' ? rawBalance.currency_path : '',
      label: typeof rawBalance.label === 'string' ? rawBalance.label : '',
    },
    customModels: Array.isArray(value.custom_models)
      ? value.custom_models
          .map(normalizeCustomModel)
          .filter((model): model is CustomModelConfig => model !== null)
      : [],
  };
}

function providerConfigToToml(config: ProviderConfig): Record<string, unknown> {
  const value: Record<string, unknown> = {
    name: config.name.trim(),
    base_url: config.baseUrl.trim(),
    wire_api: config.wireApi,
  };
  if (config.apiKey.trim()) {
    value.experimental_bearer_token = config.apiKey.trim();
  }
  if (config.envKey.trim()) {
    value.env_key = config.envKey.trim();
  }
  if (config.modelsEndpoint.trim()) {
    value.models_endpoint = config.modelsEndpoint.trim();
  }
  const balanceEndpoint = config.balance.endpoint.trim();
  const balanceValuePath = config.balance.valuePath.trim();
  if (balanceEndpoint && balanceValuePath) {
    const balance: Record<string, unknown> = {
      endpoint: balanceEndpoint,
      value_path: balanceValuePath,
    };
    const currencyPath = config.balance.currencyPath.trim();
    if (currencyPath) {
      balance.currency_path = currencyPath;
    }
    const label = config.balance.label.trim();
    if (label) {
      balance.label = label;
    }
    value.balance = balance;
  }
  const customModels = config.customModels
    .map((model) => ({ ...model, id: model.id.trim() }))
    .filter((model) => model.id.length > 0);
  if (customModels.length > 0) {
    value.custom_models = customModels.map((model) => {
      const modalities = model.inputModalities.filter(
        (modality) => modality === 'text' || modality === 'image' || modality === 'audio',
      );
      const usesDefaultModalities =
        modalities.length === DEFAULT_CUSTOM_MODEL_MODALITIES.length &&
        DEFAULT_CUSTOM_MODEL_MODALITIES.every((modality) => modalities.includes(modality));
      if (
        model.contextWindow === null &&
        model.maxContextWindow === null &&
        usesDefaultModalities &&
        model.supportedReasoningLevels.length === 0 &&
        model.defaultReasoningLevel === null
      ) {
        return model.id;
      }
      const entry: Record<string, unknown> = { id: model.id };
      if (model.contextWindow !== null) {
        entry.context_window = model.contextWindow;
      }
      if (model.maxContextWindow !== null) {
        entry.max_context_window = model.maxContextWindow;
      }
      entry.input_modalities = modalities.length > 0 ? modalities : [...DEFAULT_CUSTOM_MODEL_MODALITIES];
      if (model.supportedReasoningLevels.length > 0) {
        entry.supported_reasoning_levels = [...model.supportedReasoningLevels];
        if (model.defaultReasoningLevel !== null) {
          entry.default_reasoning_level = model.defaultReasoningLevel;
        }
      }
      return entry;
    });
  }
  return value;
}

export interface ApprovalRequest {
  id: string | number;
  kind: 'command' | 'file';
  title: string;
  detail?: string;
  reason?: string | null;
}

export interface ProjectView {
  id: string;
  name: string;
  roots: string[];
  primaryRoot: string | null;
  recencyAt: number | null;
  threads: Thread[];
}

export interface PendingSteer {
  id: string;
  text: string;
  images: string[];
}

/// 会话运行期间发送消息的默认行为。
/// - `queue`：等待当前轮结束后再发送。
/// - `steer`：并入当前轮。
export type FollowUpBehavior = 'queue' | 'steer';

/// User message waiting for the active turn to finish before it is sent.
export interface QueuedMessage {
  id: string;
  text: string;
  images: string[];
  input: UserInput[];
  asGoal: boolean;
}

/// 侧边对话分支。`message` 是需要在分支里投递的排队消息，快捷键打开的新分支不带消息。
export interface SideChatBranch {
  threadId: string;
  message: QueuedMessage | null;
}

/// 会话只能只读打开的原因。
/// - `writerBusy`：会话已被另一个 writer 占用。
/// - `missingProvider`：会话记录的 provider 已从配置里删除，无法重建会话。
export type ReadOnlyReason = 'writerBusy' | 'missingProvider';

/// 只读会话。历史可以查看，但发送前必须解决 `reason` 对应的阻塞。
export interface ReadOnlySession {
  threadId: string;
  reason: ReadOnlyReason;
  /// 会话记录里已不存在的 provider 名称，仅 `missingProvider` 使用。
  provider: string | null;
}

export interface WorkxController {
  status: 'connecting' | 'ready' | 'error' | 'stopped';
  statusMessage: string | null;
  serverInfo: InitializeResponse | null;
  models: Model[];
  selectedModelId: string | null;
  selectModel: (id: string) => void;
  providerId: string | null;
  providers: string[];
  providerOptions: ProviderOption[];
  providerConfigs: Record<string, ProviderConfig>;
  providerBusy: boolean;
  selectProvider: (id: string) => Promise<void>;
  saveProvider: (id: string, config: ProviderConfig) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  readProviderBalance: (id: string | null) => Promise<ProviderBalanceView>;
  selectedEffort: string | null;
  setEffort: (effort: string) => void;
  permission: PermissionMode;
  setPermission: (mode: PermissionMode) => void;
  projects: ProjectView[];
  recents: Thread[];
  activeThread: Thread | null;
  draft: { projectId: string | null } | null;
  /// 当前会话树的子 agent 线程，包含更深层后代，用于顶栏子代理面板。
  subAgents: Thread[];
  /// 当前会话树根线程 id；浏览子代理会话时保持不变。未打开会话时为 null。
  subAgentRootId: string | null;
  transcript: TranscriptEntry[];
  pendingSteers: PendingSteer[];
  queuedMessages: QueuedMessage[];
  /// 运行期间发送消息的默认行为。
  followUpBehavior: FollowUpBehavior;
  setFollowUpBehavior: (behavior: FollowUpBehavior) => void;
  queueBusy: boolean;
  removeQueued: (id: string) => void;
  editQueued: (id: string, text: string) => void;
  /// 按给定 id 顺序重排排队消息，未出现在 `ids` 里的消息追加到最后。
  reorderQueued: (ids: string[]) => void;
  setEditingQueued: (id: string | null) => void;
  /// 投递排队消息。返回需要打开的侧边对话分支；插话到当前会话或失败时返回 null。
  sendQueued: (id: string, destination: 'current' | 'side') => Promise<SideChatBranch | null>;
  /// 为当前会话派生一个不含消息的侧边对话分支。没有打开会话时返回 null。
  openSideChat: () => Promise<SideChatBranch | null>;
  running: boolean;
  approvals: ApprovalRequest[];
  warnings: string[];
  error: string | null;
  cwd: string;
  searchTerm: string;
  searchResults: Thread[];
  searching: boolean;
  pluginMarketplaces: PluginMarketplaceEntry[];
  pluginErrors: MarketplaceLoadErrorInfo[];
  pluginsLoading: boolean;
  skills: SkillMetadata[];
  skillErrors: SkillErrorInfo[];
  skillsLoading: boolean;
  mcpServers: McpServerStatus[];
  mcpLoading: boolean;
  slashCommands: SlashCommandInfo[];
  goal: ThreadGoal | null;
  setGoal: (objective: string) => Promise<ThreadGoal | null>;
  clearGoal: () => Promise<void>;
  setGoalStatus: (status: ThreadGoalStatus) => Promise<void>;
  setActiveCwd: (cwd: string) => void;
  newThread: () => Promise<void>;
  newThreadInProject: (projectId: string) => Promise<void>;
  openThread: (id: string) => Promise<void>;
  forkThread: (lastTurnId: string) => Promise<void>;
  retryActiveThread: () => Promise<void>;
  /// 会话只读打开的原因；null 表示会话可写。
  readOnly: ReadOnlySession | null;
  sendMessage: (
    text: string,
    bindings?: ComposerMenuBinding[],
    images?: string[],
    options?: { asGoal?: boolean; behavior?: FollowUpBehavior },
  ) => Promise<void>;
  /// 发送已构造好的输入项。侧边对话投递排队消息时用它保留原始附件与提及。
  sendInput: (
    input: UserInput[],
    text: string,
    images: string[],
    options?: { asGoal?: boolean; behavior?: FollowUpBehavior },
  ) => Promise<void>;
  searchMentionFiles: (query: string) => Promise<FuzzyFileSearchResult[]>;
  searchMentionChats: (query: string) => Promise<Thread[]>;
  compactThread: () => Promise<void>;
  reviewChanges: () => Promise<void>;
  initAgentsFile: () => Promise<void>;
  interrupt: () => Promise<void>;
  renameThread: (id: string, name: string) => Promise<void>;
  archiveThread: (id: string) => Promise<void>;
  deleteThread: (id: string) => Promise<void>;
  setSearchTerm: (term: string) => void;
  refreshPlugins: () => Promise<void>;
  refreshSkills: () => Promise<void>;
  refreshMcpServers: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  createProject: (name: string, roots: string[]) => Promise<Project>;
  updateProject: (id: string, name: string, roots: string[]) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  resolveApproval: (id: string | number, decision: 'accept' | 'decline') => Promise<void>;
  dismissError: () => void;
  refreshThreads: () => Promise<void>;
  refreshSubAgents: () => Promise<void>;
}

interface State {
  status: WorkxController['status'];
  statusMessage: string | null;
  serverInfo: InitializeResponse | null;
  models: Model[];
  projects: Project[];
  threads: Thread[];
  subAgents: Thread[];
  subAgentRootId: string | null;
  activeThread: Thread | null;
  draft: { projectId: string | null } | null;
  readOnly: ReadOnlySession | null;
  turns: TurnView[];
  pendingSteers: PendingSteer[];
  queuedMessages: QueuedMessage[];
  running: boolean;
  activeTurnId: string | null;
  approvals: ApprovalRequest[];
  warnings: string[];
  error: string | null;
  searchTerm: string;
  searchResults: Thread[];
  searching: boolean;
  pluginMarketplaces: PluginMarketplaceEntry[];
  pluginErrors: MarketplaceLoadErrorInfo[];
  pluginsLoading: boolean;
  skills: SkillMetadata[];
  skillErrors: SkillErrorInfo[];
  skillsLoading: boolean;
  mcpServers: McpServerStatus[];
  mcpLoading: boolean;
  slashCommands: SlashCommandInfo[];
  goal: ThreadGoal | null;
  goalTurnIds: string[];
}

type Action =
  | { type: 'status'; status: State['status']; message?: string | null }
  | { type: 'serverInfo'; info: InitializeResponse | null }
  | { type: 'models'; models: Model[] }
  | { type: 'projects'; projects: Project[] }
  | { type: 'threads'; threads: Thread[] }
  | { type: 'subAgents'; threads: Thread[]; rootThreadId: string | null }
  | { type: 'subAgentUpdated'; thread: Thread }
  | { type: 'threadUpsert'; thread: Thread }
  | { type: 'draft'; projectId: string | null }
  | { type: 'thread'; thread: Thread; turns: TurnView[]; readOnly?: ReadOnlySession | null }
  | { type: 'item'; turnId: string; item: ThreadItem }
  | { type: 'delta'; turnId: string; itemId: string; delta: string }
  | { type: 'turnStarted'; turnId: string; startedAtMs: number | null }
  | { type: 'turnCompleted'; turnId: string; durationMs: number | null; status: TurnView['status'] }
  | { type: 'steerPending'; steer: PendingSteer }
  | { type: 'steerSettled'; text: string }
  | { type: 'queueAdd'; message: QueuedMessage }
  | { type: 'queueRemove'; id: string }
  | { type: 'queueEdit'; id: string; text: string }
  | { type: 'queueOrder'; ids: string[] }
  | { type: 'warning'; message: string }
  | { type: 'error'; message: string | null }
  | { type: 'approvalAdd'; approval: ApprovalRequest }
  | { type: 'approvalRemove'; id: string | number }
  | { type: 'searchTerm'; term: string }
  | { type: 'searchResults'; results: Thread[]; searching: boolean }
  | { type: 'threadUpdated'; thread: Thread }
  | { type: 'threadRemoved'; threadId: string }
  | {
      type: 'plugins';
      marketplaces: PluginMarketplaceEntry[];
      errors: MarketplaceLoadErrorInfo[];
    }
  | { type: 'pluginsLoading'; loading: boolean }
  | { type: 'skills'; skills: SkillMetadata[]; errors: SkillErrorInfo[] }
  | { type: 'skillsLoading'; loading: boolean }
  | { type: 'mcp'; servers: McpServerStatus[] }
  | { type: 'mcpLoading'; loading: boolean }
  | { type: 'slashCommands'; commands: SlashCommandInfo[] }
  | { type: 'goal'; goal: ThreadGoal | null }
  | { type: 'goalTurn'; turnId: string };

const initialState: State = {
  status: 'connecting',
  statusMessage: null,
  serverInfo: null,
  models: [],
  projects: [],
  threads: [],
  subAgents: [],
  subAgentRootId: null,
  activeThread: null,
  draft: null,
  readOnly: null,
  turns: [],
  pendingSteers: [],
  queuedMessages: [],
  running: false,
  activeTurnId: null,
  approvals: [],
  warnings: [],
  error: null,
  searchTerm: '',
  searchResults: [],
  searching: false,
  pluginMarketplaces: [],
  pluginErrors: [],
  pluginsLoading: false,
  skills: [],
  skillErrors: [],
  skillsLoading: false,
  mcpServers: [],
  mcpLoading: false,
  slashCommands: [],
  goal: null,
  goalTurnIds: [],
};

function upsertItem(items: ThreadItem[], item: ThreadItem): ThreadItem[] {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index < 0) {
    return [...items, item];
  }
  return items.map((existing, position) => (position === index ? item : existing));
}

function upsertTurn(turns: TurnView[], turnId: string): [TurnView[], TurnView] {
  const existing = turns.find((turn) => turn.id === turnId);
  if (existing) {
    return [turns, existing];
  }
  const created: TurnView = {
    id: turnId,
    items: [],
    status: null,
    durationMs: null,
    startedAtMs: null,
  };
  return [[...turns, created], created];
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'status':
      return { ...state, status: action.status, statusMessage: action.message ?? null };
    case 'serverInfo':
      return { ...state, serverInfo: action.info };
    case 'models':
      return { ...state, models: action.models };
    case 'projects':
      return { ...state, projects: action.projects };
    case 'threads':
      return {
        ...state,
        threads: action.threads,
        activeThread: state.activeThread
          ? (action.threads.find((thread) => thread.id === state.activeThread?.id) ??
            state.activeThread)
          : null,
      };
    case 'threadUpsert': {
      const exists = state.threads.some((thread) => thread.id === action.thread.id);
      return {
        ...state,
        threads: exists
          ? state.threads.map((thread) =>
              thread.id === action.thread.id ? action.thread : thread,
            )
          : [action.thread, ...state.threads],
      };
    }
    case 'draft':
      return {
        ...state,
        activeThread: null,
        draft: { projectId: action.projectId },
        turns: [],
        pendingSteers: [],
        queuedMessages: [],
        readOnly: null,
        running: false,
        activeTurnId: null,
        error: null,
        warnings: [],
        approvals: [],
      };
    case 'thread':
      return {
        ...state,
        activeThread: action.thread,
        draft: null,
        turns: action.turns,
        pendingSteers: [],
        queuedMessages: [],
        readOnly: action.readOnly ?? null,
        running: action.readOnly
          ? false
          : action.turns.some((turn) => turn.status === 'inProgress'),
        activeTurnId: null,
        error: null,
        warnings: [],
        approvals: [],
        goal: null,
        goalTurnIds: [],
      };
    case 'item': {
      const [turns, turn] = upsertTurn(state.turns, action.turnId);
      return {
        ...state,
        turns: turns.map((entry) =>
          entry.id === turn.id ? { ...entry, items: upsertItem(entry.items, action.item) } : entry,
        ),
      };
    }
    case 'delta': {
      const [turns, turn] = upsertTurn(state.turns, action.turnId);
      const hasItem = turn.items.some((item) => item.id === action.itemId);
      const items = hasItem
        ? turn.items.map((item) =>
            item.id === action.itemId && item.type === 'agentMessage'
              ? { ...item, text: item.text + action.delta }
              : item,
          )
        : [
            ...turn.items,
            {
              type: 'agentMessage' as const,
              id: action.itemId,
              text: action.delta,
              phase: null,
              memoryCitation: null,
              delivery: null,
              questions: null,
            },
          ];
      return {
        ...state,
        turns: turns.map((entry) => (entry.id === turn.id ? { ...entry, items } : entry)),
      };
    }
    case 'turnStarted': {
      const [turns, turn] = upsertTurn(state.turns, action.turnId);
      return {
        ...state,
        running: true,
        activeTurnId: action.turnId,
        turns: turns.map((entry) =>
          entry.id === turn.id
            ? { ...entry, startedAtMs: action.startedAtMs, status: 'inProgress' }
            : entry,
        ),
      };
    }
    case 'turnCompleted':
      return {
        ...state,
        running: false,
        activeTurnId: null,
        approvals: [],
        pendingSteers: [],
        turns: state.turns.map((entry) =>
          entry.id === action.turnId
            ? { ...entry, status: action.status, durationMs: action.durationMs }
            : entry,
        ),
      };
    case 'steerPending':
      return { ...state, pendingSteers: [...state.pendingSteers, action.steer] };
    case 'steerSettled':
      return {
        ...state,
        pendingSteers: state.pendingSteers.filter((steer) => steer.text !== action.text),
      };
    case 'queueAdd':
      return { ...state, queuedMessages: [...state.queuedMessages, action.message] };
    case 'queueRemove':
      return {
        ...state,
        queuedMessages: state.queuedMessages.filter((message) => message.id !== action.id),
      };
    case 'queueEdit':
      return {
        ...state,
        queuedMessages: state.queuedMessages.map((message) => message.id === action.id
          ? { ...message, text: action.text, input: [
              { type: 'text', text: action.text, text_elements: [] },
              ...message.input.filter((item) => item.type !== 'text'),
            ] }
          : message),
      };
    case 'queueOrder': {
      const byId = new Map(state.queuedMessages.map((message) => [message.id, message]));
      const ordered = action.ids
        .map((id) => byId.get(id))
        .filter((message): message is QueuedMessage => message !== undefined);
      const missing = state.queuedMessages.filter((message) => !action.ids.includes(message.id));
      return { ...state, queuedMessages: [...ordered, ...missing] };
    }
    case 'warning':
      return { ...state, warnings: [...state.warnings.slice(-4), action.message] };
    case 'error':
      return { ...state, error: action.message };
    case 'approvalAdd':
      return { ...state, approvals: [...state.approvals, action.approval] };
    case 'approvalRemove':
      return {
        ...state,
        approvals: state.approvals.filter((approval) => approval.id !== action.id),
      };
    case 'searchTerm':
      return {
        ...state,
        searchTerm: action.term,
        searchResults: action.term.trim() ? state.searchResults : [],
      };
    case 'searchResults':
      return { ...state, searchResults: action.results, searching: action.searching };
    case 'threadUpdated':
      return {
        ...state,
        threads: state.threads.map((thread) =>
          thread.id === action.thread.id ? action.thread : thread,
        ),
        activeThread:
          state.activeThread?.id === action.thread.id ? action.thread : state.activeThread,
      };
    case 'subAgents':
      return { ...state, subAgents: action.threads, subAgentRootId: action.rootThreadId };
    case 'subAgentUpdated':
      return {
        ...state,
        subAgents: state.subAgents.map((thread) =>
          thread.id === action.thread.id ? action.thread : thread,
        ),
      };
    case 'threadRemoved':
      return {
        ...state,
        threads: state.threads.filter((thread) => thread.id !== action.threadId),
        activeThread:
          state.activeThread?.id === action.threadId ? null : state.activeThread,
        turns: state.activeThread?.id === action.threadId ? [] : state.turns,
        readOnly:
          state.activeThread?.id === action.threadId ? null : state.readOnly,
      };
    case 'plugins':
      return {
        ...state,
        pluginMarketplaces: action.marketplaces,
        pluginErrors: action.errors,
        pluginsLoading: false,
      };
    case 'pluginsLoading':
      return { ...state, pluginsLoading: action.loading };
    case 'skills':
      return {
        ...state,
        skills: action.skills,
        skillErrors: action.errors,
        skillsLoading: false,
      };
    case 'skillsLoading':
      return { ...state, skillsLoading: action.loading };
    case 'mcp':
      return { ...state, mcpServers: action.servers, mcpLoading: false };
    case 'mcpLoading':
      return { ...state, mcpLoading: action.loading };
    case 'slashCommands':
      return { ...state, slashCommands: action.commands };
    case 'goal':
      return { ...state, goal: action.goal };
    case 'goalTurn':
      return state.goalTurnIds.includes(action.turnId)
        ? state
        : { ...state, goalTurnIds: [...state.goalTurnIds, action.turnId] };
    default:
      return state;
  }
}

function turnView(turn: Turn): TurnView {
  return {
    id: turn.id,
    items: turn.items,
    status: turn.status,
    durationMs: turn.durationMs,
    startedAtMs: turn.startedAt === null ? null : turn.startedAt * 1000,
  };
}

/**
 * Resumed-thread config overrides.
 *
 * The app-server applies them only when the requesting connection holds no
 * subscription for the thread, so a resume that carries overrides must
 * unsubscribe first and cannot be retried while the thread is running.
 */
interface ThreadResumeOverrides {
  modelProvider: string;
  model: string | null;
}

export function useWorkx(): WorkxController {
  const { t } = useI18n();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [providers, setProviders] = useState<string[]>([]);
  const [providerConfigs, setProviderConfigs] = useState<Record<string, ProviderConfig>>({});
  const [providerBusy, setProviderBusy] = useState(false);
  const [effortId, setEffortId] = useState<string | null>(null);
  const [permissionId, setPermissionId] = useState('full-access');
  const [cwd, setCwd] = useState('');
  const [followUpBehavior, setFollowUpBehavior] = useState<FollowUpBehavior>(() => {
    const stored = window.localStorage.getItem('workx.followUpBehavior');
    if (stored === 'queue' || stored === 'steer') {
      return stored;
    }
    // 旧版本只持久化排队开关，读到旧键时按开关换算。
    return window.localStorage.getItem('workx.queueing') === 'false' ? 'steer' : 'queue';
  });
  const [queueBusy, setQueueBusy] = useState(false);
  const [editingQueued, setEditingQueued] = useState<string | null>(null);
  const queueActionRef = useRef(false);

  const threadIdRef = useRef<string | null>(null);
  const turnIdRef = useRef<string | null>(null);
  const modelRef = useRef<string | null>(null);
  const providerRef = useRef<string | null>(null);
  const effortRef = useRef<string | null>(null);
  const permissionRef = useRef<PermissionMode>(
    PERMISSION_MODES.find((mode) => mode.id === 'full-access') ?? PERMISSION_MODES[0],
  );
  const cwdRef = useRef('');
  const bootedRef = useRef(false);
  const threadsRef = useRef<Thread[]>([]);
  const projectsRef = useRef<Project[]>([]);
  const activeProjectIdRef = useRef<string | null>(null);
  const selectionRef = useRef(0);
  const pendingStartRef = useRef<Promise<string> | null>(null);
  const pendingThreadsRef = useRef<Map<string, Thread>>(new Map());
  const subAgentsRef = useRef<Thread[]>([]);
  /// 子代理面板的锚点线程：会话树根线程。浏览子代理会话时保持不变。
  const subAgentRootRef = useRef<string | null>(null);
  const subAgentRequestRef = useRef(0);

  const permission = useMemo(
    () => PERMISSION_MODES.find((mode) => mode.id === permissionId) ?? PERMISSION_MODES[0],
    [permissionId],
  );

  useEffect(() => {
    permissionRef.current = permission;
  }, [permission]);

  useEffect(() => {
    threadsRef.current = state.threads;
  }, [state.threads]);

  const request = useCallback(<T,>(method: string, params?: unknown): Promise<T> => {
    return window.workx.appServer.request<T>(method, params);
  }, []);

  useEffect(() => {
    subAgentsRef.current = state.subAgents;
  }, [state.subAgents]);

  const refreshThreads = useCallback(async () => {
    const response = await request<ThreadListResponse>(
      'thread/list',
      {
        limit: 200,
        sortKey: 'recency_at',
        sortDirection: 'desc',
      } satisfies ThreadListRequestParams,
    );
    const serverIds = new Set(response.data.map((thread) => thread.id));
    for (const id of serverIds) {
      pendingThreadsRef.current.delete(id);
    }
    dispatch({
      type: 'threads',
      threads: [...pendingThreadsRef.current.values(), ...response.data],
    });
  }, [request]);

  /**
   * 刷新子代理列表。查询以会话树根线程为祖先，因此子代理会话中嵌套的子代理也会列出。
   * 不带 sourceKinds，否则 app-server 只会返回交互式会话。
   */
  const refreshSubAgents = useCallback(async () => {
    const rootThreadId = subAgentRootRef.current;
    const requestId = ++subAgentRequestRef.current;
    if (!rootThreadId) {
      dispatch({ type: 'subAgents', threads: [], rootThreadId: null });
      return;
    }
    try {
      const response = await request<ThreadListResponse>(
        'thread/list',
        {
          ancestorThreadId: rootThreadId,
          limit: 50,
          sortKey: 'created_at',
          sortDirection: 'desc',
          useStateDbOnly: true,
        } satisfies ThreadListRequestParams,
      );
      if (requestId === subAgentRequestRef.current) {
        dispatch({ type: 'subAgents', threads: response.data, rootThreadId });
      }
    } catch {
      // 子代理列表只用于展示；请求失败时保留上一次结果。
    }
  }, [request]);

  const refreshProjects = useCallback(async () => {
    const response = await request<ProjectListResponse>('project/list', {
      limit: 100,
      sortKey: 'position',
      sortDirection: 'asc',
    });
    projectsRef.current = response.data;
    dispatch({ type: 'projects', projects: response.data });
  }, [request]);

  const refreshModels = useCallback(async () => {
    const [listed, config] = await Promise.all([
      request<ModelListResponse>('model/list', {}),
      request<ConfigReadResponse>('config/read', {}),
    ]);
    dispatch({ type: 'models', models: listed.data });
    if (!modelRef.current) {
      // The configured model is the last one the user picked, so a new chat keeps using it
      // instead of falling back to the catalog default.
      const configured = config.config.model;
      const preferred =
        (configured ? listed.data.find((model) => model.id === configured) : undefined) ??
        listed.data.find((model) => model.isDefault) ??
        listed.data[0] ??
        null;
      if (preferred) {
        modelRef.current = preferred.id;
        setSelectedModelId(preferred.id);
        effortRef.current = preferred.defaultReasoningEffort ?? null;
        setEffortId(preferred.defaultReasoningEffort ?? null);
      }
    }
  }, [request]);

  const persistModelSelection = useCallback(
    async (model: string, effort: string | null) => {
      try {
        await request('config/batchWrite', {
          edits: [
            { keyPath: 'model', value: model, mergeStrategy: 'replace' },
            {
              keyPath: 'model_reasoning_effort',
              value: effort ?? null,
              mergeStrategy: 'replace',
            },
          ],
          reloadUserConfig: true,
        });
      } catch (error) {
        dispatch({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [request],
  );

  const refreshSlashCommands = useCallback(async () => {
    try {
      const response = await request<{ data: SlashCommandInfo[] }>('slashCommands/list', {});
      dispatch({ type: 'slashCommands', commands: response.data });
    } catch {
      // App-servers older than `slashCommands/list` still support the goal and
      // thread APIs, so keep the composer usable with a built-in subset rather
      // than failing the whole boot.
      dispatch({ type: 'slashCommands', commands: FALLBACK_SLASH_COMMANDS });
    }
  }, [request]);

  const loadGoal = useCallback(
    async (threadId: string) => {
      try {
        const response = await request<ThreadGoalGetResponse>('thread/goal/get', {
          threadId,
        });
        if (threadIdRef.current === threadId) {
          dispatch({ type: 'goal', goal: response.goal });
        }
      } catch {
        if (threadIdRef.current === threadId) {
          dispatch({ type: 'goal', goal: null });
        }
      }
    },
    [request],
  );

  const applyConfigRead = useCallback((response: ConfigReadResponse) => {
    const raw =
      (response.config.model_providers as Record<string, unknown> | undefined) ?? {};
    setProviderConfigs(
      Object.fromEntries(
        Object.entries({ ...LOCAL_MODEL_PROVIDER_DEFAULTS, ...raw })
          .map(([id, value]) => [id, normalizeProviderConfig(value)]),
      ),
    );
    const ids = Array.from(new Set([...Object.keys(raw), ...Object.keys(LOCAL_MODEL_PROVIDER_DEFAULTS)])).sort();
    setProviders(ids);
    providerRef.current = response.config.model_provider ?? null;
    setProviderId(response.config.model_provider ?? null);
    return raw;
  }, []);

  const refreshProviders = useCallback(async () => {
    applyConfigRead(await request<ConfigReadResponse>('config/read', { includeLayers: true }));
  }, [applyConfigRead, request]);

  // Reloads the model catalog for the active provider and repairs the persisted model.
  // A model the new provider does not list cannot be used, so it is replaced by the provider
  // default; otherwise the previous selection is kept.
  const loadModelsForActiveProvider = useCallback(async () => {
    const listed = await request<ModelListResponse>('model/list', {});
    const current = modelRef.current;
    const preferred =
      (current ? listed.data.find((model) => model.id === current) : undefined) ??
      listed.data.find((model) => model.isDefault) ??
      listed.data[0] ??
      null;
    await request('config/batchWrite', {
      edits: [{ keyPath: 'model', value: preferred?.id ?? null, mergeStrategy: 'replace' }],
      reloadUserConfig: true,
    });
    dispatch({ type: 'models', models: listed.data });
    modelRef.current = preferred?.id ?? null;
    setSelectedModelId(preferred?.id ?? null);
    effortRef.current = preferred?.defaultReasoningEffort ?? null;
    setEffortId(preferred?.defaultReasoningEffort ?? null);
  }, [request]);

  const openThread = useCallback(
    async (id: string, overrides?: ThreadResumeOverrides) => {
      const selection = ++selectionRef.current;
      let thread: Thread | null = null;
      // The resume response carries the stored thread summary plus the settings the new
      // session actually uses. The summary lags a resume that applied overrides, so the
      // composer must read the session fields.
      let resumedSession: { model: string; modelProvider: string; effort: string | null } | null = null;
      let readOnly: ReadOnlySession | null = null;
      const knownThread =
        threadsRef.current.find((candidate) => candidate.id === id) ??
        subAgentsRef.current.find((candidate) => candidate.id === id);
      const projectId = knownThread?.projectId ?? null;
      try {
        if (overrides) {
          // Resuming with overrides rebuilds the session only when this connection is
          // not subscribed yet. A failed unsubscribe therefore costs the override, not
          // the resume, and the post-resume check reports it.
          await request('thread/unsubscribe', { threadId: id }).catch(() => undefined);
        }
        const response = await request<ThreadResumeResponse>('thread/resume', {
          threadId: id,
          runtimeWorkspaceRoots: projectWorkspaceRoots(projectsRef.current, projectId),
          modelProvider: overrides?.modelProvider,
          model: overrides?.model ?? undefined,
        });
        thread = response.thread;
        resumedSession = {
          model: response.model,
          modelProvider: response.modelProvider,
          effort: response.reasoningEffort,
        };
      } catch (error) {
        if (selection !== selectionRef.current) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        const missingProvider = /Model provider `([^`]+)` not found/.exec(message);
        // 无法重建会话时仍展示历史：会话被另一个 writer 占用，或会话记录的 provider 已被删除。
        if (!message.includes('already has an active writer') && !missingProvider) {
          dispatch({ type: 'error', message });
          return;
        }
        readOnly = missingProvider
          ? { threadId: id, reason: 'missingProvider', provider: missingProvider[1] }
          : { threadId: id, reason: 'writerBusy', provider: null };
        try {
          const response = await request<ThreadReadResponse>('thread/read', {
            threadId: id,
            includeTurns: true,
          });
          thread = response.thread;
        } catch (readError) {
          if (selection === selectionRef.current) {
            dispatch({
              type: 'error',
              message: readError instanceof Error ? readError.message : String(readError),
            });
          }
          return;
        }
      }
      if (!thread || selection !== selectionRef.current) {
        return;
      }
      threadIdRef.current = thread.id;
      activeProjectIdRef.current = thread.projectId;
      turnIdRef.current = null;
      // 顶层会话重设面板锚点；打开子代理会话时保留原锚点，面板继续列出它的兄弟代理。
      if (thread.parentThreadId === null) {
        subAgentRootRef.current = thread.id;
      }
      void refreshSubAgents();
      if (thread.cwd && thread.cwd !== cwdRef.current) {
        cwdRef.current = thread.cwd;
        setCwd(thread.cwd);
      }
      const activeModel = resumedSession?.model ?? thread.model;
      const activeProvider = resumedSession?.modelProvider ?? thread.modelProvider;
      const activeEffort = resumedSession ? resumedSession.effort : (thread.reasoningEffort ?? null);
      // Overrides only survive a resume that rebuilt the session, so a session that still
      // reports the previous provider means the request was dropped, not deferred.
      const ignoredOverride = Boolean(overrides && activeProvider !== overrides.modelProvider);
      // 只读会话不改写 composer：provider 已删除时，会话里的 provider 不能作为当前选择。
      const adoptSession = !ignoredOverride && readOnly?.reason !== 'missingProvider';
      // A reopened chat keeps working with the provider, model, and effort it already used
      // instead of inheriting whatever the composer last showed.
      if (adoptSession && activeModel) {
        modelRef.current = activeModel;
        setSelectedModelId(activeModel);
      }
      if (adoptSession) {
        effortRef.current = activeEffort;
        setEffortId(activeEffort);
      }
      if (adoptSession && activeProvider) {
        providerRef.current = activeProvider;
        setProviderId(activeProvider);
      }
      dispatch({
        type: 'thread',
        thread,
        turns: thread.turns.map(turnView),
        readOnly,
      });
      // The thread view resets warnings, so report the ignored override after it renders.
      if (ignoredOverride) {
        dispatch({ type: 'warning', message: t('provider.switchDeferred') });
      }
      void loadGoal(thread.id);
    },
    [loadGoal, refreshSubAgents, request, t],
  );

  // A session keeps the provider snapshot it was created with, so provider changes only
  // reach an open chat after its session is rebuilt.
  const applyProviderToActiveThread = useCallback(
    async (id: string) => {
      const threadId = threadIdRef.current;
      if (threadId) {
        await openThread(threadId, { modelProvider: id, model: modelRef.current });
      }
    },
    [openThread],
  );

  const saveProvider = useCallback(
    async (id: string, config: ProviderConfig) => {
      const value = providerConfigToToml(config);
      const edits: { keyPath: string; value: unknown; mergeStrategy: 'replace' | 'upsert' }[] = [
        { keyPath: `model_providers.${id}`, value, mergeStrategy: 'upsert' },
      ];
      for (const key of OPTIONAL_PROVIDER_CONFIG_KEYS) {
        if (!(key in value)) {
          edits.push({
            keyPath: `model_providers.${id}.${key}`,
            value: null,
            mergeStrategy: 'replace',
          });
        }
      }
      await request('config/batchWrite', { edits, reloadUserConfig: true });
      const raw = applyConfigRead(
        await request<ConfigReadResponse>('config/read', { includeLayers: true }),
      );
      // Older CLIs ignore `custom_models` instead of rejecting it, so a save
      // would look successful while the model never appears.
      const saved = normalizeProviderConfig(raw[id]);
      const missing = config.customModels.filter(
        (model) => !saved.customModels.some((candidate) => candidate.id === model.id),
      );
      if (missing.length > 0) {
        throw new Error(
          t('provider.customModelsUnsupported', {
            models: missing.map((model) => model.id).join(', '),
          }),
        );
      }
      if (id === providerId) {
        try {
          await loadModelsForActiveProvider();
          await applyProviderToActiveThread(id);
        } catch (error) {
          dispatch({
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
    [
      applyConfigRead,
      applyProviderToActiveThread,
      loadModelsForActiveProvider,
      providerId,
      request,
      t,
    ],
  );

  const deleteProvider = useCallback(
    async (id: string) => {
      const wasActive = id === providerId;
      const remaining = providers.filter((candidate) => candidate !== id);
      const custom = remaining.filter(
        (candidate) => !BUILTIN_MODEL_PROVIDER_IDS.includes(candidate),
      );
      const fallback = custom[0] ?? (remaining.includes('openai') ? 'openai' : remaining[0]);
      const edits: { keyPath: string; value: unknown; mergeStrategy: 'replace' }[] = [
        { keyPath: `model_providers.${id}`, value: null, mergeStrategy: 'replace' },
      ];
      // Clear the selection in the same write so the config never references a
      // provider that no longer exists.
      if (wasActive && fallback) {
        edits.push(
          { keyPath: 'model_provider', value: fallback, mergeStrategy: 'replace' },
          { keyPath: 'model_reasoning_effort', value: null, mergeStrategy: 'replace' },
          { keyPath: 'service_tier', value: null, mergeStrategy: 'replace' },
        );
      }
      await request('config/batchWrite', { edits, reloadUserConfig: true });
      await refreshProviders();
      if (wasActive && fallback) {
        try {
          await loadModelsForActiveProvider();
        } catch (error) {
          dispatch({
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
    [
      loadModelsForActiveProvider,
      providerId,
      providers,
      refreshProviders,
      request,
    ],
  );

  const readProviderBalance = useCallback(
    async (id: string | null) => {
      return request<ProviderBalanceView>('modelProvider/balance/read', {
        providerId: id,
      });
    },
    [request],
  );

  const startThread = useCallback(
    async (projectId?: string, cwd?: string, selection?: number): Promise<string> => {
      const response = await request<ThreadStartResponse>('thread/start', {
        cwd: cwd ?? (cwdRef.current || undefined),
        projectId: projectId ?? undefined,
        runtimeWorkspaceRoots: projectWorkspaceRoots(projectsRef.current, projectId ?? null),
        model: modelRef.current ?? undefined,
        modelProvider: providerRef.current ?? undefined,
        approvalPolicy: permissionRef.current.approvalPolicy,
        sandbox: permissionRef.current.sandbox,
      });
      pendingThreadsRef.current.set(response.thread.id, response.thread);
      dispatch({ type: 'threadUpsert', thread: response.thread });
      // A start that finishes after the user opened another chat must not steal the view.
      if (selection === undefined || selection === selectionRef.current) {
        threadIdRef.current = response.thread.id;
        activeProjectIdRef.current = response.thread.projectId;
        turnIdRef.current = null;
        if (response.thread.cwd && response.thread.cwd !== cwdRef.current) {
          cwdRef.current = response.thread.cwd;
          setCwd(response.thread.cwd);
        }
        dispatch({ type: 'thread', thread: response.thread, turns: [] });
        // 新建会话即新的会话树根，子代理面板以它为锚点。
        if (response.thread.parentThreadId === null) {
          subAgentRootRef.current = response.thread.id;
        }
        void refreshSubAgents();
      }
      return response.thread.id;
    },
    [refreshSubAgents, request],
  );

  const beginThread = useCallback(
    async (projectId: string | null) => {
      const selection = ++selectionRef.current;
      threadIdRef.current = null;
      turnIdRef.current = null;
      subAgentRootRef.current = null;
      void refreshSubAgents();
      const project = projectsRef.current.find((candidate) => candidate.id === projectId);
      const primaryRoot = project?.roots[0]?.path;
      if (primaryRoot) {
        cwdRef.current = primaryRoot;
        setCwd(primaryRoot);
      }
      activeProjectIdRef.current = projectId;
      dispatch({ type: 'draft', projectId });
      const starting = startThread(projectId ?? undefined, primaryRoot, selection);
      pendingStartRef.current = starting;
      try {
        await starting;
      } catch (error) {
        if (selection === selectionRef.current) {
          dispatch({
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (pendingStartRef.current === starting) {
          pendingStartRef.current = null;
        }
      }
    },
    [refreshSubAgents, startThread],
  );

  const newThread = useCallback(() => beginThread(null), [beginThread]);

  const newThreadInProject = useCallback(
    (projectId: string) => beginThread(projectId),
    [beginThread],
  );

  const createProject = useCallback(
    async (name: string, roots: string[]): Promise<Project> => {
      const response = await request<ProjectCreateResponse>('project/create', {
        name,
        roots: roots.map((path) => ({ path })),
        metadata: {},
        idempotencyKey: crypto.randomUUID(),
      });
      await refreshProjects();
      return response.project;
    },
    [request, refreshProjects],
  );

  const updateProject = useCallback(
    async (id: string, name: string, roots: string[]) => {
      await request<ProjectUpdateResponse>('project/update', {
        projectId: id,
        name,
        roots: roots.map((path) => ({ path })),
      });
      await refreshProjects();
    },
    [request, refreshProjects],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      await request<ProjectDeleteResponse>('project/delete', { projectId: id });
      await Promise.all([refreshProjects(), refreshThreads()]);
    },
    [request, refreshProjects, refreshThreads],
  );

  const selectProvider = useCallback(
    async (id: string) => {
      if (providerBusy || id === providerId) {
        return;
      }
      setProviderBusy(true);
      try {
        await request('config/batchWrite', {
          edits: [
            { keyPath: 'model_provider', value: id, mergeStrategy: 'replace' },
            { keyPath: 'model_reasoning_effort', value: null, mergeStrategy: 'replace' },
            { keyPath: 'service_tier', value: null, mergeStrategy: 'replace' },
          ],
          reloadUserConfig: true,
        });
        await refreshProviders();
        await loadModelsForActiveProvider();
        await applyProviderToActiveThread(id);
      } catch (error) {
        dispatch({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setProviderBusy(false);
      }
    },
    [
      applyProviderToActiveThread,
      loadModelsForActiveProvider,
      providerBusy,
      providerId,
      refreshProviders,
      request,
    ],
  );

  // 重试只读会话：provider 已删除时必须带上当前的 provider，否则服务端仍按旧 provider 重建。
  const retryActiveThread = useCallback(async () => {
    const threadId = threadIdRef.current;
    const provider = providerRef.current;
    if (!threadId) {
      return;
    }
    if (
      provider &&
      state.readOnly?.threadId === threadId &&
      state.readOnly.reason === 'missingProvider'
    ) {
      await openThread(threadId, { modelProvider: provider, model: modelRef.current });
      return;
    }
    await openThread(threadId);
  }, [openThread, state.readOnly]);

  const forkThread = useCallback(
    async (lastTurnId: string) => {
      const threadId = threadIdRef.current;
      if (!threadId) {
        return;
      }
      const response = await request<ThreadForkResponse>('thread/fork', {
        threadId,
        lastTurnId,
      });
      pendingThreadsRef.current.set(response.thread.id, response.thread);
      dispatch({ type: 'threadUpsert', thread: response.thread });
      await openThread(response.thread.id);
    },
    [openThread, request],
  );

  const setGoal = useCallback(
    async (objective: string) => {
      try {
        const threadId =
          threadIdRef.current ??
          (await (pendingStartRef.current ??
            startThread(activeProjectIdRef.current ?? undefined)));
        const response = await request<ThreadGoalSetResponse>('thread/goal/set', {
          threadId,
          objective,
          status: 'active' as ThreadGoalStatus,
        });
        dispatch({ type: 'goal', goal: response.goal });
        return response.goal;
      } catch (error) {
        dispatch({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    [request, startThread],
  );

  const clearGoal = useCallback(async () => {
    const threadId = threadIdRef.current;
    if (!threadId) {
      return;
    }
    try {
      await request('thread/goal/clear', { threadId });
      dispatch({ type: 'goal', goal: null });
    } catch (error) {
      dispatch({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [request]);

  const setGoalStatus = useCallback(
    async (status: ThreadGoalStatus) => {
      const threadId = threadIdRef.current;
      if (!threadId) {
        return;
      }
      try {
        const response = await request<ThreadGoalSetResponse>('thread/goal/set', {
          threadId,
          status,
        });
        dispatch({ type: 'goal', goal: response.goal });
      } catch (error) {
        dispatch({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [request],
  );

  // Starts a turn on the active thread. Direct sends and drained queue entries share it.
  const startTurn = useCallback(
    async (input: UserInput[], asGoalText: string | null) => {
      const threadId = threadIdRef.current;
      if (!threadId) {
        return;
      }
      const selection = selectionRef.current;
      const response = await request<TurnStartResponse>('turn/start', {
        threadId,
        input,
        runtimeWorkspaceRoots: projectWorkspaceRoots(
          projectsRef.current,
          activeProjectIdRef.current,
        ),
        model: modelRef.current ?? undefined,
        effort: effortRef.current ?? undefined,
      });
      if (selection !== selectionRef.current) {
        return;
      }
      turnIdRef.current = response.turn.id;
      dispatch({
        type: 'turnStarted',
        turnId: response.turn.id,
        startedAtMs: Date.now(),
      });
      if (asGoalText && asGoalText.trim()) {
        await setGoal(asGoalText);
        dispatch({ type: 'goalTurn', turnId: response.turn.id });
      }
    },
    [request, setGoal],
  );

  // 发送已构造好的输入项：补建会话、按需排队，插话失败后回退到新一轮。
  const sendInput = useCallback(
    async (
      input: UserInput[],
      text: string,
      images: string[],
      options?: { asGoal?: boolean; behavior?: FollowUpBehavior },
    ) => {
      if (state.readOnly) {
        return;
      }
      const selection = selectionRef.current;
      const threadId =
        threadIdRef.current ??
        (await (pendingStartRef.current ??
          startThread(activeProjectIdRef.current ?? undefined, undefined, selection)));
      if (selection !== selectionRef.current) {
        return;
      }
      const activeTurnId = turnIdRef.current;
      // 运行期间默认按用户选择的跟进行为处理，调用方可以逐条覆盖。
      const behavior = options?.behavior ?? followUpBehavior;
      if (activeTurnId && behavior === 'queue') {
        dispatch({
          type: 'queueAdd',
          message: {
            id: `queued-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            text,
            images: [...images],
            input,
            asGoal: options?.asGoal ?? false,
          },
        });
        return;
      }
      // Steering is only attempted when the caller asked for it. Fall back to
      // starting a new turn when the active turn already finished.
      if (activeTurnId) {
        let expectedTurnId = activeTurnId;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            await request('turn/steer', { threadId, input, expectedTurnId });
            dispatch({
              type: 'steerPending',
              steer: {
                id: `steer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                text,
                images: [...images],
              },
            });
            if (options?.asGoal && text.trim()) {
              await setGoal(text);
              dispatch({ type: 'goalTurn', turnId: activeTurnId });
            }
            return;
          } catch (steerError) {
            const message =
              steerError instanceof Error ? steerError.message : String(steerError);
            if (message.includes('no active turn to steer')) {
              turnIdRef.current = null;
              break;
            }
            const mismatch = /expected active turn id `[^`]+` but found `([^`]+)`/.exec(
              message,
            );
            if (attempt === 0 && mismatch) {
              expectedTurnId = mismatch[1];
              turnIdRef.current = expectedTurnId;
              continue;
            }
            dispatch({ type: 'error', message });
            return;
          }
        }
      }

      await startTurn(input, options?.asGoal ? text : null);
    },
    [followUpBehavior, request, setGoal, startThread, startTurn, state.readOnly],
  );

  const sendMessage = useCallback(
    async (
      text: string,
      bindings: ComposerMenuBinding[] = [],
      images: string[] = [],
      options?: { asGoal?: boolean; behavior?: FollowUpBehavior },
    ) => {
      const input: UserInput[] = [];
      if (text.length > 0) {
        input.push({ type: 'text', text, text_elements: [] });
      }
      for (const imagePath of images) {
        input.push({ type: 'localImage', path: imagePath });
      }
      for (const binding of bindings) {
        input.push(
          binding.type === 'skill'
            ? { type: 'skill', name: binding.name, path: binding.path }
            : { type: 'mention', name: binding.name, path: binding.path },
        );
      }
      await sendInput(input, text, images, options);
    },
    [sendInput],
  );

  // 派生当前会话的侧边对话分支，不切换当前会话，也不改动原线程。
  const forkSideThread = useCallback(async (): Promise<string | null> => {
    const threadId = threadIdRef.current;
    if (!threadId) {
      return null;
    }
    const response = await request<ThreadForkResponse>('thread/fork', {
      threadId, model: modelRef.current, modelProvider: providerRef.current,
    });
    pendingThreadsRef.current.set(response.thread.id, response.thread);
    dispatch({ type: 'threadUpsert', thread: response.thread });
    return response.thread.id;
  }, [request]);

  const openSideChat = useCallback(async (): Promise<SideChatBranch | null> => {
    try {
      const threadId = await forkSideThread();
      return threadId ? { threadId, message: null } : null;
    } catch (error) {
      dispatch({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }, [forkSideThread]);

  const sendQueued = useCallback(async (id: string, destination: 'current' | 'side') => {
    const message = state.queuedMessages.find((candidate) => candidate.id === id);
    const threadId = threadIdRef.current;
    if (!message || !threadId || queueActionRef.current || queueSendRef.current || state.readOnly) {
      return null;
    }
    const selection = selectionRef.current;
    queueActionRef.current = true;
    setQueueBusy(true);
    try {
      let branch: SideChatBranch | null = null;
      if (destination === 'side') {
        // 消息由侧边对话面板在订阅完成后投递，避免开头的流式事件丢失。
        const sideThreadId = await forkSideThread();
        if (!sideThreadId) {
          return null;
        }
        branch = { threadId: sideThreadId, message };
      } else {
        const activeTurnId = turnIdRef.current;
        if (activeTurnId) {
          try {
            await request('turn/steer', { threadId, input: message.input, expectedTurnId: activeTurnId });
          } catch (error) {
            if (!(error instanceof Error) || !error.message.includes('no active turn to steer')) throw error;
            if (selection !== selectionRef.current) throw error;
            turnIdRef.current = null;
            await startTurn(message.input, null);
          }
          if (message.asGoal) {
            await setGoal(message.text);
          }
        } else {
          await startTurn(message.input, message.asGoal ? message.text : null);
        }
        if (selection === selectionRef.current) {
          dispatch({ type: 'steerPending', steer: { id, text: message.text, images: message.images } });
        }
      }
      if (selection === selectionRef.current) {
        dispatch({ type: 'queueRemove', id });
      }
      return branch;
    } catch (error) {
      dispatch({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      queueActionRef.current = false;
      setQueueBusy(false);
    }
  }, [forkSideThread, request, setGoal, startTurn, state.queuedMessages, state.readOnly]);

  // Queued sends run one at a time, each after the previous turn finishes.
  // `queueSendRef` blocks a second drain while `turn/start` is still in flight, and
  // `drainTick` re-runs this effect after that request settles.
  const queueSendRef = useRef(false);
  const [drainTick, setDrainTick] = useState(0);
  useEffect(() => {
    if (
      queueSendRef.current ||
      queueActionRef.current ||
      state.running ||
      state.readOnly ||
      state.queuedMessages.some((message) => message.id === editingQueued) ||
      state.queuedMessages.length === 0
    ) {
      return;
    }
    const [next] = state.queuedMessages;
    queueSendRef.current = true;
    dispatch({ type: 'queueRemove', id: next.id });
    dispatch({
      type: 'steerPending',
      steer: { id: next.id, text: next.text, images: next.images },
    });
    void startTurn(next.input, next.asGoal ? next.text : null)
      .catch((error: unknown) => {
        dispatch({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        queueSendRef.current = false;
        setDrainTick((tick) => tick + 1);
      });
  }, [drainTick, editingQueued, queueBusy, startTurn, state.queuedMessages, state.running, state.readOnly]);

  const searchMentionFiles = useCallback(
    async (query: string) => {
      const roots =
        projectWorkspaceRoots(projectsRef.current, activeProjectIdRef.current) ??
        (cwdRef.current ? [cwdRef.current] : []);
      if (roots.length === 0) {
        return [];
      }
      const response = await request<FuzzyFileSearchResponse>('fuzzyFileSearch', {
        query,
        roots,
        cancellationToken: null,
      });
      return response.files.slice(0, 12);
    },
    [request],
  );

  const searchMentionChats = useCallback(
    async (query: string) => {
      const response = await request<ThreadSearchResponse>('thread/search', {
        searchTerm: query,
        limit: 8,
      });
      return response.data.map((result) => result.thread);
    },
    [request],
  );

  const compactThread = useCallback(async () => {
    const threadId = threadIdRef.current;
    if (!threadId) {
      return;
    }
    await request('thread/compact/start', { threadId });
  }, [request]);

  const reviewChanges = useCallback(async () => {
    const threadId =
      threadIdRef.current ??
      (await (pendingStartRef.current ??
        startThread(activeProjectIdRef.current ?? undefined, undefined, selectionRef.current)));
    await request('review/start', {
      threadId,
      target: { type: 'uncommittedChanges' },
    });
  }, [request, startThread]);

  const initAgentsFile = useCallback(async () => {
    await sendMessage(INIT_AGENTS_PROMPT);
  }, [sendMessage]);

  const interrupt = useCallback(async () => {
    const threadId = threadIdRef.current;
    const turnId = turnIdRef.current;
    if (!threadId || !turnId) {
      return;
    }
    await request('turn/interrupt', { threadId, turnId });
  }, [request]);

  const renameThread = useCallback(
    async (id: string, name: string) => {
      await request('thread/name/set', { threadId: id, name });
      const thread = state.threads.find((candidate) => candidate.id === id);
      if (thread) {
        dispatch({ type: 'threadUpdated', thread: { ...thread, name } });
      }
    },
    [request, state.threads],
  );

  const archiveThread = useCallback(
    async (id: string) => {
      await request('thread/archive', { threadId: id });
      pendingThreadsRef.current.delete(id);
      dispatch({ type: 'threadRemoved', threadId: id });
      void refreshThreads();
    },
    [request, refreshThreads],
  );

  const deleteThread = useCallback(
    async (id: string) => {
      await request('thread/delete', { threadId: id });
      pendingThreadsRef.current.delete(id);
      dispatch({ type: 'threadRemoved', threadId: id });
      void refreshThreads();
    },
    [request, refreshThreads],
  );

  const setSearchTerm = useCallback(
    (term: string) => {
      dispatch({ type: 'searchTerm', term });
      if (!term.trim()) {
        dispatch({ type: 'searchResults', results: [], searching: false });
      }
    },
    [],
  );

  const refreshPlugins = useCallback(async () => {
    dispatch({ type: 'pluginsLoading', loading: true });
    try {
      const response = await request<PluginListResponse>('plugin/list', {
        cwds: cwdRef.current ? [cwdRef.current] : undefined,
      });
      dispatch({
        type: 'plugins',
        marketplaces: response.marketplaces,
        errors: response.marketplaceLoadErrors,
      });
    } catch (error) {
      dispatch({
        type: 'plugins',
        marketplaces: [],
        errors: [
          {
            marketplacePath: '',
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      });
    }
  }, [request]);

  const refreshSkills = useCallback(async () => {
    dispatch({ type: 'skillsLoading', loading: true });
    try {
      const response = await request<SkillsListResponse>('skills/list', {
        cwds: cwdRef.current ? [cwdRef.current] : [],
      });
      dispatch({
        type: 'skills',
        skills: response.data.flatMap((entry) => entry.skills),
        errors: response.data.flatMap((entry) => entry.errors),
      });
    } catch (error) {
      dispatch({
        type: 'skills',
        skills: [],
        errors: [
          {
            path: '',
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      });
    }
  }, [request]);

  const refreshMcpServers = useCallback(async () => {
    dispatch({ type: 'mcpLoading', loading: true });
    try {
      const response = await request<ListMcpServerStatusResponse>('mcpServerStatus/list', {
        limit: 50,
      });
      dispatch({ type: 'mcp', servers: response.data });
    } catch {
      dispatch({ type: 'mcp', servers: [] });
    }
  }, [request]);

  const resolveApproval = useCallback(
    async (id: string | number, decision: 'accept' | 'decline') => {
      await window.workx.appServer.respond(id, { decision });
      dispatch({ type: 'approvalRemove', id });
    },
    [],
  );

  const handleNotification = useCallback(
    (notification: { method: string; params: unknown }) => {
      const threadId = (notification.params as { threadId?: string | null } | null)?.threadId;
      if (
        threadId &&
        threadId !== threadIdRef.current &&
        (notification.method.startsWith('turn/') ||
          notification.method.startsWith('item/') ||
          notification.method === 'error' ||
          notification.method === 'warning')
      ) {
        return;
      }
      switch (notification.method) {
        case 'turn/started': {
          const params = notification.params as TurnStartedNotification;
          turnIdRef.current = params.turn.id;
          dispatch({
            type: 'turnStarted',
            turnId: params.turn.id,
            startedAtMs: params.turn.startedAt ? params.turn.startedAt * 1000 : Date.now(),
          });
          break;
        }
        case 'item/started': {
          const params = notification.params as ItemStartedNotification;
          dispatch({ type: 'item', turnId: params.turnId, item: params.item });
          if (params.item.type === 'collabAgentToolCall') {
            void refreshSubAgents();
          }
          if (params.item.type === 'userMessage') {
            dispatch({
              type: 'steerSettled',
              text: textFromUserInput(params.item.content).trim(),
            });
          }
          break;
        }
        case 'item/completed': {
          const params = notification.params as ItemCompletedNotification;
          dispatch({ type: 'item', turnId: params.turnId, item: params.item });
          if (params.item.type === 'collabAgentToolCall') {
            void refreshSubAgents();
          }
          if (params.item.type === 'userMessage') {
            dispatch({
              type: 'steerSettled',
              text: textFromUserInput(params.item.content).trim(),
            });
          }
          break;
        }
        case 'item/agentMessage/delta': {
          const params = notification.params as AgentMessageDeltaNotification;
          dispatch({
            type: 'delta',
            turnId: params.turnId,
            itemId: params.itemId,
            delta: params.delta,
          });
          break;
        }
        case 'turn/completed': {
          const params = notification.params as TurnCompletedNotification;
          turnIdRef.current = null;
          dispatch({
            type: 'turnCompleted',
            turnId: params.turn.id,
            durationMs: params.turn.durationMs,
            status: params.turn.status,
          });
          void Promise.all([refreshThreads(), refreshProjects(), refreshSubAgents()]);
          break;
        }
        case 'project/changed': {
          const params = notification.params as ProjectChangedNotification;
          if (params.changeType === 'deleted') {
            void refreshThreads();
          }
          void refreshProjects();
          break;
        }
        case 'thread/project/updated': {
          const params = notification.params as ThreadProjectUpdatedNotification;
          const thread = threadsRef.current.find((candidate) => candidate.id === params.threadId);
          if (thread) {
            dispatch({
              type: 'threadUpdated',
              thread: { ...thread, projectId: params.projectId },
            });
          }
          void Promise.all([refreshThreads(), refreshProjects()]);
          break;
        }
        case 'error': {
          const params = notification.params as ErrorNotification;
          dispatch({ type: 'error', message: params.error.message });
          break;
        }
        case 'warning': {
          const params = notification.params as WarningNotification;
          dispatch({ type: 'warning', message: params.message });
          break;
        }
        case 'thread/goal/updated': {
          const params = notification.params as ThreadGoalUpdatedNotification;
          if (params.threadId === threadIdRef.current) {
            dispatch({ type: 'goal', goal: params.goal });
          }
          break;
        }
        case 'thread/goal/cleared': {
          const params = notification.params as { threadId: string };
          if (params.threadId === threadIdRef.current) {
            dispatch({ type: 'goal', goal: null });
          }
          break;
        }
        case 'thread/status/changed': {
          const params = notification.params as ThreadStatusChangedNotification;
          const thread = threadsRef.current.find(
            (candidate) => candidate.id === params.threadId,
          );
          if (thread) {
            dispatch({ type: 'threadUpdated', thread: { ...thread, status: params.status } });
          }
          const subAgent = subAgentsRef.current.find(
            (candidate) => candidate.id === params.threadId,
          );
          if (subAgent) {
            dispatch({ type: 'subAgentUpdated', thread: { ...subAgent, status: params.status } });
          }
          break;
        }
        case 'thread/name/updated': {
          const params = notification.params as ThreadNameUpdatedNotification;
          const thread = threadsRef.current.find((candidate) => candidate.id === params.threadId);
          if (thread && params.threadName !== undefined) {
            dispatch({ type: 'threadUpdated', thread: { ...thread, name: params.threadName } });
          }
          break;
        }
        case 'thread/archived':
        case 'thread/deleted': {
          const params = notification.params as
            | ThreadArchivedNotification
            | ThreadDeletedNotification;
          pendingThreadsRef.current.delete(params.threadId);
          dispatch({ type: 'threadRemoved', threadId: params.threadId });
          break;
        }
        default:
          break;
      }
    },
    [refreshProjects, refreshSubAgents, refreshThreads],
  );

  const handleServerRequest = useCallback(
    (serverRequest: { id: string | number; method: string; params: unknown }) => {
      switch (serverRequest.method) {
        case 'item/commandExecution/requestApproval': {
          const params = serverRequest.params as CommandExecutionRequestApprovalParams;
          dispatch({
            type: 'approvalAdd',
            approval: {
              id: serverRequest.id,
              kind: 'command',
              title: params.command ?? t('approval.runCommand'),
              detail: params.cwd ?? undefined,
              reason: params.reason ?? null,
            },
          });
          break;
        }
        case 'item/fileChange/requestApproval': {
          const params = serverRequest.params as FileChangeRequestApprovalParams;
          dispatch({
            type: 'approvalAdd',
            approval: {
              id: serverRequest.id,
              kind: 'file',
              title: t('approval.applyFileChanges'),
              detail: params.grantRoot ?? undefined,
              reason: params.reason ?? null,
            },
          });
          break;
        }
        default:
          void window.workx.appServer.respond(serverRequest.id, undefined, {
            code: -32601,
            message: `Workx Desktop does not handle ${serverRequest.method}`,
          });
      }
    },
    [t],
  );

  useEffect(() => {
    const offNotification = window.workx.appServer.onNotification(handleNotification);
    const offServerRequest = window.workx.appServer.onServerRequest(handleServerRequest);
    const offStatus = window.workx.appServer.onStatus((status) => {
      if (status.status === 'ready') {
        dispatch({ type: 'status', status: 'ready' });
      } else if (status.status === 'stopped') {
        dispatch({ type: 'status', status: 'stopped', message: 'app-server stopped' });
      } else if (status.status === 'error') {
        dispatch({ type: 'status', status: 'error', message: status.message });
      }
    });

    return () => {
      offNotification();
      offServerRequest();
      offStatus();
    };
  }, [handleNotification, handleServerRequest]);

  useEffect(() => {
    if (bootedRef.current) {
      return;
    }
    bootedRef.current = true;

    void (async () => {
      dispatch({ type: 'status', status: 'connecting' });
      try {
        const home = await window.workx.getCwd();
        cwdRef.current = home;
        setCwd(home);
        const result = await window.workx.appServer.start();
        if (!result.ok) {
          dispatch({ type: 'status', status: 'error', message: result.message ?? 'failed' });
          return;
        }
        dispatch({ type: 'serverInfo', info: result.info ?? null });
        dispatch({ type: 'status', status: 'ready' });
        await Promise.all([
          refreshModels(),
          refreshThreads(),
          refreshProjects(),
          refreshProviders(),
          refreshMcpServers(),
          refreshSlashCommands(),
        ]);
      } catch (error) {
        dispatch({
          type: 'status',
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }, [
    refreshMcpServers,
    refreshModels,
    refreshProjects,
    refreshProviders,
    refreshSlashCommands,
    refreshThreads,
  ]);

  useEffect(() => {
    if (state.status !== 'ready') {
      return;
    }
    void refreshSkills();
    void refreshPlugins();
  }, [cwd, refreshPlugins, refreshSkills, state.status]);

  useEffect(() => {
    const term = state.searchTerm.trim();
    if (!term) {
      return;
    }
    dispatch({ type: 'searchResults', results: [], searching: true });
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await request<ThreadSearchResponse>('thread/search', {
            searchTerm: term,
            limit: 20,
          });
          dispatch({
            type: 'searchResults',
            results: response.data.map((result) => result.thread),
            searching: false,
          });
        } catch (error) {
          dispatch({ type: 'searchResults', results: [], searching: false });
          dispatch({
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [state.searchTerm, request]);

  const providerOptions = useMemo(
    () =>
      providers.map((id) => ({ id, name: providerDisplayName(id, providerConfigs) })),
    [providerConfigs, providers],
  );

  const transcript = useMemo(() => {
    const entries = buildTranscript(state.turns, t, new Set(state.goalTurnIds));
    for (const steer of state.pendingSteers) {
      entries.push({
        kind: 'user',
        id: steer.id,
        text: steer.text,
        images: steer.images,
      });
    }
    return entries;
  }, [state.goalTurnIds, state.turns, state.pendingSteers, t]);

  const projects = useMemo<ProjectView[]>(() => {
    const byProject = new Map<string, Thread[]>();
    for (const thread of state.threads) {
      if (!thread.projectId) {
        continue;
      }
      const existing = byProject.get(thread.projectId);
      if (existing) {
        existing.push(thread);
      } else {
        byProject.set(thread.projectId, [thread]);
      }
    }
    return state.projects.map((project) => ({
      id: project.id,
      name: project.name,
      roots: project.roots.map((root) => root.path),
      primaryRoot: project.roots[0]?.path ?? null,
      recencyAt: project.recencyAt,
      threads: byProject.get(project.id) ?? [],
    }));
  }, [state.projects, state.threads]);

  const recents = useMemo(
    () => state.threads.filter((thread) => !thread.projectId),
    [state.threads],
  );

  return {
    status: state.status,
    statusMessage: state.statusMessage,
    serverInfo: state.serverInfo,
    models: state.models,
    selectedModelId,
    selectModel: (id) => {
      modelRef.current = id;
      setSelectedModelId(id);
      const model = state.models.find((candidate) => candidate.id === id);
      const effort = model ? (model.defaultReasoningEffort ?? null) : effortRef.current;
      effortRef.current = effort;
      setEffortId(effort);
      void persistModelSelection(id, effort);
    },
    selectedEffort: effortId,
    setEffort: (effort) => {
      effortRef.current = effort;
      setEffortId(effort);
      if (modelRef.current) {
        void persistModelSelection(modelRef.current, effort);
      }
    },
    providerId,
    providers,
    providerOptions,
    providerConfigs,
    providerBusy,
    selectProvider,
    saveProvider,
    deleteProvider,
    readProviderBalance,
    permission,
    setPermission: (mode) => {
      permissionRef.current = mode;
      setPermissionId(mode.id);
    },
    projects,
    recents,
    activeThread: state.activeThread,
    draft: state.draft,
    subAgents: state.subAgents,
    subAgentRootId: state.subAgentRootId,
    transcript,
    pendingSteers: state.pendingSteers,
    queuedMessages: state.queuedMessages,
    followUpBehavior,
    setFollowUpBehavior: (behavior) => {
      window.localStorage.setItem('workx.followUpBehavior', behavior);
      setFollowUpBehavior(behavior);
    },
    queueBusy,
    removeQueued: (id) => dispatch({ type: 'queueRemove', id }),
    editQueued: (id, text) => dispatch({ type: 'queueEdit', id, text }),
    reorderQueued: (ids) => dispatch({ type: 'queueOrder', ids }),
    setEditingQueued,
    sendQueued,
    openSideChat,
    running: state.running,
    approvals: state.approvals,
    warnings: state.warnings,
    error: state.error,
    cwd,
    searchTerm: state.searchTerm,
    searchResults: state.searchResults,
    searching: state.searching,
    pluginMarketplaces: state.pluginMarketplaces,
    pluginErrors: state.pluginErrors,
    pluginsLoading: state.pluginsLoading,
    skills: state.skills,
    skillErrors: state.skillErrors,
    skillsLoading: state.skillsLoading,
    mcpServers: state.mcpServers,
    mcpLoading: state.mcpLoading,
    slashCommands: state.slashCommands,
    goal: state.goal,
    setGoal,
    clearGoal,
    setGoalStatus,
    setActiveCwd: (next) => {
      cwdRef.current = next;
      setCwd(next);
    },
    newThread,
    newThreadInProject,
    openThread,
    forkThread,
    retryActiveThread,
    readOnly: state.readOnly,
    sendMessage,
    sendInput,
    searchMentionFiles,
    searchMentionChats,
    compactThread,
    reviewChanges,
    initAgentsFile,
    interrupt,
    renameThread,
    archiveThread,
    deleteThread,
    setSearchTerm,
    refreshPlugins,
    refreshSkills,
    refreshMcpServers,
    refreshProjects,
    createProject,
    updateProject,
    deleteProject,
    resolveApproval,
    dismissError: () => dispatch({ type: 'error', message: null }),
    refreshThreads,
    refreshSubAgents,
  };
}
