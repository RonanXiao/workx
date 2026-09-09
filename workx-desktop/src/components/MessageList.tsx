import {
  Check,
  ChevronDown,
  Copy,
  FileDiff,
  GitBranch,
  Globe,
  Image as ImageIcon,
  ListChecks,
  ScrollText,
  Sparkles,
  SquareTerminal,
  TriangleAlert,
  Wrench,
  X,
} from 'lucide-react';
import { useState, type ComponentType, type ReactNode, type SVGProps } from 'react';

import type { ApprovalRequest } from '../app/useWorkx';
import type { Activity, ActivityIcon, TranscriptEntry } from '../app/transcript';
import { cn } from '../lib/cn';
import { useI18n, type MessageKey } from '../lib/i18n';
import { Markdown } from './Markdown';

const ACTIVITY_ICONS: Record<ActivityIcon, ComponentType<SVGProps<SVGSVGElement>>> = {
  terminal: SquareTerminal,
  file: FileDiff,
  tool: Wrench,
  search: Globe,
  reasoning: Sparkles,
  plan: ListChecks,
  image: ImageIcon,
  output: ScrollText,
};

const ACTIVITY_VERB_KEYS: Record<ActivityIcon, MessageKey> = {
  terminal: 'activity.terminal',
  file: 'activity.file',
  tool: 'activity.tool',
  search: 'activity.search',
  reasoning: 'activity.reasoning',
  plan: 'activity.plan',
  image: 'activity.image',
  output: 'activity.output',
};

interface MessageListProps {
  entries: TranscriptEntry[];
  running: boolean;
  error: string | null;
  warnings: string[];
  approvals: ApprovalRequest[];
  cwd: string;
  writerConflict: boolean;
  onResolveApproval: (id: string | number, decision: 'accept' | 'decline') => void;
  onDismissError: () => void;
  onRetryWriter: () => void;
  onBranch: (turnId: string) => void;
}

export function MessageList({
  entries,
  running,
  error,
  warnings,
  approvals,
  cwd,
  writerConflict,
  onResolveApproval,
  onDismissError,
  onRetryWriter,
  onBranch,
}: MessageListProps) {
  return (
    <div className="mx-auto flex w-full max-w-[42rem] flex-col gap-7 px-6 pb-10 pt-2">
      {writerConflict ? <WriterConflict onRetry={onRetryWriter} /> : null}

      {entries.length === 0 ? <EmptyState cwd={cwd} /> : null}

      {entries.map((entry) =>
        entry.kind === 'user' ? (
          <div key={entry.id} className="flex justify-end">
            <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-bubble px-4 py-2.5 text-[16px] leading-[1.5]">
              {entry.text}
            </div>
          </div>
        ) : (
          <AssistantTurn key={entry.id} entry={entry} onBranch={onBranch} />
        ),
      )}

      {approvals.map((approval) => (
        <ApprovalCard key={approval.id} approval={approval} onResolve={onResolveApproval} />
      ))}

      {warnings.map((warning, index) => (
        <Banner key={`${warning}-${index}`} tone="warning">
          {warning}
        </Banner>
      ))}

      {error ? (
        <Banner tone="error" onDismiss={onDismissError}>
          {error}
        </Banner>
      ) : null}

      {running && entries.length === 0 ? <Thinking /> : null}
    </div>
  );
}

function WriterConflict({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium">{t('message.openElsewhere')}</p>
        <p className="mt-0.5 text-[13px] text-fg-secondary">{t('message.closeThere')}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-[13px] hover:bg-hover"
      >
        {t('common.retry')}
      </button>
    </div>
  );
}

