import type { ThreadItem } from '@protocol/v2/ThreadItem';
import type { FileUpdateChange } from '@protocol/v2/FileUpdateChange';
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
  changes?: FileUpdateChange[];
}

export type TranscriptEntry =
  | { kind: 'user'; id: string; text: string; images: string[]; goal?: boolean }
  | {
      kind: 'assistant';
      id: string;
      turnId: string;
      text: string;
      activities: Activity[];
      durationMs: number | null;
      startedAtMs: number | null;
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

export function imagesFromUserInput(content: UserInput[]): string[] {
  return content.flatMap((part) => {
    if (part.type === 'localImage') {
      return [part.path];
    }
    if (part.type === 'image') {
      return [part.url];
    }
    return [];
  });
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
        changes: item.changes,
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
    case 'reasoning':
      return {
        id: item.id,
        icon: 'reasoning',
        label: item.summary[0] ?? t('activity.thinking'),
        active: false,
      };
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

export function buildTranscript(
  turns: TurnView[],
  t: Translate,
  goalTurnIds: ReadonlySet<string> = new Set(),
): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];

  for (const turn of turns) {
    const activities: Activity[] = [];
    const turnEntries: Extract<TranscriptEntry, { kind: 'assistant' }>[] = [];
    let goalMarked = false;

    for (const item of turn.items) {
      if (item.type === 'userMessage') {
        const isGoal: boolean = goalTurnIds.has(turn.id) && !goalMarked;
        goalMarked = goalMarked || isGoal;
        entries.push({
          kind: 'user',
          id: item.id,
          text: textFromUserInput(item.content),
          images: imagesFromUserInput(item.content),
          goal: isGoal,
        });
        continue;
      }
      if (item.type === 'agentMessage') {
        const assistantEntry = {
          kind: 'assistant',
          id: item.id,
          turnId: turn.id,
          text: item.text,
          activities: [...activities],
          durationMs: null,
          startedAtMs: turn.startedAtMs,
          status: turn.status,
          active: false,
        } satisfies Extract<TranscriptEntry, { kind: 'assistant' }>;
        entries.push(assistantEntry);
        turnEntries.push(assistantEntry);
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

    if (turnEntries.length === 0) {
      const summaryEntry = {
        kind: 'assistant',
        id: `${turn.id}-summary`,
        turnId: turn.id,
        text: '',
        activities: [],
        durationMs: null,
        startedAtMs: turn.startedAtMs,
        status: turn.status,
        active: false,
      } satisfies Extract<TranscriptEntry, { kind: 'assistant' }>;
      entries.push(summaryEntry);
      turnEntries.push(summaryEntry);
    }

    const lastEntry = turnEntries[turnEntries.length - 1];
    lastEntry.activities = [...lastEntry.activities, ...activities];

    // Only the newest message of a turn can still be working. Earlier messages of the same turn
    // already finished, and labelling them as in progress makes running and finished turns
    // indistinguishable. Every message reports the turn duration once the turn completes.
    const turnInProgress = turn.status === 'inProgress' || turn.status === null;
    for (const entry of turnEntries) {
      entry.status = turn.status;
      entry.durationMs = turn.durationMs;
      entry.active = turnInProgress && entry === lastEntry;
    }
  }

  return entries;
}
