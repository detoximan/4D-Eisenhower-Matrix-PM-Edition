import { MarkdownView, type App, type TFile } from 'obsidian';
import { parseAllTasks, parseDaily } from '../core/parser.ts';
import { parseProjectFile } from '../core/projectFiles.ts';
import {
  appendTaskUnderHeading,
  moveBlockInContent,
  moveLineQuadrant,
  setDueDateOnLine,
  setStatusOnLine,
  toggleLine,
  transformLineInContent,
  updateLineTextAndTags,
  type UpdateOptions,
} from '../core/lineOps.ts';
import type { Priority, Quadrant, Task } from '../core/types.ts';
import {
  buildDailyNotePath,
  ensureDailyExists,
  getDailyNotesFolder,
} from './dailyNotes.ts';

const DATE_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;

/**
 * Read + write přístup k taskům přes Obsidian Vault API.
 * Write operace běží přes `app.vault.process()` — atomic + serializovaný.
 */
export class ObsidianTaskRepo {
  private excludedFolders: string[];
  private dailyFolderOverride: string;
  private sectionHeading: string;

  constructor(
    private app: App,
    excludedFolders: string[] = [],
    dailyFolderOverride: string = '',
    sectionHeading: string = '# Today',
  ) {
    this.excludedFolders = excludedFolders;
    this.dailyFolderOverride = dailyFolderOverride;
    this.sectionHeading = sectionHeading;
  }

  setDailyFolderOverride(folder: string) {
    this.dailyFolderOverride = folder;
  }

  setSectionHeading(heading: string) {
    this.sectionHeading = heading;
  }

  // ============================================================
  // READ
  // ============================================================

