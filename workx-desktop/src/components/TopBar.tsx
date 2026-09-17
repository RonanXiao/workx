import {
  ChevronDown,
  Columns2,
  FileDiff,
  FileText,
  MoreHorizontal,
  PanelRight,
  Share2,
} from 'lucide-react';
import { useState } from 'react';

import type { Thread } from '@protocol/v2/Thread';

import { cn } from '../lib/cn';
import { useI18n, type MessageKey } from '../lib/i18n';
import { IconButton } from './IconButton';
import { Menu, MenuItem } from './Menu';
import { SubAgentsButton } from './SubAgentsButton';

export type ConnectionStatus = 'connecting' | 'ready' | 'error' | 'stopped';

interface TopBarProps {
  title: string;
  subtitle?: string | null;
  status: ConnectionStatus;
  exportDisabled?: boolean;
  subAgents: Thread[];
  onSelectSubAgent: (threadId: string) => void;
  onOpenAllSubAgents: () => void;
  onRefreshSubAgents: () => void;
  explorerOpen: boolean;
  onToggleExplorer: () => void;
  reviewOpen: boolean;
  onToggleReview: () => void;
  onExportPdf: () => void;
  onExportMarkdown: () => void;
}

const STATUS_STYLE: Record<ConnectionStatus, { dot: string; labelKey: MessageKey }> = {
  connecting: { dot: 'bg-amber-500', labelKey: 'topbar.connecting' },
  ready: { dot: 'bg-emerald-500', labelKey: 'topbar.connected' },
  error: { dot: 'bg-danger', labelKey: 'topbar.disconnected' },
  stopped: { dot: 'bg-fg-tertiary', labelKey: 'topbar.stopped' },
};

export function TopBar({
  title,
  subtitle,
  status,
  exportDisabled = false,
  subAgents,
  onSelectSubAgent,
  onOpenAllSubAgents,
  onRefreshSubAgents,
  explorerOpen,
  onToggleExplorer,
  reviewOpen,
  onToggleReview,
  onExportPdf,
  onExportMarkdown,
}: TopBarProps) {
  const { t } = useI18n();
  const [shareOpen, setShareOpen] = useState(false);
  const statusStyle = STATUS_STYLE[status];
  return (
    <header className="drag flex h-[52px] shrink-0 items-center gap-2 px-3">
      <div className="no-drag flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-fg-secondary">
        <FileText className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="max-w-[420px] truncate">{title}</span>
        {subtitle ? (
          <span className="max-w-[220px] truncate text-fg-tertiary">{subtitle}</span>
        ) : null}
        <MoreHorizontal className="size-3.5 shrink-0" strokeWidth={1.75} />
      </div>

      <div className="no-drag ml-auto flex items-center gap-0.5">
        <div className="mr-1 flex items-center gap-1.5 rounded-md px-2 text-[12px] text-fg-tertiary">
          <span className={cn('size-1.5 rounded-full', statusStyle.dot)} />
          {t(statusStyle.labelKey)}
        </div>
        <div className="mr-1.5">
          <SubAgentsButton
            subAgents={subAgents}
            onSelect={onSelectSubAgent}
            onOpenAll={onOpenAllSubAgents}
            onRefresh={onRefreshSubAgents}
          />
        </div>
        <div className="relative">
          <button
            type="button"
            disabled={exportDisabled}
            onClick={() => setShareOpen((value) => !value)}
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-secondary hover:bg-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Share2 className="size-3.5" strokeWidth={1.75} />
            {t('topbar.share')}
            <ChevronDown
              className={cn('size-3 transition-transform', shareOpen && 'rotate-180')}
              strokeWidth={1.75}
            />
          </button>
          <Menu
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            align="right"
            placement="bottom"
          >
            <MenuItem
              title={t('topbar.exportPdf')}
              description={t('topbar.exportPdfDescription')}
              onClick={() => {
                setShareOpen(false);
                onExportPdf();
              }}
            />
            <MenuItem
              title={t('topbar.exportMarkdown')}
              description={t('topbar.exportMarkdownDescription')}
              onClick={() => {
                setShareOpen(false);
                onExportMarkdown();
              }}
            />
          </Menu>
        </div>
        <IconButton size="sm" aria-label={t('topbar.toggleSplit')}>
          <Columns2 className="size-4" strokeWidth={1.75} />
        </IconButton>
        <IconButton
          size="sm"
          aria-label={t('review.toggle')}
          active={reviewOpen}
          onClick={onToggleReview}
        >
          <FileDiff className="size-4" strokeWidth={1.75} />
        </IconButton>
        <IconButton
          size="sm"
          aria-label={t('topbar.toggleSidePanel')}
          active={explorerOpen}
          onClick={onToggleExplorer}
        >
          <PanelRight className="size-4" strokeWidth={1.75} />
        </IconButton>
      </div>
    </header>
  );
}
