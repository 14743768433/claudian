export interface LayoutPort {
  openLibraryTab(): Promise<void>;
  ensureSideLeaves(courseId: string): Promise<void>;
  focusChatForConversation(conversationId: string): Promise<void>;
  revealNotePane(path: string): Promise<void>;
  refreshLearningViews(courseId: string): Promise<void>;
  refreshChatLearningControls(): void;
}
