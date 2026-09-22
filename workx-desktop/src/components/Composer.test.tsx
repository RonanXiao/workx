// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { ProjectView } from '../app/useWorkx';
import { PERMISSION_MODES } from '../data/workspace';
import { I18nProvider, LANGUAGE_STORAGE_KEY } from '../lib/i18n';
import { Composer } from './Composer';

let root: Root;
let host: HTMLDivElement;
let onSelectProject: ReturnType<typeof vi.fn>;
let onSubmit: ReturnType<typeof vi.fn>;

const PROJECTS: ProjectView[] = [
  {
    id: 'project-one',
    name: 'Alpha project',
    roots: ['/tmp/alpha'],
    primaryRoot: '/tmp/alpha',
    recencyAt: null,
    threads: [],
  },
  {
    id: 'project-two',
    name: 'Beta project',
    roots: ['/tmp/beta'],
    primaryRoot: '/tmp/beta',
    recencyAt: null,
    threads: [],
  },
];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  onSelectProject = vi.fn();
  onSubmit = vi.fn();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function renderComposer(options: { newChat: boolean; selectedProjectId: string | null }) {
  await act(async () =>
    root.render(
      <I18nProvider>
        <Composer
          models={[]}
          modelsByProvider={{}}
          catalogBusy={{}}
          selectedModelId={null}
          onSelectModel={() => undefined}
          onRefreshProviderModels={() => undefined}
          selectedEffort={null}
          onEffortChange={() => undefined}
          providers={[]}
          providerId={null}
          providerBusy={false}
          onManageProviders={() => undefined}
          permission={PERMISSION_MODES[0]}
          onPermissionChange={() => undefined}
          skills={[]}
          plugins={[]}
          mcpServers={[]}
          commands={[]}
          searchFiles={async () => []}
          searchChats={async () => []}
          running={false}
          queuedMessages={[]}
          followUpBehavior="queue"
          queueBusy={false}
          onFollowUpBehaviorChange={() => undefined}
          onRemoveQueued={() => undefined}
          onEditQueued={() => undefined}
          onReorderQueued={() => undefined}
          onEditingQueuedChange={() => undefined}
          onSendQueued={() => undefined}
          disabled={false}
          newChat={options.newChat}
          projects={PROJECTS}
          selectedProjectId={options.selectedProjectId}
          onSelectProject={onSelectProject}
          onSubmit={onSubmit}
          onCommand={() => undefined}
          onInterrupt={() => undefined}
        />
      </I18nProvider>,
    ),
  );
}

// 项目选择器是表单里的第一个按钮，位于输入框上方。
function pickerButton(): HTMLButtonElement {
  const button = host.querySelector('form button');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('project picker is not rendered');
  }
  return button;
}

function menuItem(text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate !== pickerButton() && candidate.textContent?.includes(text),
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`menu item is not rendered: ${text}`);
  }
  return button;
}

it('shows the project picker above the composer for a new chat', async () => {
  await renderComposer({ newChat: true, selectedProjectId: null });
  expect(pickerButton().textContent).toBe('Select project');
  expect(host.innerHTML).toMatchSnapshot('new chat project picker');
});

it('shows the preselected project name and lists every project in the menu', async () => {
  await renderComposer({ newChat: true, selectedProjectId: 'project-one' });
  expect(pickerButton().textContent).toBe('Alpha project');

  await act(async () => {
    pickerButton().click();
  });
  expect(host.innerHTML).toMatchSnapshot('open project picker');
  expect(menuItem('No project')).toBeDefined();
  expect(menuItem('Beta project')).toBeDefined();
});

it('reports the picked project and lets the user clear the selection', async () => {
  await renderComposer({ newChat: true, selectedProjectId: 'project-one' });
  await act(async () => {
    pickerButton().click();
  });

  await act(async () => {
    menuItem('Beta project').click();
  });
  expect(onSelectProject).toHaveBeenCalledWith('project-two');

  await act(async () => {
    pickerButton().click();
  });
  await act(async () => {
    menuItem('No project').click();
  });
  expect(onSelectProject).toHaveBeenLastCalledWith(null);
});

it('hides the project picker while a chat is open', async () => {
  await renderComposer({ newChat: false, selectedProjectId: null });
  expect(host.textContent).not.toContain('Select project');
  expect(host.textContent).not.toContain('Alpha project');
  expect(host.querySelector('form button')?.getAttribute('aria-label')).toBe('Add files and more');
});
