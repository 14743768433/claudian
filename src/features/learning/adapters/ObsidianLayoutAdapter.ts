import { TFile, type WorkspaceLeaf } from 'obsidian';

import { VIEW_TYPE_CLAUDIAN } from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { revealWorkspaceLeaf } from '../../../utils/obsidianCompat';
import type { LayoutPort } from '../ports/LayoutPort';
import {
  VIEW_TYPE_CHAPTER_LIST,
  VIEW_TYPE_COURSE_ARTIFACTS,
  VIEW_TYPE_COURSE_LIBRARY,
} from '../views/viewTypes';

type CourseAwareView = {
  setCourseId?: (courseId: string) => void;
  render?: () => Promise<void> | void;
};

type ChatView = {
  getTabManager?: () => { openConversation: (id: string) => Promise<void> } | null;
};

function asCourseAwareView(leaf: WorkspaceLeaf): CourseAwareView {
  return (leaf.view ?? {}) as CourseAwareView;
}

export class ObsidianLayoutAdapter implements LayoutPort {
  constructor(private readonly plugin: ClaudianPlugin) {}

  async openLibraryTab(): Promise<void> {
    const leaf = this.plugin.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE_COURSE_LIBRARY, active: true });
    await asCourseAwareView(leaf).render?.();
  }

  async ensureSideLeaves(courseId: string): Promise<void> {
    const workspace = this.plugin.app.workspace;
    const leftLeaf = workspace.getLeftLeaf(false) ?? workspace.getLeftLeaf(true);
    if (leftLeaf) {
      await leftLeaf.setViewState({ type: VIEW_TYPE_CHAPTER_LIST, active: true });
      asCourseAwareView(leftLeaf).setCourseId?.(courseId);
      await revealWorkspaceLeaf(workspace, leftLeaf);
    }

    const rightLeaf = workspace.getRightLeaf(false) ?? workspace.getRightLeaf(true);
    if (rightLeaf) {
      await rightLeaf.setViewState({ type: VIEW_TYPE_COURSE_ARTIFACTS, active: true });
      asCourseAwareView(rightLeaf).setCourseId?.(courseId);
      await revealWorkspaceLeaf(workspace, rightLeaf);
    }
  }

  async focusChatForConversation(conversationId: string): Promise<void> {
    const workspace = this.plugin.app.workspace;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN)[0] ?? null;

    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE_CLAUDIAN, active: true });
    }
    await revealWorkspaceLeaf(workspace, leaf);

    const view = leaf.view && typeof (leaf.view as ChatView).getTabManager === 'function'
      ? leaf.view as ChatView
      : this.plugin.getView();
    const tabManager = view?.getTabManager?.();
    if (tabManager) {
      await tabManager.openConversation(conversationId);
    }
  }

  async revealNotePane(path: string): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath?.(path);
    if (!(file instanceof TFile)) {
      throw new Error('File is missing.');
    }
    const leaf = this.plugin.app.workspace.getLeaf('split', 'vertical');
    await leaf.openFile(file);
  }

  async refreshLearningViews(courseId: string): Promise<void> {
    for (const leaf of this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CHAPTER_LIST)) {
      asCourseAwareView(leaf).setCourseId?.(courseId);
    }
    for (const leaf of this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_COURSE_ARTIFACTS)) {
      asCourseAwareView(leaf).setCourseId?.(courseId);
    }
  }

  refreshChatLearningControls(): void {
    for (const view of this.plugin.getAllViews()) {
      view.refreshLearningControls();
    }
  }
}
