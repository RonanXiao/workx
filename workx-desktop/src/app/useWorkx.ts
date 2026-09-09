import type { AgentMessageDeltaNotification } from '@protocol/v2/AgentMessageDeltaNotification';
import type { CommandExecutionRequestApprovalParams } from '@protocol/v2/CommandExecutionRequestApprovalParams';
import type { ConfigReadResponse } from '@protocol/v2/ConfigReadResponse';
import type { ErrorNotification } from '@protocol/v2/ErrorNotification';
import type { FileChangeRequestApprovalParams } from '@protocol/v2/FileChangeRequestApprovalParams';
import type { FuzzyFileSearchResponse } from '@protocol/FuzzyFileSearchResponse';
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

import { INIT_AGENTS_PROMPT, type ComposerMenuBinding } from '../data/composerMenu';
import {
  buildProviderSummaries,
  registryIsEmpty,
  registryToCustomModels,
  type CustomModel,
  type CustomModelRegistry,
  type ProviderConfigEntry,
  type ProviderSummary,
  withRegistryCustomModel,
  withoutRegistryCustomModel,
} from '../data/providers';
import { PERMISSION_MODES, type PermissionMode } from '../data/workspace';
import { useI18n } from '../lib/i18n';
import {
  type ProjectCreateResponse,
  type ProjectDeleteResponse,
  type ProjectListResponse,
  type ProjectUpdateResponse,
  type ThreadSearchResponse,
} from './protocolExtensions';
import { buildTranscript, type TranscriptEntry, type TurnView } from './transcript';

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

export interface WorkxController {
  status: 'connecting' | 'ready' | 'error' | 'stopped';
  statusMessage: string | null;
  models: Model[];
  selectedModelId: string | null;
  selectModel: (id: string) => void;
  providerId: string | null;
  providers: ProviderSummary[];
  /** model_providers.<id> entries configured in config.toml. */
  configuredProviders: Record<string, ProviderConfigEntry>;
  /** Custom models registered for the active provider. */
  customModels: CustomModel[];
  providerBusy: boolean;
  selectProvider: (id: string) => Promise<void>;
  saveProvider: (params: {
    id: string;
    entry: ProviderConfigEntry;
    activate: boolean;
    defaultModel?: string | null;
  }) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  addCustomModel: (id: string, label?: string) => Promise<void>;
  removeCustomModel: (id: string) => Promise<void>;
  selectedEffort: string | null;
  setEffort: (effort: string) => void;
  permission: PermissionMode;
  setPermission: (mode: PermissionMode) => void;
  projects: ProjectView[];
  recents: Thread[];
  activeThread: Thread | null;
  transcript: TranscriptEntry[];
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
  setActiveCwd: (cwd: string) => void;
  newThread: () => Promise<void>;
  newThreadInProject: (projectId: string) => Promise<void>;
  openThread: (id: string) => Promise<void>;
  forkThread: (lastTurnId: string) => Promise<void>;
  retryActiveThread: () => Promise<void>;
  writerConflict: boolean;
  sendMessage: (text: string, bindings?: ComposerMenuBinding[]) => Promise<void>;
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
  models: Model[];
  projects: Project[];
  threads: Thread[];
  activeThread: Thread | null;
  writerConflict: string | null;
  turns: TurnView[];
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
}

type Action =
  | { type: 'status'; status: State['status']; message?: string | null }
  | { type: 'models'; models: Model[] }
  | { type: 'projects'; projects: Project[] }
  | { type: 'threads'; threads: Thread[] }
  | { type: 'threadUpsert'; thread: Thread }
  | { type: 'thread'; thread: Thread; turns: TurnView[]; writerConflict?: string | null }
  | { type: 'item'; turnId: string; item: ThreadItem }
  | { type: 'delta'; turnId: string; itemId: string; delta: string }
  | { type: 'turnStarted'; turnId: string; startedAtMs: number | null }
  | { type: 'turnCompleted'; turnId: string; durationMs: number | null; status: TurnView['status'] }
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
  | { type: 'mcpLoading'; loading: boolean };

