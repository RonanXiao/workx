import { Check } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '../lib/cn';

interface MenuProps {
  open: boolean;
  onClose: () => void;
  align?: 'left' | 'right';
  placement?: 'top' | 'bottom';
  children: ReactNode;
}

// 下拉菜单容器。菜单高度由容器决定，不随条目数量增长：条目超出上限时容器内滚动。
export function Menu({
  open,
  onClose,
  align = 'left',
  placement = 'top',
  children,
}: MenuProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onMouseDown={onClose} />
      <div
        className={cn(
          'absolute z-50 max-h-[min(60vh,380px)] min-w-[280px] overflow-y-auto overscroll-contain rounded-xl border border-line bg-elevated p-1 shadow-xl',
          placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          align === 'right' ? 'right-0' : 'left-0',
        )}
      >
        {children}
      </div>
    </>
  );
}

interface MenuItemProps {
  title: string;
  description?: string;
  selected?: boolean;
  icon?: ReactNode;
  onClick: () => void;
}

export function MenuItem({
  title,
  description,
  selected = false,
  icon,
  onClick,
}: MenuItemProps) {
  const itemRef = useRef<HTMLButtonElement>(null);

  // 菜单限高后选中项可能落在可视区域外，打开菜单时需滚入视野；jsdom 未实现 scrollIntoView。
  useEffect(() => {
    if (selected) {
      itemRef.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [selected]);

  return (
    <button
      ref={itemRef}
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-hover"
    >
      {icon ? (
        <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center text-fg-secondary">
          {icon}
        </span>
      ) : (
        <Check
          className={cn('mt-0.5 size-3.5 shrink-0', selected ? 'opacity-100' : 'opacity-0')}
          strokeWidth={2}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-[12px] leading-snug text-fg-tertiary">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}
