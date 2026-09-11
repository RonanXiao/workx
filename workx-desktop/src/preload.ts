import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type { InitializeResponse } from '@protocol/InitializeResponse';

type ThemeSource = 'light' | 'dark' | 'system';

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
  electron: string;
  chrome: string;
  node: string;
}

export interface AppServerNotification {
  method: string;
  params: unknown;
}

export interface AppServerServerRequest {
  id: string | number;
  method: string;
  params: unknown;
}

export type AppServerStatus =
  | { status: 'ready'; info: InitializeResponse }
  | { status: 'stopped'; exit?: unknown }
  | { status: 'error'; message: string };

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface GitFileStatus {
  path: string;
  code: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  deleted: boolean;
}

export interface GitStatusResult {
  isRepo: boolean;
  root: string | null;
  branch: string | null;
  files: GitFileStatus[];
}

export interface GitDiffResult {
  diff: string;
  error: string | null;
}

export interface GitNumstat {
  path: string;
  additions: number;
  deletions: number;
}

export interface GitCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export interface AppServerApi {
  start: () => Promise<{ ok: boolean; info?: InitializeResponse; message?: string }>;
  request: <T = unknown>(method: string, params?: unknown) => Promise<T>;
  respond: (
    id: string | number,
    result?: unknown,
    error?: { code: number; message: string },
  ) => Promise<void>;
  onNotification: (listener: (notification: AppServerNotification) => void) => () => void;
  onServerRequest: (listener: (request: AppServerServerRequest) => void) => () => void;
  onStatus: (listener: (status: AppServerStatus) => void) => () => void;
}

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

interface RequestEnvelope {
  ok: boolean;
  result?: unknown;
  error?: { message: string; code?: number };
}

const appServer: AppServerApi = {
  start: () => ipcRenderer.invoke('workx:app-server:start'),
  request: async <T = unknown>(method: string, params?: unknown): Promise<T> => {
    const response = (await ipcRenderer.invoke('workx:app-server:request', {
      method,
      params,
    })) as RequestEnvelope;
    if (response?.ok) {
      return response.result as T;
    }
    const error = new Error(response?.error?.message ?? `${method} failed`);
    if (response?.error?.code !== undefined) {
      Object.assign(error, { code: response.error.code });
    }
    throw error;
  },
  respond: (id, result, error) =>
    ipcRenderer.invoke('workx:app-server:respond', { id, result, error }),
  onNotification: (listener) => subscribe('workx:app-server:notification', listener),
  onServerRequest: (listener) => subscribe('workx:app-server:server-request', listener),
  onStatus: (listener) => subscribe('workx:app-server:status', listener),
};

const api = {
  platform: process.platform,
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('workx:open-external', url),
  openPath: (target: string): Promise<string> => ipcRenderer.invoke('workx:open-path', target),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('workx:pick-folder'),
  getTheme: (): Promise<ThemeSource> => ipcRenderer.invoke('workx:get-theme'),
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('workx:get-app-info'),
  savePastedImage: (data: Uint8Array, extension: string): Promise<string | null> =>
    ipcRenderer.invoke('workx:save-pasted-image', data, extension),
  readImage: (target: string): Promise<string | null> =>
    ipcRenderer.invoke('workx:read-image', target),
  listDirectory: (target: string): Promise<DirectoryEntry[]> =>
    ipcRenderer.invoke('workx:list-directory', target),
  searchDirectory: (roots: string[], query: string): Promise<DirectoryEntry[]> =>
    ipcRenderer.invoke('workx:search-directory', roots, query),
  setTheme: (theme: ThemeSource): Promise<ThemeSource> =>
    ipcRenderer.invoke('workx:set-theme', theme),
  saveMarkdown: (content: string, suggestedName: string): Promise<{ path: string } | null> =>
    ipcRenderer.invoke('workx:save-markdown', content, suggestedName),
  exportPdf: (html: string, suggestedName: string): Promise<{ path: string } | null> =>
    ipcRenderer.invoke('workx:export-pdf', html, suggestedName),
  getCwd: (): Promise<string> => ipcRenderer.invoke('workx:get-cwd'),
  gitStatus: (cwd: string): Promise<GitStatusResult> =>
    ipcRenderer.invoke('workx:git-status', cwd),
  gitDiff: (
    cwd: string,
    scope: 'unstaged' | 'staged',
    filePath: string,
  ): Promise<GitDiffResult> => ipcRenderer.invoke('workx:git-diff', cwd, scope, filePath),
  gitStage: (cwd: string, filePath: string): Promise<GitCommandResult> =>
    ipcRenderer.invoke('workx:git-stage', cwd, filePath),
  gitUnstage: (cwd: string, filePath: string): Promise<GitCommandResult> =>
    ipcRenderer.invoke('workx:git-unstage', cwd, filePath),
  gitRevertFile: (
    cwd: string,
    filePath: string,
    untracked: boolean,
  ): Promise<GitCommandResult> => ipcRenderer.invoke('workx:git-revert-file', cwd, filePath, untracked),
  gitCommit: (cwd: string, message: string): Promise<GitCommandResult> =>
    ipcRenderer.invoke('workx:git-commit', cwd, message),
  gitPush: (cwd: string): Promise<GitCommandResult> => ipcRenderer.invoke('workx:git-push', cwd),
  gitNumstat: (cwd: string, scope: 'unstaged' | 'staged'): Promise<GitNumstat[]> =>
    ipcRenderer.invoke('workx:git-numstat', cwd, scope),
  readTextFile: (target: string): Promise<string | null> =>
    ipcRenderer.invoke('workx:read-text-file', target),
  writeTextFile: (target: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('workx:write-text-file', target, content),
  deleteFile: (target: string): Promise<boolean> => ipcRenderer.invoke('workx:delete-file', target),
  appServer,
};

contextBridge.exposeInMainWorld('workx', api);

export type WorkxBridge = typeof api;