function AssistantTurn({
  entry,
  onBranch,
}: {
  entry: Extract<TranscriptEntry, { kind: 'assistant' }>;
  onBranch: (turnId: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasActivities = entry.activities.length > 0;

  const copy = () => {
    void navigator.clipboard.writeText(entry.text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="group/turn">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          disabled={!hasActivities}
          onClick={() => setOpen((value) => !value)}
          className="flex shrink-0 items-center gap-1 text-[13px] text-fg-tertiary enabled:hover:text-fg-secondary"
        >
          <span>
            {entry.active
              ? t('message.working')
              : entry.durationMs !== null
                ? t('message.workedFor', { duration: formatDuration(entry.durationMs) })
                : t('message.worked')}
          </span>
          {hasActivities ? (
            <ChevronDown
              className={cn('size-3.5 transition-transform', open && 'rotate-180')}
              strokeWidth={1.75}
            />
          ) : null}
        </button>
        <div className="h-px flex-1 bg-line-subtle" />
      </div>

      {open && hasActivities ? (
        <div className="mt-2.5">
          <p className="text-[14px] text-fg-secondary">{summarize(entry.activities, t)}</p>
          <div className="mt-1.5 flex flex-col gap-px">
            {entry.activities.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} />
            ))}
          </div>
        </div>
      ) : null}

      {entry.text ? (
        <div className="mt-3">
          <Markdown>{entry.text}</Markdown>
        </div>
      ) : entry.active ? (
        <div className="mt-3">
          <Thinking />
        </div>
      ) : null}

      {entry.text ? (
        <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/turn:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? t('message.copied') : t('message.copy')}
            title={copied ? t('message.copied') : t('message.copy')}
            className="flex size-7 items-center justify-center rounded-md text-fg-tertiary hover:bg-hover hover:text-fg"
          >
            {copied ? (
              <Check className="size-4" strokeWidth={1.75} />
            ) : (
              <Copy className="size-4" strokeWidth={1.75} />
            )}
          </button>
          {!entry.active ? (
            <button
              type="button"
              onClick={() => onBranch(entry.turnId)}
              aria-label={t('message.branch')}
              title={t('message.branch')}
              className="flex size-7 items-center justify-center rounded-md text-fg-tertiary hover:bg-hover hover:text-fg"
            >
              <GitBranch className="size-4" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      ) : null}

      {entry.status === 'failed' ? (
        <div className="mt-3">
          <Banner tone="error">{t('message.turnFailed')}</Banner>
        </div>
      ) : null}
    </div>
  );
}

function ActivityRow({ activity }: { activity: Activity }) {
  const Icon = ACTIVITY_ICONS[activity.icon];
  const hasBody = Boolean(
    (activity.output && activity.output.trim()) ||
      (activity.reasoning && activity.reasoning.trim()),
  );
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 py-[3px] text-[14px] text-fg-secondary',
        activity.active && 'text-fg',
      )}
    >
      <Icon
        className={cn(
          'mt-[3px] size-4 shrink-0 text-fg-tertiary',
          activity.active && 'animate-pulse text-fg',
        )}
        strokeWidth={1.75}
      />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={hasBody ? () => setOpen((value) => !value) : undefined}
          className={cn(
            'block min-w-0 break-words text-left font-mono text-[13px]',
            hasBody && 'cursor-pointer hover:text-fg',
          )}
        >
          {activity.label}
        </button>
        {open && activity.reasoning ? (
          <pre className="mt-1 whitespace-pre-wrap break-words rounded-md bg-hover px-2.5 py-2 text-[12px] text-fg-secondary">
            {activity.reasoning}
          </pre>
        ) : null}
        {open && activity.output && activity.output.trim() ? (
          <pre className="mt-1 whitespace-pre-wrap break-words rounded-md bg-hover px-2.5 py-2 text-[12px] text-fg-secondary">
            {activity.output}
          </pre>
        ) : null}
      </div>
      {activity.exitCode != null ? (
        <span
          className={cn(
            'ml-auto shrink-0 text-[12px]',
            activity.exitCode === 0 ? 'text-fg-tertiary' : 'text-danger',
          )}
        >
          exit {activity.exitCode}
        </span>
      ) : activity.status ? (
        <span
          className={cn(
            'ml-auto shrink-0 text-[12px]',
            activity.status === 'failed' ? 'text-danger' : 'text-fg-tertiary',
          )}
        >
          {activity.status}
        </span>
      ) : null}
    </div>
  );
}

function ApprovalCard({
  approval,
  onResolve,
}: {
  approval: ApprovalRequest;
  onResolve: (id: string | number, decision: 'accept' | 'decline') => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-line bg-elevated p-3.5">
      <div className="flex items-start gap-2.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium">
            {approval.kind === 'command'
              ? t('message.approveCommand')
              : t('message.approveFileChanges')}
          </p>
          <p className="mt-1 break-words font-mono text-[13px] text-fg-secondary">
            {approval.title}
          </p>
          {approval.detail ? (
            <p className="mt-1 break-words text-[12px] text-fg-tertiary">{approval.detail}</p>
          ) : null}
          {approval.reason ? (
            <p className="mt-1 text-[12px] text-fg-tertiary">{approval.reason}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => onResolve(approval.id, 'decline')}
          className="h-7 rounded-full border border-line px-3 text-[13px] hover:bg-hover"
        >
          {t('message.decline')}
        </button>
        <button
          type="button"
          onClick={() => onResolve(approval.id, 'accept')}
          className="h-7 rounded-full bg-send px-3 text-[13px] text-send-fg"
        >
          {t('message.approve')}
        </button>
      </div>
    </div>
  );
}

function Banner({
  tone,
  children,
  onDismiss,
}: {
  tone: 'warning' | 'error';
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[13px]',
        tone === 'error'
          ? 'border-danger/30 bg-danger/10 text-danger'
          : 'border-warning/30 bg-warning/10 text-warning',
      )}
    >
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 break-words">{children}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('common.dismiss')}
          className="shrink-0"
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}

function Thinking() {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 text-[14px] text-fg-tertiary">
      <span className="size-1.5 animate-pulse rounded-full bg-fg-tertiary" />
      {t('message.thinking')}
    </div>
  );
}

function EmptyState({ cwd }: { cwd: string }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-2 py-20 text-center">
      <p className="text-[17px] font-medium">{t('message.emptyTitle')}</p>
      <p className="max-w-[360px] text-[13px] text-fg-tertiary">
        {t('message.emptyPrefix')}
        <span className="break-all font-mono">{cwd || t('message.currentDirectory')}</span>
        {t('message.emptySuffix')}
      </p>
    </div>
  );
}

function summarize(
  activities: Activity[],
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  const verbs: string[] = [];
  for (const activity of activities) {
    const verb = t(ACTIVITY_VERB_KEYS[activity.icon]);
    if (!verbs.includes(verb)) {
      verbs.push(verb);
    }
  }
  if (verbs.length === 0) {
    return t('activity.worked');
  }
  return verbs.join(', ');
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
