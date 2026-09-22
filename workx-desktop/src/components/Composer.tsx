import {
  AlertTriangle,
  ArrowUp,
  ChevronDown,
  FileText,
  Folder,
  MessageSquare,
  ListEnd,
  Mic,
  Plug,
  Plus,
  Puzzle,
  RefreshCw,
  Settings2,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { FuzzyFileSearchResult } from '@protocol/FuzzyFileSearchResult';
import type { McpServerStatus } from '@protocol/v2/McpServerStatus';
import type { Model } from '@protocol/v2/Model';
import type { PluginSummary } from '@protocol/v2/PluginSummary';
import type { SkillMetadata } from '@protocol/v2/SkillMetadata';
import type { Thread } from '@protocol/v2/Thread';
import type {
  FollowUpBehavior,
  ProjectView,
  ProviderModelCatalog,
  ProviderOption,
  QueuedMessage,
} from '../app/useWorkx';
import {
  commandDescription,
  commandIcon,
  commandTitle,
  findCommand,
  isVisibleInComposerMenu,
  type ComposerMenuBinding,
  type SlashCommandInfo,
} from '../data/composerMenu';
import { PERMISSION_MODES, type PermissionMode } from '../data/workspace';
import { cn } from '../lib/cn';
import { useI18n } from '../lib/i18n';
import { ComposerMenu, type ComposerMenuItem, type ComposerMenuSection } from './ComposerMenu';
import { IconButton } from './IconButton';
import { ImageLightbox } from './ImageLightbox';
import { Menu, MenuItem } from './Menu';
import { threadTitle } from './Sidebar';
import { QueuedMessages } from './QueuedMessages';

type ComposerMenuState =
  | { mode: 'mention'; start: number | null; query: string }
  | { mode: 'slash'; start: number; query: string };

interface ComposerProps {
  /// 当前 provider 的模型列表。
  models: Model[];
  /// 按 provider 分组的模型目录缓存，模型选择器按它渲染分组。
  modelsByProvider: ProviderModelCatalog;
  /// 正在拉取模型目录的 provider。
  catalogBusy: Record<string, boolean>;
  selectedModelId: string | null;
  /// 选择具体模型；模型属于其它 provider 时由调用方同时切换 provider。
  onSelectModel: (providerId: string, modelId: string) => void;
  /// 重新拉取指定 provider 的模型目录。
  onRefreshProviderModels: (providerId: string) => void;
  /// Reasoning effort for the selected model; null means the model default.
  selectedEffort: string | null;
  onEffortChange: (effort: string) => void;
  providers: ProviderOption[];
  providerId: string | null;
  providerBusy: boolean;
  onManageProviders: () => void;
  permission: PermissionMode;
  onPermissionChange: (mode: PermissionMode) => void;
  skills: SkillMetadata[];
  plugins: PluginSummary[];
  mcpServers: McpServerStatus[];
  commands: SlashCommandInfo[];
  searchFiles: (query: string) => Promise<FuzzyFileSearchResult[]>;
  searchChats: (query: string) => Promise<Thread[]>;
  running: boolean;
  queuedMessages: QueuedMessage[];
  followUpBehavior: FollowUpBehavior;
  queueBusy: boolean;
  onFollowUpBehaviorChange: (behavior: FollowUpBehavior) => void;
  onRemoveQueued: (id: string) => void;
  onEditQueued: (id: string, text: string) => void;
  onReorderQueued: (ids: string[]) => void;
  onEditingQueuedChange: (id: string | null) => void;
  onSendQueued: (id: string, destination: 'current' | 'side') => void;
  disabled: boolean;
  disabledPlaceholder?: string;
  /// 是否处于新建对话状态；为 true 时在输入框上方显示项目选择器。
  newChat: boolean;
  projects: ProjectView[];
  /// 新建对话预选的项目；null 表示不归属任何项目。
  selectedProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
  /// 发送草稿。`behavior` 省略时使用用户的默认跟进行为，逐条覆盖时由调用方显式传入。
  onSubmit: (
    text: string,
    bindings: ComposerMenuBinding[],
    images: string[],
    behavior?: FollowUpBehavior,
  ) => void;
  onCommand: (id: string, args: string) => void;
  onInterrupt: () => void;
}

function detectTrigger(value: string, caret: number): ComposerMenuState | null {
  const before = value.slice(0, caret);
  if (before.startsWith('/')) {
    const query = before.slice(1);
    if (!/\s/.test(query)) {
      return { mode: 'slash', start: 0, query };
    }
  }
  const at = before.lastIndexOf('@');
  if (at !== -1) {
    const prev = at === 0 ? '' : before[at - 1];
    const query = before.slice(at + 1);
    if ((at === 0 || /\s/.test(prev)) && !/[\s@]/.test(query)) {
      return { mode: 'mention', start: at, query };
    }
  }
  return null;
}

function splitPluginNameSegments(name: string): Array<{ text: string; separator: string | null }> {
  const segments: Array<{ text: string; separator: string | null }> = [];
  let current = '';
  for (const char of name) {
    if (char === '-' || char === '_') {
      if (current) {
        segments.push({ text: current, separator: char });
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) {
    segments.push({ text: current, separator: null });
  }
  return segments;
}

function pluginMentionName(pluginName: string, displayName: string): string {
  const pluginSegments = splitPluginNameSegments(pluginName);
  const displaySegments = displayName.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (
    pluginSegments.length === displaySegments.length &&
    pluginSegments.every(
      (segment, index) => segment.text.toLowerCase() === displaySegments[index].toLowerCase(),
    )
  ) {
    return pluginSegments
      .map((segment, index) => displaySegments[index] + (segment.separator ?? ''))
      .join('');
  }
  return pluginName
    .split(/([-_])/)
    .map((part) => (part === '-' || part === '_' ? part : part.replace(/^[a-z]/, (c) => c.toUpperCase())))
    .join('');
}

interface ComposerImage {
  id: string;
  path: string;
  previewUrl: string;
  name: string;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};

let nextImageId = 0;

function extensionFromMimeType(mimeType: string): string {
  return IMAGE_EXTENSIONS[mimeType] ?? 'png';
}

function matches(terms: Array<string | null | undefined>, query: string): boolean {
  if (!query) {
    return true;
  }
  const needle = query.toLowerCase();
  return terms.some((term) => term?.toLowerCase().includes(needle));
}

export function Composer({
  models,
  modelsByProvider,
  catalogBusy,
  selectedModelId,
  onSelectModel,
  onRefreshProviderModels,
  selectedEffort,
  onEffortChange,
  providers,
  providerId,
  providerBusy,
  onManageProviders,
  permission,
  onPermissionChange,
  skills,
  plugins,
  mcpServers,
  commands,
  searchFiles,
  searchChats,
  running,
  queuedMessages,
  followUpBehavior,
  queueBusy,
  onFollowUpBehaviorChange,
  onRemoveQueued,
  onEditQueued,
  onReorderQueued,
  onEditingQueuedChange,
  onSendQueued,
  disabled,
  disabledPlaceholder,
  newChat,
  projects,
  selectedProjectId,
  onSelectProject,
  onSubmit,
  onCommand,
  onInterrupt,
}: ComposerProps) {
  const { t, language } = useI18n();
  const [value, setValue] = useState('');
  const [modelOpen, setModelOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const [effortOpen, setEffortOpen] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [menu, setMenu] = useState<ComposerMenuState | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [fileResults, setFileResults] = useState<FuzzyFileSearchResult[]>([]);
  const [chatResults, setChatResults] = useState<Thread[]>([]);
  const [searching, setSearching] = useState(false);
  const [images, setImages] = useState<ComposerImage[]>([]);
  const [previewImage, setPreviewImage] = useState<ComposerImage | null>(null);
  const [imageNotice, setImageNotice] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const bindingsRef = useRef(new Map<string, ComposerMenuBinding>());
  const imagesRef = useRef<ComposerImage[]>([]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) {
      return;
    }
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
  }, [value]);

  const selectedModel = models.find((model) => model.id === selectedModelId) ?? null;
  /// 模型选择器的分组内容：按 provider 展示顺序排列，搜索时只保留命中的模型。
  const modelGroups = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    return providers.flatMap((provider) => {
      const listed = modelsByProvider[provider.id]?.models ?? [];
      const matched = query
        ? listed.filter((model) =>
            matches([model.id, model.displayName, model.description], query),
          )
        : listed;
      // 搜索时跳过没有命中的 provider，避免空分组占满列表。
      if (query && matched.length === 0) {
        return [];
      }
      return [{ id: provider.id, name: provider.name, models: matched }];
    });
  }, [modelQuery, modelsByProvider, providers]);
  const effortOptions = selectedModel?.supportedReasoningEfforts ?? [];
  const currentEffort = selectedEffort ?? selectedModel?.defaultReasoningEffort ?? null;
  const imageInputSupported =
    selectedModel === null || selectedModel.inputModalities.includes('image');

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(
    () => () => {
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    },
    [],
  );

  useEffect(() => {
    if (!imageNotice) {
      return;
    }
    const timer = window.setTimeout(() => setImageNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [imageNotice]);

  const addPastedImages = async (files: File[]) => {
    for (const file of files) {
      try {
        const buffer = new Uint8Array(await file.arrayBuffer());
        const filePath = await window.workx.savePastedImage(
          buffer,
          extensionFromMimeType(file.type),
        );
        if (!filePath) {
          continue;
        }
        const previewUrl = URL.createObjectURL(file);
        nextImageId += 1;
        setImages((current) => [
          ...current,
          {
            id: `image-${nextImageId}`,
            path: filePath,
            previewUrl,
            name: file.name || 'image',
          },
        ]);
        setImageNotice(null);
      } catch {
        setImageNotice(t('composer.imageUnsupported'));
      }
    }
  };

  const removeImage = (id: string) => {
    setImages((current) => {
      const removed = current.find((image) => image.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return current.filter((image) => image.id !== id);
    });
    setPreviewImage((current) => (current?.id === id ? null : current));
  };

  useEffect(() => {
    if (!menu || menu.mode !== 'mention') {
      return;
    }
    const query = menu.query.trim();
    if (!query) {
      setFileResults([]);
      setChatResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const [files, chats] = await Promise.all([searchFiles(query), searchChats(query)]);
          if (cancelled) {
            return;
          }
          setFileResults(files);
          setChatResults(chats);
        } catch {
          if (!cancelled) {
            setFileResults([]);
            setChatResults([]);
          }
        } finally {
          if (!cancelled) {
            setSearching(false);
          }
        }
      })();
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [menu, searchFiles, searchChats]);

  const query = menu?.query.trim() ?? '';

  const mentionSections = useMemo<ComposerMenuSection[]>(() => {
    const fileItems: ComposerMenuItem[] = fileResults.map((file) => ({
      id: `file:${file.path}`,
      title: file.file_name || file.path,
      description: file.path,
      icon: FileText,
      insertText: `@${file.path}`,
    }));
    const chatItems: ComposerMenuItem[] = chatResults.map((thread) => ({
      id: `chat:${thread.id}`,
      title: threadTitle(thread, t('common.newChat')),
      description: thread.cwd,
      icon: MessageSquare,
      insertText: `@${threadTitle(thread, t('common.newChat'))}`,
    }));
    const skillItems: ComposerMenuItem[] = skills
      .filter((skill) => skill.enabled)
      .filter((skill) =>
        matches([skill.name, skill.interface?.displayName, skill.description], query),
      )
      .slice(0, 20)
      .map((skill) => ({
        id: `skill:${skill.name}`,
        title: skill.interface?.displayName ?? skill.name,
        description: skill.interface?.shortDescription ?? skill.description,
        meta: `$${skill.name}`,
        icon: Sparkles,
        insertText: `$${skill.name}`,
        binding: { type: 'skill', name: skill.name, path: skill.path },
      }));
    const pluginItems: ComposerMenuItem[] = plugins
      .filter((plugin) => plugin.enabled && plugin.installed)
      .filter((plugin) =>
        matches([plugin.id, plugin.name, plugin.interface?.displayName], query),
      )
      .slice(0, 20)
      .map((plugin) => {
        const [pluginName] = plugin.id.split('@');
        const displayName = plugin.interface?.displayName ?? plugin.name;
        const mentionName = pluginMentionName(pluginName, displayName);
        return {
          id: `plugin:${plugin.id}`,
          title: displayName,
          description: plugin.interface?.shortDescription ?? undefined,
          meta: `@${mentionName}`,
          icon: Puzzle,
          insertText: `@${mentionName}`,
          binding: { type: 'mention', name: displayName, path: `plugin://${plugin.id}` },
        };
      });
    const mcpItems: ComposerMenuItem[] = mcpServers
      .filter((server) => matches([server.name, server.serverInfo?.name], query))
      .slice(0, 20)
      .map((server) => ({
        id: `mcp:${server.name}`,
        title: server.name,
        description: server.serverInfo?.name ?? undefined,
        meta: t('common.tools', { count: Object.keys(server.tools ?? {}).length }),
        icon: Plug,
        insertText: `$${server.name}`,
        binding: { type: 'mention', name: server.name, path: `mcp://${server.name}` },
      }));
    return [
      {
        id: 'filesAndChats',
        label: t('composer.filesAndChats'),
        hint: query ? undefined : t('composer.typeToSearch'),
        items: [...fileItems, ...chatItems],
      },
      { id: 'skills', label: t('composer.skills'), items: skillItems },
      { id: 'plugins', label: t('composer.plugins'), items: pluginItems },
      { id: 'mcp', label: t('composer.mcpServers'), items: mcpItems },
    ];
  }, [chatResults, fileResults, mcpServers, plugins, query, skills, t]);

  const slashSections = useMemo<ComposerMenuSection[]>(() => {
    const items: ComposerMenuItem[] = commands
      .filter(isVisibleInComposerMenu)
      .filter((command) => !running || command.availableDuringTask)
      .filter((command) => matches([command.name, commandTitle(command, language)], query))
      .map((command) => ({
        id: `command:${command.name}`,
        title: commandTitle(command, language),
        description: commandDescription(command, language),
        meta: `/${command.name}`,
        icon: commandIcon(command.name),
        insertText: `/${command.name}`,
        commandId: command.name,
      }));
    return [{ id: 'commands', label: t('composer.commands'), items }];
  }, [commands, language, query, running, t]);

  const sections = menu?.mode === 'slash' ? slashSections : mentionSections;
  const flatItems = useMemo(() => sections.flatMap((section) => section.items), [sections]);

  useEffect(() => {
    if (!menu) {
      setActiveId(null);
      return;
    }
    setActiveId((current) =>
      current && flatItems.some((item) => item.id === current) ? current : (flatItems[0]?.id ?? null),
    );
  }, [flatItems, menu]);

  const closeMenu = useCallback(() => {
    if (menu && menu.start !== null) {
      setDismissedKey(`${menu.mode}:${menu.start}`);
    }
    setMenu(null);
    setActiveId(null);
  }, [menu]);

  const handleValueChange = (next: string, caret: number) => {
    setValue(next);
    if (menu && menu.start === null) {
      setMenu(null);
      return;
    }
    const detected = detectTrigger(next, caret);
    if (!detected) {
      setMenu(null);
      setDismissedKey(null);
      return;
    }
    const key = `${detected.mode}:${detected.start}`;
    if (dismissedKey === key) {
      setMenu(null);
      return;
    }
    setMenu(detected);
  };

  const runCommand = (command: SlashCommandInfo, args: string) => {
    if (command.name === 'model') {
      setModelOpen(true);
      return;
    }
    if (command.name === 'provider') {
      // 提供方与模型在同一个下拉里选择，两个命令都打开它。
      setModelOpen(true);
      return;
    }
    if (command.name === 'permissions') {
      setPermissionOpen(true);
      return;
    }
    onCommand(command.name, args);
  };

  const applyItem = (item: ComposerMenuItem) => {
    if (item.commandId) {
      const command = findCommand(commands, item.commandId);
      setMenu(null);
      setDismissedKey(null);
      setActiveId(null);
      if (!command) {
        return;
      }
      if (command.supportsInlineArgs) {
        setValue(`/${command.name} `);
        window.requestAnimationFrame(() => {
          const element = textareaRef.current;
          if (element) {
            element.focus();
            const end = element.value.length;
            element.setSelectionRange(end, end);
          }
        });
        return;
      }
      setValue('');
      runCommand(command, '');
      return;
    }
    if (item.binding) {
      bindingsRef.current.set(item.insertText, item.binding);
    }
    const element = textareaRef.current;
    const caret = element?.selectionStart ?? value.length;
    const end = Math.max(element?.selectionEnd ?? caret, caret);
    let nextValue: string;
    let nextCaret: number;
    if (menu && menu.start !== null) {
      nextValue = value.slice(0, menu.start) + item.insertText + value.slice(end);
      nextCaret = menu.start + item.insertText.length;
    } else {
      const needsSpace = caret > 0 && !/\s/.test(value[caret - 1] ?? '');
      const prefix = needsSpace ? ' ' : '';
      nextValue = value.slice(0, caret) + prefix + item.insertText + value.slice(end);
      nextCaret = caret + prefix.length + item.insertText.length;
    }
    setValue(nextValue);
    setMenu(null);
    setDismissedKey(null);
    setActiveId(null);
    window.requestAnimationFrame(() => {
      const target = textareaRef.current;
      if (target) {
        target.focus();
        target.setSelectionRange(nextCaret, nextCaret);
      }
    });
  };

  const moveActive = (delta: number) => {
    if (flatItems.length === 0) {
      return;
    }
    const index = flatItems.findIndex((item) => item.id === activeId);
    const next = index === -1 ? 0 : (index + delta + flatItems.length) % flatItems.length;
    setActiveId(flatItems[next]?.id ?? null);
  };

  // 省略 `behavior` 时按用户设置的默认跟进行为发送。
  const submit = (behavior?: FollowUpBehavior) => {
    const trimmed = value.trim();
    const imagePaths = images.map((image) => image.path);
    if ((!trimmed && imagePaths.length === 0) || disabled) {
      return;
    }
    if (trimmed.startsWith('/') && imagePaths.length === 0) {
      const [name, ...rest] = trimmed.slice(1).split(/\s+/);
      const command = findCommand(commands, name);
      if (command) {
        setValue('');
        setMenu(null);
        runCommand(command, rest.join(' '));
        return;
      }
    }
    const bindings = [...bindingsRef.current.entries()]
      .filter(([token]) => trimmed.includes(token))
      .map(([, binding]) => binding);
    bindingsRef.current.clear();
    images.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    setImages([]);
    setValue('');
    setMenu(null);
    onSubmit(trimmed, bindings, imagePaths, behavior);
  };

  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? null;

  return (
    <div className="shrink-0 px-6 pb-4">
      <QueuedMessages messages={queuedMessages} disabled={disabled || queueBusy}
        followUpBehavior={followUpBehavior} onFollowUpBehaviorChange={onFollowUpBehaviorChange}
        onRemove={onRemoveQueued} onEdit={onEditQueued} onReorder={onReorderQueued}
        onEditingChange={onEditingQueuedChange} onSend={onSendQueued} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="relative mx-auto w-full max-w-[42rem] rounded-3xl border border-line bg-composer shadow-[var(--elevation-composer)] transition-colors focus-within:border-line-strong"
      >
        {menu ? (
          <ComposerMenu
            sections={sections}
            activeId={activeId}
            loading={menu.mode === 'mention' && searching}
            emptyLabel={t('composer.noResults')}
            onHover={setActiveId}
            onSelect={applyItem}
            onDismiss={closeMenu}
          />
        ) : null}

        {newChat ? (
          <div className="flex items-center px-3 pt-3">
            <div className="relative">
              <button
                type="button"
                disabled={disabled}
                onClick={() => setProjectOpen((open) => !open)}
                className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-[13px] text-fg-secondary hover:bg-hover disabled:opacity-60"
              >
                <Folder className="size-3.5 shrink-0" strokeWidth={1.75} />
                <span className="max-w-[220px] truncate">
                  {selectedProject?.name ?? t('composer.selectProject')}
                </span>
                <ChevronDown className="size-3.5 shrink-0" strokeWidth={1.75} />
              </button>
              <Menu open={projectOpen} onClose={() => setProjectOpen(false)}>
                <MenuItem
                  title={t('composer.noProject')}
                  selected={selectedProjectId === null}
                  onClick={() => {
                    onSelectProject(null);
                    setProjectOpen(false);
                  }}
                />
                {projects.map((project) => (
                  <MenuItem
                    key={project.id}
                    title={project.name}
                    description={project.primaryRoot ?? undefined}
                    selected={project.id === selectedProjectId}
                    onClick={() => {
                      onSelectProject(project.id);
                      setProjectOpen(false);
                    }}
                  />
                ))}
              </Menu>
            </div>
          </div>
        ) : null}

        {images.length > 0 || imageNotice ? (
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
            {images.map((image) => (
              <div key={image.id} className="relative">
                <button
                  type="button"
                  aria-label={t('message.viewImage')}
                  title={t('message.viewImage')}
                  onClick={() => setPreviewImage(image)}
                  className="block size-16 overflow-hidden rounded-lg border border-line hover:border-line-strong"
                >
                  <img src={image.previewUrl} alt={image.name} className="size-full object-cover" />
                </button>
                <button
                  type="button"
                  aria-label={t('composer.removeImage')}
                  onClick={() => removeImage(image.id)}
                  className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-line bg-elevated text-fg-secondary hover:text-danger"
                >
                  <X className="size-3" strokeWidth={2} />
                </button>
              </div>
            ))}
            {imageNotice ? (
              <span className="text-[12px] text-warning">{imageNotice}</span>
            ) : null}
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          onPaste={(event) => {
            if (disabled) {
              return;
            }
            const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
              file.type.startsWith('image/'),
            );
            if (files.length === 0) {
              return;
            }
            event.preventDefault();
            if (!imageInputSupported) {
              setImageNotice(t('composer.imageUnsupported'));
              return;
            }
            void addPastedImages(files);
          }}
          onChange={(event) =>
            handleValueChange(event.target.value, event.target.selectionStart ?? 0)
          }
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onBlur={() => {
            composingRef.current = false;
          }}
          onKeyDown={(event) => {
            // Let the IME consume Enter while a candidate is being confirmed.
            // `isComposing` covers Chromium; keyCode 229 covers IMEs that end
            // composition before the confirming keydown reaches the page.
            if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) {
              return;
            }
            if (menu && flatItems.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                moveActive(1);
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                moveActive(-1);
                return;
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault();
                const active = flatItems.find((item) => item.id === activeId) ?? flatItems[0];
                if (active) {
                  applyItem(active);
                }
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                closeMenu();
                return;
              }
            }
            // Cmd/Ctrl+Shift+Enter 只对这条草稿使用另一种跟进行为。
            if (event.key === 'Enter' && event.shiftKey && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit(followUpBehavior === 'queue' ? 'steer' : 'queue');
              return;
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={
            disabled
              ? (disabledPlaceholder ?? t('composer.connecting'))
              : t('composer.placeholder')
          }
          className="max-h-[240px] w-full resize-none bg-transparent px-4 pt-3.5 text-[16px] leading-[1.5] outline-none placeholder:text-fg-tertiary disabled:opacity-60"
        />

        <div className="flex items-center gap-1 px-3 pb-2.5 pt-0.5">
          <IconButton
            aria-label={t('composer.addFiles')}
            title={`${t('composer.addFiles')} (@)`}
            disabled={disabled}
            active={menu !== null}
            onClick={() => {
              setDismissedKey(null);
              setActiveId(null);
              setMenu({ mode: 'mention', start: null, query: '' });
              textareaRef.current?.focus();
            }}
          >
            <Plus className="size-4" strokeWidth={1.75} />
          </IconButton>

          <div className="relative">
            <button
              type="button"
              onClick={() => setPermissionOpen((open) => !open)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[13px] hover:bg-hover',
                permission.warning ? 'text-warning' : 'text-fg-secondary',
              )}
            >
              {permission.warning ? (
                <AlertTriangle className="size-3.5" strokeWidth={1.75} />
              ) : null}
              {t(permission.labelKey)}
            </button>
            <Menu open={permissionOpen} onClose={() => setPermissionOpen(false)}>
              {PERMISSION_MODES.map((mode) => (
                <MenuItem
                  key={mode.id}
                  title={t(mode.labelKey)}
                  description={t(mode.descriptionKey)}
                  selected={mode.id === permission.id}
                  onClick={() => {
                    onPermissionChange(mode);
                    setPermissionOpen(false);
                  }}
                />
              ))}
            </Menu>
          </div>

          <div className="ml-auto flex items-center gap-1">
            {followUpBehavior === 'steer' ? <IconButton aria-label={t('queue.enable')} title={t('queue.enable')}
              onClick={() => onFollowUpBehaviorChange('queue')}><ListEnd className="size-4" /></IconButton> : null}
            <div className="relative">
              <button
                type="button"
                disabled={providerBusy}
                onClick={() => setModelOpen((open) => !open)}
                className="flex h-7 items-center gap-1 rounded-md px-2 text-[13px] text-fg-secondary hover:bg-hover disabled:opacity-60"
              >
                <span className="max-w-[180px] truncate">
                  {selectedModel?.displayName ?? selectedModelId ?? t('composer.model')}
                </span>
                <ChevronDown className="size-3.5 shrink-0" strokeWidth={1.75} />
              </button>
              <Menu
                open={modelOpen}
                onClose={() => {
                  setModelOpen(false);
                  setModelQuery('');
                }}
                align="right"
              >
                <div className="sticky -top-1 z-10 -mx-1 bg-elevated px-2 pt-1 pb-1.5">
                  <input
                    autoFocus
                    value={modelQuery}
                    onChange={(event) => setModelQuery(event.target.value)}
                    placeholder={t('composer.searchModels')}
                    className="h-7 w-full rounded-md border border-line bg-transparent px-2 text-[13px] outline-none placeholder:text-fg-tertiary focus:border-line-strong"
                  />
                </div>
                {modelGroups.map((group) => (
                  <div key={group.id}>
                    <div className="flex items-center justify-between gap-2 px-2.5 pt-1.5 pb-1">
                      <span className="truncate text-[11px] tracking-wide text-fg-tertiary uppercase">
                        {group.name}
                      </span>
                      <button
                        type="button"
                        aria-label={t('composer.refreshModels')}
                        title={t('composer.refreshModels')}
                        onClick={() => onRefreshProviderModels(group.id)}
                        className="flex size-5 shrink-0 items-center justify-center rounded text-fg-tertiary hover:bg-hover hover:text-fg"
                      >
                        <RefreshCw
                          className={cn('size-3', catalogBusy[group.id] && 'animate-spin')}
                          strokeWidth={1.75}
                        />
                      </button>
                    </div>
                    {group.models.length === 0 ? (
                      <div className="px-2.5 pb-2 text-[12px] text-fg-tertiary">
                        {catalogBusy[group.id]
                          ? t('composer.loadingModels')
                          : t('composer.emptyModels')}
                      </div>
                    ) : (
                      group.models.map((model) => (
                        <MenuItem
                          key={model.id}
                          title={model.displayName}
                          description={model.description}
                          selected={group.id === providerId && model.id === selectedModelId}
                          onClick={() => {
                            onSelectModel(group.id, model.id);
                            setModelOpen(false);
                            setModelQuery('');
                          }}
                        />
                      ))
                    )}
                  </div>
                ))}
                {modelGroups.length === 0 ? (
                  <div className="px-2.5 py-2 text-[12px] text-fg-tertiary">
                    {t('composer.emptyModels')}
                  </div>
                ) : null}
                <div className="my-1 h-px bg-line" />
                <MenuItem
                  title={t('provider.manage')}
                  description={t('provider.manageDescription')}
                  icon={<Settings2 className="size-3.5" strokeWidth={1.75} />}
                  onClick={() => {
                    setModelOpen(false);
                    onManageProviders();
                  }}
                />
              </Menu>
            </div>

            {effortOptions.length > 0 ? (
              <div className="relative">
                <button
                  type="button"
                  aria-label={t('composer.reasoningEffort')}
                  onClick={() => setEffortOpen((open) => !open)}
                  className="flex h-7 items-center gap-1 rounded-md px-2 text-[13px] text-fg-secondary hover:bg-hover"
                >
                  <span className="max-w-[120px] truncate">{currentEffort}</span>
                  <ChevronDown className="size-3.5 shrink-0" strokeWidth={1.75} />
                </button>
                <Menu open={effortOpen} onClose={() => setEffortOpen(false)} align="right">
                  {effortOptions.map((option) => (
                    <MenuItem
                      key={option.reasoningEffort}
                      title={option.reasoningEffort}
                      description={option.description}
                      selected={option.reasoningEffort === currentEffort}
                      onClick={() => {
                        onEffortChange(option.reasoningEffort);
                        setEffortOpen(false);
                      }}
                    />
                  ))}
                </Menu>
              </div>
            ) : null}

            <IconButton aria-label={t('composer.dictate')}>
              <Mic className="size-4" strokeWidth={1.75} />
            </IconButton>

            {running ? (
              <>
                {value.trim().length > 0 || images.length > 0 ? (
                  <>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => submit('steer')}
                      className="flex h-8 items-center rounded-full border border-line px-3 text-[13px] text-fg-secondary transition-colors hover:border-line-strong hover:text-fg disabled:opacity-30"
                    >
                      {t('composer.steer')}
                    </button>
                    <button
                      type="submit"
                      disabled={disabled}
                      aria-label={t(followUpBehavior === 'queue' ? 'composer.queue' : 'composer.steer')}
                      title={t(followUpBehavior === 'queue' ? 'composer.queue' : 'composer.steer')}
                      className="flex size-8 items-center justify-center rounded-full bg-send text-send-fg transition-opacity disabled:opacity-30"
                    >
                      <ArrowUp className="size-4" strokeWidth={2} />
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={onInterrupt}
                  aria-label={t('composer.stop')}
                  className="flex size-8 items-center justify-center rounded-full bg-send text-send-fg"
                >
                  <Square className="size-3.5" strokeWidth={2} />
                </button>
              </>
            ) : (
              <button
                type="submit"
                aria-label={t('composer.send')}
                disabled={value.trim().length === 0 || disabled}
                className="flex size-8 items-center justify-center rounded-full bg-send text-send-fg transition-opacity disabled:opacity-30"
              >
                <ArrowUp className="size-4" strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
      </form>
      {previewImage ? (
        <ImageLightbox
          source={previewImage.previewUrl}
          onClose={() => setPreviewImage(null)}
        />
      ) : null}
    </div>
  );
}
