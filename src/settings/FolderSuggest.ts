import { AbstractInputSuggest, type App, TFolder } from 'obsidian';

/**
 * Suggester pro text input, který zobrazuje seznam složek ve vault-u.
 * Filtruje fuzzy podle typovaného textu.
 *
 * Použití:
 * ```ts
 * .addText((text) => {
 *   text.setValue(...).onChange(...);
 *   new FolderSuggest(app, text.inputEl);
 * })
 * ```
 *
 * Po výběru se vstup naplní cestou složky a dispatchne se `input` event,
 * takže `Setting.onChange()` se zavolá automaticky.
 */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(
    app: App,
    private readonly inputEl: HTMLInputElement,
  ) {
    super(app, inputEl);
  }

  protected getSuggestions(query: string): TFolder[] {
    const lower = query.toLowerCase();
    const out: TFolder[] = [];
    const root = this.app.vault.getRoot();

    const collect = (folder: TFolder) => {
      if (folder.path && folder.path !== '/' && folder.path.toLowerCase().includes(lower)) {
        out.push(folder);
      }
      for (const child of folder.children) {
        if (child instanceof TFolder) collect(child);
      }
    };
    collect(root);

    // Seřaď: nejprve shallow složky (méně `/` v cestě), pak abecedně.
    out.sort((a, b) => {
      const depthA = (a.path.match(/\//g) ?? []).length;
      const depthB = (b.path.match(/\//g) ?? []).length;
      if (depthA !== depthB) return depthA - depthB;
      return a.path.localeCompare(b.path);
    });

    return out.slice(0, 50); // limit pro velké vaults
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }

  selectSuggestion(folder: TFolder): void {
    this.inputEl.value = folder.path;
    this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    this.close();
  }
}
