// @vitest-environment jsdom
//
// `thread/resume` returns the stored thread summary and the settings the resumed session
// actually uses. The summary lags behind a resume that applied overrides, so the composer
// must read the session settings. These tests pin that behavior through the real hook.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Thread } from '@protocol/v2/Thread';
import { I18nProvider, LANGUAGE_STORAGE_KEY, translate } from '../lib/i18n';
import type { AppServerNotification, WorkxBridge } from '../preload';
import {
  MODEL_CATALOG_STORAGE_KEY,
  PROVIDER_ORDER_STORAGE_KEY,
  readModelCatalog,
  useWorkx,
  type WorkxController,
} from './useWorkx';

const THREAD_ID = '01a0a7e5-7354-7661-9386-8dcacd8b666c';
const CWD = '/tmp/workx-desktop-resume-test';

interface ResumeScenario {
  /** Provider stored on the thread summary. A resume that applied overrides leaves it stale. */
  threadProvider: string;
  /** Provider the resumed session reports. This is the value the session actually uses. */
  sessionProvider: string;
  /** 会话记录的 provider 已删除；不带 override 的 resume 按此名称报错。 */
  missingProvider?: string;
  /** resume 首次因另一个 writer 占用而失败，用于覆盖只读回退与重试。 */
  writerBusyOnce?: boolean;
  /** 该会话树下的子代理线程；`thread/list` 带 ancestorThreadId 时返回。 */
  subAgentThreads?: Thread[];
  /** resume 返回的会话里仍在进行的 turn id，用于覆盖运行中切换 provider 后的中断。 */
  runningTurnId?: string;
  /** 记录桥接收到的请求，用于断言桌面端发出的 wire 参数。 */
  recordedRequests?: Array<{ method: string; params?: unknown }>;
  /** 首次 `model/list` 会失败的 provider，用于模拟单个 provider 拉取失败。 */
  modelListFailsOnce?: string[];
}

function threadSummary(provider: string): Thread {
  return {
    id: THREAD_ID,
    parentThreadId: null,
    projectId: null,
    cwd: CWD,
    model: `${provider}-stored-model`,
    modelProvider: provider,
    reasoningEffort: null,
    turns: [],
  } as unknown as Thread;
}

function storedTurnThread(provider: string): Thread {
  return {
    ...threadSummary(provider),
    turns: [
      {
        id: 'stored-turn',
        status: 'completed',
        items: [
          {
            id: 'stored-item',
            type: 'userMessage',
            content: [{ type: 'text', text: 'hi' }],
          },
        ],
      },
    ],
  } as unknown as Thread;
}

function runningTurnThread(provider: string, turnId: string): Thread {
  return {
    ...threadSummary(provider),
    turns: [{ id: turnId, status: 'inProgress', items: [] }],
  } as unknown as Thread;
}

