/**
 * Obsidian Tasks parser — sdíleno s `Eisenhower-matrix/app/server/parser.ts`.
 * Čistá funkce, žádné fs / Obsidian API závislosti. Drž sync ručně.
 */

import type { Priority, Quadrant } from './types.ts';

const QUADRANT_TAGS = ['#DO', '#DECIDE', '#DELEGATE', '#DELETE'] as const;

const TASK_LINE = /^(\s*-\s+\[)([ xX])(\]\s+)(.*)$/;
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

const DNES_HEADING_RE = /^#\s+Dnes\s*$/i;

export type ParsedTask = {
  lineIndex: number;
  raw: string;
  checked: boolean;
  text: string;
  quadrant: Quadrant;
  contextTags: string[];
  dueDate?: string;
  startDate?: string;
  doneDate?: string;
  priority?: Priority;
};

/**
 * Parsuje celý MD soubor. Vrací tasky z sekce `# Dnes` (pokud existuje).
 */
export function parseDaily(raw: string): {
  tasks: ParsedTask[];
  dnesHeadingLine: number | null;
} {
  const lines = raw.split(/\r?\n/);
  const tasks: ParsedTask[] = [];
  let inDnes = false;
  let inCodeBlock = false;
  let dnesHeadingLine: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    if (/^#+\s/.test(line)) {
      if (DNES_HEADING_RE.test(line)) {
        inDnes = true;
        dnesHeadingLine = i;
      } else {
        inDnes = false;
      }
      continue;
    }

    if (!inDnes) continue;

    const task = parseTaskLine(line, i);
    if (task) tasks.push(task);
  }

  return { tasks, dnesHeadingLine };
}

/**
 * Parsuje VŠECHNY tasky v souboru, nezávisle na sekci. Přeskakuje code blocky.
 */
export function parseAllTasks(raw: string): ParsedTask[] {
  const lines = raw.split(/\r?\n/);
  const tasks: ParsedTask[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const task = parseTaskLine(line, i);
    if (task) tasks.push(task);
  }

  return tasks;
}

/**
 * Parsuje jeden řádek jako task. Vrací null pokud to není task řádek.
 */
export function parseTaskLine(line: string, lineIndex: number): ParsedTask | null {
  const m = TASK_LINE.exec(line);
  if (!m) return null;

  const checked = m[2].toLowerCase() === 'x';
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

  return {
    lineIndex,
    raw: line,
    checked,
    text,
    quadrant,
    contextTags,
    dueDate,
    startDate,
    doneDate,
    priority,
  };
}

function determineQuadrant(body: string): Quadrant {
  const firstTokenMatch = /^\s*(#[\p{L}][\p{L}\p{N}_-]*)/u.exec(body);
  if (!firstTokenMatch) return 'OPEN';
  const first = firstTokenMatch[1].toUpperCase();
  switch (first) {
    case '#DO':
      return 'DO';
    case '#DECIDE':
      return 'DECIDE';
    case '#DELEGATE':
      return 'DELEGATE';
    case '#DELETE':
      return 'DELETE';
    default:
      return 'OPEN';
  }
}
