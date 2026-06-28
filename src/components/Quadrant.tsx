import { useMemo, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { type PaneType } from 'obsidian';
import type { Priority, Quadrant as QuadrantKind, Task } from '../core/types.ts';
import { QUADRANT_META } from '../core/types.ts';
import type { SortMode } from '../core/taskUtils.ts';
import { TaskCard } from './TaskCard.tsx';
import { AddTaskInput } from './AddTaskInput.tsx';
import { Icon } from './Icon.tsx';

type Props = {
  kind: QuadrantKind;
  tasks: Task[];
  today: string;
  collapsed: boolean;
  collapsedParents: Set<string>;
  onToggleParentCollapse: (key: string) => void;
  onCollapseTasks: (keys: string[]) => void;
  onExpandTasks: (keys: string[]) => void;
  activeTaskId: string | null;
  compact: boolean;
  sortMode: SortMode;
  kanbanActive: boolean;
  onToggleKanban: () => void;
  onToggleCollapsed: () => void;
  graceMap: Map<string, number>;
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
  }) => Promise<void>;
  onOpenSource: (task: Task, mode?: PaneType | boolean) => void;
  onMoveQuadrant: (task: Task, target: QuadrantKind) => void;
  createTagSuggest: (inputEl: HTMLInputElement) => void;
};