function createBridge(scenario: ResumeScenario): WorkxBridge {
  // Mirrors the config file the app-server would hand back through `config/read`.
  const config = { provider: 'alpha', model: 'alpha-catalog-model' };
  const providers: Record<string, unknown> = { alpha: { name: 'Alpha' }, beta: { name: 'Beta' } };
  const failingModelList = new Set(scenario.modelListFailsOnce ?? []);
  let writerBusy = scenario.writerBusyOnce === true;
  const request = async (method: string, params?: unknown): Promise<unknown> => {
    scenario.recordedRequests?.push({ method, params });
    switch (method) {
      case 'config/read':
        return {
          config: {
            model: config.model,
            model_provider: config.provider,
            model_providers: providers,
          },
        };
      case 'config/batchWrite': {
        const { edits } = params as { edits: { keyPath: string; value: unknown }[] };
        for (const edit of edits) {
          const keys = edit.keyPath.split('.');
          if (keys[0] === 'model_providers' && keys.length === 2) {
            providers[keys[1]] = edit.value;
          }
          if (edit.keyPath === 'model_provider') {
            config.provider = String(edit.value);
          }
          if (edit.keyPath === 'model') {
            config.model = String(edit.value);
          }
        }
        return {};
      }
      case 'model/list':
        if (failingModelList.delete(config.provider)) {
          throw new Error(`model/list failed for ${config.provider}`);
        }
        return {
          data: [
            {
              id: `${config.provider}-catalog-model`,
              isDefault: true,
              defaultReasoningEffort: 'medium',
            },
          ],
        };
      case 'thread/list':
        if ((params as { ancestorThreadId?: string } | undefined)?.ancestorThreadId) {
          return { data: scenario.subAgentThreads ?? [] };
        }
        return { data: [threadSummary(scenario.threadProvider)] };
      case 'thread/resume': {
        // The scenario describes the session a resume with overrides ends up with. A plain
        // resume keeps the stored thread settings.
        const requested = (params as { modelProvider?: string } | undefined)?.modelProvider;
        if (writerBusy && !requested) {
          writerBusy = false;
          throw new Error(`thread ${THREAD_ID} already has an active writer`);
        }
        // A deleted provider only blocks a resume that would reuse it; an override rebuilds
        // the session on the provider the caller names.
        if (scenario.missingProvider && !requested) {
          throw new Error(`Model provider \`${scenario.missingProvider}\` not found`);
        }
        const sessionProvider = requested ? scenario.sessionProvider : scenario.threadProvider;
        // 运行中的会话 resume 后仍带着进行中的 turn，客户端据此恢复中断目标。
        const thread = scenario.runningTurnId
          ? runningTurnThread(scenario.threadProvider, scenario.runningTurnId)
          : threadSummary(scenario.threadProvider);
        return {
          thread,
          model: `${sessionProvider}-session-model`,
          modelProvider: sessionProvider,
          reasoningEffort: 'high',
        };
      }
      case 'thread/read':
        return { thread: storedTurnThread(scenario.threadProvider) };
      case 'thread/unsubscribe':
        return {};
      case 'turn/start':
        return { turn: { id: 'active-turn' } };
      case 'turn/steer':
        return {};
      case 'turn/interrupt':
        return {};
      case 'thread/fork':
        return { thread: { ...threadSummary('alpha'), id: 'side-thread' } };
      case 'thread/goal/get':
        return { goal: null };
      case 'project/list':
        return { data: [] };
      case 'slashCommands/list':
        return { data: [] };
      case 'skills/list':
        return { data: [] };
      case 'plugin/list':
        return { marketplaces: [], marketplaceLoadErrors: [] };
      case 'mcpServerStatus/list':
        return { data: [] };
      default:
        throw new Error(`unexpected app-server request: ${method}`);
    }
  };

  return {
    platform: 'darwin',
    getCwd: async () => CWD,
    appServer: {
      start: async () => ({ ok: true }),
      request,
      respond: async () => undefined,
      onNotification: () => () => undefined,
      onServerRequest: () => () => undefined,
      onStatus: () => () => undefined,
    },
  } as unknown as WorkxBridge;
}

type AppServerNotificationListener = (notification: AppServerNotification) => void;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let latest: WorkxController | null = null;

beforeEach(() => {
  window.localStorage.removeItem('workx.followUpBehavior');
  window.localStorage.removeItem('workx.queueing');
  window.localStorage.removeItem(PROVIDER_ORDER_STORAGE_KEY);
  window.localStorage.removeItem(MODEL_CATALOG_STORAGE_KEY);
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  latest = null;
});

