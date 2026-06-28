/**
 * Sort + filter utility — sdíleno s `Eisenhower-matrix/app/src/utils/taskUtils.ts`.
 * Drž sync ručně.
 */

import type { Priority, Task } from './types.ts';

/**
 * Sort mode for task display.
 * - 'auto': current behaviour — sort by overdue → priority → dueDate → text
 * - 'manual': sort by lineIndex (order in file), enabling drag-and-drop reordering
 */
export type SortMode = 'auto' | 'manual';

/**
 * Find the full contiguous block of a task and its subtasks.
 * Returns [startLineIndex, endLineIndex] (inclusive, 0-based line indices).
 *
 * A block is: the root task + all consecutive subtasks with higher indent
 * that come after it (same sourceFile). Stops at a root-level (indent=0)
 * task or end of array.
 */
export function findTaskBlockRange(
  task: Task,
  fullTasks: Task[],
): [number, number] {
  // Find the root task of this group
  const root = findRootTask(task, fullTasks);
  const rootLine = root.lineIndex;
  const rootFile = root.sourceFile;

  let startLine = rootLine;
  let endLine = rootLine;

  // Walk forward through tasks in the same file, collecting subtasks
  for (let i = 0; i < fullTasks.length; i++) {
    const t = fullTasks[i];
    if (t.sourceFile !== rootFile) continue;
    if (t.lineIndex > endLine && t.indent > 0) {
      // This is a subtask following our block
      // We need to check it belongs to our root (not a sibling subtask)
      // Walk backwards to find its parent chain
      let parent = t;
      while (parent.parentIndex !== undefined) {
        parent = fullTasks[parent.parentIndex];
      }
      if (parent.lineIndex === rootLine) {
        endLine = t.lineIndex;
      }
    }
  }

  return [startLine, endLine];
}

/**
 * Check whether two tasks can be reordered (drag-and-drop) relative to each other.
 * Rules:
 * - Both must be root tasks (indent === 0)
 * - Both must be in the same sourceFile
 * - Subtasks can only be reordered WITHIN their parent (same block)
 * - A subtask can never become a root, and a root can never become a subtask
 */
/**
 * Find the block of a SINGLE subtask: the subtask line plus any deeper-
 * indented descendant lines that follow it in the same file. Unlike
 * findTaskBlockRange, this does NOT jump to the root, so a subtask can be
 * reordered among its siblings without dragging the whole parent block.
 */
export function findSubtaskBlockRange(
  task: Task,
  fullTasks: Task[],
): [number, number] {
  const sameFile = fullTasks
    .filter((t) => t.sourceFile === task.sourceFile)
    .sort((a, b) => a.lineIndex - b.lineIndex);
  const startIdx = sameFile.findIndex((t) => t.lineIndex === task.lineIndex);
  let endLine = task.lineIndex;
  if (startIdx !== -1) {
    for (let i = startIdx + 1; i < sameFile.length; i++) {
      if (sameFile[i].indent > task.indent) {
        endLine = sameFile[i].lineIndex;
      } else {
        break;
      }
    }
  }
  return [task.lineIndex, endLine];
}

export function canReorder(
  dragged: Task,
  target: Task,
  fullTasks: Task[],
): boolean {
  // Subtask → subtask within same parent: allowed
  if (dragged.indent > 0 && target.indent > 0) {
    const dragRoot = findRootTask(dragged, fullTasks);
    const targetRoot = findRootTask(target, fullTasks);
    return dragRoot === targetRoot && dragRoot.sourceFile === targetRoot.sourceFile;
  }

  // Root → root: allowed if same file
  if (dragged.indent === 0 && target.indent === 0) {
    return dragged.sourceFile === target.sourceFile;
  }

  // Mixed (root ↔ subtask): not allowed
  return false;
}

const PRIORITY_RANK: Record<Priority | 'none', number> = {
  highest: 0,
  high: 1,
  medium: 2,
  low: 3,
  lowest: 4,
  none: 5,
};

function priorityRank(p?: Priority): number {
  return p ? PRIORITY_RANK[p] : PRIORITY_RANK.none;
}

/**
 * Comparator pro řazení tasků uvnitř kvadrantu:
 *   0. Subtasky (indent > 0) se drží hned za svým rodičem
 *   1. Overdue (dueDate < today)
 *   2. Priorita desc (🔺 → ⏫ → 🔼 → 🔽 → ⏬ → bez)
 *   3. Due date asc (s dueDate před bez)
 *   4. Text alfabeticky (cs locale)
 *
 * Pro grouping: rodiče se řadí mezi sebou normálně (overdue → priority →
 * dueDate → text). Jejich subtasky jdou hned za nimi v původním pořadí
 * (lineIndex ascending).
 */
