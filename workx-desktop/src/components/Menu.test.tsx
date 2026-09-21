// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { Menu, MenuItem } from './Menu';

let root: Root;
let host: HTMLDivElement;
let onClose: ReturnType<typeof vi.fn>;
let onItemClick: ReturnType<typeof vi.fn>;
let scrollIntoView: ReturnType<typeof vi.fn>;
let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  onClose = vi.fn();
  onItemClick = vi.fn();
  originalScrollIntoView = Element.prototype.scrollIntoView;
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

const models = ['grok-4.6', 'qwen3.6-plus', 'qwen3.7-max', 'kimi-k3'];

async function renderMenu(selected: string) {
  await act(async () =>
    root.render(
      <Menu open onClose={onClose}>
        {models.map((model) => (
          <MenuItem
            key={model}
            title={model}
            selected={model === selected}
            onClick={onItemClick}
          />
        ))}
      </Menu>,
    ),
  );
}

it('caps the menu height so long lists scroll inside the menu', async () => {
  await renderMenu('qwen3.6-plus');
  expect(host.innerHTML).toMatchSnapshot('open menu');
});

it('scrolls the selected item into view when the menu opens', async () => {
  await renderMenu('kimi-k3');

  expect(scrollIntoView).toHaveBeenCalledTimes(1);
  expect(scrollIntoView.mock.instances[0]).toBe(
    [...host.querySelectorAll('button')].at(-1),
  );
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
});
