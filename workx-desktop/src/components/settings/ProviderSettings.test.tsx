// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { LOCAL_MODEL_PROVIDER_DEFAULTS, normalizeProviderConfig } from '../../app/useWorkx';
import { I18nProvider, LANGUAGE_STORAGE_KEY } from '../../lib/i18n';
import { ProviderSettings } from './ProviderSettings';

let host: HTMLDivElement;
let root: Root;

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

it.each(['lmstudio', 'ollama'])('edits and saves the built-in %s provider', async (id) => {
  const configs = Object.fromEntries(Object.entries(LOCAL_MODEL_PROVIDER_DEFAULTS)
    .map(([key, value]) => [key, normalizeProviderConfig(value)]));
  const onSave = vi.fn().mockResolvedValue(undefined);
  await act(async () => root.render(
    <I18nProvider>
      <ProviderSettings providerConfigs={configs} onSave={onSave}
        onDelete={vi.fn()} onReadBalance={vi.fn()} />
    </I18nProvider>,
  ));
  const providerButton = [...host.querySelectorAll('button')]
    .find((button) => button.textContent === `${configs[id].name}${id}`);
  expect(providerButton).toBeDefined();
  await act(async () => providerButton?.click());
  expect({
    buttons: [...host.querySelectorAll('button')].map((button) => button.textContent),
    fields: [...host.querySelectorAll('input')].slice(0, 5).map((input) => ({
      value: input.value, readOnly: input.readOnly, disabled: input.disabled,
    })),
    note: [...host.querySelectorAll('p')].map((paragraph) => paragraph.textContent),
  }).toMatchSnapshot();
  const endpoint = host.querySelector<HTMLInputElement>('input[placeholder="https://api.example.com/v1"]');
  if (!endpoint) throw new Error('missing endpoint input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      ?.call(endpoint, 'http://192.168.1.2:8080/v1');
    endpoint.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const save = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Save');
  expect(save).toBeDefined();
  await act(async () => save?.click());
  expect(onSave).toHaveBeenCalledWith(id, {
    ...configs[id], baseUrl: 'http://192.168.1.2:8080/v1',
  });
});