/**
 * Find the root task by walking up the parentIndex chain.
 * Uses `fullTasks` array for parentIndex lookups (indices are relative to it).
 * For root tasks (parentIndex === undefined), returns the task itself.
 */
export function findRootTask(task: Task, fullTasks: Task[]): Task {
  if (task.parentIndex === undefined) return task;
  let current = task;
  while (current.parentIndex !== undefined) {
    current = fullTasks[current.parentIndex];
  }
  return current;
}

/**
 * Sort key for a root task (used to compare groups).
 * Returns a tuple: [overdueRank, priorityRank, dueDate, text]
 */
function rootSortKey(task: Task, today: string): [number, number, string, string] {
  return [
    isOverdue(task, today) ? 0 : 1,
    priorityRank(task.priority),
    task.dueDate ?? '9999-99-99',
    task.text,
  ];
}

/**
 * Comparator pro řazení tasků uvnitř kvadrantu:
 *   1. Tasks are grouped by their root parent
 *   2. Within each group, root parent comes first, then subtasks by lineIndex
 *   3. Groups are sorted by: overdue → priority → dueDate → text
 *
 * `fullTasks` is the complete (unfiltered) tasks array — needed because
 * parentIndex values reference indices in that array, not in the filtered subset.
 */
export function makeCompareTask(today: string, fullTasks: Task[]): (a: Task, b: Task) => number {
  return (a, b) => {
    const aRoot = findRootTask(a, fullTasks);
    const bRoot = findRootTask(b, fullTasks);

    // Same group (same root parent)
    if (aRoot === bRoot) {
      // Root comes before its subtasks
      if (a === aRoot) return -1;
      if (b === bRoot) return 1;
      // Both are subtasks — sort by lineIndex (original order in file)
      return a.lineIndex - b.lineIndex;
    }

    // Different groups — sort by root task's sort key
    const aKey = rootSortKey(aRoot, today);
    const bKey = rootSortKey(bRoot, today);

    for (let i = 0; i < aKey.length; i++) {
      if (aKey[i] < bKey[i]) return -1;
      if (aKey[i] > bKey[i]) return 1;
    }
    return 0;
  };
}

export function isOverdue(task: Task, today: string): boolean {
  return !!task.dueDate && task.dueDate < today;
}

export const UNTAGGED_FILTER = '__untagged__';

export function extractAllContextTags(tasks: Task[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  let untagged = 0;
  for (const t of tasks) {
    if (t.contextTags.length === 0) untagged++;
    for (const tag of t.contextTags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  const entries = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag, 'cs', { sensitivity: 'base' }));
  // UNTAGGED_FILTER ("Ostatní") vždy na konci, nezávisle na abecedě.
  if (untagged > 0) {
    entries.push({ tag: UNTAGGED_FILTER, count: untagged });
  }
  return entries;
}

export function matchesFilter(task: Task, selectedTags: string[]): boolean {
  if (selectedTags.length === 0) return true;
  return selectedTags.some((sel) => {
    if (sel === UNTAGGED_FILTER) return task.contextTags.length === 0;
    return task.contextTags.some((t) => t.toLowerCase() === sel.toLowerCase());
  });
}

// ============================================================
// Rychlý filtr podle due date
// ============================================================

export type DueFilter = 'none' | 'today' | 'week' | 'selected';

/** Vrátí ISO datum posunuté o `days` (lokální čas, bez UTC off-by-one). */
export function addDaysISO(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return formatDateISO(new Date(y, m - 1, d + days));
}

/**
 * Due-date quick filtr:
 *   'today'    = overdue + due dnes
 *   'week'     = overdue + due v rozmezí dnes .. dnes+7
 *   'selected' = due přesně na datum vybrané v horní liště (`selectedDate`),
 *                bez overdue — čistě tasky toho jednoho dne
 * Tasky bez due date při aktivním filtru nikdy nematchují.
 */
export function matchesDueFilter(
  task: Task,
  dueFilter: DueFilter,
  today: string,
  selectedDate: string,
): boolean {
  if (dueFilter === 'none') return true;
  if (!task.dueDate) return false;
  if (dueFilter === 'selected') return task.dueDate === selectedDate;
  if (task.dueDate < today) return true; // overdue platí pro 'today' i 'week'
  if (dueFilter === 'today') return task.dueDate === today;
  return task.dueDate <= addDaysISO(today, 7); // 'week': dnes .. dnes+7
}

export function formatDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
