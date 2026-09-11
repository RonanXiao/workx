import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import {
  BUILTIN_MODEL_PROVIDER_IDS,
  type CustomModelConfig,
  type InputModality,
  type ProviderBalanceView,
  type ProviderConfig,
  type ProviderWireApi,
} from '../../app/useWorkx';
import { cn } from '../../lib/cn';
import { useI18n } from '../../lib/i18n';

interface ProviderSettingsProps {
  providerConfigs: Record<string, ProviderConfig>;
  onSave: (id: string, config: ProviderConfig) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReadBalance: (id: string | null) => Promise<ProviderBalanceView>;
}

interface CustomModelDraft {
  id: string;
  contextWindow: string;
  maxContextWindow: string;
  inputModalities: InputModality[];
}

interface ProviderDraft {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  envKey: string;
  wireApi: ProviderWireApi;
  modelsEndpoint: string;
  balanceEndpoint: string;
  balanceValuePath: string;
  balanceCurrencyPath: string;
  balanceLabel: string;
  customModels: CustomModelDraft[];
}

const EMPTY_DRAFT: ProviderDraft = {
  id: '',
  name: '',
  baseUrl: '',
  apiKey: '',
  envKey: '',
  wireApi: 'responses',
  modelsEndpoint: '',
  balanceEndpoint: '',
  balanceValuePath: '',
  balanceCurrencyPath: '',
  balanceLabel: '',
  customModels: [],
};

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const WIRE_API_OPTIONS: ProviderWireApi[] = ['responses', 'chat', 'auto'];
const MODALITY_OPTIONS: InputModality[] = ['text', 'image', 'audio'];

function parsePositiveIntegerInput(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d+$/.test(trimmed)) {
    return 'invalid';
  }
  const value = Number(trimmed);
  return value > 0 ? value : 'invalid';
}

function draftFromConfig(id: string, config: ProviderConfig): ProviderDraft {
  return {
    id,
    name: config.name,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    envKey: config.envKey,
    wireApi: config.wireApi,
    modelsEndpoint: config.modelsEndpoint,
    balanceEndpoint: config.balance.endpoint,
    balanceValuePath: config.balance.valuePath,
    balanceCurrencyPath: config.balance.currencyPath,
    balanceLabel: config.balance.label,
    customModels: config.customModels.map((model) => ({
      id: model.id,
      contextWindow: model.contextWindow === null ? '' : String(model.contextWindow),
      maxContextWindow:
        model.maxContextWindow === null ? '' : String(model.maxContextWindow),
      inputModalities: [...model.inputModalities],
    })),
  };
}

