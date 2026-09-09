import type { ThreadItem } from '@protocol/v2/ThreadItem';
import type { TurnStatus } from '@protocol/v2/TurnStatus';
import type { UserInput } from '@protocol/v2/UserInput';
import type { MessageKey } from '../lib/i18n';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export type ActivityIcon =
  | 'terminal'
  | 'file'
  | 'tool'
  | 'search'
  | 'reasoning'
  | 'plan'
  | 'image'
  | 'output';

export interface Activity {
  id: string;
  icon: ActivityIcon;
  label: string;
  detail?: string;
  status?: string;
  active: boolean;
  /** Exit code of a finished command execution, when the backend reports one. */
  exitCode?: number | null;
  /** Aggregated stdout/stderr of a finished command execution, when available. */
  output?: string | null;
  /** Full reasoning text shown instead of a bare "thinking" label. */
  reasoning?: string | null;
}

export type TranscriptEntry =
  | { kind: 'user'; id: string; text: string }
  | {
      kind: 'assistant';
      id: string;
      turnId: string;
      text: string;
      activities: Activity[];
      durationMs: number | null;
      status: TurnStatus | null;
      active: boolean;
    };

export interface TurnView {
  id: string;
  items: ThreadItem[];
  status: TurnStatus | null;
  durationMs: number | null;
  startedAtMs: number | null;
}

export function textFromUserInput(content: UserInput[]): string {
  return content
    .filter((part): part is Extract<UserInput, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

export function activityFromItem(item: ThreadItem, t: Translate): Activity | null {
  switch (item.type) {
    case 'commandExecution':
      return {
        id: item.id,
        icon: 'terminal',
        label: item.command,
        detail: item.cwd,
        status: item.status,
        active: item.status === 'inProgress',
        exitCode: item.exitCode,
        output: item.aggregatedOutput,
      };
    case 'fileChange':
      return {
        id: item.id,
        icon: 'file',
        label: t(
          item.changes.length === 1 ? 'activity.filesChangedOne' : 'activity.filesChanged',
          { count: item.changes.length },
        ),
        detail: item.changes.map((change) => change.path).join(', '),
        status: item.status,
        active: item.status === 'inProgress',
      };
    case 'mcpToolCall':
      return {
        id: item.id,
        icon: 'tool',
        label: `${item.server} / ${item.tool}`,
        status: item.status,
        active: item.status === 'inProgress',
      };
    case 'dynamicToolCall':
      return {
        id: item.id,
        icon: 'tool',
        label: item.namespace ? `${item.namespace} / ${item.tool}` : item.tool,
        status: item.status,
        active: item.status === 'inProgress',
      };
    case 'webSearch':
      return {
        id: item.id,
        icon: 'search',
        label: item.query
          ? t('activity.searchedFor', { query: item.query })
          : t('activity.searched'),
        active: false,
      };
    case 'reasoning': {
      const summaryText = item.summary.join('\n\n');
      const contentText = item.content.join('\n\n');
      const reasoningText = summaryText || contentText;
      return {
        id: item.id,
        icon: 'reasoning',
        label: item.summary[0] ?? t('activity.thinking'),
        reasoning: reasoningText || null,
        active: false,
      };
    }
    case 'plan':
      return { id: item.id, icon: 'plan', label: t('activity.updatedPlan'), active: false };
    case 'functionCallOutput':
      return { id: item.id, icon: 'output', label: item.name, active: false };
    case 'imageView':
      return { id: item.id, icon: 'image', label: t('activity.viewedImage'), active: false };
    case 'imageGeneration':
      return { id: item.id, icon: 'image', label: t('activity.generatedImage'), active: false };
    case 'contextCompaction':
      return { id: item.id, icon: 'plan', label: t('activity.compacted'), active: false };
    case 'subAgentActivity':
      return { id: item.id, icon: 'tool', label: t('activity.subAgent'), active: false };
    case 'sleep':
      return { id: item.id, icon: 'plan', label: t('activity.waiting'), active: true };
    default:
      return null;
  }
}

export function buildTranscript(turns: TurnView[], t: Translate): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];

  for (const turn of turns) {
    const activities: Activity[] = [];
    let assistantEntry: Extract<TranscriptEntry, { kind: 'assistant' }> | null = null;

    for (const item of turn.items) {
      if (item.type === 'userMessage') {
        entries.push({ kind: 'user', id: item.id, text: textFromUserInput(item.content) });
        continue;
      }
      if (item.type === 'agentMessage') {
        assistantEntry = {
          kind: 'assistant',
          id: item.id,
          turnId: turn.id,
          text: item.text,
          activities: [...activities],
          durationMs: null,
          status: turn.status,
          active: turn.status === 'inProgress',
        };
        entries.push(assistantEntry);
        activities.length = 0;
        continue;
      }
      const activity = activityFromItem(item, t);
      if (activity) {
        const index = activities.findIndex((existing) => existing.id === activity.id);
        if (index >= 0) {
          activities[index] = activity;
        } else {
          activities.push(activity);
        }
      }
    }

    const target =
      assistantEntry ??
      ({
        kind: 'assistant',
        id: `${turn.id}-summary`,
        turnId: turn.id,
        text: '',
        activities: [],
        durationMs: null,
        status: turn.status,
        active: turn.status === 'inProgress',
      } satisfies Extract<TranscriptEntry, { kind: 'assistant' }>);

    if (!assistantEntry) {
      entries.push(target);
    }
    target.activities = [...target.activities, ...activities];
    target.durationMs = turn.durationMs;
    target.status = turn.status;
    target.active = turn.status === 'inProgress' || turn.status === null;
  }

  return entries;
}
