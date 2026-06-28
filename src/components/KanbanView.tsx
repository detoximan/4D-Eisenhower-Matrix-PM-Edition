import { useDroppable } from '@dnd-kit/core';
import type { PaneType } from 'obsidian';
import { useState, useMemo, type ReactNode } from 'react';
import type { Priority, Quadrant as QuadrantKind, Task } from '../core/types.ts';
import { QUADRANTS, QUADRANT_META } from '../core/types.ts';
import type { SortMode } from '../core/taskUtils.ts';
import { TaskCard } from './TaskCard.tsx';
import { Quadrant } from './Quadrant.tsx';
import { AddTaskInput } from './AddTaskInput.tsx';
import { Icon } from './Icon.tsx';

// 4 status-sloupce. Forwarded [>] se zobrazí ve Scheduled, canceled [-] v Done
// (drop ale vždy nastaví primární char sloupce — vzácné stavy jen přes menu).
const KANBAN_COLUMNS: {
  key: string;
  label: string;
  statusChar: string;
  icon: string;
}[] = [
  { key: 'todo', label: 'To-do', statusChar: ' ', icon: 'square' },
  { key: 'inprogress', label: 'In progress', statusChar: '/', icon: 'em-square-half' },
  { key: 'scheduled', label: 'Scheduled', statusChar: '<', icon: 'calendar' },
  { key: 'done', label: 'Done', statusChar: 'x', icon: 'square-check-big' },
];

function columnKeyForStatus(s: string): string {
  if (s === '/') return 'inprogress';
  if (s === '<' || s === '>') return 'scheduled';
  if (s.toLowerCase() === 'x' || s === '-') return 'done';
  return 'todo';
}

type Props = {
  kanbanQuadrant: QuadrantKind;
  tasks: Task[];
  today: string;
  collapsed: Record<QuadrantKind, boolean>;
  collapsedParents: Set<string>;
  onToggleParentCollapse: (key: string) => void;
  onCollapseTasks: (keys: string[]) => void;
  onExpandTasks: (keys: string[]) => void;
  graceMap: Map<string, number>;
  activeTaskId: string | null;
  compact: boolean;
  sortMode: SortMode;
  onToggleCollapsed: (q: QuadrantKind) => void;
  onToggleKanban: (q: QuadrantKind) => void;
  onToggleTask: (task: Task) => void;
  onSetStatus: (task: Task, newStatus: string) => Promise<void>;
  onSetDueDate: (task: Task, newDueDate: string | null) => Promise<void>;
  onUpdateTask: (
    task: Task,
    text: string,
    contextTags: string[],
    options: { dueDate: string | null; priority: Priority | null },
  ) => Promise<void>;
  onAddTask: (input: {
    text: string;
    quadrant: QuadrantKind;
    dueDate: string | null;
    priority: Priority | null;
    status?: string;
  }) => Promise<void>;
  onOpenSource: (task: Task, mode?: PaneType | boolean) => void;
  onMoveQuadrant: (task: Task, target: QuadrantKind) => void;
  createTagSuggest: (inputEl: HTMLInputElement) => void;
};

