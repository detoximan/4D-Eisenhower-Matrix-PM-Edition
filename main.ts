import { Plugin, WorkspaceLeaf } from 'obsidian';
import { MatrixView, VIEW_TYPE_MATRIX } from './src/view/MatrixView.ts';

export default class EisenhowerMatrixPlugin extends Plugin {
  async onload(): Promise<void> {
    console.log('[Eisenhower Matrix] loading plugin');

    this.registerView(VIEW_TYPE_MATRIX, (leaf) => new MatrixView(leaf));

    this.addRibbonIcon('layout-grid', 'Open Eisenhower Matrix', () => {
      void this.activateView();
    });

    this.addCommand({
      id: 'open-eisenhower-matrix',
      name: 'Open Eisenhower Matrix',
      callback: () => {
        void this.activateView();
      },
    });
  }

  async onunload(): Promise<void> {
    console.log('[Eisenhower Matrix] unloading plugin');
  }

  /**
   * Otevři view v hlavním panelu. Pokud už existuje, jen ho zaměř.
   */
  private async activateView(): Promise<void> {
    const { workspace } = this.app;

    const existing = workspace.getLeavesOfType(VIEW_TYPE_MATRIX);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf: WorkspaceLeaf | null = workspace.getLeaf('tab');
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE_MATRIX, active: true });
    workspace.revealLeaf(leaf);
  }
}
