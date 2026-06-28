/**
 * Core types — sdíleno s `Eisenhower-matrix/app` web verzí.
 * Drž sync ručně. Při změně v jedné kopii uprav i druhou.
 */

export type Quadrant = 'DO' | 'DECIDE' | 'DELEGATE' | 'DELETE' | 'OPEN';

export type Priority = 'highest' | 'high' | 'medium' | 'low' | 'lowest';

export type Task = {
  lineIndex: number;
  raw: string;
  /**
   * Checkbox status — jeden znak mezi hranatými závorkami.
   * Plugin rozumí 6 Basic stavům (`TASK_STATUSES`), ostatní znaky se
   * vykreslí jako "to-do" a při kliknutí přejdou na `x`.
   */
  status: string;
  /** Derived: status === 'x' / 'X' (zachované kvůli existujícímu kódu). */
  checked: boolean;
  text: string;
  quadrant: Quadrant;
  contextTags: string[];
  dueDate?: string;
  startDate?: string;
  doneDate?: string;
  priority?: Priority;
  sourceFile: string;
  isFromDnes: boolean;
  /** Indent level — 0 = root task, 1+ = subtask. */
  indent: number;
  /** Index of parent task in the parsed array. Undefined for root tasks. */
  parentIndex?: number;
  /** Project file (pro-*.md path) this root task is listed in, if any. */
  projectKey?: string;
  /** Slug of that project (frontmatter `slug`, fallback filename). */
  projectSlug?: string;
  /** 1-based order of this task within its project's quadrant list. */
  projectOrder?: number;
  /** Line index of this task's [[link]] inside the project file. */
  projectLinkLine?: number;
};

/**
 * 6 Basic checkbox stavů ve stylu „Things" / Alternate Checkboxes.
 * `done` a `canceled` jsou "closed" — `showCompleted` přepínač je skrývá.
 */
export const TASK_STATUSES: {
  char: string;
  label: string;
  icon: string;
  closed?: boolean;
}[] = [
  // Záměrně hranaté Lucide ikony pro to-do / incomplete / done — vizuálně
  // odpovídají Things theme. canceled / forwarded / scheduling jsou
  // záměrně bez rámečku (jen dash / triangle / calendar) — taky Things.
  { char: ' ', label: 'To-do', icon: 'square' },
  { char: '/', label: 'In progress', icon: 'em-square-half' },
  { char: 'x', label: 'Done', icon: 'square-check-big', closed: true },
  { char: '-', label: 'Canceled', icon: 'minus', closed: true },
  { char: '>', label: 'Forwarded', icon: 'play' },
  { char: '<', label: 'Scheduling', icon: 'calendar' },
];

export function isClosedStatus(status: string): boolean {
  return status.toLowerCase() === 'x' || status === '-';
}

export const QUADRANTS: Quadrant[] = ['DO', 'DECIDE', 'DELEGATE', 'DELETE', 'OPEN'];

export const QUADRANT_META: Record<
  Quadrant,
  { label: string; subtitle: string; accent: string }
> = {
  DO: {
    label: 'СДЕЛАТЬ',
    subtitle: 'Важно + Срочно',
    accent: 'var(--color-red)',
  },
  DECIDE: {
    label: 'ПОМНИТЬ',
    subtitle: 'Важно + Не срочно',
    accent: 'var(--color-blue)',
  },
  DELEGATE: {
    label: 'НАДО',
    subtitle: 'Не важно + Срочно',
    accent: 'var(--color-green)',
  },
  DELETE: {
    label: 'ТАКОЕ СЕБЕ',
    subtitle: 'Не важно + Не срочно',
    accent: 'var(--color-yellow)',
  },
  OPEN: {
    label: 'ВХОДЯЩИЕ',
    subtitle: 'Нет тега квадранта',
    accent: 'var(--text-muted)',
  },
};

export const PRIORITIES: Priority[] = ['highest', 'high', 'medium', 'low', 'lowest'];

export const PRIORITY_META: Record<
  Priority,
  { emoji: string; label: string; tone: string }
> = {
  highest: { emoji: '🔺', label: 'Highest', tone: 'var(--color-red)' },
  high: { emoji: '⏫', label: 'High', tone: 'var(--color-orange)' },
  medium: { emoji: '🔼', label: 'Medium', tone: 'var(--color-yellow)' },
  low: { emoji: '🔽', label: 'Low', tone: 'var(--color-cyan)' },
  lowest: { emoji: '⏬', label: 'Lowest', tone: 'var(--text-muted)' },
};
