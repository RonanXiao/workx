import { ArrowLeftRight, Monitor, Moon, Pencil, Plus, Sun, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { Model } from '@protocol/v2/Model';
import {
  emptyProviderFormValue,
  formValueFromEntry,
  type CustomModel,
  type ProviderConfigEntry,
  type ProviderFormValue,
  type ProviderSummary,
} from '../data/providers';
import { cn } from '../lib/cn';
import { LANGUAGE_OPTIONS, useI18n, type MessageKey } from '../lib/i18n';
import type { ThemePreference } from '../lib/theme';
import { ConfirmDialog } from './ConfirmDialog';
import { Field } from './Field';
import { IconButton } from './IconButton';
import { ProviderEditorDialog, type ProviderSaveRequest } from './ProviderEditorDialog';

export interface ProviderSaveParams {
  id: string;
  entry: ProviderConfigEntry;
  activate: boolean;
  defaultModel?: string | null;
}

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  models: Model[];
  selectedModelId: string | null;
  onModelChange: (id: string) => void;
  providers: ProviderSummary[];
  providerId: string | null;
  providerBusy: boolean;
  onSelectProvider: (id: string) => void;
  onSaveProvider: (params: ProviderSaveParams) => Promise<void>;
  onDeleteProvider: (id: string) => Promise<void>;
  configuredProviders: Record<string, ProviderConfigEntry>;
  customModels: CustomModel[];
  onAddCustomModel: (id: string) => Promise<void>;
  onRemoveCustomModel: (id: string) => Promise<void>;
  selectedEffort: string | null;
  onEffortChange: (effort: string) => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
}

