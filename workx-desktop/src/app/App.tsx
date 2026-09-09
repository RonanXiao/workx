import { ArrowDown, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Composer } from '../components/Composer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CreateProjectDialog } from '../components/CreateProjectDialog';
import { MessageList } from '../components/MessageList';
import { SettingsDialog } from '../components/SettingsDialog';
import { Sidebar, threadTitle } from '../components/Sidebar';
import { TopBar } from '../components/TopBar';
import { McpPanel, PluginsPanel, SkillsPanel } from '../components/WorkxPanels';
import type { NavKey } from '../data/workspace';
import { buildExportHtml, buildMarkdown, exportFileName } from '../lib/export';
import {
  applyTheme,
  readStoredTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from '../lib/theme';
import { useI18n, type MessageKey } from '../lib/i18n';
import { useWorkx, type ProjectView } from './useWorkx';

const AUTO_FOLLOW_THRESHOLD_PX = 48;

const PANEL_TITLES: Partial<Record<NavKey, MessageKey>> = {
  plugins: 'app.panelPlugins',
  skills: 'app.panelSkills',
  mcp: 'app.panelMcp',
};

export function App() {
  const { t, language } = useI18n();
  const workx = useWorkx();
  const [theme, setTheme] = useState<ThemePreference>(readStoredTheme);
  const [activeNav, setActiveNav] = useState<NavKey | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchRequest, setSearchRequest] = useState(0);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [projectDialog, setProjectDialog] = useState<{
    mode: 'create' | 'edit';
    project: ProjectView | null;
  } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ProjectView | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ProjectView | null>(null);
  const [exportError, setExportError] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoFollowRef = useRef(true);

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    void window.workx?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (theme === 'system') {
        applyTheme('system');
      }
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === ',' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (workx.status !== 'ready') {
      return;
    }
    if (activeNav === 'plugins') {
      void workx.refreshPlugins();
    } else if (activeNav === 'skills') {
      void workx.refreshSkills();
    } else if (activeNav === 'mcp') {
      void workx.refreshMcpServers();
    }
  }, [activeNav, workx.status, workx.refreshPlugins, workx.refreshSkills, workx.refreshMcpServers]);

  const updateScrollState = useCallback(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    autoFollowRef.current = distance <= AUTO_FOLLOW_THRESHOLD_PX;
    setShowScrollDown(distance > 160);
  }, []);

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    autoFollowRef.current = true;
    element.scrollTop = element.scrollHeight;
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    if (autoFollowRef.current) {
      element.scrollTop = element.scrollHeight;
    }
    updateScrollState();
  }, [workx.transcript, updateScrollState]);

  useEffect(() => {
    if (workx.activeThread) {
      window.requestAnimationFrame(scrollToBottom);
    }
  }, [workx.activeThread, scrollToBottom]);

  const activeThread = workx.activeThread;
  const activeCwd = activeThread?.cwd ?? workx.cwd;
  const disabled = workx.status !== 'ready';
  const panel = PANEL_TITLES[activeNav ?? 'new-chat'] ? activeNav : null;
  const title =
    (panel && PANEL_TITLES[panel] ? t(PANEL_TITLES[panel]) : null) ??
    (activeThread ? threadTitle(activeThread, t('common.newChat')) : t('common.newChat'));

  const plugins = workx.pluginMarketplaces.flatMap((marketplace) => marketplace.plugins);

  useEffect(() => {
    if (!exportError) {
      return;
    }
    const timer = window.setTimeout(() => setExportError(false), 4000);
    return () => window.clearTimeout(timer);
  }, [exportError]);

  const exportChat = useCallback(
    async (format: 'pdf' | 'markdown') => {
      const entries = workx.transcript;
      if (entries.length === 0) {
        return;
      }
      const baseName = exportFileName(title);
      try {
        if (format === 'markdown') {
          await window.workx.saveMarkdown(
            buildMarkdown(title, entries, language),
            `${baseName}.md`,
          );
        } else {
          await window.workx.exportPdf(buildExportHtml(title, entries, language), `${baseName}.pdf`);
        }
        setExportError(false);
      } catch {
        setExportError(true);
      }
    },
    [language, title, workx.transcript],
  );

  const runCommand = (id: string, args: string) => {
    switch (id) {
      case 'new':
      case 'clear':
        setActiveNav('new-chat');
        void workx.newThread();
        return;
      case 'compact':
        void workx.compactThread();
        return;
      case 'review':
        void workx.reviewChanges();
        return;
      case 'init':
        void workx.initAgentsFile();
        return;
      case 'rename': {
        const name = args.trim();
        if (name && workx.activeThread) {
          void workx.renameThread(workx.activeThread.id, name);
        }
        return;
      }
      case 'archive':
        if (workx.activeThread) {
          void workx.archiveThread(workx.activeThread.id);
        }
        return;
      case 'delete':
        if (workx.activeThread) {
          void workx.deleteThread(workx.activeThread.id);
        }
        return;
      case 'skills':
        setActiveNav('skills');
        return;
      case 'plugins':
        setActiveNav('plugins');
        return;
      case 'mcp':
        setActiveNav('mcp');
        return;
      case 'resume':
        setSearchRequest((request) => request + 1);
        return;
      default:
        return;
    }
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-app text-fg">
      <Sidebar
        activeNav={activeNav}
        onSelectNav={setActiveNav}
        onOpenSettings={() => setSettingsOpen(true)}
        onNewChat={() => {
          setActiveNav('new-chat');
          void workx.newThread();
        }}
        projects={workx.projects}
        recents={workx.recents}
        activeThreadId={activeThread?.id ?? null}
        onSelectThread={(id) => {
          setActiveNav(null);
          void workx.openThread(id);
        }}
        onSelectProject={(projectId) => {
          setActiveNav(null);
          const project = workx.projects.find((candidate) => candidate.id === projectId);
          if (project?.primaryRoot) {
            workx.setActiveCwd(project.primaryRoot);
          }
        }}
        onNewChatInProject={(projectId) => {
          setActiveNav('new-chat');
          void workx.newThreadInProject(projectId);
        }}
        onAddProject={() => setProjectDialog({ mode: 'create', project: null })}
        onArchiveProjectChats={(project) => setArchiveTarget(project)}
        onEditProject={(project) => setProjectDialog({ mode: 'edit', project })}
        onRenameProject={(project, name) =>
          void workx.updateProject(project.id, name, project.roots)
        }
        onRemoveProject={(project) => setRemoveTarget(project)}
        searchTerm={workx.searchTerm}
        searchResults={workx.searchResults}
        searching={workx.searching}
        searchRequest={searchRequest}
        onSearchTermChange={workx.setSearchTerm}
        onRenameThread={(id, name) => void workx.renameThread(id, name)}
        onArchiveThread={(id) => void workx.archiveThread(id)}
        onDeleteThread={(id) => void workx.deleteThread(id)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={title}
          subtitle={panel ? null : activeCwd}
          status={workx.status}
          exportDisabled={workx.transcript.length === 0}
          onExportPdf={() => void exportChat('pdf')}
          onExportMarkdown={() => void exportChat('markdown')}
        />

        {panel ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {panel === 'plugins' ? (
              <PluginsPanel
                marketplaces={workx.pluginMarketplaces}
                errors={workx.pluginErrors}
                loading={workx.pluginsLoading}
                onRefresh={() => void workx.refreshPlugins()}
              />
            ) : null}
            {panel === 'skills' ? (
              <SkillsPanel
                skills={workx.skills}
                errors={workx.skillErrors}
                loading={workx.skillsLoading}
                onRefresh={() => void workx.refreshSkills()}
              />
            ) : null}
            {panel === 'mcp' ? (
              <McpPanel
                servers={workx.mcpServers}
                loading={workx.mcpLoading}
                onRefresh={() => void workx.refreshMcpServers()}
              />
            ) : null}
          </div>
        ) : (
          <>
            <div className="relative min-h-0 flex-1">
              <div
                ref={scrollRef}
                onScroll={updateScrollState}
                className="h-full overflow-y-auto"
              >
                <MessageList
                  entries={workx.transcript}
                  running={workx.running}
                  error={
                    workx.error ??
                    (workx.status === 'error' ? workx.statusMessage : null) ??
                    (workx.status === 'stopped'
                      ? t('app.stopped')
                      : null)
                  }
                  warnings={workx.warnings}
                  approvals={workx.approvals}
                  cwd={activeCwd}
                  writerConflict={workx.writerConflict}
                  onResolveApproval={(id, decision) => void workx.resolveApproval(id, decision)}
                  onDismissError={workx.dismissError}
                  onRetryWriter={() => void workx.retryActiveThread()}
                  onBranch={(turnId) => void workx.forkThread(turnId)}
                />
              </div>

              {showScrollDown ? (
                <button
                  type="button"
                  onClick={scrollToBottom}
                  aria-label={t('message.scrollToBottom')}
                  className="absolute bottom-4 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-elevated text-fg-secondary shadow-lg hover:text-fg"
                >
                  <ArrowDown className="size-4" strokeWidth={1.75} />
                </button>
              ) : null}
            </div>

            <Composer
              models={workx.models}
              selectedModelId={workx.selectedModelId}
              onModelChange={workx.selectModel}
              providers={workx.providers}
              providerId={workx.providerId}
              providerBusy={workx.providerBusy}
              onProviderChange={(id) => void workx.selectProvider(id)}
              customModels={workx.customModels}
              onAddCustomModel={workx.addCustomModel}
              onRemoveCustomModel={workx.removeCustomModel}
              onManageProviders={() => setSettingsOpen(true)}
              permission={workx.permission}
              onPermissionChange={workx.setPermission}
              skills={workx.skills}
              plugins={plugins}
              mcpServers={workx.mcpServers}
              searchFiles={workx.searchMentionFiles}
              searchChats={workx.searchMentionChats}
              running={workx.running}
              disabled={disabled || workx.writerConflict}
              disabledPlaceholder={
                workx.writerConflict ? t('composer.openElsewhere') : undefined
              }
              onSubmit={(text, bindings) => {
                void workx.sendMessage(text, bindings);
                window.requestAnimationFrame(scrollToBottom);
              }}
              onCommand={runCommand}
              onInterrupt={() => void workx.interrupt()}
            />
          </>
        )}
      </main>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        models={workx.models}
        selectedModelId={workx.selectedModelId}
        onModelChange={workx.selectModel}
        providers={workx.providers}
        providerId={workx.providerId}
        providerBusy={workx.providerBusy}
        onSelectProvider={(id) => void workx.selectProvider(id)}
        onSaveProvider={(params) =>
          workx.saveProvider({
            id: params.id,
            entry: params.entry,
            activate: params.activate,
            defaultModel: params.defaultModel ?? null,
          })
        }
        onDeleteProvider={workx.deleteProvider}
        configuredProviders={workx.configuredProviders}
        customModels={workx.customModels}
        onAddCustomModel={workx.addCustomModel}
        onRemoveCustomModel={workx.removeCustomModel}
        selectedEffort={workx.selectedEffort}
        onEffortChange={workx.setEffort}
        theme={theme}
        onThemeChange={setTheme}
      />

      <CreateProjectDialog
        open={projectDialog !== null}
        mode={projectDialog?.mode ?? 'create'}
        initialName={projectDialog?.project?.name ?? ''}
        initialRoots={projectDialog?.project?.roots ?? []}
        onClose={() => setProjectDialog(null)}
        onPickFolder={() => window.workx.pickFolder()}
        onSubmit={async (name, roots) => {
          const dialog = projectDialog;
          if (!dialog) {
            return;
          }
          if (dialog.mode === 'edit' && dialog.project) {
            await workx.updateProject(dialog.project.id, name, roots);
            return;
          }
          await workx.createProject(name, roots);
        }}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        title={t('app.removeTitle', { name: removeTarget?.name ?? 'project' })}
        description={t('app.removeDescription')}
        confirmLabel={t('app.removeConfirm')}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          const target = removeTarget;
          setRemoveTarget(null);
          if (target) {
            void workx.deleteProject(target.id);
          }
        }}
      />

      {exportError ? (
        <div
          role="alert"
          className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 rounded-lg border border-danger/30 bg-elevated px-3.5 py-2 text-[13px] shadow-lg"
        >
          <TriangleAlert className="size-4 text-danger" strokeWidth={1.75} />
          {t('topbar.exportFailed')}
        </div>
      ) : null}

      <ConfirmDialog
        open={archiveTarget !== null}
        title={t(
          archiveTarget?.threads.length === 1 ? 'app.archiveTitleOne' : 'app.archiveTitle',
          { count: archiveTarget?.threads.length ?? 0 },
        )}
        description={t('app.archiveDescription', {
          name: archiveTarget?.name ?? 'this project',
        })}
        confirmLabel={t('app.archiveConfirm')}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => {
          const target = archiveTarget;
          setArchiveTarget(null);
          if (target) {
            void Promise.all(target.threads.map((thread) => workx.archiveThread(thread.id)));
          }
        }}
      />
    </div>
  );
}