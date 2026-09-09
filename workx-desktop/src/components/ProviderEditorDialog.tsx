import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '../lib/cn';
import { useI18n, type MessageKey } from '../lib/i18n';
import {
  WIRE_API_OPTIONS,
  type ApiKeyMode,
  type ProviderConfigEntry,
  type ProviderFormValue,
  type WireApi,
  toProviderConfigEntry,
  validateProviderForm,
} from '../data/providers';
import { Field, inputClassName } from './Field';

export interface ProviderSaveRequest {
  id: string;
  entry: ProviderConfigEntry;
  defaultModel: string | null;
  activate: boolean;
}

interface ProviderEditorDialogProps {
  mode: 'add' | 'edit';
  /** Form prefilled by the caller (existing entry when editing, empty when adding). */
  initial: ProviderFormValue;
  /** The raw entry stored in config.toml when editing; used to keep fields
   *  the form does not manage (e.g. requires_openai_auth, auth). */
  existing: ProviderConfigEntry | null;
  /** Whether this provider is the active provider right now. */
  isActiveProvider: boolean;
  onCancel: () => void;
  onSubmit: (request: ProviderSaveRequest) => Promise<void>;
}

export function ProviderEditorDialog({
  mode,
  initial,
  existing,
  isActiveProvider,
  onCancel,
  onSubmit,
}: ProviderEditorDialogProps) {
  const { t } = useI18n();
  // The caller remounts this dialog (with a key) when the target changes, so
  // the form state can simply be seeded once.
  const [value, setValue] = useState<ProviderFormValue>(initial);
  const storedToken = initial.token.trim() || null;
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Escape cancels unless a save is in flight (handled below).
  useEffect(() => {
    if (busy) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  // While a save is in flight, swallow Escape so it cannot close the dialog
  // underneath while buttons are disabled.
  useEffect(() => {
    if (!busy) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [busy]);

  const providerId = mode === 'edit' ? initial.id.trim() : value.id.trim();

  const set = (patch: Partial<ProviderFormValue>) => {
    setValue((current) => ({ ...current, ...patch }));
    setErrorKey(null);
    setSubmitError(null);
  };

  const updateRow = (
    group: 'headers' | 'envHeaders' | 'queryParams',
    index: number,
    patch: Partial<{ key: string; value: string }>,
  ) => {
    setValue((current) => {
      const rows = [...current[group]];
      rows[index] = { ...rows[index], ...patch };
      return { ...current, [group]: rows };
    });
  };

  const removeRow = (group: 'headers' | 'envHeaders' | 'queryParams', index: number) => {
    setValue((current) => ({
      ...current,
      [group]: current[group].filter((_, i) => i !== index),
    }));
  };

  const addRow = (group: 'headers' | 'envHeaders' | 'queryParams') => {
    setValue((current) => ({ ...current, [group]: [...current[group], { key: '', value: '' }] }));
  };

  const submit = async (activate: boolean) => {
    const validationError = validateProviderForm(value);
    if (validationError) {
      setErrorKey(validationError);
      return;
    }
    const serialized = toProviderConfigEntry(value, storedToken);
    // Start from the stored entry so config fields this form does not manage
    // survive an edit, then apply the form values and remove fields the user
    // cleared (an empty value means "unset" for the managed keys).
    const entry: ProviderConfigEntry = { ...(existing ?? {}), ...serialized };
    for (const key of [
      'models_endpoint',
      'http_headers',
      'env_http_headers',
      'query_params',
      'request_max_retries',
      'stream_max_retries',
      'stream_idle_timeout_ms',
      'websocket_connect_timeout_ms',
      'supports_websockets',
      'env_key',
      'experimental_bearer_token',
    ] as const) {
      if (!(key in serialized)) {
        delete entry[key];
      }
    }
    setBusy(true);
    setSubmitError(null);
    try {
      await onSubmit({
        id: providerId,
        entry,
        defaultModel: value.defaultModel.trim() || null,
        activate,
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  const apiKeyOptions: { mode: ApiKeyMode; label: string }[] = [
    { mode: 'none', label: t('provider.apiKeyNone') },
    { mode: 'env', label: t('provider.apiKeyEnv') },
    { mode: 'inline', label: t('provider.apiKeyInline') },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(mode === 'add' ? 'provider.addTitle' : 'provider.editTitle')}
        className="flex max-h-[88vh] w-[600px] max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-elevated shadow-2xl"
      >
        <div className="border-b border-line px-6 pb-3 pt-5">
          <h2 className="text-[17px] font-semibold">
            {t(mode === 'add' ? 'provider.addTitle' : 'provider.editTitle')}
          </h2>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('provider.id')}>
              <input
                value={providerId}
                disabled={mode === 'edit' || busy}
                onChange={(event) => set({ id: event.target.value })}
                placeholder="my-provider"
                spellCheck={false}
                className={cn(inputClassName, 'disabled:opacity-60')}
              />
            </Field>
            <Field label={t('provider.name')}>
              <input
                value={value.name}
                disabled={busy}
                onChange={(event) => set({ name: event.target.value })}
                placeholder={providerId || 'My provider'}
                spellCheck={false}
                className={cn(inputClassName, 'disabled:opacity-60')}
              />
            </Field>
          </div>

          <Field label={t('provider.baseUrl')}>
            <input
              value={value.baseUrl}
              disabled={busy}
              onChange={(event) => set({ baseUrl: event.target.value })}
              placeholder="https://api.example.com/v1"
              spellCheck={false}
              className={cn(inputClassName, 'disabled:opacity-60')}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('provider.protocol')}>
              <select
                value={value.wireApi}
                disabled={busy}
                onChange={(event) => set({ wireApi: event.target.value as WireApi })}
                className={cn(inputClassName, 'disabled:opacity-60')}
              >
                {WIRE_API_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('provider.modelsEndpoint')}>
              <input
                value={value.modelsEndpoint}
                disabled={busy}
                onChange={(event) => set({ modelsEndpoint: event.target.value })}
                placeholder="/v1/models"
                spellCheck={false}
                className={cn(inputClassName, 'disabled:opacity-60')}
              />
            </Field>
          </div>

          <Field label={t('provider.apiKeySource')}>
            <div className="flex gap-1.5">
              {apiKeyOptions.map((option) => (
                <button
                  key={option.mode}
                  type="button"
                  disabled={busy}
                  onClick={() => set({ apiKeyMode: option.mode })}
                  className={cn(
                    'h-8 flex-1 rounded-lg border text-[13px]',
                    value.apiKeyMode === option.mode
                      ? 'border-line-strong bg-active text-fg'
                      : 'border-line text-fg-secondary hover:bg-hover',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Field>
          {value.apiKeyMode === 'env' ? (
            <Field label={t('provider.envVar')}>
              <input
                value={value.envVar}
                disabled={busy}
                onChange={(event) => set({ envVar: event.target.value })}
                placeholder="MY_PROVIDER_API_KEY"
                spellCheck={false}
                className={cn(inputClassName, 'disabled:opacity-60')}
              />
            </Field>
          ) : null}
          {value.apiKeyMode === 'inline' ? (
            <div className="space-y-1.5">
              <Field label={t('provider.apiKeyField')}>
                <input
                  type="password"
                  value={value.token}
                  disabled={busy || value.clearStoredToken}
                  onChange={(event) => set({ token: event.target.value })}
                  placeholder={storedToken ? t('provider.apiKeyFieldPlaceholder') : ''}
                  autoComplete="off"
                  spellCheck={false}
                  className={cn(inputClassName, 'disabled:opacity-60')}
                />
              </Field>
              {storedToken ? (
                <label className="flex items-center gap-2 text-[13px] text-fg-secondary">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={value.clearStoredToken}
                    onChange={(event) => set({ clearStoredToken: event.target.checked })}
                  />
                  {t('provider.clearKey')}
                </label>
              ) : null}
            </div>
          ) : null}

          <Field label={t('provider.defaultModel')}>
            <input
              value={value.defaultModel}
              disabled={busy}
              onChange={(event) => set({ defaultModel: event.target.value })}
              placeholder={t('settings.customModelPlaceholder')}
              spellCheck={false}
              className={cn(inputClassName, 'disabled:opacity-60')}
            />
          </Field>

          <div>
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowAdvanced((show) => !show)}
              className="flex items-center gap-1 text-[13px] text-fg-secondary hover:text-fg"
            >
              {showAdvanced ? (
                <ChevronUp className="size-3.5" strokeWidth={1.75} />
              ) : (
                <ChevronDown className="size-3.5" strokeWidth={1.75} />
              )}
              {t('provider.advanced')}
            </button>
            {showAdvanced ? (
              <div className="mt-3 space-y-4">
                <KvRows
                  label={t('provider.headers')}
                  rows={value.headers}
                  valueLabel={t('provider.headersValue')}
                  disabled={busy}
                  onChange={(index, patch) => updateRow('headers', index, patch)}
                  onAdd={() => addRow('headers')}
                  onRemove={(index) => removeRow('headers', index)}
                />
                <KvRows
                  label={t('provider.envHeaders')}
                  rows={value.envHeaders}
                  valueLabel={t('provider.envHeadersValue')}
                  disabled={busy}
                  onChange={(index, patch) => updateRow('envHeaders', index, patch)}
                  onAdd={() => addRow('envHeaders')}
                  onRemove={(index) => removeRow('envHeaders', index)}
                />
                <KvRows
                  label={t('provider.queryParams')}
                  rows={value.queryParams}
                  valueLabel={t('provider.headersValue')}
                  disabled={busy}
                  onChange={(index, patch) => updateRow('queryParams', index, patch)}
                  onAdd={() => addRow('queryParams')}
                  onRemove={(index) => removeRow('queryParams', index)}
                />
                <div className="grid grid-cols-2 gap-3">
                  <NumberField
                    label={t('provider.requestMaxRetries')}
                    value={value.requestMaxRetries}
                    disabled={busy}
                    onChange={(text) => set({ requestMaxRetries: text })}
                  />
                  <NumberField
                    label={t('provider.streamMaxRetries')}
                    value={value.streamMaxRetries}
                    disabled={busy}
                    onChange={(text) => set({ streamMaxRetries: text })}
                  />
                  <NumberField
                    label={t('provider.streamIdleTimeoutMs')}
                    value={value.streamIdleTimeoutMs}
                    disabled={busy}
                    onChange={(text) => set({ streamIdleTimeoutMs: text })}
                  />
                  <NumberField
                    label={t('provider.wsConnectTimeoutMs')}
                    value={value.websocketConnectTimeoutMs}
                    disabled={busy}
                    onChange={(text) => set({ websocketConnectTimeoutMs: text })}
                  />
                </div>
                <label className="flex items-center gap-2 text-[13px] text-fg-secondary">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={value.supportsWebsockets}
                    onChange={(event) => set({ supportsWebsockets: event.target.checked })}
                  />
                  {t('provider.supportsWebsockets')}
                </label>
              </div>
            ) : null}
          </div>

          {errorKey ? <p className="text-[13px] text-danger">{t(errorKey as MessageKey)}</p> : null}
          {submitError ? <p className="text-[13px] text-danger">{submitError}</p> : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="h-8 rounded-full border border-line px-4 text-[13px] hover:bg-hover disabled:opacity-60"
          >
            {t('common.cancel')}
          </button>
          {!isActiveProvider && mode === 'edit' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit(false)}
              className="h-8 rounded-full border border-line px-4 text-[13px] hover:bg-hover disabled:opacity-60"
            >
              {t('provider.save')}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit(isActiveProvider ? false : true)}
            className="h-8 rounded-full bg-send px-4 text-[13px] text-send-fg disabled:opacity-60"
          >
            {t(isActiveProvider ? 'provider.save' : 'provider.saveAndUse')}
          </button>
        </div>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  return (
    <Field label={label}>
      <input
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={cn(inputClassName, 'disabled:opacity-60')}
      />
    </Field>
  );
}

function KvRows({
  label,
  rows,
  valueLabel,
  disabled,
  onChange,
  onAdd,
  onRemove,
}: {
  label: string;
  rows: { key: string; value: string }[];
  valueLabel: string;
  disabled: boolean;
  onChange: (index: number, patch: { key: string; value: string }) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div>
      <span className="text-[13px] text-fg-secondary">{label}</span>
      <div className="mt-1.5 space-y-1.5">
        {rows.map((row, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <input
              value={row.key}
              disabled={disabled}
              onChange={(event) => onChange(index, { key: event.target.value, value: row.value })}
              placeholder={t('provider.headerName')}
              spellCheck={false}
              className={cn(inputClassName, 'flex-1 disabled:opacity-60')}
            />
            <input
              value={row.value}
              disabled={disabled}
              onChange={(event) => onChange(index, { key: row.key, value: event.target.value })}
              placeholder={valueLabel}
              spellCheck={false}
              className={cn(inputClassName, 'flex-1 disabled:opacity-60')}
            />
            <button
              type="button"
              title={t('provider.removeRow')}
              aria-label={t('provider.removeRow')}
              disabled={disabled}
              onClick={() => onRemove(index)}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-fg-tertiary hover:bg-hover hover:text-fg disabled:opacity-60"
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={onAdd}
          className="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-fg-secondary hover:bg-hover hover:text-fg disabled:opacity-60"
        >
          <Plus className="size-3.5" strokeWidth={1.75} />
          {t('provider.addRow')}
        </button>
      </div>
    </div>
  );
}