describe('queued message actions', () => {
  it('keeps queued messages out of the transcript and preserves attachments when editing and steering', async () => {
    const bridge = createBridge({ threadProvider: 'alpha', sessionProvider: 'alpha' });
    const request = vi.spyOn(bridge.appServer, 'request');
    await renderWorkx(bridge);
    await act(async () => { await controller().openThread(THREAD_ID); await controller().sendMessage('start'); });
    await act(async () => { await controller().sendMessage('queued', [{ type: 'skill', name: 'test', path: '/skills/test' }], ['/image.png']); });
    const message = controller().queuedMessages[0];
    expect(controller().transcript.some((entry) => entry.id === message.id)).toBe(false);
    await act(async () => { controller().editQueued(message.id, 'edited'); });
    const input = [
      { type: 'text', text: 'edited', text_elements: [] },
      { type: 'localImage', path: '/image.png' },
      { type: 'skill', name: 'test', path: '/skills/test' },
    ];
    expect(controller().queuedMessages).toEqual([{ ...message, text: 'edited', input }]);
    await act(async () => { await controller().sendQueued(message.id, 'current'); });
    expect(request).toHaveBeenCalledWith('turn/steer', { threadId: THREAD_ID, input, expectedTurnId: 'active-turn' });
    expect(controller().queuedMessages).toEqual([]);
  });

  it('retains a queued message when steering fails', async () => {
    const bridge = createBridge({ threadProvider: 'alpha', sessionProvider: 'alpha' });
    await renderWorkx(bridge);
    await act(async () => { await controller().openThread(THREAD_ID); await controller().sendMessage('start'); });
    await act(async () => { await controller().sendMessage('queued'); });
    const messages = controller().queuedMessages;
    vi.spyOn(bridge.appServer, 'request').mockRejectedValueOnce(new Error('steer failed'));
    await act(async () => { await controller().sendQueued(messages[0].id, 'current'); });
    expect(controller().queuedMessages).toEqual(messages);
    expect(controller().error).toBe('steer failed');
    expect(controller().queueBusy).toBe(false);
  });

  it('forks a side chat for a queued message without touching the active conversation', async () => {
    const bridge = createBridge({ threadProvider: 'alpha', sessionProvider: 'alpha' });
    const request = vi.spyOn(bridge.appServer, 'request');
    await renderWorkx(bridge);
    await act(async () => { await controller().openThread(THREAD_ID); await controller().sendMessage('start'); });
    await act(async () => { await controller().sendMessage('side'); await controller().sendMessage('stay'); });
    const [side, stay] = controller().queuedMessages;
    await act(async () => {
      expect(await controller().sendQueued(side.id, 'side')).toEqual({ threadId: 'side-thread', message: side });
    });
    // 分支由侧边对话面板订阅后投递，因此这里不能先起一轮。
    expect(request).not.toHaveBeenCalledWith('turn/start', expect.objectContaining({ threadId: 'side-thread' }));
    expect(controller().activeThread?.id).toBe(THREAD_ID);
    expect(controller().queuedMessages).toEqual([stay]);
    await act(async () => { controller().removeQueued(stay.id); });
    expect(controller().queuedMessages).toEqual([]);
  });

  it('opens an empty side chat branch for the active thread', async () => {
    const bridge = createBridge({ threadProvider: 'alpha', sessionProvider: 'alpha' });
    const request = vi.spyOn(bridge.appServer, 'request');
    await renderWorkx(bridge);
    await act(async () => { await controller().openThread(THREAD_ID); });
    await act(async () => {
      expect(await controller().openSideChat()).toEqual({ threadId: 'side-thread', message: null });
    });
    expect(request).toHaveBeenCalledWith('thread/fork', {
      threadId: THREAD_ID, model: 'alpha-session-model', modelProvider: 'alpha',
    });
    expect(controller().activeThread?.id).toBe(THREAD_ID);
  });

  it('steers new messages after switching the follow-up behavior and persists the preference', async () => {
    const bridge = createBridge({ threadProvider: 'alpha', sessionProvider: 'alpha' });
    const request = vi.spyOn(bridge.appServer, 'request');
    await renderWorkx(bridge);
    await act(async () => { await controller().openThread(THREAD_ID); await controller().sendMessage('start'); });
    await act(async () => { controller().setFollowUpBehavior('steer'); });
    await act(async () => { await controller().sendMessage('direct'); });
    expect(controller().queuedMessages).toEqual([]);
    expect(request).toHaveBeenCalledWith('turn/steer', {
      threadId: THREAD_ID, input: [{ type: 'text', text: 'direct', text_elements: [] }], expectedTurnId: 'active-turn',
    });
    expect(window.localStorage.getItem('workx.followUpBehavior')).toBe('steer');
  });

  it('reads the legacy queueing switch and reorders queued messages', async () => {
    window.localStorage.setItem('workx.queueing', 'false');
    const bridge = createBridge({ threadProvider: 'alpha', sessionProvider: 'alpha' });
    await renderWorkx(bridge);
    expect(controller().followUpBehavior).toBe('steer');
    await act(async () => { await controller().openThread(THREAD_ID); await controller().sendMessage('start'); });
    await act(async () => { controller().setFollowUpBehavior('queue'); });
    await act(async () => { await controller().sendMessage('one'); await controller().sendMessage('two'); await controller().sendMessage('three'); });
    const [one, two, three] = controller().queuedMessages;
    await act(async () => { controller().reorderQueued([three.id, one.id, two.id]); });
    expect(controller().queuedMessages).toEqual([three, one, two]);
  });
});

