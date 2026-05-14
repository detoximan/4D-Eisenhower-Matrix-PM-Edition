import type { Task } from '../core/types.ts';
import { PRIORITY_META } from '../core/types.ts';
import { isOverdue } from '../core/taskUtils.ts';

type Props = {
  task: Task;
  today: string;
};

export function TaskCard({ task, today }: Props) {
  const overdue = isOverdue(task, today);

  return (
    <li className={`em-task ${overdue ? 'em-task-overdue' : ''}`}>
      <div className="em-task-row">
        <input
          type="checkbox"
          checked={task.checked}
          disabled
          className="em-task-checkbox"
          aria-label="Task checkbox (read-only ve Fázi A)"
        />
        <div className="em-task-body">
          <p className="em-task-text">
            {task.text || <em className="em-empty-text">(prázdný text)</em>}
          </p>
          {!task.isFromDnes && (
            <p className="em-task-source" title={task.sourceFile}>
              📁 {shortenPath(task.sourceFile)}
            </p>
          )}
          <div className="em-task-badges">
            {task.contextTags.map((tag) => (
              <span key={tag} className="em-tag">
                {tag}
              </span>
            ))}
            {task.priority && (
              <span
                className="em-priority"
                style={{ color: PRIORITY_META[task.priority].tone }}
                title={`Priorita: ${PRIORITY_META[task.priority].label}`}
              >
                {PRIORITY_META[task.priority].emoji} {PRIORITY_META[task.priority].label}
              </span>
            )}
            {task.dueDate && (
              <span className={`em-badge ${overdue ? 'em-badge-overdue' : ''}`}>
                📅 {task.dueDate}
              </span>
            )}
            {task.startDate && <span className="em-badge">🛫 {task.startDate}</span>}
            {task.doneDate && <span className="em-badge">✅ {task.doneDate}</span>}
          </div>
        </div>
      </div>
    </li>
  );
}

function shortenPath(rel: string): string {
  const parts = rel.split('/');
  const filename = parts.pop() ?? '';
  const name = filename.replace(/\.md$/i, '');
  const cleaned = parts.map((p) => p.replace(/^\d+_/, ''));
  if (cleaned[0]?.toLowerCase() === 'daily-tasks') {
    return `Daily / ${name}`;
  }
  const short = cleaned.slice(-2).join(' / ');
  return short ? `${short} / ${name}` : name;
}
