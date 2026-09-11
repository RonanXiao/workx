import {
  Info,
  Palette,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useState, type ComponentType, type ReactNode, type SVGProps } from 'react';

import type { InitializeResponse } from '@protocol/InitializeResponse';
import type { Model } from '@protocol/v2/Model';
import type { AppInfo } from '../../preload';
import type {
  ProviderBalanceView,
  ProviderConfig,
  WorkxController,
} from '../../app/useWorkx';
import { PERMISSION_MODES, type PermissionMode } from '../../data/workspace';
import { cn } from '../../lib/cn';
import { LANGUAGE_OPTIONS, useI18n, type MessageKey } from '../../lib/i18n';
import type { ThemePreference } from '../../lib/theme';
import { ProviderSettings } from './ProviderSettings';

export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'model'
  | 'permission'
  | 'providers'
  | 'about';

interface SettingsNavItem {
  key: SettingsSection;
  labelKey: MessageKey;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const SECTIONS: SettingsNavItem[] = [
  { key: 'general', labelKey: 'settings.general', icon: SlidersHorizontal },
  { key: 'appearance', labelKey: 'settings.appearance', icon: Palette },
  { key: 'model', labelKey: 'settings.model', icon: Sparkles },
  { key: 'permission', labelKey: 'settings.permissions', icon: ShieldCheck },
  { key: 'providers', labelKey: 'settings.providers', icon: Server },
  { key: 'about', labelKey: 'settings.about', icon: Info },
];

interface SettingsPageProps {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onClose: () => void;
  models: Model[];
  selectedModelId: string | null;
  onModelChange: (id: string) => void;
  selectedEffort: string | null;
  onEffortChange: (effort: string) => void;
  providers: string[];
  providerId: string | null;
  providerBusy: boolean;
  onProviderChange: (id: string) => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  permission: PermissionMode;
  onPermissionChange: (mode: PermissionMode) => void;
  providerConfigs: Record<string, ProviderConfig>;
  onSaveProvider: (id: string, config: ProviderConfig) => Promise<void>;
  onDeleteProvider: (id: string) => Promise<void>;
  onReadProviderBalance: (id: string | null) => Promise<ProviderBalanceView>;
  appServerStatus: WorkxController['status'];
  serverInfo: InitializeResponse | null;
  cwd: string;
}

export function SettingsPage(props: SettingsPageProps) {
  const { t } = useI18n();
  const { section, onSectionChange, onClose } = props;
  const active = SECTIONS.find((item) => item.key === section) ?? SECTIONS[0];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex bg-app text-fg">
      <aside className="flex w-[224px] shrink-0 flex-col border-r border-line bg-sidebar">
        <div className="flex h-11 shrink-0 items-center px-4 text-[15px] font-semibold">
          {t('settings.title')}
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          {SECTIONS.map((item) => {
            const Icon = item.icon;
            const selected = item.key === section;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onSectionChange(item.key)}
                className={cn(
                  'mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px]',
                  selected ? 'bg-active text-fg' : 'text-fg-secondary hover:bg-hover hover:text-fg',
                )}
              >
                <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                <span className="truncate">{t(item.labelKey)}</span>
              </button>
            );
          })}
        </nav>
        <div className="shrink-0 border-t border-line p-2">
          <button
            type="button"
            onClick={onClose}
            className="flex w-full items-center justify-center rounded-lg px-2.5 py-2 text-[13px] text-fg-secondary hover:bg-hover hover:text-fg"
          >
            {t('settings.backToApp')}
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-5">
          <h1 className="min-w-0 flex-1 truncate text-[14px] font-semibold">
            {t(active.labelKey)}
          </h1>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            className="-mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-md text-fg-secondary hover:bg-hover hover:text-fg"
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>

        {section === 'providers' ? (
          <ProviderSettings
            providerConfigs={props.providerConfigs}
            onSave={props.onSaveProvider}
            onDelete={props.onDeleteProvider}
            onReadBalance={props.onReadProviderBalance}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {section === 'general' ? <GeneralSection /> : null}
            {section === 'appearance' ? (
              <AppearanceSection theme={props.theme} onThemeChange={props.onThemeChange} />
            ) : null}
            {section === 'model' ? (
              <ModelSection
                models={props.models}
                selectedModelId={props.selectedModelId}
                onModelChange={props.onModelChange}
                selectedEffort={props.selectedEffort}
                onEffortChange={props.onEffortChange}
                providers={props.providers}
                providerId={props.providerId}
                providerBusy={props.providerBusy}
                onProviderChange={props.onProviderChange}
              />
            ) : null}
            {section === 'permission' ? (
              <PermissionSection
                permission={props.permission}
                onPermissionChange={props.onPermissionChange}
              />
            ) : null}
            {section === 'about' ? (
              <AboutSection
                appServerStatus={props.appServerStatus}
                serverInfo={props.serverInfo}
                cwd={props.cwd}
              />
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}

function SectionShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-6 px-8 py-7">
      <div>
        <h2 className="text-[17px] font-semibold">{title}</h2>
        <p className="mt-1 text-[13px] leading-snug text-fg-tertiary">{description}</p>
      </div>
      {children}
    </div>
  );
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      {title ? <h3 className="px-1 text-[12px] font-medium text-fg-tertiary">{title}</h3> : null}
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-elevated">
        {children}
      </div>
    </section>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="min-w-0">
        <div className="text-[14px]">{label}</div>
        {description ? (
          <div className="mt-0.5 text-[12px] leading-snug text-fg-tertiary">{description}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function Select({
  value,
  onChange,
  disabled,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 min-w-[10rem] max-w-[16rem] truncate rounded-lg border border-line bg-app px-2.5 text-[13px] outline-none focus:border-line-strong disabled:opacity-60"
    >
      {children}
    </select>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; icon?: ComponentType<SVGProps<SVGSVGElement>> }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((option) => {
        const Icon = option.icon;
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'flex h-8 items-center justify-center gap-1.5 rounded-lg border px-3 text-[13px]',
              selected
                ? 'border-line-strong bg-active text-fg'
                : 'border-line text-fg-secondary hover:bg-hover',
            )}
          >
            {Icon ? <Icon className="size-3.5" strokeWidth={1.75} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function GeneralSection() {
  const { t, language, setLanguage } = useI18n();
  return (
    <SectionShell title={t('settings.general')} description={t('settings.generalDescription')}>
      <Group>
        <Row label={t('settings.language')} description={t('settings.languageDescription')}>
          <Segmented value={language} options={LANGUAGE_OPTIONS} onChange={setLanguage} />
        </Row>
      </Group>
    </SectionShell>
  );
}

function AppearanceSection({
  theme,
  onThemeChange,
}: {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
}) {
  const { t } = useI18n();
  return (
    <SectionShell title={t('settings.appearance')} description={t('settings.appearanceDescription')}>
      <Group>
        <Row label={t('settings.theme')} description={t('settings.themeDescription')}>
          <Segmented
            value={theme}
            onChange={onThemeChange}
            options={[
              { value: 'light', label: t('settings.light') },
              { value: 'dark', label: t('settings.dark') },
              { value: 'system', label: t('settings.system') },
            ]}
          />
        </Row>
      </Group>
    </SectionShell>
  );
}

function ModelSection({
  models,
  selectedModelId,
  onModelChange,
  selectedEffort,
  onEffortChange,
  providers,
  providerId,
  providerBusy,
  onProviderChange,
}: {
  models: Model[];
  selectedModelId: string | null;
  onModelChange: (id: string) => void;
  selectedEffort: string | null;
  onEffortChange: (effort: string) => void;
  providers: string[];
  providerId: string | null;
  providerBusy: boolean;
  onProviderChange: (id: string) => void;
}) {
  const { t } = useI18n();
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? null;
  const efforts = selectedModel
    ? selectedModel.supportedReasoningEfforts.length > 0
      ? selectedModel.supportedReasoningEfforts
      : [
          {
            reasoningEffort: selectedModel.defaultReasoningEffort,
            description: t('settings.defaultForModel'),
          },
        ]
    : [];

  return (
    <SectionShell title={t('settings.model')} description={t('settings.modelDescription')}>
      <Group>
        <Row label={t('settings.provider')} description={t('settings.providerDescription')}>
          <Select
            value={providerId ?? ''}
            disabled={providerBusy || providers.length === 0}
            onChange={onProviderChange}
          >
            {providers.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </Select>
        </Row>
      </Group>

      <Group>
        <Row label={t('settings.model')}>
          <Select value={selectedModelId ?? ''} onChange={onModelChange}>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </Select>
        </Row>
        <Row label={t('settings.reasoningEffort')}>
          <Select value={selectedEffort ?? ''} onChange={onEffortChange} disabled={efforts.length === 0}>
            {efforts.map((option) => (
              <option key={option.reasoningEffort} value={option.reasoningEffort}>
                {option.reasoningEffort}
              </option>
            ))}
          </Select>
        </Row>
      </Group>
    </SectionShell>
  );
}

function PermissionSection({
  permission,
  onPermissionChange,
}: {
  permission: PermissionMode;
  onPermissionChange: (mode: PermissionMode) => void;
}) {
  const { t } = useI18n();
  return (
    <SectionShell
      title={t('settings.permissions')}
      description={t('settings.permissionsDescription')}
    >
      <Group title={t('settings.approvalMode')}>
        {PERMISSION_MODES.map((mode) => {
          const selected = mode.id === permission.id;
          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => onPermissionChange(mode)}
              className={cn(
                'flex w-full items-center justify-between gap-4 px-4 py-3 text-left',
                selected ? 'bg-active' : 'hover:bg-hover',
              )}
            >
              <span className="min-w-0">
                <span
                  className={cn('block text-[14px]', mode.warning && 'text-warning')}
                >
                  {t(mode.labelKey)}
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-fg-tertiary">
                  {t(mode.descriptionKey)}
                </span>
              </span>
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full border',
                  selected ? 'border-line-strong bg-fg' : 'border-line-strong',
                )}
              >
                {selected ? <span className="size-1.5 rounded-full bg-app" /> : null}
              </span>
            </button>
          );
        })}
      </Group>
    </SectionShell>
  );
}

function AboutSection({
  appServerStatus,
  serverInfo,
  cwd,
}: {
  appServerStatus: WorkxController['status'];
  serverInfo: InitializeResponse | null;
  cwd: string;
}) {
  const { t } = useI18n();
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let active = true;
    window.workx
      .getAppInfo()
      .then((info) => {
        if (active) {
          setAppInfo(info);
        }
      })
      .catch(() => {
        if (active) {
          setAppInfo(null);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const statusLabel =
    appServerStatus === 'ready'
      ? t('topbar.connected')
      : appServerStatus === 'connecting'
        ? t('topbar.connecting')
        : appServerStatus === 'stopped'
          ? t('topbar.stopped')
          : t('topbar.disconnected');

  return (
    <SectionShell title={t('settings.about')} description={t('settings.aboutDescription')}>
      <Group title={t('settings.aboutApp')}>
        <Row label={t('settings.appVersion')}>
          <Value>{appInfo ? `${appInfo.name} ${appInfo.version}` : '—'}</Value>
        </Row>
        <Row label={t('settings.appServer')} description={serverInfo?.userAgent}>
          <Value>{statusLabel}</Value>
        </Row>
        <Row label={t('settings.platform')}>
          <Value>
            {appInfo ? `${appInfo.platform} · ${appInfo.arch}` : '—'}
          </Value>
        </Row>
      </Group>

      <Group title={t('settings.aboutWorkspace')}>
        <Row label={t('settings.workxHome')} description={serverInfo?.workxHome}>
          {serverInfo ? (
            <button
              type="button"
              onClick={() => void window.workx.openPath(serverInfo.workxHome)}
              className="h-8 rounded-full border border-line px-3 text-[13px] text-fg-secondary hover:bg-hover"
            >
              {t('settings.openFolder')}
            </button>
          ) : null}
        </Row>
        <Row label={t('settings.workingDirectory')} description={cwd}>
          {cwd ? (
            <button
              type="button"
              onClick={() => void window.workx.openPath(cwd)}
              className="h-8 rounded-full border border-line px-3 text-[13px] text-fg-secondary hover:bg-hover"
            >
              {t('settings.openFolder')}
            </button>
          ) : null}
        </Row>
      </Group>

      <Group title={t('settings.aboutRuntime')}>
        <Row label="Electron">
          <Value>{appInfo?.electron ?? '—'}</Value>
        </Row>
        <Row label="Chromium">
          <Value>{appInfo?.chrome ?? '—'}</Value>
        </Row>
        <Row label="Node.js">
          <Value>{appInfo?.node ?? '—'}</Value>
        </Row>
      </Group>
    </SectionShell>
  );
}

function Value({ children }: { children: ReactNode }) {
  return <span className="max-w-[22rem] truncate text-[13px] text-fg-secondary">{children}</span>;
}
