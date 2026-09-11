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

export type ProviderWireApi = 'responses' | 'chat' | 'auto';

export type InputModality = 'text' | 'image' | 'audio';

export const DEFAULT_CUSTOM_MODEL_MODALITIES: InputModality[] = ['text', 'image'];

export interface CustomModelConfig {
  id: string;
  contextWindow: number | null;
  maxContextWindow: number | null;
  inputModalities: InputModality[];
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

function normalizeCustomModel(raw: unknown): CustomModelConfig | null {
  if (typeof raw === 'string') {
    const id = raw.trim();
    return id
      ? {
          id,
          contextWindow: null,
          maxContextWindow: null,
          inputModalities: [...DEFAULT_CUSTOM_MODEL_MODALITIES],
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
        usesDefaultModalities
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

export interface WorkxController {
  status: 'connecting' | 'ready' | 'error' | 'stopped';
  statusMessage: string | null;
  serverInfo: InitializeResponse | null;
  models: Model[];
  selectedModelId: string | null;
  selectModel: (id: string) => void;
  providerId: string | null;
  providers: string[];
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
  transcript: TranscriptEntry[];
  pendingSteers: PendingSteer[];
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
  writerConflict: boolean;
  sendMessage: (
    text: string,
    bindings?: ComposerMenuBinding[],
    images?: string[],
    options?: { asGoal?: boolean },
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
}

interface State {
  status: WorkxController['status'];
  statusMessage: string | null;
  serverInfo: InitializeResponse | null;
  models: Model[];
  projects: Project[];
  threads: Thread[];
  activeThread: Thread | null;
  draft: { projectId: string | null } | null;
  writerConflict: string | null;
  turns: TurnView[];
  pendingSteers: PendingSteer[];
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
  | { type: 'threadUpsert'; thread: Thread }
  | { type: 'draft'; projectId: string | null }
  | { type: 'thread'; thread: Thread; turns: TurnView[]; writerConflict?: string | null }
  | { type: 'item'; turnId: string; item: ThreadItem }
  | { type: 'delta'; turnId: string; itemId: string; delta: string }
  | { type: 'turnStarted'; turnId: string; startedAtMs: number | null }
  | { type: 'turnCompleted'; turnId: string; durationMs: number | null; status: TurnView['status'] }
  | { type: 'steerPending'; steer: PendingSteer }
  | { type: 'steerSettled'; text: string }
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
  activeThread: null,
  draft: null,
  writerConflict: null,
  turns: [],
  pendingSteers: [],
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
        writerConflict: null,
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
        writerConflict: action.writerConflict ?? null,
        running: action.writerConflict
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
    case 'threadRemoved':
      return {
        ...state,
        threads: state.threads.filter((thread) => thread.id !== action.threadId),
        activeThread:
          state.activeThread?.id === action.threadId ? null : state.activeThread,
        turns: state.activeThread?.id === action.threadId ? [] : state.turns,
        writerConflict:
          state.activeThread?.id === action.threadId ? null : state.writerConflict,
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

  const threadIdRef = useRef<string | null>(null);
  const turnIdRef = useRef<string | null>(null);
  const modelRef = useRef<string | null>(null);
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

  const refreshThreads = useCallback(async () => {
    const response = await request<ThreadListResponse>('thread/list', {
      limit: 200,
      sortKey: 'recency_at',
      sortDirection: 'desc',
    });
    const serverIds = new Set(response.data.map((thread) => thread.id));
    for (const id of serverIds) {
      pendingThreadsRef.current.delete(id);
    }
    dispatch({
      type: 'threads',
      threads: [...pendingThreadsRef.current.values(), ...response.data],
    });
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
    const response = await request<ModelListResponse>('model/list', {});
    dispatch({ type: 'models', models: response.data });
    if (!modelRef.current) {
      const preferred =
        response.data.find((model) => model.isDefault) ?? response.data[0] ?? null;
      if (preferred) {
        modelRef.current = preferred.id;
        setSelectedModelId(preferred.id);
        effortRef.current = preferred.defaultReasoningEffort ?? null;
        setEffortId(preferred.defaultReasoningEffort ?? null);
      }
    }
  }, [request]);

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
        Object.entries(raw).map(([id, value]) => [id, normalizeProviderConfig(value)]),
      ),
    );
    const ids = Array.from(new Set([...Object.keys(raw), ...BUILTIN_MODEL_PROVIDER_IDS])).sort();
    setProviders(ids);
    setProviderId(response.config.model_provider ?? null);
    return raw;
  }, []);

  const refreshProviders = useCallback(async () => {
    applyConfigRead(await request<ConfigReadResponse>('config/read', { includeLayers: true }));
  }, [applyConfigRead, request]);

  const loadModelsForActiveProvider = useCallback(async (options?: { preserveModel?: boolean }) => {
    const listed = await request<ModelListResponse>('model/list', {});
    const current = options?.preserveModel ? modelRef.current : null;
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
      } catch (error) {
        dispatch({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setProviderBusy(false);
      }
    },
    [loadModelsForActiveProvider, providerBusy, providerId, refreshProviders, request],
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
          await loadModelsForActiveProvider({ preserveModel: true });
        } catch (error) {
          dispatch({
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
    [applyConfigRead, loadModelsForActiveProvider, providerId, request, t],
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
      }
      return response.thread.id;
    },
    [request],
  );

  const beginThread = useCallback(
    async (projectId: string | null) => {
      const selection = ++selectionRef.current;
      threadIdRef.current = null;
      turnIdRef.current = null;
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
    [startThread],
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

  const openThread = useCallback(
    async (id: string) => {
      const selection = ++selectionRef.current;
      let thread: Thread | null = null;
      let writerConflict = false;
      const projectId = threadsRef.current.find((candidate) => candidate.id === id)?.projectId ?? null;
      try {
        const response = await request<ThreadResumeResponse>('thread/resume', {
          threadId: id,
          runtimeWorkspaceRoots: projectWorkspaceRoots(projectsRef.current, projectId),
        });
        thread = response.thread;
      } catch (error) {
        if (selection !== selectionRef.current) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('already has an active writer')) {
          dispatch({ type: 'error', message });
          return;
        }
        writerConflict = true;
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
      if (thread.cwd && thread.cwd !== cwdRef.current) {
        cwdRef.current = thread.cwd;
        setCwd(thread.cwd);
      }
      dispatch({
        type: 'thread',
        thread,
        turns: thread.turns.map(turnView),
        writerConflict: writerConflict ? id : null,
      });
      void loadGoal(thread.id);
    },
    [loadGoal, request],
  );

  const retryActiveThread = useCallback(async () => {
    const threadId = threadIdRef.current;
    if (threadId) {
      await openThread(threadId);
    }
  }, [openThread]);

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

  const sendMessage = useCallback(
    async (
      text: string,
      bindings: ComposerMenuBinding[] = [],
      images: string[] = [],
      options?: { asGoal?: boolean },
    ) => {
      if (state.writerConflict) {
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

      // While a turn is active the server accepts additional input as a steer.
      // Fall back to starting a new turn when the active turn already finished.
      const activeTurnId = turnIdRef.current;
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

      const response = await request<TurnStartResponse>('turn/start', {
        threadId,
        input,
        runtimeWorkspaceRoots: projectWorkspaceRoots(
          projectsRef.current,
          activeProjectIdRef.current,
        ),
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
      if (options?.asGoal && text.trim()) {
        await setGoal(text);
        dispatch({ type: 'goalTurn', turnId: response.turn.id });
      }
    },
    [request, setGoal, startThread, state.writerConflict],
  );

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
          void Promise.all([refreshThreads(), refreshProjects()]);
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
    [refreshProjects, refreshThreads],
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
      if (model) {
        effortRef.current = model.defaultReasoningEffort ?? null;
        setEffortId(model.defaultReasoningEffort ?? null);
      }
    },
    selectedEffort: effortId,
    setEffort: (effort) => {
      effortRef.current = effort;
      setEffortId(effort);
    },
    providerId,
    providers,
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
    transcript,
    pendingSteers: state.pendingSteers,
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
    writerConflict: state.writerConflict !== null,
    sendMessage,
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
  };
}