export function KanbanView(props: Props) {
  const { kanbanQuadrant } = props;
  const byQuadrant: Record<QuadrantKind, Task[]> = {
    DO: [],
    DECIDE: [],
    DELEGATE: [],
    DELETE: [],
    OPEN: [],
  };
  for (const t of props.tasks) byQuadrant[t.quadrant].push(t);

  const meta = QUADRANT_META[kanbanQuadrant];
  const expandedTasks = byQuadrant[kanbanQuadrant];
  const bottom = QUADRANTS.filter((q) => q !== kanbanQuadrant);

  // === Collapse logic — shared with the rest of the matrix via props ===
  const collapsedParents = props.collapsedParents;

  const hasSubtask = useMemo(() => {
    const set = new Set<string>();
    for (const t of expandedTasks) {
      if (t.indent > 0) {
        const idx = expandedTasks.indexOf(t);
        for (let i = idx - 1; i >= 0; i--) {
          if (expandedTasks[i].indent < t.indent) {
            set.add(`${expandedTasks[i].sourceFile}:${expandedTasks[i].lineIndex}`);
            break;
          }
          if (expandedTasks[i].indent === 0) break;
        }
      }
    }
    return set;
  }, [expandedTasks]);

  // Numbering (same scheme as the grid): roots per project, subtasks per parent.
  const numberByKey = useMemo(() => {
    const map = new Map<string, number>();
    const rootCountByProject = new Map<string, number>();
    const subCountByParent = new Map<string, number>();
    for (let i = 0; i < expandedTasks.length; i++) {
      const t = expandedTasks[i];
      const key = `${t.sourceFile}:${t.lineIndex}`;
      if (t.indent === 0) {
        const groupKey = t.projectKey ?? '__noproject__';
        const n = (rootCountByProject.get(groupKey) ?? 0) + 1;
        rootCountByProject.set(groupKey, n);
        map.set(key, n);
      } else {
        let parentKey = '';
        for (let j = i - 1; j >= 0; j--) {
          if (expandedTasks[j].sourceFile === t.sourceFile && expandedTasks[j].indent < t.indent) {
            parentKey = `${expandedTasks[j].sourceFile}:${expandedTasks[j].lineIndex}`;
            break;
          }
        }
        const n = (subCountByParent.get(parentKey) ?? 0) + 1;
        subCountByParent.set(parentKey, n);
        map.set(key, n);
      }
    }
    return map;
  }, [expandedTasks]);

  const visibleExpandedTasks = useMemo(() => {
    if (collapsedParents.size === 0) return expandedTasks;
    const result: typeof expandedTasks = [];
    let skipping = false;
    let skipIndent = -1;
    for (const t of expandedTasks) {
      if (skipping) {
        if (t.indent > skipIndent) continue;
        skipping = false;
      }
      const key = `${t.sourceFile}:${t.lineIndex}`;
      result.push(t);
      if (collapsedParents.has(key)) {
        skipping = true;
        skipIndent = t.indent;
      }
    }
    return result;
  }, [expandedTasks, collapsedParents]);

  // Drives the header "Collapse tasks" button for the focused quadrant.
  const collapsibleKeys = useMemo(() => [...hasSubtask], [hasSubtask]);
  const allTasksCollapsed =
    collapsibleKeys.length > 0 && collapsibleKeys.every((k) => collapsedParents.has(k));
  const toggleAllTasks = () => {
    if (allTasksCollapsed) props.onExpandTasks(collapsibleKeys);
    else props.onCollapseTasks(collapsibleKeys);
  };

  const renderCard = (t: Task): ReactNode => {
    const key = `${t.sourceFile}:${t.lineIndex}`;
    return (
      <TaskCard
        key={key}
        task={t}
        today={props.today}
        graceExpiresAt={props.graceMap.get(key)}
        isActiveDrag={props.activeTaskId === key}
        compact={props.compact}
        sortable={props.sortMode === 'manual'}
        number={numberByKey.get(key)}
        isCollapsible={hasSubtask.has(key)}
        isCollapsed={collapsedParents.has(key)}
        onToggleCollapse={() => props.onToggleParentCollapse(key)}
        onToggle={() => props.onToggleTask(t)}
        onSetStatus={(s) => props.onSetStatus(t, s)}
        onSetDueDate={(d) => props.onSetDueDate(t, d)}
        onUpdateTask={(text, tags, opts) => props.onUpdateTask(t, text, tags, opts)}
        onOpenSource={(mode) => props.onOpenSource(t, mode)}
        onMoveQuadrant={(target) => props.onMoveQuadrant(t, target)}
        createTagSuggest={props.createTagSuggest}
      />
    );
  };

  return (
    <div className="em-kanban">
      <section
        className={`em-quadrant em-quadrant-${kanbanQuadrant.toLowerCase()} em-kanban-main`}
        aria-label={meta.label}
      >
        <header className="em-quadrant-header">
          <div className="em-quadrant-title">
            <h3>{meta.label}</h3>
            <p>{meta.subtitle}</p>
          </div>
          <div className="em-quadrant-actions">
            {collapsibleKeys.length > 0 && (
              <button
                type="button"
                onClick={toggleAllTasks}
                className="em-quadrant-collapse-tasks"
                title={allTasksCollapsed ? 'Expand all subtasks in this quadrant' : 'Collapse all subtasks in this quadrant'}
                aria-label={allTasksCollapsed ? 'Expand all subtasks' : 'Collapse all subtasks'}
              >
                <span className="em-cct-tri">{allTasksCollapsed ? '▶' : '▼'}</span>
                <span className="em-cct-lbl">{allTasksCollapsed ? 'Expand' : 'Collapse'}<br />tasks</span>
              </button>
            )}
            <span className="em-quadrant-count">{visibleExpandedTasks.length}</span>
            <button
              type="button"
              className="em-kanban-btn em-kanban-back"
              onClick={() => props.onToggleKanban(kanbanQuadrant)}
              title="Back to 4D grid"
              aria-label="Back to 4D grid"
            >
              <Icon name="layout-grid" className="em-kanban-icon" />
              <span>Back</span>
            </button>
          </div>
        </header>
        <div className="em-kanban-columns">
          {KANBAN_COLUMNS.map((col) => (
            <KanbanColumn
              key={col.key}
              col={col}
              quadrant={kanbanQuadrant}
              tasks={visibleExpandedTasks.filter((t) => columnKeyForStatus(t.status) === col.key)}
              renderCard={renderCard}
              onAddTask={props.onAddTask}
              createTagSuggest={props.createTagSuggest}
            />
          ))}
        </div>
      </section>

      <div className="em-kanban-bottom">
        {bottom.map((q) => (
          <Quadrant
            key={q}
            kind={q}
            tasks={byQuadrant[q]}
            today={props.today}
            collapsed={props.collapsed[q]}
            collapsedParents={props.collapsedParents}
            onToggleParentCollapse={props.onToggleParentCollapse}
            onCollapseTasks={props.onCollapseTasks}
            onExpandTasks={props.onExpandTasks}
            graceMap={props.graceMap}
            activeTaskId={props.activeTaskId}
            compact={props.compact}
            sortMode={props.sortMode}
            kanbanActive={false}
            onToggleKanban={() => props.onToggleKanban(q)}
            onToggleCollapsed={() => props.onToggleCollapsed(q)}
            onToggleTask={props.onToggleTask}
            onSetStatus={props.onSetStatus}
            onSetDueDate={props.onSetDueDate}
            onUpdateTask={props.onUpdateTask}
            onAddTask={props.onAddTask}
            onOpenSource={props.onOpenSource}
            onMoveQuadrant={props.onMoveQuadrant}
            createTagSuggest={props.createTagSuggest}
          />
        ))}
      </div>
    </div>
  );
}