const initialState: State = {
  status: 'connecting',
  statusMessage: null,
  models: [],
  projects: [],
  threads: [],
  activeThread: null,
  writerConflict: null,
  turns: [],
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
    case 'thread':
      return {
        ...state,
        activeThread: action.thread,
        turns: action.turns,
        writerConflict: action.writerConflict ?? null,
        running: action.writerConflict
          ? false
          : action.turns.some((turn) => turn.status === 'inProgress'),
        activeTurnId: null,
        error: null,
        warnings: [],
        approvals: [],
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
        turns: state.turns.map((entry) =>
          entry.id === action.turnId
            ? { ...entry, status: action.status, durationMs: action.durationMs }
            : entry,
        ),
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
    default:
      return state;
  }
}


function parseConfiguredProviders(value: unknown): Record<string, ProviderConfigEntry> {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const entries: Record<string, ProviderConfigEntry> = {};
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry !== null && typeof entry === 'object') {
      entries[id] = entry as ProviderConfigEntry;
    }
  }
  return entries;
}

/** Read the `desktop.customModels` registry written by this app. Unknown
 *  shapes are ignored so a hand-edited config.toml can never crash the UI. */
function parseCustomModelRegistry(desktop: unknown): CustomModelRegistry {
  const value =
    typeof desktop === 'object' && desktop !== null
      ? (desktop as { customModels?: unknown }).customModels
      : undefined;
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const registry: CustomModelRegistry = {};
  for (const [providerId, byModelId] of Object.entries(value as Record<string, unknown>)) {
    if (typeof byModelId !== 'object' || byModelId === null) {
      continue;
    }
    const modelEntries: Record<string, { label?: string }> = {};
    for (const [modelId, meta] of Object.entries(byModelId as Record<string, unknown>)) {
      const label =
        typeof meta === 'object' && meta !== null
          ? (meta as { label?: unknown }).label
          : undefined;
      modelEntries[modelId] =
        typeof label === 'string' && label.trim() ? { label: label.trim() } : {};
    }
    if (Object.keys(modelEntries).length > 0) {
      registry[providerId] = modelEntries;
    }
  }
  return registry;
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
  const [configuredProviders, setConfiguredProviders] = useState<
    Record<string, ProviderConfigEntry>
  >({});
  const [customRegistry, setCustomRegistry] = useState<CustomModelRegistry>({});
  const [providerBusy, setProviderBusy] = useState(false);
  const [effortId, setEffortId] = useState<string | null>(null);
  const [permissionId, setPermissionId] = useState('full-access');
  const [cwd, setCwd] = useState('');

  const threadIdRef = useRef<string | null>(null);
  const turnIdRef = useRef<string | null>(null);
  const modelRef = useRef<string | null>(null);
  const configModelRef = useRef<string | null>(null);
  const effortRef = useRef<string | null>(null);
  const permissionRef = useRef<PermissionMode>(
    PERMISSION_MODES.find((mode) => mode.id === 'full-access') ?? PERMISSION_MODES[0],
  );
  const cwdRef = useRef('');
  const bootedRef = useRef(false);
  const threadsRef = useRef<Thread[]>([]);
  const projectsRef = useRef<Project[]>([]);
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

  /** Seed the selected model from config `model` first (it may be a model id
   *  the catalog does not list, e.g. an internal/beta model), then fall back
   *  to the catalog default. */
  const applyModelSeed = (listed: Model[], configModel: string | null) => {
    if (configModel) {
      const known = listed.find((model) => model.id === configModel) ?? null;
      if (known) {
        modelRef.current = known.id;
        setSelectedModelId(known.id);
        effortRef.current = known.defaultReasoningEffort ?? null;
        setEffortId(effortRef.current);
        return;
      }
      modelRef.current = configModel;
      setSelectedModelId(configModel);
      effortRef.current = null;
      setEffortId(null);
      return;
    }
    const preferred = listed.find((model) => model.isDefault) ?? listed[0] ?? null;
    if (preferred) {
      modelRef.current = preferred.id;
      setSelectedModelId(preferred.id);
      effortRef.current = preferred.defaultReasoningEffort ?? null;
      setEffortId(effortRef.current);
    }
  };

  const refreshModels = useCallback(async () => {
    const response = await request<ModelListResponse>('model/list', {});
    dispatch({ type: 'models', models: response.data });
    if (!modelRef.current) {
      applyModelSeed(response.data, configModelRef.current);
    }
  }, [request]);

  const refreshProviders = useCallback(async () => {
    const response = await request<ConfigReadResponse>('config/read', { includeLayers: true });
    const config = response.config;
    configModelRef.current = config.model ?? null;
    setProviderId(config.model_provider ?? null);
    setConfiguredProviders(parseConfiguredProviders(config.model_providers));
    setCustomRegistry(parseCustomModelRegistry(config.desktop));
  }, [request]);

  const providers = useMemo<ProviderSummary[]>(
    () => buildProviderSummaries(configuredProviders, providerId),
    [configuredProviders, providerId],
  );

  const customModels = useMemo<CustomModel[]>(
    () => registryToCustomModels(customRegistry, providerId),
    [customRegistry, providerId],
  );

  /** Select a model locally and persist it as config `model` so the choice
   *  survives restarts and is shared with the CLI/TUI. */
  const chooseModel = useCallback(
    (id: string | null) => {
      if (id === modelRef.current) {
        return;
      }
      modelRef.current = id;
      setSelectedModelId(id);
      const model = state.models.find((candidate) => candidate.id === id);
      effortRef.current = model?.defaultReasoningEffort ?? null;
      setEffortId(effortRef.current);
      void request('config/batchWrite', {
        edits: [{ keyPath: 'model', value: id, mergeStrategy: 'replace' }],
        reloadUserConfig: true,
      }).catch((error: unknown) => {
        dispatch({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      });
    },
    [request, state.models],
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
        const listed = await request<ModelListResponse>('model/list', {});
        const preferred = listed.data.find((model) => model.isDefault) ?? listed.data[0] ?? null;
        await request('config/batchWrite', {
          edits: [
            {
              keyPath: 'model',
              value: preferred?.id ?? null,
              mergeStrategy: 'replace',
            },
          ],
          reloadUserConfig: true,
        });
        await refreshProviders();
        dispatch({ type: 'models', models: listed.data });
        modelRef.current = preferred?.id ?? null;
        setSelectedModelId(preferred?.id ?? null);
        effortRef.current = preferred?.defaultReasoningEffort ?? null;
        setEffortId(preferred?.defaultReasoningEffort ?? null);
      } catch (error) {
        dispatch({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setProviderBusy(false);
      }
    },
    [providerBusy, providerId, refreshProviders, request],
  );

  const persistCustomRegistry = useCallback(
    async (next: CustomModelRegistry) => {
      await request('config/batchWrite', {
        edits: [
          {
            keyPath: 'desktop.customModels',
            value: registryIsEmpty(next) ? null : (next as unknown as object),
            mergeStrategy: 'replace',
          },
        ],
        reloadUserConfig: true,
      });
    },
    [request],
  );

  const saveProvider = useCallback(
    async ({
      id,
      entry,
      activate,
      defaultModel,
    }: {
      id: string;
      entry: ProviderConfigEntry;
      activate: boolean;
      defaultModel?: string | null;
    }) => {
      const edits: { keyPath: string; value: unknown; mergeStrategy: 'replace' }[] = [
        {
          keyPath: `model_providers.${id}`,
          value: entry,
          mergeStrategy: 'replace',
        },
      ];
      const explicitModel = defaultModel?.trim() ?? null;
      if (activate) {
        edits.push(
          { keyPath: 'model_provider', value: id, mergeStrategy: 'replace' },
          { keyPath: 'model', value: explicitModel, mergeStrategy: 'replace' },
          { keyPath: 'model_reasoning_effort', value: null, mergeStrategy: 'replace' },
          { keyPath: 'service_tier', value: null, mergeStrategy: 'replace' },
        );
      }
      await request('config/batchWrite', { edits, reloadUserConfig: true });
      await refreshProviders();
      if (!activate) {
        // Saving the provider that is already active must not touch the
        // selected model, but the catalog may have changed (new base URL /
        // endpoint), so refresh it in the background.
        if (id === providerId) {
          try {
            const listed = await request<ModelListResponse>('model/list', {});
            dispatch({ type: 'models', models: listed.data });
          } catch {
            // Keep the previous list; the next provider switch reloads it.
          }
        }
        return;
      }
      if (explicitModel) {
        modelRef.current = explicitModel;
        setSelectedModelId(explicitModel);
        effortRef.current = null;
        setEffortId(null);
        return;
      }
      let listed: Model[] = [];
      try {
        listed = (await request<ModelListResponse>('model/list', {})).data;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Provider saved, but its model list could not be loaded: ${message}`);
      }
      const preferred = listed.find((model) => model.isDefault) ?? listed[0] ?? null;
      if (preferred) {
        await request('config/batchWrite', {
          edits: [{ keyPath: 'model', value: preferred.id, mergeStrategy: 'replace' }],
          reloadUserConfig: true,
        });
      }
      dispatch({ type: 'models', models: listed });
      modelRef.current = preferred?.id ?? null;
      setSelectedModelId(preferred?.id ?? null);
      effortRef.current = preferred?.defaultReasoningEffort ?? null;
      setEffortId(effortRef.current);
      if (!preferred) {
        throw new Error(
          'The provider is active, but its models endpoint returned no models. Open the model menu and type the model id you want to use.',
        );
      }
    },
    [providerId, refreshProviders, request],
  );

  const deleteProvider = useCallback(
    async (id: string) => {
      if (id === providerId) {
        throw new Error('Switch to another provider before removing the active one.');
      }
      await request('config/batchWrite', {
        edits: [
          {
            keyPath: `model_providers.${id}`,
            value: null,
            mergeStrategy: 'replace',
          },
        ],
        reloadUserConfig: true,
      });
      await refreshProviders();
    },
    [providerId, refreshProviders, request],
  );

  const addCustomModel = useCallback(
    async (id: string, label?: string) => {
      const activeProvider = providerId;
      if (!activeProvider) {
        return;
      }
      const trimmed = id.trim();
      if (!trimmed) {
        return;
      }
      const next = withRegistryCustomModel(customRegistry, activeProvider, {
        id: trimmed,
        label,
      });
      setCustomRegistry(next);
      try {
        await persistCustomRegistry(next);
      } catch (error) {
        setCustomRegistry(customRegistry);
        throw error;
      }
      chooseModel(trimmed);
    },
    [chooseModel, customRegistry, persistCustomRegistry, providerId],
  );

  const removeCustomModel = useCallback(
    async (id: string) => {
      const activeProvider = providerId;
      if (!activeProvider) {
        return;
      }
      const next = withoutRegistryCustomModel(customRegistry, activeProvider, id);
      setCustomRegistry(next);
      try {
        await persistCustomRegistry(next);
      } catch (error) {
        setCustomRegistry(customRegistry);
        throw error;
      }
      if (modelRef.current === id) {
        const fallback = state.models.find((model) => model.isDefault) ?? state.models[0] ?? null;
        chooseModel(fallback?.id ?? null);
      }
    },
    [chooseModel, customRegistry, persistCustomRegistry, providerId, state.models],
  );

  const startThread = useCallback(
    async (projectId?: string, cwd?: string): Promise<string> => {
      const response = await request<ThreadStartResponse>('thread/start', {
        cwd: cwd ?? (cwdRef.current || undefined),
        projectId: projectId ?? undefined,
        model: modelRef.current ?? undefined,
        approvalPolicy: permissionRef.current.approvalPolicy,
        sandbox: permissionRef.current.sandbox,
      });
      threadIdRef.current = response.thread.id;
      turnIdRef.current = null;
      if (response.thread.cwd && response.thread.cwd !== cwdRef.current) {
        cwdRef.current = response.thread.cwd;
        setCwd(response.thread.cwd);
      }
      pendingThreadsRef.current.set(response.thread.id, response.thread);
      dispatch({ type: 'threadUpsert', thread: response.thread });
      dispatch({ type: 'thread', thread: response.thread, turns: [] });
      return response.thread.id;
    },
    [request],
  );

  const newThread = useCallback(async () => {
    await startThread();
  }, [startThread]);

  const newThreadInProject = useCallback(
    async (projectId: string) => {
      const project = projectsRef.current.find((candidate) => candidate.id === projectId);
      const primaryRoot = project?.roots[0]?.path ?? undefined;
      await startThread(projectId, primaryRoot);
    },
    [startThread],
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
      let thread: Thread | null = null;
      let writerConflict = false;
      try {
        const response = await request<ThreadResumeResponse>('thread/resume', { threadId: id });
        thread = response.thread;
      } catch (error) {
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
          dispatch({
            type: 'error',
            message: readError instanceof Error ? readError.message : String(readError),
          });
          return;
        }
      }
      if (!thread) {
        return;
      }
      threadIdRef.current = thread.id;
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
    },
    [request],
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

  const sendMessage = useCallback(
    async (text: string, bindings: ComposerMenuBinding[] = []) => {
      if (state.writerConflict) {
        return;
      }
      const threadId = threadIdRef.current ?? (await startThread());
      const input: UserInput[] = [{ type: 'text', text, text_elements: [] }];
      for (const binding of bindings) {
        input.push(
          binding.type === 'skill'
            ? { type: 'skill', name: binding.name, path: binding.path }
            : { type: 'mention', name: binding.name, path: binding.path },
        );
      }
      const response = await request<TurnStartResponse>('turn/start', {
        threadId,
        input,
        effort: effortRef.current ?? undefined,
      });
      turnIdRef.current = response.turn.id;
      dispatch({
        type: 'turnStarted',
        turnId: response.turn.id,
        startedAtMs: Date.now(),
      });
    },
    [request, startThread, state.writerConflict],
  );

  const searchMentionFiles = useCallback(
    async (query: string) => {
      const root = cwdRef.current;
      if (!root) {
        return [];
      }
      const response = await request<FuzzyFileSearchResponse>('fuzzyFileSearch', {
        query,
        roots: [root],
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
    const threadId = threadIdRef.current ?? (await startThread());
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
          break;
        }
        case 'item/completed': {
          const params = notification.params as ItemCompletedNotification;
          dispatch({ type: 'item', turnId: params.turnId, item: params.item });
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
        dispatch({ type: 'status', status: 'ready' });
        // Load provider config first so refreshModels can seed the current
        // config `model` (which may not appear in model/list at all).
        await refreshProviders();
        await refreshModels();
        await Promise.all([
          refreshThreads(),
          refreshProjects(),
          refreshMcpServers(),
        ]);
      } catch (error) {
        dispatch({
          type: 'status',
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }, [refreshMcpServers, refreshModels, refreshProjects, refreshProviders, refreshThreads]);

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

  const transcript = useMemo(() => buildTranscript(state.turns, t), [state.turns, t]);

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
    models: state.models,
    selectedModelId,
    selectModel: chooseModel,
    selectedEffort: effortId,
    setEffort: (effort) => {
      effortRef.current = effort;
      setEffortId(effort);
    },
    providerId,
    providers,
    configuredProviders,
    customModels,
    providerBusy,
    selectProvider,
    saveProvider,
    deleteProvider,
    addCustomModel,
    removeCustomModel,
    permission,
    setPermission: (mode) => {
      permissionRef.current = mode;
      setPermissionId(mode.id);
    },
    projects,
    recents,
    activeThread: state.activeThread,
    transcript,
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
