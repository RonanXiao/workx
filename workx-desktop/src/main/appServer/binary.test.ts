import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveWorkxBinary } from './binary';

const filesystem = vi.hoisted(() => new Map<string, { target?: string; directory?: boolean; executable?: boolean }>());
const userHome = vi.hoisted(() => vi.fn());
const originalProcess = process;
const installed = 'C:\\Users\\Dev\\AppData\\Local\\Programs\\OpenAI\\Workx\\bin\\workx.exe';
const desktop = 'C:\\Apps\\Workx\\Workx.exe';

vi.mock('node:os', () => ({ homedir: userHome }));
vi.mock('node:fs', () => {
  const entry = (name: string) => {
    const file = filesystem.get(process.platform === 'win32' ? name.toLowerCase() : name);
    if (!file) throw new Error('ENOENT');
    return file;
  };
  return {
    constants: { F_OK: 0, X_OK: 1 },
    statSync: (name: string) => ({ isFile: () => !entry(name).directory }),
    realpathSync: (name: string) => entry(name).target ?? name,
    accessSync: (name: string, mode: number) => {
      if (mode === 1 && entry(name).executable === false) throw new Error('EACCES');
    },
  };
});

function addFile(name: string, properties = {}) {
  filesystem.set(process.platform === 'win32' ? name.toLowerCase() : name, properties);
}

beforeEach(() => {
  filesystem.clear();
  userHome.mockReturnValue('C:\\Users\\Dev');
  vi.stubGlobal('process', {
    ...originalProcess, platform: 'win32', execPath: desktop,
    resourcesPath: 'C:\\Apps\\Workx\\resources',
    env: { LOCALAPPDATA: 'C:\\Users\\Dev\\AppData\\Local', PATH: '' },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('Workx CLI discovery', () => {
  it('finds the Windows installer location without an updated PATH', () => {
    addFile(installed);
    expect(resolveWorkxBinary()).toBe(installed);
  });

  it('prefers a bundled CLI to the installed CLI', () => {
    const bundled = 'C:\\Apps\\Workx\\resources\\bin\\workx.exe';
    addFile(bundled);
    addFile(installed);
    expect(resolveWorkxBinary()).toBe(bundled);
  });

  it('honors the custom Windows installer directory', () => {
    process.env.WORKX_INSTALL_DIR = 'D:\\CLI Tools';
    addFile('D:\\CLI Tools\\workx.exe');
    expect(resolveWorkxBinary()).toBe('D:\\CLI Tools\\workx.exe');
  });

  it('skips the desktop executable in PATH and resolves a later CLI absolutely', () => {
    process.env.PATH = 'C:\\Apps\\Workx;"D:\\CLI Tools"';
    addFile(desktop);
    addFile('D:\\CLI Tools\\workx.exe');
    expect(resolveWorkxBinary()).toBe('D:\\CLI Tools\\workx.exe');
  });

  it('fails instead of letting Windows search the application directory', () => {
    addFile(desktop);
    expect(() => resolveWorkxBinary()).toThrow('Workx CLI not found');
  });

  it.each([desktop.toUpperCase(), 'D:\\Alias\\workx.exe'])(
    'rejects an explicit override pointing back to the desktop: %s', (override) => {
      addFile(desktop);
      addFile('D:\\Alias\\workx.exe', { target: desktop });
      process.env.WORKX_BIN = override;
      expect(() => resolveWorkxBinary()).toThrow('WORKX_BIN points to Workx Desktop');
    },
  );

  it('does not silently replace a missing explicit override', () => {
    addFile(installed);
    process.env.WORKX_BIN = 'D:\\Missing\\workx.exe';
    expect(() => resolveWorkxBinary()).toThrow('Workx CLI not found at D:\\Missing\\workx.exe');
  });

  it('accepts an override with spaces and an omitted Windows extension', () => {
    addFile('D:\\CLI Tools\\workx.exe');
    expect(resolveWorkxBinary('D:\\CLI Tools\\workx')).toBe('D:\\CLI Tools\\workx.exe');
  });

  it('resolves a command-name override through PATH', () => {
    process.env.PATH = 'D:\\CLI Tools';
    process.env.WORKX_BIN = 'custom-workx';
    addFile(installed);
    addFile('D:\\CLI Tools\\custom-workx.exe');
    expect(resolveWorkxBinary()).toBe('D:\\CLI Tools\\custom-workx.exe');
  });

  it('rejects directories instead of attempting to execute them', () => {
    addFile(installed, { directory: true });
    expect(() => resolveWorkxBinary()).toThrow('Workx CLI not found');
  });

  it('prefers the macOS bundled CLI over Homebrew without changing explicit overrides', () => {
    const resources = '/Applications/Workx.app/Contents/Resources';
    const bundled = `${resources}/bin/workx`;
    const homebrew = '/opt/homebrew/bin/workx';
    vi.stubGlobal('process', {
      ...originalProcess, platform: 'darwin',
      execPath: '/Applications/Workx.app/Contents/MacOS/Workx',
      resourcesPath: resources, env: { PATH: '' },
    });
    addFile(bundled);
    addFile(homebrew);
    expect(resolveWorkxBinary()).toBe(bundled);
    expect(resolveWorkxBinary(homebrew)).toBe(homebrew);
  });

  it('keeps Homebrew discovery for macOS GUI launches', () => {
    vi.stubGlobal('process', {
      ...originalProcess, platform: 'darwin', execPath: '/Applications/Workx.app/Contents/MacOS/Workx',
      resourcesPath: undefined, env: { PATH: '/usr/bin:/bin' },
    });
    userHome.mockReturnValue('/Users/dev');
    addFile('/opt/homebrew/bin/workx');
    expect(resolveWorkxBinary()).toBe('/opt/homebrew/bin/workx');
  });

  it('skips non-executable Unix files and uses a later PATH entry', () => {
    vi.stubGlobal('process', {
      ...originalProcess, platform: 'linux', execPath: '/opt/Workx/workx',
      resourcesPath: undefined, env: { PATH: '/usr/local/bin:/usr/bin' },
    });
    userHome.mockReturnValue('/home/dev');
    addFile('/home/dev/.local/bin/workx', { executable: false });
    addFile('/usr/bin/workx');
    expect(resolveWorkxBinary()).toBe('/usr/bin/workx');
  });
});