describe('subagent panel', () => {
  it('lists the subagents of the open chat and follows their status changes', async () => {
    const subagent = {
      ...threadSummary('alpha'),
      id: '01a0a7e5-7354-7661-9386-8dcacd8b8888',
      parentThreadId: THREAD_ID,
      agentNickname: 'worker-one',
      agentRole: 'worker',
      status: { type: 'active', activeFlags: [] },
    } as unknown as Thread;
    const scenario: ResumeScenario = {
      threadProvider: 'alpha',
      sessionProvider: 'alpha',
      subAgentThreads: [subagent],
      recordedRequests: [],
    };
    const bridge = createBridge(scenario);
    // 捕获通知订阅，用于模拟 app-server 推送的子代理状态变化。
    const received: AppServerNotificationListener[] = [];
    bridge.appServer.onNotification = (listener) => {
      received.push(listener);
      return () => undefined;
    };
    await renderWorkx(bridge);
    await act(async () => {
      await controller().openThread(THREAD_ID);
    });
    await waitFor(() => controller().subAgents.length === 1, 'subagent list');
    expect(controller().subAgents).toEqual([subagent]);
    expect(controller().subAgentRootId).toBe(THREAD_ID);
    // 生成类型不含 experimental 字段，这里固定桌面端发出的 wire 参数，避免字段名被改错。
    expect(
      scenario.recordedRequests
        ?.filter((entry) => entry.method === 'thread/list')
        .map((entry) => entry.params),
    ).toContainEqual({
      ancestorThreadId: THREAD_ID,
      limit: 50,
      sortKey: 'created_at',
      sortDirection: 'desc',
      useStateDbOnly: true,
    });

    await act(async () => {
      for (const handler of received) {
        handler({
          method: 'thread/status/changed',
          params: {
            threadId: subagent.id,
            status: { type: 'active', activeFlags: ['waitingOnUserInput'] },
          },
        });
      }
    });
    expect(controller().subAgents[0].status).toEqual({
      type: 'active',
      activeFlags: ['waitingOnUserInput'],
    });
  });
});

afterEach(async () => {
  const mounted = root;
  root = null;
  if (mounted) {
    await act(async () => {
      mounted.unmount();
    });
  }
  container?.remove();
  container = null;
});