export function SettingsDialog({
  open,
  onClose,
  models,
  selectedModelId,
  onModelChange,
  providers,
  providerId,
  providerBusy,
  onSelectProvider,
  onSaveProvider,
  onDeleteProvider,
  configuredProviders,
  customModels,
  onAddCustomModel,
  onRemoveCustomModel,
  selectedEffort,
  onEffortChange,
  theme,
  onThemeChange,
}: SettingsDialogProps) {
  const { t, language, setLanguage } = useI18n();
  const [draftModelId, setDraftModelId] = useState(selectedModelId);
  const [draftEffort, setDraftEffort] = useState(selectedEffort);
  const [draftTheme, setDraftTheme] = useState(theme);
  const [editor, setEditor] = useState<{ mode: 'add' | 'edit'; id: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProviderSummary | null>(null);
  const [customDraft, setCustomDraft] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const busy = providerBusy || actionBusy;
  const draftModel = models.find((model) => model.id === draftModelId) ?? null;
  const efforts = draftModel
    ? draftModel.supportedReasoningEfforts.length > 0
      ? draftModel.supportedReasoningEfforts
      : [
          {
            reasoningEffort: draftModel.defaultReasoningEffort,
            description: t('settings.defaultForModel'),
          },
        ]
    : [];
  const listedIds = new Set(models.map((model) => model.id));

  useEffect(() => {
    if (open) {
      // Refresh drafts when the dialog opens or the active provider/model
      // changes while it is open (e.g. after switching provider in the list).
      setDraftModelId(selectedModelId);
      setDraftEffort(selectedEffort);
      setDraftTheme(theme);
      setActionError(null);
      setCustomDraft('');
    }
  }, [open, providerId, selectedModelId, selectedEffort, theme]);

  // Only swallow Escape while this is the top-most layer so stacked dialogs
  // (provider editor, delete confirmation) close first.
  useEffect(() => {
    if (!open || editor !== null || deleteTarget !== null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [deleteTarget, editor, onClose, open]);

  if (!open) {
    return null;
  }

  const runAction = async (action: () => Promise<void>) => {
    setActionBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionBusy(false);
    }
  };

  const saveProvider = async (request: ProviderSaveRequest) => {
    await runAction(async () => {
      await onSaveProvider({
        id: request.id,
        entry: request.entry,
        activate: request.activate,
        defaultModel: request.defaultModel,
      });
      setEditor(null);
    });
  };

  const buildEditorInitial = (): ProviderFormValue => {
    if (!editor) {
      return emptyProviderFormValue();
    }
    if (editor.mode === 'edit') {
      const entry = configuredProviders[editor.id];
      return entry ? formValueFromEntry(editor.id, entry) : emptyProviderFormValue();
    }
    return emptyProviderFormValue();
  };

  const addCustomModel = async () => {
    const id = customDraft.trim();
    if (!id) {
      return;
    }
    if (listedIds.has(id) || customModels.some((model) => model.id === id)) {
      setActionError(t('settings.modelExists'));
      return;
    }
    await runAction(async () => {
      await onAddCustomModel(id);
      setCustomDraft('');
    });
  };

  const removeCustomModel = async (id: string) => {
    await runAction(async () => {
      await onRemoveCustomModel(id);
      if (draftModelId === id) {
        setDraftModelId(null);
      }
    });
  };

  const removeProvider = async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) {
      return;
    }
    await runAction(() => onDeleteProvider(target.id));
  };

  const themeOptions: { value: ThemePreference; label: MessageKey; icon: typeof Sun }[] = [
    { value: 'light', label: 'settings.light', icon: Sun },
    { value: 'dark', label: 'settings.dark', icon: Moon },
    { value: 'system', label: 'settings.system', icon: Monitor },
  ];

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6"
        onMouseDown={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('settings.title')}
          onMouseDown={(event) => event.stopPropagation()}
          className="flex max-h-[86vh] w-[500px] max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-elevated p-6 shadow-2xl"
        >
          <div className="shrink-0">
            <h2 className="text-[17px] font-semibold">{t('settings.title')}</h2>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pt-5">
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-medium text-fg-secondary">
                  {t('settings.modelProvider')}
                </h3>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditor({ mode: 'add', id: '' })}
                  className="flex h-7 items-center gap-1 rounded-lg px-2 text-[13px] text-fg-secondary hover:bg-hover hover:text-fg disabled:opacity-60"
                >
                  <Plus className="size-3.5" strokeWidth={1.75} />
                  {t('settings.providerAdd')}
                </button>
              </div>

              <p className="text-[12px] leading-snug text-fg-tertiary">
                {t('settings.modelProviderHint')}
              </p>

              <div className="space-y-1.5">
                {providers.map((provider) => {
                  const isActive = provider.id === providerId;
                  return (
                    <div
                      key={provider.id}
                      className="flex items-center gap-2 rounded-lg border border-line bg-app px-3 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px]">{provider.name}</span>
                        <span className="block truncate text-[12px] text-fg-tertiary">
                          {provider.id}
                          {provider.baseUrl ? ' · ' + provider.baseUrl : ''}
                          {provider.builtin ? ' · ' + t('settings.providerBuiltin') : ''}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-0.5">
                        {isActive ? (
                          <span className="rounded-full bg-active px-2 py-0.5 text-[11px] font-medium">
                            {t('settings.providerActive')}
                          </span>
                        ) : (
                          <IconButton
                            aria-label={t('settings.providerUse')}
                            title={t('settings.providerUse')}
                            disabled={busy}
                            onClick={() => void onSelectProvider(provider.id)}
                          >
                            <ArrowLeftRight className="size-3.5" strokeWidth={1.75} />
                          </IconButton>
                        )}
                        {provider.editable ? (
                          <IconButton
                            aria-label={t('settings.providerEdit')}
                            title={t('settings.providerEdit')}
                            disabled={busy}
                            onClick={() => setEditor({ mode: 'edit', id: provider.id })}
                          >
                            <Pencil className="size-3.5" strokeWidth={1.75} />
                          </IconButton>
                        ) : null}
                        {provider.removable && !isActive ? (
                          <IconButton
                            aria-label={t('settings.providerDelete')}
                            title={t('settings.providerDelete')}
                            disabled={busy}
                            onClick={() => setDeleteTarget(provider)}
                          >
                            <Trash2 className="size-3.5" strokeWidth={1.75} />
                          </IconButton>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="space-y-2">
              <Field label={t('settings.model')}>
                {models.length + customModels.length > 0 ? (
                  <select
                    value={draftModelId ?? ''}
                    onChange={(event) => {
                      const nextId = event.target.value;
                      setDraftModelId(nextId);
                      const nextModel = models.find((model) => model.id === nextId);
                      setDraftEffort(nextModel?.defaultReasoningEffort ?? null);
                    }}
                    className="h-9 w-full rounded-lg border border-line bg-app px-2.5 text-[14px] outline-none focus:border-line-strong"
                  >
                    {models.length > 0 ? (
                      <optgroup label={t('settings.modelsListed')}>
                        {models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.displayName}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {customModels.length > 0 ? (
                      <optgroup label={t('settings.modelsCustom')}>
                        {customModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.id}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                ) : (
                  <p className="text-[13px] text-fg-tertiary">{t('settings.noModels')}</p>
                )}
              </Field>

              {draftModel ? (
                <Field label={t('settings.reasoningEffort')}>
                  <select
                    value={draftEffort ?? ''}
                    onChange={(event) => setDraftEffort(event.target.value)}
                    className="h-9 w-full rounded-lg border border-line bg-app px-2.5 text-[14px] outline-none focus:border-line-strong"
                  >
                    {efforts.map((option) => (
                      <option key={option.reasoningEffort} value={option.reasoningEffort}>
                        {option.reasoningEffort}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}

              <div className="space-y-1.5">
                <h3 className="text-[13px] font-medium text-fg-secondary">
                  {t('settings.customModels')}
                </h3>
                {customModels.length === 0 ? (
                  <p className="text-[12px] leading-snug text-fg-tertiary">
                    {t('settings.customModelsHint')}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {customModels.map((model) => (
                      <div
                        key={model.id}
                        className="flex items-center gap-2 rounded-md border border-line bg-app px-2.5 py-1.5"
                      >
                        <code className="min-w-0 flex-1 truncate text-[12px]">{model.id}</code>
                        <IconButton
                          aria-label={t('common.delete')}
                          title={t('common.delete')}
                          disabled={busy}
                          onClick={() => void removeCustomModel(model.id)}
                        >
                          <Trash2 className="size-3.5" strokeWidth={1.75} />
                        </IconButton>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-1.5">
                  <input
                    value={customDraft}
                    disabled={busy || !providerId}
                    onChange={(event) => setCustomDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void addCustomModel();
                      }
                    }}
                    placeholder={t('settings.customModelPlaceholder')}
                    spellCheck={false}
                    className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-app px-2.5 text-[13px] outline-none focus:border-line-strong disabled:opacity-60"
                  />
                  <button
                    type="button"
                    disabled={busy || !providerId || !customDraft.trim()}
                    onClick={() => void addCustomModel()}
                    className="h-8 rounded-lg border border-line px-3 text-[13px] hover:bg-hover disabled:opacity-60"
                  >
                    {t('settings.addCustomModel')}
                  </button>
                </div>
              </div>
            </section>

            <Field label={t('settings.language')}>
              <div className="flex gap-1.5">
                {LANGUAGE_OPTIONS.map((option) => {
                  const selected = language === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setLanguage(option.value)}
                      className={cn(
                        'flex h-9 flex-1 items-center justify-center rounded-lg border text-[13px]',
                        selected
                          ? 'border-line-strong bg-active text-fg'
                          : 'border-line text-fg-secondary hover:bg-hover',
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label={t('settings.theme')}>
              <div className="flex gap-1.5">
                {themeOptions.map((option) => {
                  const Icon = option.icon;
                  const selected = draftTheme === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setDraftTheme(option.value)}
                      className={cn(
                        'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border text-[13px]',
                        selected
                          ? 'border-line-strong bg-active text-fg'
                          : 'border-line text-fg-secondary hover:bg-hover',
                      )}
                    >
                      <Icon className="size-3.5" strokeWidth={1.75} />
                      {t(option.label)}
                    </button>
                  );
                })}
              </div>
            </Field>

            {actionError ? <p className="text-[13px] text-danger">{actionError}</p> : null}
          </div>

          <div className="mt-5 flex shrink-0 justify-end gap-2 border-t border-line pt-4">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-full border border-line px-4 text-[13px] hover:bg-hover"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => {
                if (draftModelId) {
                  onModelChange(draftModelId);
                }
                if (draftEffort) {
                  onEffortChange(draftEffort);
                }
                onThemeChange(draftTheme);
                onClose();
              }}
              className="h-8 rounded-full bg-send px-4 text-[13px] text-send-fg"
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>

      {editor ? (
        <ProviderEditorDialog
          key={editor.mode + ':' + editor.id}
          mode={editor.mode}
          initial={buildEditorInitial()}
          existing={
            editor.mode === 'edit' ? (configuredProviders[editor.id] ?? null) : null
          }
          isActiveProvider={editor.id === providerId}
          onCancel={() => setEditor(null)}
          onSubmit={saveProvider}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('settings.providerDeleteTitle', { name: deleteTarget?.name ?? '' })}
        description={t('settings.providerDeleteDescription')}
        confirmLabel={t('common.delete')}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void removeProvider()}
      />
    </>
  );
}