import { beforeEach, expect, it, vi } from 'vitest';

import { checkForUpdates } from './updates';

const fetchRelease = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ net: { fetch: fetchRelease } }));

const application = { version: '0.1.5', platform: 'darwin', arch: 'arm64' };
const release = {
  tag_name: 'rust-v0.1.6', draft: false, prerelease: false,
  assets: [{ name: 'Workx-0.1.6-arm64.dmg' }, { name: 'Workx-0.1.6 Setup.exe' }],
};

beforeEach(() => {
  fetchRelease.mockReset();
  fetchRelease.mockResolvedValue(Response.json(release));
});

it.each(['darwin', 'win32'])('finds an installer for %s using the desktop version', async (platform) => {
  expect(await checkForUpdates({ ...application, platform, arch: platform === 'win32' ? 'x64' : 'arm64' }))
    .toEqual({
      status: 'available', currentVersion: '0.1.5', latestVersion: '0.1.6',
      releaseUrl: 'https://github.com/RonanXiao/workx/releases/tag/rust-v0.1.6',
    });
  expect(fetchRelease).toHaveBeenCalledWith(
    'https://api.github.com/repos/RonanXiao/workx/releases/latest',
    expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
  );
});

it.each([
  ['0.1.6', 'up-to-date'], ['0.1.10', 'up-to-date'], ['1.0.0', 'up-to-date'],
  ['0.0.99', 'available'], ['0.1.6-beta.1', 'available'],
  ['0.1.6+build.1', 'up-to-date'], ['0.1.7-beta.1', 'up-to-date'],
])('compares version %s numerically and handles prerelease builds', async (version, status) => {
  expect((await checkForUpdates({ ...application, version })).status).toBe(status);
});

it.each([
  { platform: 'darwin', arch: 'x64' }, { platform: 'win32', arch: 'arm64' },
  { platform: 'linux', arch: 'x64' },
])('does not offer the wrong installer for $platform $arch', async (target) => {
  expect((await checkForUpdates({ ...application, ...target })).status).toBe('unavailable');
});

it('reports a release whose desktop assets have not finished uploading', async () => {
  fetchRelease.mockResolvedValue(Response.json({ ...release, assets: [] }));
  expect((await checkForUpdates(application)).status).toBe('unavailable');
});

it.each([
  { ...release, draft: true }, { ...release, prerelease: true },
  { ...release, tag_name: 'not-a-version' }, {},
])('rejects incomplete or non-stable metadata', async (metadata) => {
  fetchRelease.mockResolvedValue(Response.json(metadata));
  await expect(checkForUpdates(application)).rejects.toThrow('Invalid stable release');
});

it.each([403, 404, 500])('reports HTTP %s instead of saying the app is current', async (status) => {
  fetchRelease.mockResolvedValue(new Response(null, { status }));
  await expect(checkForUpdates(application)).rejects.toThrow(`HTTP ${status}`);
});

it('propagates a timeout and permits a later retry', async () => {
  fetchRelease.mockRejectedValueOnce(new Error('timeout'));
  await expect(checkForUpdates(application)).rejects.toThrow('timeout');
  expect((await checkForUpdates(application)).status).toBe('available');
});
