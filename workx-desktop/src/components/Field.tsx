import type { ReactNode } from 'react';

/** Settings-style labeled form row used by Settings and provider dialogs. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] text-fg-secondary">{label}</span>
      {children}
    </label>
  );
}

export const inputClassName =
  'h-9 w-full rounded-lg border border-line bg-app px-2.5 text-[14px] outline-none focus:border-line-strong';
