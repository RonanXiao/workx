import { useState } from 'react';

import { useI18n } from '../../lib/i18n';
import type { UpdateCheckResult } from '../../shared/updates';

export function UpdateCheck() {
  const { t } = useI18n();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [failed, setFailed] = useState(false);

  const check = async () => {
    setChecking(true);
    setFailed(false);
    setResult(null);
    try {
      setResult(await window.workx.checkForUpdates());
    } catch {
      setFailed(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex max-w-sm flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {result?.status === 'available' ? (
          <button type="button"
            onClick={() => { void window.workx.openExternal(result.releaseUrl).catch(() => setFailed(true)); }}
            className="h-8 rounded-full border border-line px-3 text-[13px] text-fg-secondary hover:bg-hover">
            {t('settings.viewRelease')}
          </button>
        ) : null}
        <button type="button" disabled={checking} onClick={() => void check()}
          className="h-8 rounded-full border border-line px-3 text-[13px] text-fg-secondary hover:bg-hover disabled:opacity-60">
          {t(checking ? 'settings.checkingUpdates' : 'settings.checkUpdates')}
        </button>
      </div>
      <p role="status" aria-live="polite" className="text-right text-[12px] text-fg-secondary">
        {failed ? t('settings.updateCheckFailed') : result
          ? result.status === 'available'
            ? t('settings.updateAvailable', { version: result.latestVersion })
            : result.status === 'unavailable'
              ? t('settings.updateUnavailable', { version: result.latestVersion })
              : t('settings.upToDate')
          : null}
      </p>
    </div>
  );
}