export function ProviderSettings({
  providerConfigs,
  onSave,
  onDelete,
  onReadBalance,
}: ProviderSettingsProps) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProviderDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [balance, setBalance] = useState<ProviderBalanceView | null>(null);
  const [balanceBusy, setBalanceBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const configuredIds = Object.keys(providerConfigs).sort();

  useEffect(() => {
    const first = Object.keys(providerConfigs).sort()[0];
    if (first) {
      setSelectedId(first);
      setDraft(draftFromConfig(first, providerConfigs[first]));
    } else {
      setSelectedId(null);
      setDraft(EMPTY_DRAFT);
    }
    setError(null);
    setBusy(false);
    setConfirmDelete(false);
    setBalance(null);
    setBalanceBusy(false);
    // Select the first provider on mount; edits must survive parent re-renders.
  }, []);

  const select = (id: string) => {
    setSelectedId(id);
    setDraft(draftFromConfig(id, providerConfigs[id]));
    setError(null);
    setConfirmDelete(false);
    setBalance(null);
    setSaved(false);
  };

  const startNew = () => {
    setSelectedId(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
    setConfirmDelete(false);
    setBalance(null);
  };

  const handleCheckBalance = async () => {
    if (!selectedId) {
      return;
    }
    setBalanceBusy(true);
    try {
      setBalance(await onReadBalance(selectedId));
    } catch (readError) {
      setBalance({
        configured: true,
        value: null,
        currency: null,
        label: null,
        updatedAt: Math.floor(Date.now() / 1000),
        error: readError instanceof Error ? readError.message : String(readError),
      });
    } finally {
      setBalanceBusy(false);
    }
  };

  const handleSave = async () => {
    const id = draft.id.trim();
    if (selectedId === null) {
      if (!id) {
        setError(t('provider.idRequired'));
        return;
      }
      if (!PROVIDER_ID_PATTERN.test(id)) {
        setError(t('provider.idInvalid'));
        return;
      }
      if (BUILTIN_MODEL_PROVIDER_IDS.includes(id)) {
        setError(t('provider.idReserved', { id }));
        return;
      }
    }
    if (!draft.baseUrl.trim()) {
      setError(t('provider.baseUrlRequired'));
      return;
    }
    const customModels: CustomModelConfig[] = [];
    const seenIds = new Set<string>();
    for (const model of draft.customModels) {
      const modelId = model.id.trim();
      if (!modelId) {
        setError(t('provider.customModelIdRequired'));
        return;
      }
      if (seenIds.has(modelId)) {
        setError(t('provider.customModelDuplicate', { id: modelId }));
        return;
      }
      seenIds.add(modelId);
      const contextWindow = parsePositiveIntegerInput(model.contextWindow);
      const maxContextWindow = parsePositiveIntegerInput(model.maxContextWindow);
      if (contextWindow === 'invalid' || maxContextWindow === 'invalid') {
        setError(t('provider.customModelWindowInvalid', { id: modelId }));
        return;
      }
      if (
        contextWindow !== null &&
        maxContextWindow !== null &&
        maxContextWindow < contextWindow
      ) {
        setError(t('provider.customModelWindowOrder', { id: modelId }));
        return;
      }
      const inputModalities = model.inputModalities.includes('text')
        ? [...model.inputModalities]
        : (['text', ...model.inputModalities] as InputModality[]);
      customModels.push({ id: modelId, contextWindow, maxContextWindow, inputModalities });
    }
    const balanceEndpoint = draft.balanceEndpoint.trim();
    const balanceValuePath = draft.balanceValuePath.trim();
    if (Boolean(balanceEndpoint) !== Boolean(balanceValuePath)) {
      setError(t('provider.balanceIncomplete'));
      return;
    }
    if (
      balanceEndpoint &&
      !(
        balanceEndpoint.startsWith('/') ||
        balanceEndpoint.startsWith('https://') ||
        balanceEndpoint.startsWith('http://')
      )
    ) {
      setError(t('provider.balanceInvalidEndpoint'));
      return;
    }
    const targetId = selectedId ?? id;
    const config: ProviderConfig = {
      name: draft.name.trim() || targetId,
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      envKey: draft.envKey.trim(),
      wireApi: draft.wireApi,
      modelsEndpoint: draft.modelsEndpoint.trim(),
      balance: {
        endpoint: balanceEndpoint,
        valuePath: balanceValuePath,
        currencyPath: draft.balanceCurrencyPath.trim(),
        label: draft.balanceLabel.trim(),
      },
      customModels,
    };
    setBusy(true);
    try {
      await onSave(targetId, config);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (saveError) {
      setError(
        t('provider.saveFailed', {
          message: saveError instanceof Error ? saveError.message : String(saveError),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) {
      return;
    }
    const removed = selectedId;
    setBusy(true);
    try {
      await onDelete(removed);
      const remaining = configuredIds.filter((id) => id !== removed);
      if (remaining.length > 0) {
        setSelectedId(remaining[0]);
        setDraft(draftFromConfig(remaining[0], providerConfigs[remaining[0]]));
      } else {
        setSelectedId(null);
        setDraft(EMPTY_DRAFT);
      }
      setError(null);
      setConfirmDelete(false);
    } catch (deleteError) {
      setError(
        t('provider.deleteFailed', {
          message: deleteError instanceof Error ? deleteError.message : String(deleteError),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 overflow-hidden">
        <div className="flex w-[230px] shrink-0 flex-col border-r border-line bg-app">
          <h2 className="px-4 pt-4 pb-3 text-[15px] font-semibold">{t('provider.title')}</h2>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {configuredIds.map((id) => {
              const config = providerConfigs[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => select(id)}
                  className={cn(
                    'flex w-full flex-col rounded-lg px-2.5 py-2 text-left',
                    id === selectedId ? 'bg-active' : 'hover:bg-hover',
                  )}
                >
                  <span className="truncate text-[13px]">{config.name || id}</span>
                  <span className="truncate text-[11px] text-fg-tertiary">{id}</span>
                </button>
              );
            })}
            {configuredIds.length === 0 ? (
              <p className="px-2.5 py-2 text-[12px] leading-snug text-fg-tertiary">
                {t('provider.empty')}
              </p>
            ) : null}
          </div>
          <div className="border-t border-line p-2">
            <button
              type="button"
              onClick={startNew}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px]',
                selectedId === null ? 'bg-active' : 'hover:bg-hover',
              )}
            >
              <Plus className="size-4 shrink-0" strokeWidth={1.75} />
              {t('provider.add')}
            </button>
          </div>
          <p className="border-t border-line px-3 py-2 text-[11px] leading-snug text-fg-tertiary">
            {t('provider.builtinNote')}
          </p>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="flex flex-col gap-4">
              <Field
                label={t('provider.id')}
                hint={selectedId === null ? t('provider.idHint') : undefined}
              >
                <input
                  value={draft.id}
                  disabled={selectedId !== null}
                  onChange={(event) => setDraft({ ...draft, id: event.target.value })}
                  placeholder="my-provider"
                  className="h-9 w-full rounded-lg border border-line bg-app px-2.5 text-[14px] outline-none focus:border-line-strong disabled:opacity-60"
                />
              </Field>

              <Field label={t('provider.name')}>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder={draft.id || 'My provider'}
                  className="h-9 w-full rounded-lg border border-line bg-app px-2.5 text-[14px] outline-none focus:border-line-strong"
                />
              </Field>

              <Field label={t('provider.baseUrl')}>
                <input
                  value={draft.baseUrl}
                  onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                  placeholder="https://api.example.com/v1"
                  className="h-9 w-full rounded-lg border border-line bg-app px-2.5 text-[14px] outline-none focus:border-line-strong"
                />
              </Field>

              <Field label={t('provider.apiKey')} hint={t('provider.apiKeyHint')}>
                <input
                  type="password"
                  value={draft.apiKey}
                  onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                  placeholder="sk-…"
                  className="h-9 w-full rounded-lg border border-line bg-app px-2.5 text-[14px] outline-none focus:border-line-strong"
                />
              </Field>

              <Field label={t('provider.envKey')} hint={t('provider.envKeyHint')}>
                <input
                  value={draft.envKey}
                  onChange={(event) => setDraft({ ...draft, envKey: event.target.value })}
                  placeholder="MY_PROVIDER_API_KEY"
                  className="h-9 w-full rounded-lg border border-line bg-app px-2.5 text-[14px] outline-none focus:border-line-strong"
                />
              </Field>

              <Field label={t('provider.wireApi')}>
                <select
                  value={draft.wireApi}
                  onChange={(event) =>
                    setDraft({ ...draft, wireApi: event.target.value as ProviderWireApi })
                  }
                  className="h-9 w-full rounded-lg border border-line bg-app px-2.5 text-[14px] outline-none focus:border-line-strong"
                >
                  {WIRE_API_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t(`provider.wireApi.${option}`)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t('provider.modelsEndpoint')} hint={t('provider.modelsEndpointHint')}>
                <input
                  value={draft.modelsEndpoint}
                  onChange={(event) =>
                    setDraft({ ...draft, modelsEndpoint: event.target.value })
                  }
                  placeholder="/v1/models"
                  className="h-9 w-full rounded-lg border border-line bg-app px-2.5 text-[14px] outline-none focus:border-line-strong"
                />
              </Field>

              <div className="flex flex-col gap-3 rounded-xl border border-line bg-app p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-fg-secondary">
                    {t('provider.balance')}
                  </span>
                  <button
                    type="button"
                    disabled={!selectedId || balanceBusy}
                    onClick={() => void handleCheckBalance()}
                    className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-line px-2.5 text-[12px] hover:bg-hover disabled:opacity-50"
                  >
                    <RefreshCw
                      className={cn('size-3.5', balanceBusy && 'animate-spin')}
                      strokeWidth={1.75}
                    />
                    {t('provider.balanceCheck')}
                  </button>
                </div>
                <span className="text-[11px] leading-snug text-fg-tertiary">
                  {t('provider.balanceHint')}
                </span>
                <Field label={t('provider.balanceEndpoint')}>
                  <input
                    value={draft.balanceEndpoint}
                    onChange={(event) => {
                      setBalance(null);
                      setDraft({ ...draft, balanceEndpoint: event.target.value });
                    }}
                    placeholder="/user/balance"
                    className="h-9 w-full rounded-lg border border-line bg-elevated px-2.5 text-[14px] outline-none focus:border-line-strong"
                  />
                </Field>
                <Field label={t('provider.balanceValuePath')}>
                  <input
                    value={draft.balanceValuePath}
                    onChange={(event) => {
                      setBalance(null);
                      setDraft({ ...draft, balanceValuePath: event.target.value });
                    }}
                    placeholder="balance_infos[0].total_balance"
                    className="h-9 w-full rounded-lg border border-line bg-elevated px-2.5 font-mono text-[13px] outline-none focus:border-line-strong"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t('provider.balanceCurrencyPath')}>
                    <input
                      value={draft.balanceCurrencyPath}
                      onChange={(event) => {
                        setBalance(null);
                        setDraft({ ...draft, balanceCurrencyPath: event.target.value });
                      }}
                      placeholder="balance_infos[0].currency"
                      className="h-9 w-full rounded-lg border border-line bg-elevated px-2.5 font-mono text-[12px] outline-none focus:border-line-strong"
                    />
                  </Field>
                  <Field label={t('provider.balanceLabel')}>
                    <input
                      value={draft.balanceLabel}
                      onChange={(event) => {
                        setBalance(null);
                        setDraft({ ...draft, balanceLabel: event.target.value });
                      }}
                      placeholder="DeepSeek"
                      className="h-9 w-full rounded-lg border border-line bg-elevated px-2.5 text-[13px] outline-none focus:border-line-strong"
                    />
                  </Field>
                </div>
                {balance ? (
                  <p
                    className={cn(
                      'text-[12px] leading-snug',
                      balance.error ? 'text-danger' : 'text-fg-secondary',
                    )}
                  >
                    {balance.error
                      ? t('provider.balanceFailed', { message: balance.error })
                      : balance.configured && balance.value
                        ? t('provider.balanceValue', {
                            value: balance.currency
                              ? `${balance.value} ${balance.currency}`
                              : balance.value,
                          })
                        : t('provider.balanceUnconfigured')}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-fg-secondary">
                    {t('provider.customModels')}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        customModels: [
                          ...current.customModels,
                          {
                            id: '',
                            contextWindow: '',
                            maxContextWindow: '',
                            inputModalities: ['text', 'image'],
                          },
                        ],
                      }))
                    }
                    className="flex h-7 items-center gap-1 rounded-full border border-line px-2.5 text-[12px] hover:bg-hover"
                  >
                    <Plus className="size-3.5" strokeWidth={1.75} />
                    {t('provider.customModelAdd')}
                  </button>
                </div>
                <span className="text-[11px] text-fg-tertiary">
                  {t('provider.customModelsHint')}
                </span>
                {draft.customModels.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line px-3 py-3 text-[12px] text-fg-tertiary">
                    {t('provider.customModelsEmpty')}
                  </p>
                ) : null}
                {draft.customModels.map((model, index) => (
                  <div
                    key={index}
                    className="flex flex-col gap-2 rounded-xl border border-line bg-app p-3"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        value={model.id}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            customModels: current.customModels.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, id: event.target.value } : entry,
                            ),
                          }))
                        }
                        placeholder="deepseek-chat"
                        className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-elevated px-2.5 font-mono text-[13px] outline-none focus:border-line-strong"
                      />
                      <button
                        type="button"
                        aria-label={t('common.delete')}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            customModels: current.customModels.filter(
                              (_, entryIndex) => entryIndex !== index,
                            ),
                          }))
                        }
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-tertiary hover:bg-hover hover:text-danger"
                      >
                        <Trash2 className="size-3.5" strokeWidth={1.75} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-fg-tertiary">
                          {t('provider.contextWindow')}
                        </span>
                        <input
                          value={model.contextWindow}
                          inputMode="numeric"
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              customModels: current.customModels.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? { ...entry, contextWindow: event.target.value }
                                  : entry,
                              ),
                            }))
                          }
                          placeholder="128000"
                          className="h-8 w-full rounded-lg border border-line bg-elevated px-2.5 text-[13px] outline-none focus:border-line-strong"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-fg-tertiary">
                          {t('provider.maxContextWindow')}
                        </span>
                        <input
                          value={model.maxContextWindow}
                          inputMode="numeric"
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              customModels: current.customModels.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? { ...entry, maxContextWindow: event.target.value }
                                  : entry,
                              ),
                            }))
                          }
                          placeholder="128000"
                          className="h-8 w-full rounded-lg border border-line bg-elevated px-2.5 text-[13px] outline-none focus:border-line-strong"
                        />
                      </label>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] text-fg-tertiary">
                        {t('provider.inputModalities')}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {MODALITY_OPTIONS.map((modality) => {
                          const locked = modality === 'text';
                          const active = locked || model.inputModalities.includes(modality);
                          return (
                            <button
                              key={modality}
                              type="button"
                              disabled={locked}
                              onClick={() =>
                                setDraft((current) => ({
                                  ...current,
                                  customModels: current.customModels.map((entry, entryIndex) => {
                                    if (entryIndex !== index) {
                                      return entry;
                                    }
                                    const next = entry.inputModalities.includes(modality)
                                      ? entry.inputModalities.filter(
                                          (candidate) => candidate !== modality,
                                        )
                                      : [...entry.inputModalities, modality];
                                    return {
                                      ...entry,
                                      inputModalities: next.includes('text')
                                        ? next
                                        : (['text', ...next] as InputModality[]),
                                    };
                                  }),
                                }))
                              }
                              className={cn(
                                'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                                active
                                  ? 'border-line-strong bg-active text-fg'
                                  : 'border-line text-fg-tertiary hover:bg-hover',
                                locked && 'cursor-default opacity-80',
                              )}
                            >
                              {t(`provider.modality.${modality}`)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {error ? (
            <p className="border-t border-line bg-danger/5 px-5 py-2 text-[12px] leading-snug text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
            <div className="min-w-0">
              {selectedId ? (
                confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[12px] text-fg-secondary">
                      {t('provider.deleteConfirm', {
                        name: providerConfigs[selectedId]?.name || selectedId,
                      })}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleDelete()}
                      className="h-8 shrink-0 rounded-lg px-2.5 text-[13px] text-danger hover:bg-hover disabled:opacity-60"
                    >
                      {t('common.delete')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="h-8 shrink-0 rounded-lg px-2.5 text-[13px] text-fg-secondary hover:bg-hover"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-danger hover:bg-hover"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.75} />
                    {t('common.delete')}
                  </button>
                )
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {saved ? (
                <span className="text-[12px] text-fg-tertiary">{t('settings.saved')}</span>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleSave()}
                className="h-8 rounded-full bg-send px-4 text-[13px] text-send-fg disabled:opacity-60"
              >
                {busy ? t('provider.saving') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] text-fg-secondary">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-fg-tertiary">{hint}</span> : null}
    </label>
  );
}
