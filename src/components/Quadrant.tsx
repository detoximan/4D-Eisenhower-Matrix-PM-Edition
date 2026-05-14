import { useState } from 'react';
import type { Quadrant as QuadrantKind, Task } from '../core/types.ts';
import { QUADRANT_META } from '../core/types.ts';
import { TaskCard } from './TaskCard.tsx';

type Props = {
  kind: QuadrantKind;
  tasks: Task[];
  today: string;
};

export function Quadrant({ kind, tasks, today }: Props) {
  const meta = QUADRANT_META[kind];
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section
      className={`em-quadrant em-quadrant-${kind.toLowerCase()}`}
      style={{ borderTopColor: meta.accent }}
      aria-label={meta.label}
    >
      <header
        className="em-quadrant-header"
        onClick={() => setCollapsed((v) => !v)}
        role="button"
        aria-expanded={!collapsed}
      >
        <span className="em-collapse-icon">{collapsed ? '▶' : '▼'}</span>
        <div className="em-quadrant-title">
          <h3>{meta.label}</h3>
          <p>{meta.subtitle}</p>
        </div>
        <span className="em-quadrant-count">{tasks.length}</span>
      </header>

      {!collapsed && (
        <div className="em-quadrant-body">
          {tasks.length === 0 ? (
            <p className="em-empty">Žádné tasky</p>
          ) : (
            <ul className="em-task-list">
              {tasks.map((t) => (
                <TaskCard
                  key={`${t.sourceFile}:${t.lineIndex}`}
                  task={t}
                  today={today}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
