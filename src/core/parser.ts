/**
 * Obsidian Tasks parser — sdíleno s `Eisenhower-matrix/app/server/parser.ts`.
 * Čistá funkce, žádné fs / Obsidian API závislosti. Drž sync ručně.
 */

import type { Priority, Quadrant } from './types.ts';

const QUADRANT_TAGS = ['#DO', '#DECIDE', '#DELEGATE', '#DELETE', '#СДЕЛАТЬ', '#ПОМНИТЬ', '#НАДО', '#ТАКОЕ-СЕБЕ'] as const;

// `[^\]]` = jakýkoli stav uvnitř hranatých závorek (kromě samotného `]`).
// Plugin pak rozliší 6 Basic stavů + ostatní (viz TASK_STATUSES v types.ts).
const TASK_LINE = /^(\s*-\s+\[)([^\]])(\]\s+)(.*)$/;
// Unicode-aware: matchuje tagy s diakritikou (#Osobní, #Příští, #Důležité…).
const TAG_TOKEN = /#[\p{L}\p{N}_-]+/gu;

const DUE_DATE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/;
const START_DATE_RE = /🛫\s*(\d{4}-\d{2}-\d{2})/;
const DONE_DATE_RE = /✅\s*(\d{4}-\d{2}-\d{2})/;

const PRIORITY_RE = /(🔺|⏫|🔼|🔽|⏬)/;
const PRIORITY_STRIP_RE = /\s*(🔺|⏫|🔼|🔽|⏬)/g;
export const PRIORITY_EMOJI: Record<Priority, string> = {
  highest: '🔺',
  high: '⏫',
  medium: '🔼',
  low: '🔽',
  lowest: '⏬',
};
const EMOJI_TO_PRIORITY: Record<string, Priority> = {
  '🔺': 'highest',
  '⏫': 'high',
  '🔼': 'medium',
  '🔽': 'low',
  '⏬': 'lowest',
};

export type ParsedTask = {
  lineIndex: number;
  raw: string;
  status: string;
  checked: boolean;
  text: string;
  quadrant: Quadrant;
  contextTags: string[];
  dueDate?: string;
  startDate?: string;
  doneDate?: string;
  priority?: Priority;
  /** Indent level — 0 = root task, 1+ = subtask. */
  indent: number;
  /** Index of parent task in the parsed array. Undefined for root tasks. */
  parentIndex?: number;
};

/**
 * Parsuje celý MD soubor. Vrací tasky z konfigurovatelné sekce
 * (`sectionHeading`, např. `# Dnes` / `# Today`).
 */
