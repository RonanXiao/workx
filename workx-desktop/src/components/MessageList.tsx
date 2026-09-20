import {
  Check,
  ChevronDown,
  Clock,
  Copy,
  FileDiff,
  GitBranch,
  Globe,
  Image as ImageIcon,
  ListChecks,
  ScrollText,
  Sparkles,
  SquareTerminal,
  Target,
  TriangleAlert,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useState, type ComponentType, type ReactNode, type SVGProps } from 'react';

import type { ApprovalRequest, ReadOnlySession } from '../app/useWorkx';
import type { FileUpdateChange } from '@protocol/v2/FileUpdateChange';
import type { Activity, ActivityIcon, TranscriptEntry } from '../app/transcript';
import { cn } from '../lib/cn';
import { useI18n, type MessageKey } from '../lib/i18n';
import { FileChangeCard } from './FileChangeCard';
import { ImageLightbox } from './ImageLightbox';
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

const imageSourceCache = new Map<string, Promise<string | null>>();

function loadImageSource(target: string): Promise<string | null> {
  if (/^(https?:|data:)/.test(target)) {
    return Promise.resolve(target);
  }
  const cached = imageSourceCache.get(target);
  if (cached) {
    return cached;
  }
  const pending = window.workx.readImage(target).catch(() => null);
  imageSourceCache.set(target, pending);
  return pending;
}

function UserImage({ source }: { source: string }) {
  const { t } = useI18n();
  const [resolved, setResolved] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    let active = true;
    void loadImageSource(source).then((value) => {
      if (active) {
        setResolved(value);
      }
    });
    return () => {
      active = false;
    };
  }, [source]);

  if (!resolved) {
    return null;
  }
  return (
    <>
      <button
        type="button"
        aria-label={t('message.viewImage')}
        title={t('message.viewImage')}
        onClick={() => setPreview(true)}
        className="overflow-hidden rounded-xl border border-line hover:border-line-strong"
      >
        <img src={resolved} alt="" className="max-h-64 max-w-full object-contain" />
      </button>
      {preview ? <ImageLightbox source={resolved} onClose={() => setPreview(false)} /> : null}
    </>
  );
}

interface MessageListProps {
  entries: TranscriptEntry[];
  running: boolean;
  error: string | null;
  warnings: string[];
  approvals: ApprovalRequest[];
  cwd: string;
  /// 只读会话；非 null 时禁止发送，并展示 `reason` 对应的恢复指引。
  readOnly: ReadOnlySession | null;
  onResolveApproval: (id: string | number, decision: 'accept' | 'decline') => void;
  onDismissError: () => void;
  onRetryWriter: () => void;
  onBranch: (turnId: string) => void;
  onUndoFileChange: (change: FileUpdateChange) => Promise<void> | void;
  onReviewFileChange: (change: FileUpdateChange) => void;
}

