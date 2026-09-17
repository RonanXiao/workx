import { net } from 'electron';

import type { UpdateCheckResult } from '../shared/updates';

const RELEASES_API = 'https://api.github.com/repos/RonanXiao/workx/releases/latest';

export async function checkForUpdates({ version, platform, arch }: {
  version: string;
  platform: string;
  arch: string;
}): Promise<UpdateCheckResult> {
  const response = await net.fetch(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Release check failed: HTTP ${response.status}`);
  }
  const release = await response.json();
  const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
  const latest = /^rust-v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  const current = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?(?:\+[\w.-]+)?$/.exec(version);
  if (!latest || !current || release.draft !== false || release.prerelease !== false) {
    throw new Error('Invalid stable release metadata or application version');
  }
  const latestVersion = latest.slice(1, 4).join('.');
  let newer = Boolean(current[4]);
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(latest[index]) - Number(current[index]);
    if (difference !== 0) {
      newer = difference > 0;
      break;
    }
  }
  const assetName = platform === 'darwin'
    ? `Workx-${latestVersion}-${arch}.dmg`
    : platform === 'win32' && arch === 'x64'
      ? `Workx-${latestVersion} Setup.exe`
      : null;
  const hasInstaller = assetName !== null && Array.isArray(release.assets)
    && release.assets.some((asset: { name?: unknown } | null) => asset?.name === assetName);
  return {
    status: !newer ? 'up-to-date' : hasInstaller ? 'available' : 'unavailable',
    currentVersion: version,
    latestVersion,
    releaseUrl: `https://github.com/RonanXiao/workx/releases/tag/${encodeURIComponent(tag)}`,
  };
}
