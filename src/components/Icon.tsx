import { setIcon } from 'obsidian';
import { useEffect, useRef } from 'react';

/**
 * Renderuje Lucide (nebo custom přes addIcon) ikonu přes Obsidian `setIcon`.
 * Sdílené napříč komponentami, ať se ikony všude shodují.
 */
export function Icon({ name, className }: { name: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) setIcon(ref.current, name);
  }, [name]);
  return <span ref={ref} className={className} aria-hidden="true" />;
}