export function MessageList({
  entries,
  running,
  error,
  warnings,
  approvals,
  cwd,
  readOnly,
  onResolveApproval,
  onDismissError,
  onRetryWriter,
  onBranch,
  onUndoFileChange,
  onReviewFileChange,
}: MessageListProps) {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex w-full max-w-[42rem] flex-col gap-7 px-6 pb-10 pt-2">
      {readOnly ? <ReadOnlyNotice readOnly={readOnly} onRetry={onRetryWriter} /> : null}

      {entries.length === 0 ? <EmptyState cwd={cwd} /> : null}

      {entries.map((entry) =>
        entry.kind === 'user' ? (
          <div key={entry.id} className="flex justify-end">
            <div className="flex min-w-0 max-w-[85%] flex-col items-end gap-2">
              {entry.images.length > 0 ? (
                <div className="flex flex-wrap justify-end gap-2">
                  {entry.images.map((source) => (
                    <UserImage key={source} source={source} />
                  ))}
                </div>
              ) : null}
              {entry.text ? (
                <div className="min-w-0 max-w-full whitespace-pre-wrap rounded-2xl bg-bubble px-4 py-2.5 text-[16px] leading-[1.5] [overflow-wrap:anywhere]">
                  {entry.text}
                </div>
              ) : null}
              {entry.goal ? (
                <div className="flex items-center gap-1.5 text-[12px] text-fg-tertiary">
                  <Target className="size-3.5" strokeWidth={1.75} />
                  {t('goal.sentAsGoal')}
                </div>
              ) : null}
              {entry.queued ? (
                <div className="flex items-center gap-1.5 text-[12px] text-fg-tertiary">
                  <Clock className="size-3.5" strokeWidth={1.75} />
                  {t('message.queued')}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <AssistantTurn
            key={entry.id}
            entry={entry}
            cwd={cwd}
            onBranch={onBranch}
            onUndoFileChange={onUndoFileChange}
            onReviewFileChange={onReviewFileChange}
          />
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

/// 只读会话提示。按原因区分：另一处占用会话，或记录的 provider 已删除。
function ReadOnlyNotice({ readOnly, onRetry }: { readOnly: ReadOnlySession; onRetry: () => void }) {
  const { t } = useI18n();
  const missingProvider = readOnly.reason === 'missingProvider';
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium">
          {missingProvider
            ? t('message.providerRemoved', { provider: readOnly.provider ?? '' })
            : t('message.openElsewhere')}
        </p>
        <p className="mt-0.5 text-[13px] text-fg-secondary">
          {missingProvider ? t('message.pickProvider') : t('message.closeThere')}
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-[13px] hover:bg-hover"
      >
        {missingProvider ? t('message.continueHere') : t('common.retry')}
      </button>
    </div>
  );
}

function AssistantTurn({
  entry,
  cwd,
  onBranch,
  onUndoFileChange,
  onReviewFileChange,
}: {
  entry: Extract<TranscriptEntry, { kind: 'assistant' }>;
  cwd: string;
  onBranch: (turnId: string) => void;
  onUndoFileChange: (change: FileUpdateChange) => Promise<void> | void;
  onReviewFileChange: (change: FileUpdateChange) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const elapsedMs = useElapsedMs(entry.active, entry.startedAtMs);
  const workingLabel =
    elapsedMs !== null && elapsedMs >= 1000
      ? t('message.workingFor', { duration: formatDuration(elapsedMs) })
      : t('message.working');
  const fileActivities = entry.activities.filter(
    (activity) => activity.changes && activity.changes.length > 0,
  );
  const otherActivities = entry.activities.filter(
    (activity) => !activity.changes || activity.changes.length === 0,
  );
  const hasActivities = otherActivities.length > 0;
  const runningActivity =
    otherActivities.findLast((activity) => activity.active) ??
    otherActivities[otherActivities.length - 1];

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
              ? workingLabel
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
          <p className="text-[14px] text-fg-secondary">{summarize(otherActivities, t)}</p>
          <div className="mt-1.5 flex flex-col gap-px">
            {otherActivities.map((activity) => (
              <ActivityRow
                key={activity.id}
                activity={activity}
                cwd={cwd}
                onUndoFileChange={onUndoFileChange}
                onReviewFileChange={onReviewFileChange}
              />
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

      {entry.active && !open && runningActivity ? (
        <div className="mt-3">
          <ActivityRow
            activity={runningActivity}
            cwd={cwd}
            onUndoFileChange={onUndoFileChange}
            onReviewFileChange={onReviewFileChange}
          />
        </div>
      ) : null}

      {fileActivities.length > 0 ? (
        <div className="mt-2">
          {fileActivities.map((activity) => (
            <ActivityRow
              key={activity.id}
              activity={activity}
              cwd={cwd}
              onUndoFileChange={onUndoFileChange}
              onReviewFileChange={onReviewFileChange}
            />
          ))}
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

function ActivityRow({
  activity,
  cwd,
  onUndoFileChange,
  onReviewFileChange,
}: {
  activity: Activity;
  cwd: string;
  onUndoFileChange: (change: FileUpdateChange) => Promise<void> | void;
  onReviewFileChange: (change: FileUpdateChange) => void;
}) {
  const Icon = ACTIVITY_ICONS[activity.icon];
  if (activity.changes && activity.changes.length > 0) {
    return (
      <div>
        {activity.changes.map((change) => (
          <FileChangeCard
            key={`${activity.id}-${change.path}`}
            change={change}
            cwd={cwd}
            onUndo={onUndoFileChange}
            onReview={onReviewFileChange}
          />
        ))}
      </div>
    );
  }
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
      <span className="min-w-0 break-words font-mono text-[13px]">{activity.label}</span>
      {activity.status ? (
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

/** Ticks once a second while a turn runs so its header shows elapsed time instead of a static
 * "Working…", which reads the same whether or not the turn already finished. */
function useElapsedMs(active: boolean, startedAtMs: number | null): number | null {
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  useEffect(() => {
    if (!active || startedAtMs === null) {
      setElapsedMs(null);
      return;
    }
    const update = () => setElapsedMs(Date.now() - startedAtMs);
    update();
    const handle = window.setInterval(update, 1000);
    return () => window.clearInterval(handle);
  }, [active, startedAtMs]);

  return elapsedMs;
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
