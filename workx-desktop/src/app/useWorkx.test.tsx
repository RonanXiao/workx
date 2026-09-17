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
import { useWorkx, type WorkxController } from './useWorkx';

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
  /** 记录桥接收到的请求，用于断言桌面端发出的 wire 参数。 */
  recordedRequests?: Array<{ method: string; params?: unknown }>;
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

function createBridge(scenario: ResumeScenario): WorkxBridge {
  // Mirrors the config file the app-server would hand back through `config/read`.
  const config = { provider: 'alpha', model: 'alpha-catalog-model' };
  const providers: Record<string, unknown> = { alpha: { name: 'Alpha' }, beta: { name: 'Beta' } };
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
        return {
          thread: threadSummary(scenario.threadProvider),
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

describe('local providers', () => {
  it.each(['lmstudio', 'ollama'])('loads and persists editable %s configuration', async (id) => {
    await renderWorkx(createBridge({ threadProvider: 'alpha', sessionProvider: 'alpha' }));
    expect(controller().providers).toEqual(['alpha', 'beta', 'lmstudio', 'ollama']);
    const saved = {
      ...controller().providerConfigs[id],
      name: 'Local server', baseUrl: 'http://192.168.1.2:8080/v1',
      wireApi: 'chat' as const, apiKey: 'local-secret', modelsEndpoint: '/models',
    };
    await act(async () => { await controller().saveProvider(id, saved); });
    expect(controller().providerConfigs[id]).toEqual(saved);
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
});