function controller(): WorkxController {
  if (!latest) {
    throw new Error('useWorkx has not rendered');
  }
  return latest;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await flush();
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function renderWorkx(bridge: WorkxBridge): Promise<void> {
  (window as unknown as { workx: WorkxBridge }).workx = bridge;
  const host = document.createElement('div');
  document.body.appendChild(host);
  container = host;
  const mounted = createRoot(host);
  root = mounted;
  function Probe() {
    latest = useWorkx();
    return null;
  }
  await act(async () => {
    mounted.render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
  });
  await waitFor(() => latest?.status === 'ready', 'app-server boot');
}

describe('provider configuration', () => {
  it('loads and persists an edited provider configuration', async () => {
    await renderWorkx(createBridge({ threadProvider: 'alpha', sessionProvider: 'alpha' }));
    // 只列出配置里的 provider，内置的 OpenAI、Amazon Bedrock、LM Studio、Ollama 不出现。
    expect(controller().providers).toEqual(['alpha', 'beta']);
    const saved = {
      ...controller().providerConfigs.beta,
      name: 'Local server', baseUrl: 'http://192.168.1.2:8080/v1',
      wireApi: 'chat' as const, apiKey: 'local-secret', modelsEndpoint: '/models',
    };
    await act(async () => { await controller().saveProvider('beta', saved); });
    expect(controller().providerConfigs.beta).toEqual(saved);
  });

  it('applies the persisted provider order on boot', async () => {
    window.localStorage.setItem(
      PROVIDER_ORDER_STORAGE_KEY,
      JSON.stringify(['beta', 'alpha']),
    );
    await renderWorkx(createBridge({ threadProvider: 'alpha', sessionProvider: 'alpha' }));
    // 已记录的排在前，未记录的按 ID 升序追加。
    expect(controller().providers).toEqual(['beta', 'alpha']);
  });

  it('reorders providers and persists the custom order', async () => {
    await renderWorkx(createBridge({ threadProvider: 'alpha', sessionProvider: 'alpha' }));
    await act(async () => { controller().reorderProviders(['beta', 'alpha']); });
    expect(controller().providers).toEqual(['beta', 'alpha']);
    expect(window.localStorage.getItem(PROVIDER_ORDER_STORAGE_KEY))
      .toBe(JSON.stringify(['beta', 'alpha']));
  });
});

/// 取出 `config/batchWrite` 里写 `model_provider` 的值，用于断言 provider 切换顺序。
function providerWrites(params: unknown): string[] {
  const { edits } = params as { edits: { keyPath: string; value: unknown }[] };
  return edits
    .filter((edit) => edit.keyPath === 'model_provider')
    .map((edit) => String(edit.value));
}

describe('model catalog', () => {
  it('fetches each provider model list on boot and caches it', async () => {
    const recordedRequests: Array<{ method: string; params?: unknown }> = [];
    await renderWorkx(
      createBridge({ threadProvider: 'alpha', sessionProvider: 'alpha', recordedRequests }),
    );
    await waitFor(
      () => Object.keys(controller().modelsByProvider).length === 2,
      'provider model catalog',
    );
    // 启动时逐个 provider 拉取：alpha 已是配置里的 provider，不需要切换；结束后恢复配置里的选择。
    expect(
      recordedRequests
        .filter((entry) => entry.method === 'config/batchWrite')
        .flatMap((entry) => providerWrites(entry.params)),
    ).toEqual(['beta', 'alpha']);
    expect(recordedRequests.filter((entry) => entry.method === 'model/list')).toHaveLength(2);
    // 目录落盘，下次启动直接命中缓存。
    expect(controller().modelsByProvider.beta.models.map((model) => model.id))
      .toEqual(['beta-catalog-model']);
    expect(Object.keys(readModelCatalog()).sort()).toEqual(['alpha', 'beta']);
  });

  it('selects a model of another provider and switches the provider in one write', async () => {
    const recordedRequests: Array<{ method: string; params?: unknown }> = [];
    await renderWorkx(
      createBridge({ threadProvider: 'alpha', sessionProvider: 'alpha', recordedRequests }),
    );
    await waitFor(
      () => Object.keys(controller().modelsByProvider).length === 2,
      'provider model catalog',
    );
    recordedRequests.length = 0;

    await act(async () => {
      await controller().selectProviderModel('beta', 'beta-catalog-model');
    });

    expect(controller().error).toBeNull();
    expect(controller().providerId).toBe('beta');
    expect(controller().selectedModelId).toBe('beta-catalog-model');
    // 命中缓存，不需要重新拉取目录；provider 与模型写在同一次 batchWrite 里。
    expect(recordedRequests.map((entry) => entry.method)).toEqual(['config/batchWrite']);
    expect((recordedRequests[0].params as { edits: { keyPath: string }[] }).edits.map(
      (edit) => edit.keyPath,
    )).toEqual(['model_provider', 'model', 'model_reasoning_effort', 'service_tier']);
  });

  it('selects a cached model of the current provider without refetching', async () => {
    const recordedRequests: Array<{ method: string; params?: unknown }> = [];
    await renderWorkx(
      createBridge({ threadProvider: 'alpha', sessionProvider: 'alpha', recordedRequests }),
    );
    await waitFor(
      () => Object.keys(controller().modelsByProvider).length === 2,
      'provider model catalog',
    );
    recordedRequests.length = 0;

    await act(async () => {
      controller().selectModel('alpha-catalog-model');
    });
    await flush();

    expect(recordedRequests.map((entry) => entry.method)).toEqual(['config/batchWrite']);
    expect(controller().selectedModelId).toBe('alpha-catalog-model');
  });

  it('refreshes one provider on demand and restores the configured provider', async () => {
    const recordedRequests: Array<{ method: string; params?: unknown }> = [];
    await renderWorkx(
      createBridge({ threadProvider: 'alpha', sessionProvider: 'alpha', recordedRequests }),
    );
    await waitFor(
      () => Object.keys(controller().modelsByProvider).length === 2,
      'provider model catalog',
    );
    recordedRequests.length = 0;

    await act(async () => {
      await controller().refreshProviderModels('beta');
    });

    expect(recordedRequests.map((entry) => entry.method))
      .toEqual(['config/batchWrite', 'model/list', 'config/batchWrite']);
    expect(providerWrites(recordedRequests[0].params)).toEqual(['beta']);
    expect(providerWrites(recordedRequests[2].params)).toEqual(['alpha']);
    expect(controller().catalogBusy).toEqual({});
    expect(controller().providerId).toBe('alpha');
  });

  it('fetches the catalog of a provider that failed to list at boot', async () => {
    const recordedRequests: Array<{ method: string; params?: unknown }> = [];
    await renderWorkx(createBridge({
      threadProvider: 'beta',
      sessionProvider: 'beta',
      modelListFailsOnce: ['beta'],
      recordedRequests,
    }));
    await waitFor(
      () => Object.keys(controller().modelsByProvider).length === 1,
      'remaining provider model catalog',
    );
    expect(controller().modelsByProvider.beta).toBeUndefined();

    await act(async () => {
      await controller().openThread(THREAD_ID);
    });
    await waitFor(() => controller().modelsByProvider.beta !== undefined, 'beta model catalog');

    // 会话切到 beta 后补拉它的目录，选择器不再显示上一个 provider 的模型。
    expect(controller().providerId).toBe('beta');
    expect(controller().models.map((model) => model.id)).toEqual(['beta-catalog-model']);
  });
});

describe('read-only threads', () => {
  it('opens a thread whose provider was removed and keeps it read-only', async () => {
    const bridge = createBridge({
      threadProvider: 'beta',
      sessionProvider: 'alpha',
      missingProvider: 'beta',
    });
    const request = vi.spyOn(bridge.appServer, 'request');
    await renderWorkx(bridge);
    await act(async () => {
      await controller().openThread(THREAD_ID);
    });
    expect(controller().error).toBeNull();
    expect(controller().readOnly).toEqual({
      threadId: THREAD_ID,
      reason: 'missingProvider',
      provider: 'beta',
    });
    // 历史仍然可见：用户消息加上该轮的汇总条目。
    expect(controller().activeThread?.id).toBe(THREAD_ID);
    expect(controller().transcript[0]).toMatchObject({ kind: 'user', text: 'hi' });
    // provider 已删除时 composer 保持在配置里的 provider 上。
    expect(controller().providerId).toBe('alpha');
    await act(async () => {
      await controller().sendMessage('blocked');
    });
    expect(request).not.toHaveBeenCalledWith('turn/start', expect.anything());
  });

  it('resumes a read-only thread on the selected provider', async () => {
    const bridge = createBridge({
      threadProvider: 'beta',
      sessionProvider: 'alpha',
      missingProvider: 'beta',
    });
    await renderWorkx(bridge);
    await act(async () => {
      await controller().openThread(THREAD_ID);
    });
    await act(async () => {
      await controller().retryActiveThread();
    });
    expect(controller().readOnly).toBeNull();
    expect(controller().error).toBeNull();
  });

  it('reports another writer as read-only and retries the resume', async () => {
    const bridge = createBridge({
      threadProvider: 'alpha',
      sessionProvider: 'alpha',
      writerBusyOnce: true,
    });
    await renderWorkx(bridge);
    await act(async () => {
      await controller().openThread(THREAD_ID);
    });
    expect(controller().readOnly).toEqual({
      threadId: THREAD_ID,
      reason: 'writerBusy',
      provider: null,
    });
    expect(controller().transcript[0]).toMatchObject({ kind: 'user', text: 'hi' });
    await act(async () => {
      await controller().retryActiveThread();
    });
    expect(controller().readOnly).toBeNull();
    expect(controller().providerId).toBe('alpha');
  });
});

describe('provider switching on an open thread', () => {
  it('adopts the provider and model the resumed session reports', async () => {
    await renderWorkx(createBridge({ threadProvider: 'alpha', sessionProvider: 'beta' }));
    await act(async () => {
      await controller().openThread(THREAD_ID);
    });
    expect(controller().providerId).toBe('alpha');

    await act(async () => {
      await controller().selectProvider('beta');
    });

    expect(controller().error).toBeNull();
    expect(controller().warnings).toEqual([]);
    expect(controller().providerId).toBe('beta');
    expect(controller().selectedModelId).toBe('beta-session-model');
  });

  it('warns when the resumed session keeps the previous provider', async () => {
    await renderWorkx(createBridge({ threadProvider: 'alpha', sessionProvider: 'alpha' }));
    await act(async () => {
      await controller().openThread(THREAD_ID);
    });

    await act(async () => {
      await controller().selectProvider('beta');
    });

    // The chat keeps running on the stored provider, so the warning must name that state
    // while the composer keeps the provider the user picked for the next chat.
    expect(controller().warnings).toContain(translate('en', 'provider.switchDeferred'));
    expect(controller().providerId).toBe('beta');
  });

  it('interrupts the running turn a deferred provider switch kept alive', async () => {
    const scenario: ResumeScenario = {
      threadProvider: 'alpha',
      sessionProvider: 'alpha',
      runningTurnId: 'running-turn',
      recordedRequests: [],
    };
    await renderWorkx(createBridge(scenario));
    await act(async () => {
      await controller().openThread(THREAD_ID);
    });
    expect(controller().running).toBe(true);

    await act(async () => {
      await controller().selectProvider('beta');
    });
    expect(controller().warnings).toContain(translate('en', 'provider.switchDeferred'));
    // resume 拿到的仍是运行中的会话，停止按钮必须带着它的 turn id 发中断请求。
    expect(controller().running).toBe(true);

    await act(async () => {
      await controller().interrupt();
    });
    expect(
      scenario.recordedRequests?.filter((entry) => entry.method === 'turn/interrupt'),
    ).toEqual([
      { method: 'turn/interrupt', params: { threadId: THREAD_ID, turnId: 'running-turn' } },
    ]);
  });
});
