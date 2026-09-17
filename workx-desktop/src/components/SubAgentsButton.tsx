import { Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Thread } from '@protocol/v2/Thread';

import { cn } from '../lib/cn';
import { useI18n, type MessageKey } from '../lib/i18n';
import { formatDuration } from './MessageList';

/// 子代理在面板中的展示状态，由线程运行时状态映射得到。
type SubAgentState = 'running' | 'waiting' | 'completed' | 'failed';

interface SubAgentRow {
  id: string;
  name: string;
  role: string | null;
  /// 「在做什么」摘要，取自子代理线程的首条消息；无内容时为 null。
  summary: string | null;
  state: SubAgentState;
  /// 有子代理仍在运行时为 true，决定排序分组和角标计数。
  active: boolean;
  startedAtMs: number;
  updatedAtMs: number;
}

const STATE_DOT: Record<SubAgentState, string> = {
  running: 'bg-emerald-500',
  waiting: 'bg-amber-500',
  completed: 'bg-fg-tertiary/40',
  failed: 'bg-danger',
};

const STATE_LABEL_KEY: Record<SubAgentState, MessageKey> = {
  running: 'subagents.running',
  waiting: 'subagents.waiting',
  completed: 'subagents.completed',
  failed: 'subagents.failed',
};

function subAgentState(thread: Thread): SubAgentState {
  switch (thread.status.type) {
    case 'systemError':
      return 'failed';
    case 'active':
      return thread.status.activeFlags.length > 0 ? 'waiting' : 'running';
    case 'idle':
    case 'notLoaded':
      return 'completed';
  }
}

function subAgentRow(thread: Thread): SubAgentRow {
  const state = subAgentState(thread);
  // 子代理线程的首条消息就是派发时的任务描述，作为「在做什么」的摘要。
  const summary = thread.preview.replace(/\s+/g, ' ').trim();
  return {
    id: thread.id,
    name: thread.agentNickname || thread.name || summary || thread.id.slice(0, 8),
    role: thread.agentRole,
    summary: summary || null,
    state,
    active: state === 'running' || state === 'waiting',
    startedAtMs: thread.createdAt * 1000,
    updatedAtMs: thread.updatedAt * 1000,
  };
}

/// 运行中的子代理排在最前，同组按最近活动时间倒序。
function compareRows(left: SubAgentRow, right: SubAgentRow): number {
  if (left.active !== right.active) {
    return left.active ? -1 : 1;
  }
  return right.updatedAtMs - left.updatedAtMs;
}

interface SubAgentsButtonProps {
  subAgents: Thread[];
  onSelect: (threadId: string) => void;
  /// 回到会话树根线程。
  onOpenAll: () => void;
  onRefresh: () => void;
}

export function SubAgentsButton({
  subAgents,
  onSelect,
  onOpenAll,
  onRefresh,
}: SubAgentsButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rows = useMemo(() => subAgents.map(subAgentRow).sort(compareRows), [subAgents]);
  const runningCount = rows.filter((row) => row.state === 'running').length;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // 运行时长按秒走动；面板收起时不需要计时。
  useEffect(() => {
    if (!open) {
      return;
    }
    setNow(Date.now());
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t('subagents.title')}
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            onRefresh();
          }
          setOpen((value) => !value);
        }}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-elevated pr-1.5 pl-2',
          'text-[12.5px] font-medium text-fg-secondary shadow-xs transition-colors hover:bg-hover',
          open && 'bg-active text-fg',
        )}
      >
        <Users className="size-3.5" strokeWidth={1.75} />
        {t('subagents.title')}
        <span
          className={cn(
            'inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1.5',
            'text-[10.5px] font-semibold tabular-nums',
            runningCount > 0 ? 'bg-emerald-500 text-white' : 'bg-hover text-fg-tertiary',
          )}
        >
          {runningCount}
        </span>
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)} />
          <div className="absolute top-full right-0 z-50 mt-2 w-[404px] max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-line bg-elevated shadow-xl">
            <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
              <span className="text-[12.5px] font-semibold">{t('subagents.title')}</span>
              <span className="ml-auto text-[11px] tabular-nums text-fg-tertiary">
                {t('subagents.summary', { running: runningCount, total: rows.length })}
              </span>
            </div>
            <div className="max-h-[320px] overflow-y-auto px-1 pb-1">
              {rows.length === 0 ? (
                <div className="px-2 py-3 text-[11.5px] text-fg-tertiary">
                  {t('subagents.empty')}
                </div>
              ) : null}
              {rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onSelect(row.id);
                  }}
                  className="flex w-full gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover"
                >
                  <span
                    className={cn(
                      'mt-[5px] size-[7px] shrink-0 rounded-full',
                      STATE_DOT[row.state],
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          'truncate font-mono text-[12.5px] font-medium',
                          !row.active && 'text-fg-secondary',
                        )}
                      >
                        {row.name}
                      </span>
                      {row.role ? (
                        <span className="shrink-0 rounded border border-line px-1 text-[10px] leading-[14px] text-fg-tertiary">
                          {row.role}
                        </span>
                      ) : null}
                      <span className="ml-auto shrink-0 text-[11px] tabular-nums text-fg-tertiary">
                        {row.state === 'running'
                          ? formatDuration(Math.max(0, now - row.startedAtMs))
                          : t(STATE_LABEL_KEY[row.state])}
                      </span>
                    </span>
                    {row.summary ? (
                      <span
                        className={cn(
                          'mt-0.5 block truncate text-[11.5px]',
                          row.active ? 'text-fg-secondary' : 'text-fg-tertiary',
                        )}
                      >
                        {row.summary}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 border-t border-line-subtle px-3 py-2 text-[10.5px] text-fg-tertiary">
              {t('subagents.hint')}
              <span className="rounded border border-line px-1 text-[10px] leading-[14px]">Esc</span>
              {t('subagents.closeHint')}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenAll();
                }}
                className="ml-auto text-info hover:underline"
              >
                {t('subagents.openAll')}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
