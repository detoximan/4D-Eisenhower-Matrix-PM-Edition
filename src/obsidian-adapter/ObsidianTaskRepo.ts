import type { App, TFile } from 'obsidian';
import { parseAllTasks, parseDaily } from '../core/parser.ts';
import type { Task } from '../core/types.ts';
import { buildDailyNotePath } from './dailyNotes.ts';

/**
 * Read-only přístup k taskům přes Obsidian Vault API.
 * Phase A: jen agregace; write operace přijdou ve Fázi C.
 */
export class ObsidianTaskRepo {
  private excludedFolders: string[];

  constructor(
    private app: App,
    excludedFolders: string[] = ['_templates', '1_Agents'],
  ) {
    this.excludedFolders = excludedFolders;
  }

  /**
   * Vrátí všechny tasky pro matrix view pro daný den:
   *   1. Tasky z `# Dnes` sekce v daily note (isFromDnes = true)
   *   2. Všechny nehotové tasky z ostatních MD ve vault (carry-over)
   *
   * Dedup podle sourceFile + lineIndex.
   */
  async getMatrixTasks(date: string): Promise<{
    tasks: Task[];
    todayFileExists: boolean;
    scannedFiles: number;
  }> {
    const dailyPath = buildDailyNotePath(this.app, date);
    const dailyFile = this.app.vault.getFileByPath(dailyPath);

    const dnesTasks: Task[] = [];
    let todayFileExists = false;

    if (dailyFile) {
      todayFileExists = true;
      const raw = await this.app.vault.cachedRead(dailyFile);
      const { tasks } = parseDaily(raw);
      for (const t of tasks) {
        if (t.checked) continue;
        dnesTasks.push({
          ...t,
          sourceFile: dailyFile.path,
          isFromDnes: true,
        });
      }
    }

    const allFiles = this.app.vault.getMarkdownFiles();
    const otherTasks: Task[] = [];
    let scanned = 0;

    for (const file of allFiles) {
      if (dailyFile && file.path === dailyFile.path) continue;
      if (this.isExcluded(file)) continue;

      scanned++;
      const raw = await this.app.vault.cachedRead(file);
      const tasks = parseAllTasks(raw);
      for (const t of tasks) {
        if (t.checked) continue;
        if (!t.text) continue;
        otherTasks.push({
          ...t,
          sourceFile: file.path,
          isFromDnes: false,
        });
      }
    }

    // Dedup
    const seen = new Set<string>();
    const merged: Task[] = [];
    for (const t of [...dnesTasks, ...otherTasks]) {
      const key = `${t.sourceFile}:${t.lineIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
    }

    return { tasks: merged, todayFileExists, scannedFiles: scanned };
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
