/**
 * Project-file parser.
 *
 * A "project file" (pro-*.md with frontmatter `type: project`) lists its tasks
 * per Eisenhower quadrant as wiki-links, e.g.
 *
 *   ## Задачи по проекту
 *   ### #СДЕЛАТЬ
 *   - [[dtx-publish-first-5-threads]] — описание
 *
 * That ordered list is the source of truth for the order (priority) of parent
 * (root) tasks within a project. This module extracts, per project file, an
 * ordered list of (task basename, quadrant, line index, order-within-quadrant).
 */

import type { Quadrant } from './types.ts';

export type ProjectLinkEntry = {
  basename: string;
  quadrant: Quadrant;
  lineIndex: number;
  order: number;
};

export type ProjectFileInfo = {
  isProject: boolean;
  slug: string;
  entries: ProjectLinkEntry[];
};

const H2_RE = /^##\s+/;
const QUADRANT_SUBHEADING_RE = /^###\s+(#[\p{L}\p{N}_-]+)/u;
const LINK_RE = /^\s*-\s*\[\[([^\]|#]+?)\s*(?:[|#][^\]]*)?\]\]/;

function tagToQuadrant(tag: string): Quadrant {
  switch (tag.toUpperCase()) {
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

function readFrontmatter(lines: string[]): Record<string, string> {
  const fm: Record<string, string> = {};
  if (lines[0] !== '---') return fm;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') break;
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (m) fm[m[1].toLowerCase()] = m[2].trim();
  }
  return fm;
}

export function parseProjectFile(raw: string, filename: string): ProjectFileInfo {
  const lines = raw.split(/\r?\n/);
  const fm = readFrontmatter(lines);
  const isProject = fm.type === 'project' || filename.startsWith('pro-');
  const slug = fm.slug || filename.replace(/^pro-/, '').replace(/\.md$/i, '');

  const entries: ProjectLinkEntry[] = [];
  if (!isProject) return { isProject, slug, entries };

  let inTasksSection = false;
  let currentQuadrant: Quadrant = 'OPEN';
  let order = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const sub = QUADRANT_SUBHEADING_RE.exec(line);
    if (sub) {
      // Quadrant subheadings only relabel the section. The rank counter keeps
      // running across the WHOLE project file so every task gets a unique,
      // project-wide order. (A task's real matrix quadrant comes from the tag
      // in its own file, which often differs from the section it is listed
      // under here — so a per-section reset produced duplicate ranks.)
      currentQuadrant = tagToQuadrant(sub[1]);
      continue;
    }

    if (H2_RE.test(line)) {
      // Enter the tasks section on a level-2 heading that mentions "задач",
      // leave it on any other level-2 heading.
      inTasksSection = /задач/i.test(line);
      continue;
    }

    if (!inTasksSection) continue;

    const link = LINK_RE.exec(line);
    if (link) {
      order += 1;
      entries.push({
        basename: link[1].trim(),
        quadrant: currentQuadrant,
        lineIndex: i,
        order,
      });
    }
  }

  return { isProject, slug, entries };
}
