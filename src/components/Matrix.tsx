import { useMemo } from 'react';
import type { Task, Quadrant as QuadrantKind } from '../core/types.ts';
import { QUADRANTS } from '../core/types.ts';
import { Quadrant } from './Quadrant.tsx';

type Props = {
  tasks: Task[];
  today: string;
};

export function Matrix({ tasks, today }: Props) {
  const tasksByQuadrant = useMemo(() => {
    const map: Record<QuadrantKind, Task[]> = {
      DO: [],
      DECIDE: [],
      DELEGATE: [],
      DELETE: [],
      OPEN: [],
    };
    for (const t of tasks) {
      map[t.quadrant].push(t);
    }
    return map;
  }, [tasks]);

  return (
    <div className="em-matrix">
      <div className="em-matrix-grid">
        {QUADRANTS.filter((q) => q !== 'OPEN').map((q) => (
          <Quadrant key={q} kind={q} tasks={tasksByQuadrant[q]} today={today} />
        ))}
      </div>
      <div className="em-matrix-open">
        <Quadrant kind="OPEN" tasks={tasksByQuadrant.OPEN} today={today} />
      </div>
    </div>
  );
}
