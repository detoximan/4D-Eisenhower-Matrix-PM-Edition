import type { App } from 'obsidian';

/**
 * Vrátí složku, kam Obsidian ukládá daily notes. Respektuje core plugin
 * „Daily notes" — uživatel si tam nastavuje vlastní folder.
 *
 * Fallback: prázdný string (= vault root).
 */
export function getDailyNotesFolder(app: App): string {
  // Obsidian API přístup k internal plugins není v public typings,
  // ale je stable a používá ho celá komunita pluginů (např. periodic-notes).
  const internalPlugins = (app as unknown as InternalApp).internalPlugins;
  const dailyNotes = internalPlugins?.plugins?.['daily-notes'];
  if (dailyNotes?.enabled && dailyNotes.instance?.options?.folder !== undefined) {
    return dailyNotes.instance.options.folder ?? '';
  }
  return '';
}

/**
 * Pokud má core „Daily notes" nastavený formát, použij ho. Jinak fallback YYYY-MM-DD.
 * Pro Phase A používáme jen YYYY-MM-DD; vlastní format support přijde s settings tabem.
 */
export function getDailyNoteFilenameFormat(_app: App): string {
  return 'YYYY-MM-DD';
}

/**
 * Cesta k daily note souboru pro daný ISO datum.
 * Pro Phase A: folder + "/" + YYYY-MM-DD.md
 */
export function buildDailyNotePath(app: App, isoDate: string): string {
  const folder = getDailyNotesFolder(app);
  const filename = `${isoDate}.md`;
  return folder ? `${folder}/${filename}` : filename;
}

// === Internal Obsidian API shape (untyped in public types) ===
type InternalApp = {
  internalPlugins: {
    plugins: {
      'daily-notes'?: {
        enabled: boolean;
        instance?: {
          options?: {
            folder?: string;
            format?: string;
          };
        };
      };
    };
  };
};