function KanbanColumn({
  col,
  quadrant,
  tasks,
  renderCard,
  onAddTask,
  createTagSuggest,
}: {
  col: { key: string; label: string; statusChar: string; icon: string };
  quadrant: QuadrantKind;
  tasks: Task[];
  renderCard: (t: Task) => ReactNode;
  onAddTask: Props['onAddTask'];
  createTagSuggest: Props['createTagSuggest'];
}) {
  const [adding, setAdding] = useState(false);
  const { setNodeRef, isOver } = useDroppable({ id: `kanban-status:${col.statusChar}` });
  return (
    <div
      ref={setNodeRef}
      className={`em-kanban-col ${isOver ? 'em-kanban-col-over' : ''}`}
    >
      <header className="em-kanban-col-header">
        <Icon name={col.icon} className="em-kanban-icon" />
        <span className="em-kanban-col-label">{col.label}</span>
        {/* Done sloupec nemá „+" — task by se založil rovnou zavřený a hned by
            zmizel (grace + Done filtr), což je matoucí. */}
        {col.key !== 'done' && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="em-quadrant-add"
            title={`Add task (${col.label})`}
            aria-label={`Add task to ${col.label}`}
          >
            +
          </button>
        )}
        <span className="em-quadrant-count">{tasks.length}</span>
      </header>
      {adding && (
        <AddTaskInput
          quadrant={quadrant}
          status={col.statusChar}
          onSubmit={async (input) => {
            await onAddTask(input);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
          createTagSuggest={createTagSuggest}
        />
      )}
      {tasks.length === 0 && !adding ? (
        <p className="em-empty">No tasks</p>
      ) : (
        <ul className="em-task-list">{tasks.map(renderCard)}</ul>
      )}
    </div>
  );
}
