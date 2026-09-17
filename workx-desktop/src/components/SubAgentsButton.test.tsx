// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Thread } from '@protocol/v2/Thread';
import type { ThreadStatus } from '@protocol/v2/ThreadStatus';

import { I18nProvider, LANGUAGE_STORAGE_KEY } from '../lib/i18n';
import { SubAgentsButton } from './SubAgentsButton';

let root: Root;
let host: HTMLDivElement;
let onSelect: ReturnType<typeof vi.fn>;
let onOpenAll: ReturnType<typeof vi.fn>;
let onRefresh: ReturnType<typeof vi.fn>;

/// fixedNow 与 createdAt 之差决定「运行中」行的时长显示。
const fixedNow = Date.parse('2026-09-17T10:00:00Z') / 1000;

function thread(id: string, status: ThreadStatus, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    sessionId: 'session-one',
    forkedFromId: null,
    parentThreadId: 'root-one',
    preview: `work on ${id}`,
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    historyMode: 'paginated',
    modelProvider: 'openai',
    model: 'gpt-5',
    reasoningEffort: null,
    createdAt: fixedNow - 300,
    updatedAt: fixedNow - 60,
    recencyAt: null,
    status,
    path: null,
    cwd: '/tmp/workx',
    cliVersion: '0.0.0',
    source: 'appServer',
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...overrides,
  };
}

const active: ThreadStatus = { type: 'active', activeFlags: [] };
const waiting: ThreadStatus = { type: 'active', activeFlags: ['waitingOnUserInput'] };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
  vi.useFakeTimers();
  vi.setSystemTime(fixedNow * 1000);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  onSelect = vi.fn();
  onOpenAll = vi.fn();
  onRefresh = vi.fn();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

async function render(subAgents: Thread[]) {
  await act(async () =>
    root.render(
      <I18nProvider>
        <SubAgentsButton
          subAgents={subAgents}
          onSelect={onSelect}
          onOpenAll={onOpenAll}
          onRefresh={onRefresh}
        />
      </I18nProvider>,
    ),
  );
}

function findButton(label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!button) {
    throw new Error(`missing button: ${label}`);
  }
  return button;
}

it('shows a muted badge when no subagent is running', async () => {
  await render([]);
  expect(host.innerHTML).toMatchSnapshot('collapsed empty');

  await act(async () => findButton('Subagents').click());
  expect(host.innerHTML).toMatchSnapshot('expanded empty');
});

it('lists running, waiting and finished subagents', async () => {
  await render([
    thread('0192aaaa-1111-7000-8000-000000000001', active, {
      agentNickname: 'weaver-builder-page',
      agentRole: 'worker',
      preview: '读取 page 模块 controller 分派逻辑 · 已写 out/page.json',
    }),
    thread('0192aaaa-1111-7000-8000-000000000002', waiting, {
      agentNickname: 'weaver-builder-app',
      agentRole: 'worker',
      preview: '需要确认：/api/app/export 是否纳入审计范围？',
    }),
    thread('0192aaaa-1111-7000-8000-000000000003', { type: 'idle' }, {
      agentNickname: 'weaver-scene',
      agentRole: 'worker',
      preview: '输出 out/scene.json · 61 接口，无阻塞',
      updatedAt: fixedNow - 600,
    }),
    thread('0192aaaa-1111-7000-8000-000000000004', { type: 'systemError' }, {
      name: 'unnamed helper',
      preview: '',
    }),
  ]);
  expect(host.innerHTML).toMatchSnapshot('collapsed with running work');

  await act(async () => findButton('Subagents').click());
  expect(host.innerHTML).toMatchSnapshot('expanded list');
});

it('opens the selected subagent and refreshes when the panel opens', async () => {
  await render([
    thread('0192aaaa-1111-7000-8000-000000000001', active, {
      agentNickname: 'weaver-editor',
    }),
  ]);
  await act(async () => findButton('Subagents').click());
  expect(onRefresh).toHaveBeenCalledTimes(1);

  await act(async () => findButton('weaver-editor').click());
  expect(onSelect).toHaveBeenCalledWith('0192aaaa-1111-7000-8000-000000000001');
  // 选中行后面板收起。
  expect(host.textContent).not.toContain('View all chats');

  await act(async () => findButton('Subagents').click());
  await act(async () => findButton('View all chats').click());
  expect(onOpenAll).toHaveBeenCalledTimes(1);
});
