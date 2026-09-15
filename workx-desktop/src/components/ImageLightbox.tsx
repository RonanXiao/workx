import { X } from 'lucide-react';
import { useEffect } from 'react';

import { useI18n } from '../lib/i18n';

/** Full-screen preview for an attached image, dismissed by Escape, the close button, or a click
 * outside the image. */
export function ImageLightbox({ source, onClose }: { source: string; onClose: () => void }) {
  const { t } = useI18n();

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
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('message.viewImage')}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
    >
      <button
        type="button"
        aria-label={t('common.close')}
        title={t('common.close')}
        onClick={onClose}
        className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
      >
        <X className="size-4" strokeWidth={2} />
      </button>
      <img
        src={source}
        alt=""
        onClick={(event) => event.stopPropagation()}
        className="max-h-full max-w-full rounded-xl object-contain"
      />
    </div>
  );
}
