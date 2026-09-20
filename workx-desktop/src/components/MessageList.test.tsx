// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReadOnlySession } from '../app/useWorkx';
import type { TranscriptEntry } from '../app/transcript';
import { I18nProvider, LANGUAGE_STORAGE_KEY } from '../lib/i18n';
import { MessageList } from './MessageList';

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function renderList(
  readOnly: ReadOnlySession | null,
  entries: TranscriptEntry[] = [],
): Promise<ReturnType<typeof vi.fn>> {
  const onRetryWriter = vi.fn();
  await act(async () =>
    root.render(
      <I18nProvider>
        <MessageList
          entries={entries}
          running={false}
          error={null}
          warnings={[]}
          approvals={[]}
          cwd="/tmp/workx"
          readOnly={readOnly}
          onResolveApproval={vi.fn()}
          onDismissError={vi.fn()}
          onRetryWriter={onRetryWriter}
          onBranch={vi.fn()}
          onUndoFileChange={vi.fn()}
          onReviewFileChange={vi.fn()}
        />
      </I18nProvider>,
    ),
  );
  return onRetryWriter;
}

it('asks for another provider when the recorded provider was removed', async () => {
  await renderList({ threadId: 'thread-one', reason: 'missingProvider', provider: 'beta' });
  expect(host.innerHTML).toMatchSnapshot('missing provider');
});

it('asks to close the other app while another writer holds the thread', async () => {
  const onRetry = await renderList({ threadId: 'thread-one', reason: 'writerBusy', provider: null });
  expect(host.innerHTML).toMatchSnapshot('writer busy');
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === 'Retry',
  );
  await act(async () => button?.click());
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it('shows no read-only banner for a writable thread', async () => {
  await renderList(null);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it.each([
  ['multiline curl', [
    "curl 'https://example.com/' \\",
    "  -H 'Accept: text/html,application/xhtml+xml' \\",
    `  -b 'SESSION=${'0123456789abcdef'.repeat(128)}; IDS=${'12345_'.repeat(128)}' \\`,
    "  -H 'User-Agent: Example Browser'",
  ].join('\n')],
  ['unbroken text', '长文本0123456789'.repeat(256)],
])('preserves %s in a width-constrained wrapping bubble', async (_name, text) => {
  await renderList(null, [{ kind: 'user', id: 'long-message', text, images: [] }]);
  const bubble = host.querySelector('.bg-bubble');
  expect(bubble?.textContent).toBe(text);
  expect(bubble?.outerHTML.replace(text, '[message text]')).toMatchSnapshot();
  expect(bubble?.parentElement?.className).toBe(
    'flex min-w-0 max-w-[85%] flex-col items-end gap-2',
  );
});
