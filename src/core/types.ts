/**
 * Core types — sdíleno s `Eisenhower-matrix/app` web verzí.
 * Drž sync ručně. Při změně v jedné kopii uprav i druhou.
 */

export type Quadrant = 'DO' | 'DECIDE' | 'DELEGATE' | 'DELETE' | 'OPEN';

export type Priority = 'highest' | 'high' | 'medium' | 'low' | 'lowest';

export type Task = {
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
  sourceFile: string;
  isFromDnes: boolean;
};

export const QUADRANTS: Quadrant[] = ['DO', 'DECIDE', 'DELEGATE', 'DELETE', 'OPEN'];

export const QUADRANT_META: Record<
  Quadrant,
  { label: string; subtitle: string; accent: string }
> = {
  DO: {
    label: 'DO',
    subtitle: 'Důležité + Urgent',
    accent: 'var(--color-red)',
  },
  DECIDE: {
    label: 'DECIDE',
    subtitle: 'Důležité + Less Urgent',
    accent: 'var(--color-blue)',
  },
  DELEGATE: {
    label: 'DELEGATE',
    subtitle: 'Less Important + Urgent',
    accent: 'var(--color-green)',
  },
  DELETE: {
    label: 'DELETE',
    subtitle: 'Less Important + Less Urgent',
    accent: 'var(--color-yellow)',
  },
  OPEN: {
    label: 'OPEN',
    subtitle: 'Bez quadrant tagu',
    accent: 'var(--text-muted)',
  },
};

export const PRIORITIES: Priority[] = ['highest', 'high', 'medium', 'low', 'lowest'];

export const PRIORITY_META: Record<
  Priority,
  { emoji: string; label: string; tone: string }
> = {
  highest: { emoji: '🔺', label: 'Nejvyšší', tone: 'var(--color-red)' },
  high: { emoji: '⏫', label: 'Vysoká', tone: 'var(--color-orange)' },
  medium: { emoji: '🔼', label: 'Střední', tone: 'var(--color-yellow)' },
  low: { emoji: '🔽', label: 'Nízká', tone: 'var(--color-cyan)' },
  lowest: { emoji: '⏬', label: 'Nejnižší', tone: 'var(--text-muted)' },
};
