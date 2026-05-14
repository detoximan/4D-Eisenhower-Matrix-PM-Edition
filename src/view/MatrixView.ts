import { ItemView, WorkspaceLeaf } from 'obsidian';
import { createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ObsidianTaskRepo } from '../obsidian-adapter/ObsidianTaskRepo.ts';
import { MatrixApp } from './MatrixApp.tsx';
import type EisenhowerMatrixPlugin from '../../main.ts';

export const VIEW_TYPE_MATRIX = 'eisenhower-matrix-view';

export class MatrixView extends ItemView {
  private root: Root | null = null;
  private repo: ObsidianTaskRepo;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: EisenhowerMatrixPlugin,
  ) {
    super(leaf);
    this.repo = new ObsidianTaskRepo(this.app, plugin.settings.excludedFolders);
  }

  getViewType(): string {
    return VIEW_TYPE_MATRIX;
  }

  getDisplayText(): string {
    return 'Eisenhower Matrix';
  }

  getIcon(): string {
    return 'layout-grid';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('eisenhower-matrix-root');

    this.root = createRoot(container);
    this.root.render(
      createElement(
        StrictMode,
        null,
        createElement(MatrixApp, {
          app: this.app,
          repo: this.repo,
          plugin: this.plugin,
        }),
      ),
    );
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
  }
}
