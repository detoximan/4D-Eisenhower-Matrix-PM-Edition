import { useRef } from 'react';

type Props = {
  date: string;
  today: string;
  existingDates: Set<string>;
  onChange: (newDate: string) => void;
};

/**
 * Posune ISO datum o `delta` dní (může být záporné).
 */
function shiftDate(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + delta);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function DateNav({ date, today, existingDates, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const prev = shiftDate(date, -1);
  const next = shiftDate(date, 1);
  const isToday = date === today;

  const openPicker = () => {
    const el = inputRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') el.showPicker();
    else el.focus();
  };

  const dotIf = (d: string) => existingDates.has(d) ? <span className="em-dn-dot" aria-hidden /> : null;

  return (
    <div className="em-datenav">
      <button
        type="button"
        onClick={() => onChange(prev)}
        className="em-dn-btn"
        title={`Předchozí den (${prev})`}
        aria-label="Předchozí den"
      >
        ← {dotIf(prev)}
      </button>

      <button
        type="button"
        onClick={openPicker}
        className="em-dn-date"
        title="Vyber datum"
      >
        {date}
      </button>
      <input
        ref={inputRef}
        type="date"
        value={date}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="em-sr-only"
        aria-hidden
        tabIndex={-1}
      />

      <button
        type="button"
        onClick={() => onChange(next)}
        className="em-dn-btn"
        title={`Další den (${next})`}
        aria-label="Další den"
      >
        → {dotIf(next)}
      </button>

      {!isToday && (
        <button
          type="button"
          onClick={() => onChange(today)}
          className="em-dn-today"
          title={`Skoč na dnešek (${today})`}
        >
          Dnes
        </button>
      )}
    </div>
  );
}
