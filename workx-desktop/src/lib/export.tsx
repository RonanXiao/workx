import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { TranscriptEntry } from '../app/transcript';
import { formatDuration } from '../components/MessageList';
import { translate, type Language } from './i18n';

const FILE_NAME_MAX_LENGTH = 120;

export function exportFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, FILE_NAME_MAX_LENGTH) : 'workx-chat';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function textToHtml(value: string): string {
  return value
    .trim()
    .split(/\n{2,}/)
    .map((chunk) => `<p>${escapeHtml(chunk).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function markdownToHtml(value: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>,
  );
}

// Every message of a turn carries the turn duration, but the export reports it once per turn.
function isLastMessageOfTurn(entries: TranscriptEntry[], index: number): boolean {
  const entry = entries[index];
  if (entry.kind !== 'assistant') {
    return false;
  }
  const next = entries[index + 1];
  return next === undefined || next.kind !== 'assistant' || next.turnId !== entry.turnId;
}

function activityLines(entry: Extract<TranscriptEntry, { kind: 'assistant' }>): string[] {
  return entry.activities.map((activity) =>
    activity.detail ? `- ${activity.label} — \`${activity.detail}\`` : `- ${activity.label}`,
  );
}

export function buildMarkdown(
  title: string,
  entries: TranscriptEntry[],
  language: Language,
): string {
  const lines: string[] = [`# ${title}`, ''];

  for (const [index, entry] of entries.entries()) {
    if (entry.kind === 'user') {
      const body =
        entry.text.trim() ||
        (entry.images.length > 0 ? translate(language, 'activity.image') : '');
      lines.push(`## ${translate(language, 'export.user')}`, '', body, '');
      continue;
    }

    const body = entry.text.trim();
    const activityItems = activityLines(entry);
    if (!body && activityItems.length === 0) {
      continue;
    }
    lines.push(`## ${translate(language, 'export.workx')}`, '');
    if (body) {
      lines.push(body, '');
    }

    const meta: string[] = [];
    if (!entry.active && entry.durationMs !== null && isLastMessageOfTurn(entries, index)) {
      meta.push(
        `_${translate(language, 'message.workedFor', {
          duration: formatDuration(entry.durationMs),
        })}_`,
      );
    }
    meta.push(...activityItems);
    if (meta.length > 0) {
      lines.push(...meta, '');
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

const EXPORT_STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 48px 56px 64px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
    font-size: 15px;
    line-height: 1.65;
    color: #1b1b1a;
    background: #ffffff;
    -webkit-font-smoothing: antialiased;
  }
  h1 { margin: 0 0 8px; font-size: 26px; line-height: 1.25; }
  h2 { margin: 32px 0 10px; font-size: 17px; line-height: 1.35; color: #4a4a48; }
  h3 { margin: 22px 0 8px; font-size: 15px; }
  p { margin: 10px 0; }
  ul, ol { margin: 10px 0; padding-left: 22px; }
  li { margin: 4px 0; }
  blockquote { margin: 12px 0; padding-left: 14px; border-left: 3px solid #d7d7d4; color: #55534f; }
  code {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.88em;
    background: #f2f2f0;
    border-radius: 4px;
    padding: 1px 5px;
  }
  pre {
    margin: 12px 0;
    padding: 12px 14px;
    background: #f7f7f5;
    border: 1px solid #e6e6e3;
    border-radius: 10px;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
  pre code { background: none; padding: 0; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px; }
  th, td { border: 1px solid #e6e6e3; padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: #f7f7f5; font-weight: 600; }
  .meta { margin: 8px 0 0; font-size: 13px; color: #7a7a76; }
  .activities { margin: 6px 0 0; padding-left: 20px; font-size: 13px; color: #55534f; }
  .activities li { margin: 2px 0; }
  hr { border: none; border-top: 1px solid #e6e6e3; margin: 28px 0; }
`;

export function buildExportHtml(
  title: string,
  entries: TranscriptEntry[],
  language: Language,
): string {
  const sections: string[] = [];
  const userLabel = translate(language, 'export.user');
  const workxLabel = translate(language, 'export.workx');

  for (const [index, entry] of entries.entries()) {
    if (entry.kind === 'user') {
      const body =
        entry.text.trim() ||
        (entry.images.length > 0 ? translate(language, 'activity.image') : '');
      if (!body) {
        continue;
      }
      sections.push(`<section><h2>${escapeHtml(userLabel)}</h2>${textToHtml(body)}</section>`);
      continue;
    }

    const body = entry.text.trim();
    if (!body && entry.activities.length === 0) {
      continue;
    }

    const parts: string[] = [`<section><h2>${escapeHtml(workxLabel)}</h2>`];
    if (body) {
      parts.push(markdownToHtml(body));
    }
    if (!entry.active && entry.durationMs !== null && isLastMessageOfTurn(entries, index)) {
      parts.push(
        `<p class="meta">${escapeHtml(
          translate(language, 'message.workedFor', {
            duration: formatDuration(entry.durationMs),
          }),
        )}</p>`,
      );
    }
    if (entry.activities.length > 0) {
      parts.push(
        `<ul class="activities">${entry.activities
          .map(
            (activity) =>
              `<li>${escapeHtml(activity.label)}${
                activity.detail ? ` — <code>${escapeHtml(activity.detail)}</code>` : ''
              }</li>`,
          )
          .join('')}</ul>`,
      );
    }
    parts.push('</section>');
    sections.push(parts.join('\n'));
  }

  return `<!doctype html>
<html lang="${language === 'zh' ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${EXPORT_STYLE}</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${sections.join('\n<hr>\n')}
</body>
</html>
`;
}
