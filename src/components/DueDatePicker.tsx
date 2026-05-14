import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  currentDueDate?: string;
  onChange: (next: string | null) => Promise<void> | void;
  variant: 'badge' | 'add';
  overdue?: boolean;
};

type Position = { top: number; left: number };

/**
 * Trigger (📅 badge nebo `+ 📅`) + popover přes `createPortal` do
 * dokumentu vlastnícího trigger (popout window safe).
 */
export function DueDatePicker({ currentDueDate, onChange, variant, overdue }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentDueDate ?? '');
  const [pending, setPending] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => setValue(currentDueDate ?? ''), [currentDueDate]);

  const recomputePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const win = el.ownerDocument.defaultView ?? window;
    const rect = el.getBoundingClientRect();
    const popoverWidth = 260;
    const left = Math.min(rect.left, win.innerWidth - popoverWidth - 8);
    setPos({ top: rect.bottom + 4, left: Math.max(8, left) });
  }, []);

  useLayoutEffect(() => {
    if (open) recomputePosition();
  }, [open, recomputePosition]);

  useEffect(() => {
    if (!open) return;
    const doc = triggerRef.current?.ownerDocument ?? document;
    const win = doc.defaultView ?? window;

    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const t = setTimeout(() => {
      doc.addEventListener('click', onDocClick);
      doc.addEventListener('keydown', onKey);
      win.addEventListener('scroll', onScroll, true);
      win.addEventListener('resize', recomputePosition);
    }, 0);
    return () => {
      clearTimeout(t);
      doc.removeEventListener('click', onDocClick);
      doc.removeEventListener('keydown', onKey);
      win.removeEventListener('scroll', onScroll, true);
      win.removeEventListener('resize', recomputePosition);
    };
  }, [open, recomputePosition]);

  const save = async (newValue: string | null) => {
    setPending(true);
    try {
      await onChange(newValue);
      setOpen(false);
    } finally {
      setPending(false);
    }
  };

  const trigger =
    variant === 'badge' && currentDueDate ? (
      <button
        ref={triggerRef}
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`em-badge em-badge-clickable ${overdue ? 'em-badge-overdue' : ''}`}
        title="Klikni pro editaci termínu"
      >
        📅 {currentDueDate}
      </button>
    ) : (
      <button
        ref={triggerRef}
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="em-badge em-badge-add"
        title="Přidat termín"
      >
        + 📅
      </button>
    );

  const doc = triggerRef.current?.ownerDocument ?? document;
  const popover =
    open && pos
      ? createPortal(
          <div
            ref={popoverRef}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 1000 }}
            className="em-popover"
          >
            <input
              type="date"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && value) {
                  e.preventDefault();
                  void save(value);
                }
              }}
              autoFocus
              className="em-popover-input"
            />
            <button
              type="button"
              onClick={() => value && save(value)}
              disabled={pending || !value}
              className="em-btn-ok"
            >
              OK
            </button>
            {currentDueDate && (
              <button
                type="button"
                onClick={() => save(null)}
                disabled={pending}
                className="em-btn-danger-link"
                title="Odstranit termín"
              >
                Smazat
              </button>
            )}
          </div>,
          doc.body,
        )
      : null;

  return (
    <span className="em-inline-flex">
      {trigger}
      {popover}
    </span>
  );
}