  async getMatrixTasks(date: string): Promise<{
    tasks: Task[];
    todayFileExists: boolean;
    scannedFiles: number;
  }> {
    const dailyPath = buildDailyNotePath(this.app, date, this.dailyFolderOverride);
    const dailyFile = this.app.vault.getFileByPath(dailyPath);

    const dnesTasks: Task[] = [];
    let todayFileExists = false;

    if (dailyFile) {
      todayFileExists = true;
      const raw = await this.app.vault.cachedRead(dailyFile);
      const { tasks } = parseDaily(raw, this.sectionHeading);
      for (const t of tasks) {
        dnesTasks.push({ ...t, sourceFile: dailyFile.path, isFromDnes: true });
      }
    }

    const allFiles = this.app.vault.getMarkdownFiles();
    const otherTasks: Task[] = [];
    const projectByBasename = new Map<
      string,
      { projectKey: string; slug: string; order: number; linkLine: number }
    >();
    let scanned = 0;

    for (const file of allFiles) {
      if (dailyFile && file.path === dailyFile.path) continue;
      if (this.isExcluded(file)) continue;

      scanned++;
      const raw = await this.app.vault.cachedRead(file);

      const proj = parseProjectFile(raw, file.name);
      if (proj.isProject) {
        for (const e of proj.entries) {
          if (!projectByBasename.has(e.basename)) {
            projectByBasename.set(e.basename, {
              projectKey: file.path,
              slug: proj.slug,
              order: e.order,
              linkLine: e.lineIndex,
            });
          }
        }
      }

      const tasks = parseAllTasks(raw);
      for (const t of tasks) {
        if (!t.text) continue;
        otherTasks.push({ ...t, sourceFile: file.path, isFromDnes: false });
      }
    }

    const seen = new Set<string>();
    const merged: Task[] = [];
    for (const t of [...dnesTasks, ...otherTasks]) {
      const key = `${t.sourceFile}:${t.lineIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
    }

    // Rebuild parentIndex after merging — parser sets parentIndex relative
    // to a single file's task array, which breaks when tasks from multiple
    // files are merged into one array.
    rebuildParentIndices(merged);

    // Attach project info to root tasks based on which project file links them.
    for (const t of merged) {
      if (t.indent !== 0) continue;
      const base = basenameNoExt(t.sourceFile);
      const info = projectByBasename.get(base);
      if (info) {
        t.projectKey = info.projectKey;
        t.projectSlug = info.slug;
        t.projectOrder = info.order;
        t.projectLinkLine = info.linkLine;
      }
    }

    return { tasks: merged, todayFileExists, scannedFiles: scanned };
  }

  getExistingDailyDates(): Set<string> {
    const folder = getDailyNotesFolder(this.app, this.dailyFolderOverride);
    const dates = new Set<string>();
    const files = this.app.vault.getMarkdownFiles();
    for (const f of files) {
      const fileDir = f.parent?.path ?? '';
      const inFolder =
        folder === '' ? (fileDir === '' || fileDir === '/') : fileDir === folder;
      if (!inFolder) continue;
      const m = DATE_FILE_RE.exec(f.name);
      if (m) dates.add(m[1]);
    }
    return dates;
  }

  // ============================================================
  // WRITE
  // ============================================================

  async toggleTask(sourceFile: string, lineIndex: number, todayISO: string): Promise<void> {
    const file = this.requireFile(sourceFile);
    await this.app.vault.process(file, (content) =>
      transformLineInContent(content, lineIndex, (line) => toggleLine(line, todayISO).newLine),
    );
  }

  async setStatus(
    sourceFile: string,
    lineIndex: number,
    status: string,
    todayISO: string,
  ): Promise<void> {
    const file = this.requireFile(sourceFile);
    await this.app.vault.process(file, (content) =>
      transformLineInContent(
        content,
        lineIndex,
        (line) => setStatusOnLine(line, status, todayISO).newLine,
      ),
    );
  }

  /**
   * Kanban drop ze spodního kvadrantu do status-sloupce: změní zároveň
   * kvadrant (#tag) i status (checkbox) v jednom zápisu.
   */
  async moveAndSetStatus(
    sourceFile: string,
    lineIndex: number,
    newQuadrant: Quadrant,
    status: string,
    todayISO: string,
  ): Promise<void> {
    const file = this.requireFile(sourceFile);
    await this.app.vault.process(file, (content) =>
      transformLineInContent(content, lineIndex, (line) => {
        const moved = moveLineQuadrant(line, newQuadrant).newLine;
        return setStatusOnLine(moved, status, todayISO).newLine;
      }),
    );
  }

  async moveTask(
    sourceFile: string,
    lineIndex: number,
    newQuadrant: Quadrant,
  ): Promise<void> {
    const file = this.requireFile(sourceFile);
    await this.app.vault.process(file, (content) =>
      transformLineInContent(
        content,
        lineIndex,
        (line) => moveLineQuadrant(line, newQuadrant).newLine,
      ),
    );
  }

  /**
   * Reorder a block of lines (task + subtasks) within the same file.
   * Used by drag-and-drop in "manual" sort mode.
   *
   * @param sourceFile  - File containing both source and target
   * @param sourceStart - First line of dragged block (inclusive, 0-based)
   * @param sourceEnd   - Last line of dragged block (inclusive, 0-based)
   * @param targetLine  - Line index where the block should be placed
   *                      (position BEFORE which to insert, after removing block)
   */
  async reorderTaskBlock(
    sourceFile: string,
    sourceStart: number,
    sourceEnd: number,
    targetLine: number,
  ): Promise<void> {
    const file = this.requireFile(sourceFile);
    await this.app.vault.process(file, (content) =>
      moveBlockInContent(content, sourceStart, sourceEnd, targetLine),
    );
  }

  /**
   * Reorder a single [[link]] line inside a project file (pro-*.md). Used when
   * dragging root/parent tasks in manual sort mode — the order of parent tasks
   * lives in the project file, not in the individual task files.
   */
  async reorderProjectLink(
    projectFile: string,
    sourceLine: number,
    targetLine: number,
  ): Promise<void> {
    const file = this.requireFile(projectFile);
    await this.app.vault.process(file, (content) =>
      moveBlockInContent(content, sourceLine, sourceLine, targetLine),
    );
  }

  async setDueDate(
    sourceFile: string,
    lineIndex: number,
    newDueDate: string | null,
  ): Promise<void> {
    const file = this.requireFile(sourceFile);
    await this.app.vault.process(file, (content) =>
      transformLineInContent(
        content,
        lineIndex,
        (line) => setDueDateOnLine(line, newDueDate).newLine,
      ),
    );
  }

  async updateTask(
    sourceFile: string,
    lineIndex: number,
    text: string,
    contextTags: string[],
    options: UpdateOptions = {},
  ): Promise<void> {
    const file = this.requireFile(sourceFile);
    await this.app.vault.process(file, (content) =>
      transformLineInContent(
        content,
        lineIndex,
        (line) => updateLineTextAndTags(line, text, contextTags, options).newLine,
      ),
    );
  }

  /**
   * Přidá task pod sekční heading v daily note pro `date`. Pokud daily note
   * neexistuje, vytvoří ji přes core „Daily notes" template (nebo minimum scaffold).
   *
   * Vrací `sourceFile` (cestu k daily souboru) — UI ji pak může použít pro refetch.
   */
  async addTask(
    date: string,
    text: string,
    quadrant: Quadrant,
    dueDate?: string | null,
    priority?: Priority | null,
    status: string = ' ',
  ): Promise<{ sourceFile: string; lineIndex: number; newLine: string }> {
    const file = await ensureDailyExists(
      this.app,
      date,
      this.sectionHeading,
      this.dailyFolderOverride,
    );

    let lineIndex = -1;
    let newLine = '';
    await this.app.vault.process(file, (content) => {
      const result = appendTaskUnderHeading(
        content,
        this.sectionHeading,
        text,
        quadrant,
        date,
        dueDate,
        priority,
        status,
      );
      lineIndex = result.lineIndex;
      newLine = result.newLine;
      return result.newContent;
    });

    // U právě vytvořeného daily souboru se občas stane, že už otevřené
    // reading view nezareaguje na první modify event a uživatel pak nový
    // task v náhledu nevidí, dokud nepřepne do edit modu. Proaktivně
    // překreslíme všechny otevřené preview viewy téhož souboru.
    this.refreshOpenPreviews(file);

    return { sourceFile: file.path, lineIndex, newLine };
  }

  private refreshOpenPreviews(file: TFile): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (
        view instanceof MarkdownView &&
        view.file?.path === file.path &&
        view.getMode() === 'preview'
      ) {
        view.previewMode?.rerender(true);
      }
    });
  }

  // ============================================================
  // Helpers
  // ============================================================

  private requireFile(sourcePath: string): TFile {
    const file = this.app.vault.getFileByPath(sourcePath);
    if (!file) throw new Error(`File not found in vault: ${sourcePath}`);
    return file;
  }

  private isExcluded(file: TFile): boolean {
    return this.excludedFolders.some(
      (folder) => file.path === folder || file.path.startsWith(folder + '/'),
    );
  }

  setExcludedFolders(folders: string[]) {
    this.excludedFolders = folders;
  }
}

/**
 * After merging tasks from multiple files, parentIndex values from the parser
 * are relative to each file's own task array and no longer point to the
 * correct parent in the merged array. This function rebuilds parentIndex
 * by matching (sourceFile, lineIndex) of each subtask to its parent.
 *
 * Also ensures that subtasks without their own quadrant tag inherit the
 * quadrant from their nearest preceding parent with lower indent.
 */
function basenameNoExt(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.md$/i, '');
}

function rebuildParentIndices(tasks: Task[]): void {
  // Build a lookup: sourceFile:lineIndex → merged array index
  const indexByKey = new Map<string, number>();
  for (let i = 0; i < tasks.length; i++) {
    indexByKey.set(`${tasks[i].sourceFile}:${tasks[i].lineIndex}`, i);
  }

  // For each task, if it has indent > 0 and no own quadrant tag,
  // find the nearest preceding task in the SAME file with lower indent.
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.indent === 0) {
      t.parentIndex = undefined;
      continue;
    }

    // Walk backwards in the merged array to find a parent in the same file
    // with a strictly lower indent
    let found = false;
    for (let j = i - 1; j >= 0; j--) {
      const candidate = tasks[j];
      if (candidate.sourceFile !== t.sourceFile) continue;
      if (candidate.indent < t.indent) {
        t.parentIndex = j;
        // Inherit quadrant from parent if this subtask has no own quadrant tag
        // (the parser already does this per-file, but after merge the quadrant
        // should still be correct since we preserve it)
        t.quadrant = candidate.quadrant;
        found = true;
        break;
      }
    }
    if (!found) {
      t.parentIndex = undefined;
    }
  }
}