export function Quadrant({
  kind,
  tasks,
  today,
  collapsed,
  collapsedParents,
  onToggleParentCollapse,
  onCollapseTasks,
  onExpandTasks,
  activeTaskId,
  compact,
  sortMode,
  kanbanActive,
  onToggleKanban,
  onToggleCollapsed,
  graceMap,
  onToggleTask,
  onSetStatus,
  onSetDueDate,
  onUpdateTask,
  onAddTask,
  onOpenSource,
  onMoveQuadrant,
  createTagSuggest,
}: Props) {
  const meta = QUADRANT_META[kind];
  const [adding, setAdding] = useState(false);

  // Identify which tasks are root tasks that have subtasks
  const hasSubtask = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.indent > 0 && t.parentIndex !== undefined) {
        // Find parent in tasks array — but parentIndex is relative to the full
        // tasks array, not this quadrant's subset. We match by parentIndex identity.
        // Instead, we walk up: if a task has indent > 0, its parent (one level up)
        // is the closest preceding task with indent = t.indent - 1.
        // Simpler: just mark the root parent key.
        // We'll find the root by walking backwards in the quadrant's tasks list.
        const idx = tasks.indexOf(t);
        for (let i = idx - 1; i >= 0; i--) {
          if (tasks[i].indent < t.indent) {
            set.add(`${tasks[i].sourceFile}:${tasks[i].lineIndex}`);
            break;
          }
          if (tasks[i].indent === 0) break;
        }
      }
    }
    return set;
  }, [tasks]);

  // Numbering within this quadrant. Root tasks are numbered PER PROJECT
  // (1..N within each project, in the project's display order), so two
  // projects each show their own 1, 2, 3… Subtasks: 1..M within their parent.
  const numberByKey = useMemo(() => {
    const map = new Map<string, number>();
    const rootCountByProject = new Map<string, number>();
    const subCountByParent = new Map<string, number>();
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const key = `${t.sourceFile}:${t.lineIndex}`;
      if (t.indent === 0) {
        const groupKey = t.projectKey ?? '__noproject__';
        const n = (rootCountByProject.get(groupKey) ?? 0) + 1;
        rootCountByProject.set(groupKey, n);
        map.set(key, n);
      } else {
        let parentKey = '';
        for (let j = i - 1; j >= 0; j--) {
          if (tasks[j].sourceFile === t.sourceFile && tasks[j].indent < t.indent) {
            parentKey = `${tasks[j].sourceFile}:${tasks[j].lineIndex}`;
            break;
          }
        }
        const n = (subCountByParent.get(parentKey) ?? 0) + 1;
        subCountByParent.set(parentKey, n);
        map.set(key, n);
      }
    }
    return map;
  }, [tasks]);

  // Filter out subtasks of collapsed parents
  const visibleTasks = useMemo(() => {
    if (collapsedParents.size === 0) return tasks;
    const result: typeof tasks = [];
    let skipping = false;
    let skipIndent = -1;
    for (const t of tasks) {
      // If we're skipping subtasks of a collapsed parent
      if (skipping) {
        if (t.indent > skipIndent) continue;
        skipping = false;
      }
      const key = `${t.sourceFile}:${t.lineIndex}`;
      result.push(t);
      // If this root was collapsed, skip its subtasks
      if (collapsedParents.has(key)) {
        skipping = true;
        skipIndent = t.indent;
      }
    }
    return result;
  }, [tasks, collapsedParents]);

  // Keys of this quadrant's root tasks that have subtasks — drives the
  // per-quadrant "Collapse tasks" button (collapses/expands them all at once).
  const collapsibleKeys = useMemo(() => [...hasSubtask], [hasSubtask]);
  const allTasksCollapsed =
    collapsibleKeys.length > 0 && collapsibleKeys.every((k) => collapsedParents.has(k));
  const toggleAllTasks = () => {
    if (allTasksCollapsed) onExpandTasks(collapsibleKeys);
    else onCollapseTasks(collapsibleKeys);
  };

  const { setNodeRef, isOver } = useDroppable({ id: kind });

  const openAdder = () => {
    setAdding(true);
    if (collapsed) onToggleCollapsed();
  };

  return (
    <section
      ref={setNodeRef}
      className={`em-quadrant em-quadrant-${kind.toLowerCase()} ${
        isOver ? 'em-quadrant-over' : ''
      }`}
      aria-label={meta.label}
    >
      <header className="em-quadrant-header">
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="em-quadrant-collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${meta.label}` : `Collapse ${meta.label}`}
          title={collapsed ? 'Expand quadrant' : 'Collapse quadrant'}
        >
          {collapsed ? '▶' : '▼'}
        </button>
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
          <button
            type="button"
            onClick={openAdder}
            className="em-quadrant-add"
            title="Add task"
            aria-label={`Add task to ${meta.label}`}
          >
            +
          </button>
          <button
            type="button"
            onClick={onToggleKanban}
            className={`em-kanban-btn em-kanban-btn-labeled ${kanbanActive ? 'em-kanban-btn-active' : ''}`}
            title={kanbanActive ? 'Back to grid' : 'Kanban view (status columns)'}
            aria-label={kanbanActive ? 'Back to grid' : 'Kanban view'}
          >
            <Icon name="square-kanban" className="em-kanban-icon" />
            <span>Kanban</span>
          </button>
          <span className="em-quadrant-count">{tasks.length}</span>
        </div>
      </header>

      {!collapsed && (
        <div className="em-quadrant-body">
          {adding && (
            <AddTaskInput
              quadrant={kind}
              onSubmit={async (input) => {
                await onAddTask(input);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
              createTagSuggest={createTagSuggest}
            />
          )}
          {visibleTasks.length === 0 && !adding ? (
            <p className="em-empty">No tasks</p>
          ) : (
            <SortableContext
              items={visibleTasks.map((t) => `${t.sourceFile}:${t.lineIndex}`)}
              strategy={verticalListSortingStrategy}
            >
            <ul className="em-task-list">
              {visibleTasks.map((t) => {
                const key = `${t.sourceFile}:${t.lineIndex}`;
                return (
                  <TaskCard
                    key={key}
                    task={t}
                    today={today}
                    graceExpiresAt={graceMap.get(key)}
                    isActiveDrag={activeTaskId === key}
                    compact={compact}
                    sortable={sortMode === 'manual'}
                    number={numberByKey.get(key)}
                    isCollapsible={hasSubtask.has(key)}
                    isCollapsed={collapsedParents.has(key)}
                    onToggleCollapse={() => onToggleParentCollapse(key)}
                    onToggle={() => onToggleTask(t)}
                    onSetStatus={(s) => onSetStatus(t, s)}
                    onSetDueDate={(d) => onSetDueDate(t, d)}
                    onUpdateTask={(text, tags, opts) => onUpdateTask(t, text, tags, opts)}
                    onOpenSource={(mode) => onOpenSource(t, mode)}
                    onMoveQuadrant={(target) => onMoveQuadrant(t, target)}
                    createTagSuggest={createTagSuggest}
                  />
                );
              })}
            </ul>
            </SortableContext>
          )}
        </div>
      )}
    </section>
  );
}
