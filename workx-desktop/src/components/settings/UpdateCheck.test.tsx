// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { I18nProvider, LANGUAGE_STORAGE_KEY } from '../../lib/i18n';
import type { WorkxBridge } from '../../preload';
import type { UpdateCheckResult } from '../../shared/updates';
import { UpdateCheck } from './UpdateCheck';

let host: HTMLDivElement;
let root: Root;
const checkForUpdates = vi.fn();
const openExternal = vi.fn();
const available: UpdateCheckResult = {
  status: 'available', currentVersion: '0.1.5', latestVersion: '0.1.6',
  releaseUrl: 'https://github.com/RonanXiao/workx/releases/tag/rust-v0.1.6',
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
  checkForUpdates.mockReset().mockResolvedValue(available);
  openExternal.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('workx', { checkForUpdates, openExternal } as unknown as WorkxBridge);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it.each(['en', 'zh'])('checks only on click and opens the release page (%s)', async (language) => {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  await act(async () => root.render(<I18nProvider><UpdateCheck /></I18nProvider>));
  expect(checkForUpdates).not.toHaveBeenCalled();
  expect(host.textContent).toContain(language === 'zh' ? '检查更新' : 'Check for updates');
  expect(host.innerHTML).toMatchSnapshot('idle');
  await act(async () => host.querySelector('button')?.click());
  expect(checkForUpdates).toHaveBeenCalledTimes(1);
  expect(host.innerHTML).toMatchSnapshot('available');
  await act(async () => host.querySelector('button')?.click());
  expect(openExternal).toHaveBeenCalledExactlyOnceWith(available.releaseUrl);
});

it('disables duplicate checks while the request is pending', async () => {
  let finish!: (value: UpdateCheckResult) => void;
  checkForUpdates.mockReturnValue(new Promise<UpdateCheckResult>((resolve) => { finish = resolve; }));
  await act(async () => root.render(<I18nProvider><UpdateCheck /></I18nProvider>));
  await act(async () => host.querySelector('button')?.click());
  expect(host.querySelector('button')?.disabled).toBe(true);
  expect(host.innerHTML).toMatchSnapshot('checking');
  await act(async () => host.querySelector('button')?.click());
  expect(checkForUpdates).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ...available, status: 'up-to-date' }));
  expect(host.querySelector('button')?.disabled).toBe(false);
  expect(host.innerHTML).toMatchSnapshot('up-to-date');
});

it('shows failures and allows retrying', async () => {
  checkForUpdates.mockRejectedValueOnce(new Error('network error'));
  await act(async () => root.render(<I18nProvider><UpdateCheck /></I18nProvider>));
  await act(async () => host.querySelector('button')?.click());
  expect(host.innerHTML).toMatchSnapshot('failed');
  await act(async () => host.querySelector('button')?.click());
  expect(host.textContent).toContain('Workx 0.1.6 is available');
  expect(checkForUpdates).toHaveBeenCalledTimes(2);
});

it('explains when no compatible desktop installer is published', async () => {
  checkForUpdates.mockResolvedValue({ ...available, status: 'unavailable' });
  await act(async () => root.render(<I18nProvider><UpdateCheck /></I18nProvider>));
  await act(async () => host.querySelector('button')?.click());
  expect(host.innerHTML).toMatchSnapshot('unavailable');
  expect(host.querySelectorAll('button')).toHaveLength(1);
});

it('handles failures opening the release page', async () => {
  openExternal.mockRejectedValueOnce(new Error('cannot open browser'));
  await act(async () => root.render(<I18nProvider><UpdateCheck /></I18nProvider>));
  await act(async () => host.querySelector('button')?.click());
  await act(async () => host.querySelector('button')?.click());
  expect(host.textContent).toContain('Unable to check for updates or open the release page');
});