export function parseDaily(
  raw: string,
  sectionHeading: string,
): {
  tasks: ParsedTask[];
  sectionHeadingLine: number | null;
} {
  const headingNorm = sectionHeading.trim().toLowerCase();
  const lines = raw.split(/\r?\n/);
  const tasks: ParsedTask[] = [];
  let inSection = false;
  let inCodeBlock = false;
  let sectionHeadingLine: number | null = null;

  // Stack of potential parents for subtask inheritance
  const parentStack: { indent: number; quadrant: Quadrant; idx: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    if (/^#+\s/.test(line)) {
      if (line.trim().toLowerCase() === headingNorm) {
        inSection = true;
        sectionHeadingLine = i;
      } else {
        inSection = false;
      }
      continue;
    }

    if (!inSection) continue;

    const task = parseTaskLine(line, i);
    if (!task) continue;

    // Check if this task has its own quadrant tag
    const firstTagMatch = /^\s*(#[\p{L}][\p{L}\p{N}_-]*)/u.exec(task.raw);
    const firstTag = firstTagMatch?.[1]?.toUpperCase();
    const hasOwnQuadrant = firstTag && ['#DO', '#DECIDE', '#DELEGATE', '#DELETE'].includes(firstTag);

    if (task.indent > 0 && !hasOwnQuadrant) {
      // Subtask without own quadrant → inherit from nearest parent
      for (let s = parentStack.length - 1; s >= 0; s--) {
        if (parentStack[s].indent < task.indent) {
          task.quadrant = parentStack[s].quadrant;
          task.parentIndex = parentStack[s].idx;
          break;
        }
      }
    }

    // Update parent stack
    while (parentStack.length > 0 && parentStack[parentStack.length - 1].indent >= task.indent) {
      parentStack.pop();
    }
    parentStack.push({ indent: task.indent, quadrant: task.quadrant, idx: tasks.length });

    tasks.push(task);
  }

  return { tasks, sectionHeadingLine };
}

/**
 * Parsuje VŠECHNY tasky v souboru, nezávisle na sekci. Přeskakuje code blocky.
 * Subtasky (odsazené řádky bez vlastního quadrant tagu) dědí quadrant
 * od nejbližšího nadřazeného tasku s nižším odsazením.
 */
export function parseAllTasks(raw: string): ParsedTask[] {
  const lines = raw.split(/\r?\n/);
  const tasks: ParsedTask[] = [];
  let inCodeBlock = false;

  // Stack of potential parents: { indent, quadrant, indexInTasks }
  const parentStack: { indent: number; quadrant: Quadrant; idx: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const task = parseTaskLine(line, i);
    if (!task) continue;

    // Calculate indent: number of leading spaces / 2
    const indentMatch = /^(\s*)/.exec(line);
    const indent = indentMatch ? Math.floor(indentMatch[1].length / 2) : 0;
    task.indent = indent;

    // Check if this task has its own quadrant tag
    const firstTagMatch = /^\s*(#[\p{L}][\p{L}\p{N}_-]*)/u.exec(task.raw);
    const firstTag = firstTagMatch?.[1]?.toUpperCase();
    const hasOwnQuadrant = firstTag && ['#DO', '#DECIDE', '#DELEGATE', '#DELETE'].includes(firstTag);

    if (indent > 0 && !hasOwnQuadrant) {
      // Subtask without own quadrant → inherit from nearest parent with lower indent
      for (let s = parentStack.length - 1; s >= 0; s--) {
        if (parentStack[s].indent < indent) {
          task.quadrant = parentStack[s].quadrant;
          task.parentIndex = parentStack[s].idx;
          break;
        }
      }
    }

    // Update parent stack: remove entries with indent >= current
    while (parentStack.length > 0 && parentStack[parentStack.length - 1].indent >= indent) {
      parentStack.pop();
    }
    parentStack.push({ indent, quadrant: task.quadrant, idx: tasks.length });

    tasks.push(task);
  }

  return tasks;
}

/**
 * Parsuje jeden řádek jako task. Vrací null pokud to není task řádek.
 */
export function parseTaskLine(line: string, lineIndex: number): ParsedTask | null {
  const m = TASK_LINE.exec(line);
  if (!m) return null;

  const status = m[2];
  const checked = status.toLowerCase() === 'x';
  const body = m[4];

  const quadrant = determineQuadrant(body);

  const contextTags: string[] = [];
  const allTags = body.match(TAG_TOKEN) ?? [];
  for (const t of allTags) {
    if (!QUADRANT_TAGS.includes(t.toUpperCase() as (typeof QUADRANT_TAGS)[number])) {
      contextTags.push(t);
    }
  }

  const dueDate = DUE_DATE_RE.exec(body)?.[1];
  const startDate = START_DATE_RE.exec(body)?.[1];
  const doneDate = DONE_DATE_RE.exec(body)?.[1];

  const priorityMatch = PRIORITY_RE.exec(body)?.[1];
  const priority = priorityMatch ? EMOJI_TO_PRIORITY[priorityMatch] : undefined;

  let text = body;
  // strip leading hash-tags (quadrant + context na začátku)
  text = text.replace(/^(\s*#[\p{L}\p{N}_-]+)+\s*/u, '');
  // strip emoji datumy + priority
  text = text
    .replace(DUE_DATE_RE, '')
    .replace(START_DATE_RE, '')
    .replace(DONE_DATE_RE, '')
    .replace(PRIORITY_STRIP_RE, '');
  text = text.replace(/\s+/g, ' ').trim();

  // Calculate indent level from leading whitespace
  const indentMatch = /^(\s*)/.exec(line);
  const indent = indentMatch ? Math.floor(indentMatch[1].length / 2) : 0;

  return {
    lineIndex,
    raw: line,
    status,
    checked,
    text,
    quadrant,
    contextTags,
    dueDate,
    startDate,
    doneDate,
    priority,
    indent,
  };
}

function determineQuadrant(body: string): Quadrant {
  const firstTokenMatch = /^\s*(#[\p{L}][\p{L}\p{N}_-]*)/u.exec(body);
  if (!firstTokenMatch) return 'OPEN';
  const first = firstTokenMatch[1].toUpperCase();
  switch (first) {
    case '#DO':
    case '#СДЕЛАТЬ':
      return 'DO';
    case '#DECIDE':
    case '#ПОМНИТЬ':
      return 'DECIDE';
    case '#DELEGATE':
    case '#НАДО':
      return 'DELEGATE';
    case '#DELETE':
    case '#ТАКОЕ-СЕБЕ':
      return 'DELETE';
    default:
      return 'OPEN';
  }
}
